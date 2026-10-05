/**
 * In-memory + on-disk store for clipboard history.
 *
 * Responsibilities:
 *   - Keep an ordered list (most recent first) of ClipboardItem.
 *   - Deduplicate by content signature so re-copies bump `hitCount` instead of
 *     adding a clone.
 *   - Enforce a size cap, evicting the oldest *unpinned* items.
 *   - Persist the index to JSON and image bytes to per-item PNG files.
 *   - Convert internal items to the serializable DTO form for the renderer.
 */
import { existsSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync, renameSync, realpathSync } from 'node:fs'
import { join, extname, dirname, basename as pathBasename } from 'node:path'
import { nativeImage, safeStorage } from 'electron'
import { thumbnailUrlForFile, thumbnailUrlForStoredImage } from '../main/imageProtocol'
import {
  type ClipboardItem,
  type ClipboardItemDto,
  type DragRequest,
  type ItemData,
  type MergeResult,
  type FileEntry,
  type SourceApp,
  type ClipboardImageFields,
  MAX_STACK
} from '../../shared/types'
import { PATHS } from './paths'
import { createId } from './ids'
import { contentSignature } from './signature'
import { writeFileAtomicSync } from './atomicWrite'
import { MAX_ITEM_HTML_CHARS, MAX_PAYLOAD_CHARS, MAX_ORIGINAL_IMAGE_BYTES, MAC_PNG_TYPE, MAC_TIFF_TYPE, isPngBytes, isTiffBytes } from '../clipboard/formats'
import { isValidFilePath } from '../main/pathValidation'

const MAX_TITLE_CHARS = 120
const MAX_OCR_TEXT_CHARS = 20_000
const MAX_CORRUPTED_COPIES = 3
const MAX_IMPORT_ITEMS = 5000
const RECONCILE_MIN_AGE_MS = 60_000
const MAX_IMPORT_TEXT_CHARS = 10_000_000
const MAX_IMPORT_PATHS = 1000
const MAX_IMPORT_DIMENSION = 100_000
const PINNED_EXPORT_FORMAT = 'edge-drop-pinned'
const PINNED_EXPORT_VERSION = 1

type TextPayloadKind = 'txt' | 'html' | 'rtf'
const TEXT_PAYLOAD_KINDS: readonly TextPayloadKind[] = ['txt', 'html', 'rtf']

export interface ItemMeta {
  sourceApp?: SourceApp
  rtf?: string
}

interface PinnedExportCommon {
  capturedAt: number
  title?: string
  sourceApp?: SourceApp
}

export interface PinnedExportImage {
  width: number
  height: number
  bytes: number
  source?: ClipboardImageFields['source']
  fileName?: string
  png: string
}

export type PinnedExportItem = PinnedExportCommon &
  (
    | { kind: 'text'; text: string; html?: string; rtf?: string; isUrl: boolean; isColor?: boolean }
    | ({ kind: 'image' } & PinnedExportImage)
    | { kind: 'image-collection'; images: PinnedExportImage[] }
    | { kind: 'files'; paths: string[] }
  )

export interface PinnedExport {
  format: typeof PINNED_EXPORT_FORMAT
  version: typeof PINNED_EXPORT_VERSION
  exportedAt: string
  items: PinnedExportItem[]
}

function resolveImportedPath(p: string): string | null {
  try {
    const real = realpathSync.native(p)
    const st = statSync(real)
    return st.isFile() || st.isDirectory() ? real : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TITLE_CHARS) : ''
}

function cleanSourceApp(value: unknown): SourceApp | undefined {
  if (!isRecord(value)) return undefined
  const { bundleId, name } = value
  if (typeof bundleId !== 'string' || !bundleId || bundleId.length > 255) return undefined
  return typeof name === 'string' && name && name.length <= 255 ? { bundleId, name } : { bundleId }
}

function isDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_IMPORT_DIMENSION
}

/** Maps a signature -> item id so dedup is O(1). */
interface Index {
  items: ClipboardItem[]
}

/**
 * Invoked with every batch of items permanently removed from history, no
 * matter which door removed them (manual delete, batch delete, clear,
 * auto-delete prune, or silent capacity eviction). The staged-temp lifecycle
 * manager uses it to reap orphaned artifacts.
 */
export type ItemsRemovedListener = (removed: readonly ClipboardItem[]) => void

export class ItemStore {
  private items: ClipboardItem[] = []
  private sigToId = new Map<string, string>()
  private payloadSigs = new Map<string, string>()
  /** Small, bounded thumbnails for renderer DTOs. Original image bytes stay on disk. */
  private previewCache = new Map<string, string>()

  constructor(private readonly onRemoved?: ItemsRemovedListener) {}

  private notifyRemoved(removed: ClipboardItem[]): void {
    if (removed.length === 0) return
    try {
      this.onRemoved?.(removed)
    } catch (err) {
      console.error('[ItemStore] onRemoved listener failed:', err)
    }
  }

  /** Load persisted state from disk. Called once at startup. */
  load(): void {
    try {
      const file = PATHS.indexFile()
      if (!existsSync(file)) {
        this.items = []
        this.rebuildIndex()
        return
      }

      const rawBuffer = readFileSync(file)
      const rawStr = rawBuffer.toString('utf8').trim()
      const mac = process.platform === 'darwin'
      let parsedIndex: Index | null = null
      let needsMigration = false
      let encryptedOnDisk = false

      let parsedJson: any = null
      try {
        parsedJson = JSON.parse(rawStr)
      } catch {
        /* Raw non-JSON payload */
      }

      if (parsedJson && parsedJson.encrypted === true && typeof parsedJson.payload === 'string') {
        // Encrypted DPAPI Envelope
        if (safeStorage.isEncryptionAvailable()) {
          try {
            const decryptedStr = safeStorage.decryptString(Buffer.from(parsedJson.payload, 'base64'))
            parsedIndex = JSON.parse(decryptedStr) as Index
          } catch (err) {
            console.error('[ItemStore] DPAPI decryption failed:', err)
          }
        } else {
          console.warn('[ItemStore] safeStorage unavailable to decrypt items.json')
        }
        encryptedOnDisk = true
      } else if (parsedJson && Array.isArray(parsedJson.items)) {
        // Plain JSON (Legacy v0.1.1 format from active users)
        parsedIndex = parsedJson as Index
        needsMigration = !mac
      }

      if (parsedIndex && Array.isArray(parsedIndex.items)) {
        this.items = parsedIndex.items.filter((it) => it && it.data && typeof it.id === 'string')
        const droppedEntries = parsedIndex.items.length - this.items.length

        // Auto-migrate large text items to disk payload files
        let migratedAnyPayloads = false
        for (const it of this.items) {
          if (it.data.kind === 'text') {
            if (!it.data.hasFullPayload && it.data.text.length > 300) {
              this.writeTextPayload(it.id, it.data.text)
              it.data.hasFullPayload = true
              it.data.previewText = it.data.text.slice(0, 300)
              it.data.text = it.data.previewText
              migratedAnyPayloads = true
            }
            if (it.data.html && it.data.html.length > MAX_ITEM_HTML_CHARS) {
              if (mac) this.writePayload(it.id, 'html', it.data.html)
              delete it.data.html
              migratedAnyPayloads = true
            }
          }
        }

        this.rebuildIndex()

        // Auto-migrate legacy plain JSON: create backup & upgrade to DPAPI encryption
        if (mac) {
          if (encryptedOnDisk || migratedAnyPayloads) this.persist()
        } else if (needsMigration || migratedAnyPayloads) {
          console.log('[ItemStore] Migrating items.json to DPAPI safeStorage encryption and disk payloads...')
          try {
            const backupFile = `${file}.v1.bak`
            if (!existsSync(backupFile)) {
              writeFileSync(backupFile, rawBuffer)
            }
            this.persist()
          } catch (err) {
            console.error('[ItemStore] Auto-migration backup/persist failed:', err)
          }
        }

        if (mac && droppedEntries === 0 && !existsSync(this.encryptedBackupPath(file))) this.reconcileStorage()
      } else if (mac && encryptedOnDisk) {
        console.warn('[ItemStore] items.json is encrypted and cannot be decrypted; starting with an empty history')
        this.items = []
        this.rebuildIndex()
        this.setAsideEncryptedIndex(file)
      } else {
        console.warn('[ItemStore] Index file could not be parsed; preserving data without wiping')
        const backupFile = `${file}.corrupted.${Date.now()}`
        try { writeFileSync(backupFile, rawBuffer) } catch { /* ignore */ }
        if (mac) this.pruneCorruptedCopies(file)
      }
    } catch (err) {
      console.error('[ItemStore] Failed to load index file:', err)
      this.items = []
      this.sigToId.clear()
      this.payloadSigs.clear()
    }
  }

  private encryptedBackupPath(file: string): string {
    return `${file}.encrypted-backup`
  }

  private setAsideEncryptedIndex(file: string): void {
    const backup = this.encryptedBackupPath(file)
    try {
      renameSync(file, existsSync(backup) ? `${file}.corrupted.${Date.now()}` : backup)
    } catch (err) {
      console.error('[ItemStore] Failed to move the encrypted index aside:', err)
    }
    this.pruneCorruptedCopies(file)
  }

  private pruneCorruptedCopies(file: string): void {
    const dir = dirname(file)
    const prefix = `${pathBasename(file)}.corrupted.`
    try {
      const copies = readdirSync(dir)
        .filter((name) => name.startsWith(prefix))
        .sort((a, b) => (Number(b.slice(prefix.length)) || 0) - (Number(a.slice(prefix.length)) || 0))
      for (const name of copies.slice(MAX_CORRUPTED_COPIES)) {
        rmSync(join(dir, name), { force: true })
      }
    } catch (err) {
      console.error('[ItemStore] Failed to prune corrupted index copies:', err)
    }
  }

  private rebuildIndex(): void {
    this.sigToId.clear()
    for (const it of this.items) {
      this.sigToId.set(this.signatureOf(it), it.id)
    }
  }

  private signatureOf(it: ClipboardItem): string {
    if (it.data.kind === 'text' && it.data.hasFullPayload) {
      let sig = this.payloadSigs.get(it.id)
      if (!sig) {
        sig = contentSignature({ ...it.data, text: this.getFullText(it.id) })
        this.payloadSigs.set(it.id, sig)
      }
      return sig
    }
    return contentSignature(it.data)
  }

  private reconcileStorage(): void {
    const imagesDir = PATHS.imagesDir()
    const sameDir = (a: string, b: string): boolean =>
      process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
    const imageIds = new Set<string>()
    const payloadIds = new Set<string>()
    for (const it of this.items) {
      if (it.data.kind === 'text') payloadIds.add(it.id)
      else if (it.data.kind === 'image') imageIds.add(it.data.imageId)
      else if (it.data.kind === 'image-collection') it.data.images.forEach((img) => imageIds.add(img.imageId))
      else if (it.data.kind === 'files') {
        for (const p of it.data.paths) {
          if (sameDir(dirname(p), imagesDir)) imageIds.add(pathBasename(p).split('.')[0])
        }
      }
    }

    const newerThan = Date.now() - RECONCILE_MIN_AGE_MS
    const sweep = (dir: string, keep: (name: string) => boolean): void => {
      let names: string[] = []
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      for (const name of names) {
        if (keep(name)) continue
        try {
          const file = join(dir, name)
          if (statSync(file).mtimeMs > newerThan) continue
          rmSync(file, { force: true })
        } catch {}
      }
    }

    sweep(PATHS.payloadsDir(), (name) => {
      const dot = name.lastIndexOf('.')
      return dot > 0 && TEXT_PAYLOAD_KINDS.includes(name.slice(dot + 1) as TextPayloadKind) && payloadIds.has(name.slice(0, dot))
    })
    sweep(imagesDir, (name) => imageIds.has(name.split('.')[0]))
    sweep(PATHS.thumbnailsDir(), (name) => !name.endsWith('.tmp') && imageIds.has(name.split('.')[0]))
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null

  /** Persist the current index to disk. Debounced to prevent main thread blocking during UI transitions. */
  private persist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistSync()
    }, 150)
  }

  /** Synchronous disk write (called by debounced timer or on app shutdown). */
  public persistSync(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    try {
      const indexObj: Index = { items: this.items }
      const jsonStr = JSON.stringify(indexObj)
      const file = PATHS.indexFile()

      if (process.platform === 'darwin') {
        writeFileAtomicSync(file, jsonStr)
      } else if (safeStorage.isEncryptionAvailable()) {
        const encryptedBuf = safeStorage.encryptString(jsonStr)
        const envelope = {
          v: 2,
          encrypted: true,
          payload: encryptedBuf.toString('base64')
        }
        writeFileAtomicSync(file, JSON.stringify(envelope))
      } else {
        writeFileAtomicSync(file, jsonStr)
      }
    } catch (err) {
      console.error('[ItemStore] Persistence failed:', err)
    }
  }

  /**
   * Enforce the size cap by evicting oldest *unpinned* items. Walks from the
   * tail (oldest) forward, skipping anything pinned so favorites survive.
   */
  private trim(limit: number): void {
    if (this.items.length <= limit) return
    const need = this.items.length - limit
    const survivors: ClipboardItem[] = []
    const evicted: ClipboardItem[] = []
    let stillNeed = need
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      if (stillNeed > 0 && !it.pinned) {
        this.sigToId.delete(this.signatureOf(it))
        if (it.data.kind === 'image') this.removeImageFile(it.data.imageId)
        if (it.data.kind === 'image-collection') {
          it.data.images.forEach((img) => this.removeImageFile(img.imageId))
        }
        if (it.data.kind === 'text') this.removeTextPayload(it.id)
        evicted.push(it)
        stillNeed--
      } else {
        survivors.unshift(it)
      }
    }
    this.items = survivors
    this.notifyRemoved(evicted)
  }

  /**
   * Add or refresh a piece of content.
   * Returns true if the list actually changed (so callers can decide to push).
   */
  add(data: ItemData, limit: number, meta?: ItemMeta): boolean {
    if (process.platform !== 'darwin' && data.kind === 'text' && data.text.length > 500000) {
      data = { ...data, text: data.text.slice(0, 500000) }
    }
    const sig = contentSignature(data)
    const existingId = this.sigToId.get(sig)
    const now = Date.now()

    if (existingId) {
      const idx = this.items.findIndex((it) => it.id === existingId)
      if (idx >= 0) {
        const it = this.items[idx]
        // Bump count and move to front.
        const updated: ClipboardItem = { ...it, hitCount: it.hitCount + 1, capturedAt: now }
        this.items.splice(idx, 1)
        this.items.unshift(updated)
        if (data.kind === 'image' && data.imageId && !this.isImageReferenced(data.imageId)) {
          this.removeImageFile(data.imageId)
        }
        this.persist()
        return true
      }
    }

    const id = createId()
    let finalData = data
    if (data.kind === 'text') {
      finalData = this.storeTextPayloads(id, data, sig, meta?.rtf)
    }

    const item: ClipboardItem = { id, data: finalData, capturedAt: now, hitCount: 1, pinned: false }
    if (meta?.sourceApp) item.sourceApp = meta.sourceApp
    this.items.unshift(item)
    this.sigToId.set(sig, id)
    if (data.kind === 'image') this.writeImageFile(data.imageId)
    this.trim(limit)
    this.persist()
    return true
  }

  private storeTextPayloads(id: string, data: Extract<ItemData, { kind: 'text' }>, sig: string, rtf?: string): ItemData {
    const mac = process.platform === 'darwin'
    if (data.html && data.html.length > MAX_ITEM_HTML_CHARS) {
      if (mac && data.html.length <= MAX_PAYLOAD_CHARS) this.writePayload(id, 'html', data.html)
      delete data.html
    }
    if (mac && rtf && rtf.length <= MAX_PAYLOAD_CHARS) this.writePayload(id, 'rtf', rtf)
    if (data.text.length <= 300) return data
    this.writeTextPayload(id, data.text)
    this.payloadSigs.set(id, sig)
    return {
      ...data,
      hasFullPayload: true,
      previewText: data.text.slice(0, 300),
      text: data.text.slice(0, 300)
    }
  }

  setTitle(id: string, title: string): boolean {
    const it = this.items.find((x) => x.id === id)
    if (!it) return false
    const clean = cleanTitle(title)
    if (clean) it.title = clean
    else delete it.title
    this.persist()
    return true
  }

  setOcrText(id: string, text: string): boolean {
    const it = this.items.find((x) => x.id === id)
    if (!it || (it.data.kind !== 'image' && it.data.kind !== 'image-collection')) return false
    const clean = typeof text === 'string' ? text.slice(0, MAX_OCR_TEXT_CHARS) : ''
    if (it.ocrText === clean) return false
    it.ocrText = clean
    this.persist()
    return true
  }

  hasDuplicate(data: ItemData): boolean {
    const id = this.sigToId.get(contentSignature(data))
    return id !== undefined && this.items.some((it) => it.id === id)
  }

  private isImageReferenced(imageId: string): boolean {
    const fileStem = `${imageId}.`
    return this.items.some((it) => {
      if (it.data.kind === 'image') return it.data.imageId === imageId
      if (it.data.kind === 'image-collection') return it.data.images.some((img) => img.imageId === imageId)
      if (it.data.kind === 'files') return it.data.paths.some((p) => pathBasename(p).startsWith(fileStem))
      return false
    })
  }

  /**
   * Touch an item (e.g. on paste) to update its timestamp and hitCount,
   * moving unpinned items to the front of the Recent list.
   */
  touch(id: string): boolean {
    const idx = this.items.findIndex((it) => it.id === id)
    if (idx < 0) return false
    const it = this.items[idx]
    const now = Date.now()
    const updated: ClipboardItem = { ...it, hitCount: it.hitCount + 1, capturedAt: now }

    if (!it.pinned) {
      this.items.splice(idx, 1)
      this.items.unshift(updated)
    } else {
      this.items[idx] = updated
    }

    this.persist()
    return true
  }

  setPinned(id: string, pinned: boolean): void {
    const it = this.items.find((x) => x.id === id)
    if (!it) return
    it.pinned = pinned
    this.persist()
  }

  delete(id: string): void {
    const idx = this.items.findIndex((x) => x.id === id)
    if (idx < 0) return
    const [removed] = this.items.splice(idx, 1)
    this.sigToId.delete(this.signatureOf(removed))
    if (removed.data.kind === 'image') this.removeImageFile(removed.data.imageId)
    if (removed.data.kind === 'image-collection') {
      removed.data.images.forEach((img) => this.removeImageFile(img.imageId))
    }
    if (removed.data.kind === 'text') this.removeTextPayload(removed.id)
    this.persistSync()
    this.notifyRemoved([removed])
  }

  deleteBatch(ids: string[]): void {
    if (!ids || ids.length === 0) return
    const set = new Set(ids)
    const toRemove: ClipboardItem[] = []
    this.items = this.items.filter((it) => {
      if (set.has(it.id)) {
        toRemove.push(it)
        return false
      }
      return true
    })

    for (const removed of toRemove) {
      this.sigToId.delete(this.signatureOf(removed))
      if (removed.data.kind === 'image') this.removeImageFile(removed.data.imageId)
      if (removed.data.kind === 'image-collection') {
        removed.data.images.forEach((img) => this.removeImageFile(img.imageId))
      }
      if (removed.data.kind === 'text') this.removeTextPayload(removed.id)
    }
    this.persistSync()
    this.notifyRemoved(toRemove)
  }

  merge(sourceId: string, targetId: string): MergeResult {
    if (sourceId === targetId) return { ok: false }
    const srcIdx = this.items.findIndex(x => x.id === sourceId)
    const tgtIdx = this.items.findIndex(x => x.id === targetId)
    if (srcIdx < 0 || tgtIdx < 0) return { ok: false, reason: 'notfound' }

    const src = this.items[srcIdx]
    const tgt = this.items[tgtIdx]

    // Text and links cannot be merged into stacks.
    // NOTE: message is a translation key resolved renderer-side (see toast.*
    // in translations.ts), never display English from the store.
    if (src.data.kind === 'text' || tgt.data.kind === 'text') {
      return { ok: false, reason: 'incompatible', message: 'toast.mergeTextLinks' }
    }

    let newData: ItemData | null = null

    const getItemPaths = (item: ClipboardItem): string[] => {
      if (item.data.kind === 'files') return item.data.paths
      if (item.data.kind === 'image') return [this.imagePath(item.data.imageId, item.data.ext)]
      if (item.data.kind === 'image-collection') return item.data.images.map((img) => this.imagePath(img.imageId, img.ext))
      return []
    }

    const isPureImage = (item: ClipboardItem): boolean => {
      return item.data.kind === 'image' || item.data.kind === 'image-collection'
    }

    if (isPureImage(src) && isPureImage(tgt)) {
      // Pure Image(s) + Pure Image(s) -> Image Collection
      const srcData = src.data
      const tgtData = tgt.data
      const srcImages = srcData.kind === 'image-collection'
        ? srcData.images
        : srcData.kind === 'image'
          ? [{ imageId: srcData.imageId, width: srcData.width, height: srcData.height, bytes: srcData.bytes, fileBytes: srcData.fileBytes, ext: srcData.ext, source: srcData.source, fileName: srcData.fileName }]
          : []
      const tgtImages = tgtData.kind === 'image-collection'
        ? tgtData.images
        : tgtData.kind === 'image'
          ? [{ imageId: tgtData.imageId, width: tgtData.width, height: tgtData.height, bytes: tgtData.bytes, fileBytes: tgtData.fileBytes, ext: tgtData.ext, source: tgtData.source, fileName: tgtData.fileName }]
          : []
      const seen = new Set(tgtImages.map((i) => i.imageId))
      const combined = [...tgtImages, ...srcImages.filter((i) => !seen.has(i.imageId))]

      if (combined.length > MAX_STACK) return { ok: false, reason: 'full', message: 'toast.mergeImagesFull' }
      newData = { kind: 'image-collection', images: combined }
    } else if (
      (src.data.kind === 'files' || src.data.kind === 'image' || src.data.kind === 'image-collection') &&
      (tgt.data.kind === 'files' || tgt.data.kind === 'image' || tgt.data.kind === 'image-collection')
    ) {
      // Mixed combinations: Files + Files, Image(s) + Files, Files + Image(s)
      const srcPaths = getItemPaths(src)
      const tgtPaths = getItemPaths(tgt)
      const seen = new Set(tgtPaths)
      const combined = [...tgtPaths, ...srcPaths.filter((p) => !seen.has(p))]

      if (combined.length > MAX_STACK) return { ok: false, reason: 'full', message: 'toast.mergeFilesFull' }
      newData = { kind: 'files', paths: combined }
    }

    if (!newData) {
      return { ok: false, reason: 'incompatible', message: 'toast.mergeIncompatible' }
    }

    // Update target item
    this.sigToId.delete(this.signatureOf(tgt))
    tgt.data = newData
    this.sigToId.set(contentSignature(newData), tgt.id)
    tgt.capturedAt = Date.now() // bump time

    // Remove source item completely but DO NOT delete its underlying files/images
    // because they are now owned by the target!
    const [removed] = this.items.splice(srcIdx, 1)
    this.sigToId.delete(this.signatureOf(removed))

    this.persist()
    return { ok: true }
  }

  public removeSubitem(req: DragRequest): boolean {
    const sourceItem = this.get(req.id)
    if (!sourceItem) return false
    const sourceIndex = this.items.findIndex(i => i.id === req.id)
    if (sourceIndex === -1) return false

    if (sourceItem.data.kind === 'image-collection' && req.imageId) {
      const imgIdx = sourceItem.data.images.findIndex(i => i.imageId === req.imageId)
      if (imgIdx === -1) return false
      
      sourceItem.data.images.splice(imgIdx, 1)
      
      if (sourceItem.data.images.length === 1) {
        sourceItem.data = { kind: 'image', ...sourceItem.data.images[0] }
      } else if (sourceItem.data.images.length === 0) {
        this.items.splice(sourceIndex, 1)
      }
      this.rebuildIndex()
      this.persist()
      return true
    }

    if (req.paths && req.paths.length > 0 && sourceItem.data.kind === 'files') {
      const targetPaths = req.paths
      sourceItem.data.paths = sourceItem.data.paths.filter(p => !targetPaths.includes(p))
      
      if (sourceItem.data.paths.length === 0) {
        this.items.splice(sourceIndex, 1)
      }
      this.rebuildIndex()
      this.persist()
      return true
    }

    return false
  }

  public split(req: DragRequest): boolean {
    const sourceItem = this.get(req.id)
    if (!sourceItem) return false
    const sourceIndex = this.items.findIndex(i => i.id === req.id)
    if (sourceIndex === -1) return false

    // Splitting from an image collection
    if (sourceItem.data.kind === 'image-collection' && req.imageId) {
      const imgIdx = sourceItem.data.images.findIndex(i => i.imageId === req.imageId)
      if (imgIdx === -1) return false
      
      const targetImg = sourceItem.data.images[imgIdx]
      sourceItem.data.images.splice(imgIdx, 1)
      
      if (sourceItem.data.images.length === 1) {
        sourceItem.data = { kind: 'image', ...sourceItem.data.images[0] }
      } else if (sourceItem.data.images.length === 0) {
        this.items.splice(sourceIndex, 1)
      }

      const newItem: ClipboardItem = {
        id: createId(),
        capturedAt: Date.now(),
        hitCount: 1,
        pinned: false,
        data: { kind: 'image', ...targetImg }
      }
      this.items.splice(req.splitPlacement === 'after' ? sourceIndex + 1 : sourceIndex, 0, newItem)
      this.rebuildIndex()
      this.persist()
      return true
    }

    // Splitting from a file collection
    if (req.paths && req.paths.length > 0 && sourceItem.data.kind === 'files') {
      const sourcePaths = sourceItem.data.paths
      const targetPaths = req.paths.filter(p => sourcePaths.includes(p))
      if (targetPaths.length === 0) return false
      
      sourceItem.data.paths = sourcePaths.filter(p => !targetPaths.includes(p))
      
      if (sourceItem.data.paths.length === 0) {
        this.items.splice(sourceIndex, 1)
      }

      let newData: ItemData = { kind: 'files', paths: targetPaths }
      if (targetPaths.length === 1) {
        const p = targetPaths[0]
        const pLower = p.toLowerCase()
        const isFromManagedDir = pLower.includes('images') || pLower.includes('temp') || pLower.includes('edge-drop')
        if (isImageExt(p) && isFromManagedDir) {
          const imgName = pathBasename(p)
          let imageId = imgName.split('.')[0]
          const ext = (extname(p).slice(1) || 'png').toLowerCase()
          if (!/^[a-z0-9]{6,12}-[a-z0-9]{6,12}$/i.test(imageId)) {
            imageId = createId()
            try {
              if (existsSync(p)) {
                const rawBytes = readFileSync(p)
                this.stageImageBytes(imageId, rawBytes, ext)
              }
            } catch {}
          }
          let bytes = 0
          let width = 0
          let height = 0
          try {
            bytes = statSync(p).size
            const img = nativeImage.createFromPath(p)
            if (!img.isEmpty()) {
              const sz = img.getSize()
              width = sz.width
              height = sz.height
            }
          } catch {}
          newData = { kind: 'image', imageId, width, height, bytes, ext }
        }
      }

      const newItem: ClipboardItem = {
        id: createId(),
        capturedAt: Date.now(),
        hitCount: 1,
        pinned: false,
        data: newData
      }
      this.items.splice(req.splitPlacement === 'after' ? sourceIndex + 1 : sourceIndex, 0, newItem)
      this.rebuildIndex()
      this.persist()
      return true
    }

    return false
  }

  clearUnpinned(): void {
    const kept: ClipboardItem[] = []
    const removed: ClipboardItem[] = []
    for (const it of this.items) {
      if (it.pinned) kept.push(it)
      else {
        this.sigToId.delete(this.signatureOf(it))
        if (it.data.kind === 'image') this.removeImageFile(it.data.imageId)
        if (it.data.kind === 'image-collection') {
          it.data.images.forEach((img) => this.removeImageFile(img.imageId))
        }
        if (it.data.kind === 'text') this.removeTextPayload(it.id)
        removed.push(it)
      }
    }
    this.items = kept
    this.persistSync()
    this.notifyRemoved(removed)
  }

  pruneExpired(hours: number): boolean {
    if (!hours || hours <= 0) return false
    const cutoff = Date.now() - hours * 3600 * 1000
    const kept: ClipboardItem[] = []
    const expired: ClipboardItem[] = []
    for (const it of this.items) {
      if (it.pinned || it.capturedAt >= cutoff) {
        kept.push(it)
      } else {
        expired.push(it)
        this.sigToId.delete(this.signatureOf(it))
        if (it.data.kind === 'image') this.removeImageFile(it.data.imageId)
        if (it.data.kind === 'image-collection') {
          it.data.images.forEach((img) => this.removeImageFile(img.imageId))
        }
        if (it.data.kind === 'text') this.removeTextPayload(it.id)
      }
    }
    if (expired.length > 0) {
      this.items = kept
      this.persistSync()
      this.notifyRemoved(expired)
    }
    return expired.length > 0
  }

  get(id: string): ClipboardItem | undefined {
    return this.items.find((x) => x.id === id)
  }

  list(): readonly ClipboardItem[] {
    return this.items
  }

  /* ----------------------------- image files ----------------------------- */

  /**
   * Build a display-sized image preview. Sending originals as base64 data URLs
   * duplicates every image in the main process, IPC payload and renderer heap.
   */
  imageToDataUrl(imageId: string, ext?: string): string | null {
    const THUMB_SIZE = 240
    const PREVIEW_CACHE_MAX = 20
    const cacheKey = `${imageId}.${ext || ''}`
    const cached = this.previewCache.get(cacheKey)
    if (cached) {
      this.previewCache.delete(cacheKey)
      this.previewCache.set(cacheKey, cached)
      return cached
    }
    try {
      let img: any = nativeImage.createFromPath(this.imagePath(imageId, ext))
      if (img.isEmpty()) return null
      const size = img.getSize()
      let thumb: any = size.width > THUMB_SIZE || size.height > THUMB_SIZE
        ? img.resize({ width: THUMB_SIZE, quality: 'good' })
        : img
      const url = thumb.toDataURL({ scaleFactor: 1 })
      img = null
      thumb = null
      if (this.previewCache.size >= PREVIEW_CACHE_MAX) {
        this.previewCache.delete(this.previewCache.keys().next().value!)
      }
      this.previewCache.set(cacheKey, url)
      return url
    } catch {
      return null
    }
  }

  /**
   * Stage an image's bytes from a clipboard capture. The image was already
   * written to userData/images by the clipboard watcher (which has the raw
   * nativeImage); here we just no-op because the file already exists.
   * Kept for symmetry / future use.
   */
  private writeImageFile(_imageId: string): void {
    /* no-op: bytes already on disk from capture */
  }

  public getImagePath(imageId: string, ext?: string): string {
    return this.imagePath(imageId, ext)
  }

  private imagePath(imageId: string, ext?: string): string {
    if (ext) {
      const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext
      return join(PATHS.imagesDir(), `${imageId}.${cleanExt}`)
    }
    const dir = PATHS.imagesDir()
    if (existsSync(dir)) {
      try {
        const files = readdirSync(dir)
        for (const f of files) {
          if (f.startsWith(`${imageId}.`) && !f.startsWith(`${imageId}.orig.`)) {
            return join(dir, f)
          }
        }
      } catch { /* ignore */ }
    }
    return join(PATHS.imagesDir(), `${imageId}.png`)
  }

  /**
   * Resolve the on-disk path for a stored image, recovering via a directory
   * scan when the exact extension path is missing (e.g. the capture was
   * re-staged with a different ext). Returns null only when the image is
   * genuinely unrecoverable — callers must surface that to the user instead
   * of silently degrading to low-res previews.
   */
  public resolveStoredImagePath(imageId: string, ext?: string): string | null {
    if (!imageId) return null
    if (ext) {
      const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext
      const primary = join(PATHS.imagesDir(), `${imageId}.${cleanExt}`)
      if (existsSync(primary)) return primary
    }
    // Recovery: scan the images dir for any extension matching this id.
    try {
      const scanned = this.imagePath(imageId, undefined)
      if (existsSync(scanned)) return scanned
    } catch { /* ignore */ }
    return null
  }

  /**
   * True when at least one image of a collection is still recoverable on
   * disk. Used as a fast pre-check so paste can abort with an explicit error
   * before mutating any UI state.
   */
  public hasRecoverableCollectionImage(images: Array<{ imageId: string; ext?: string }>): boolean {
    return images.some((img) => this.resolveStoredImagePath(img.imageId, img.ext) !== null)
  }

  private removeImageFile(imageId: string): void {
    for (const key of this.previewCache.keys()) {
      if (key.startsWith(imageId)) this.previewCache.delete(key)
    }
    try {
      rmSync(join(PATHS.thumbnailsDir(), `${imageId}.png`), { force: true })
    } catch {}
    const dir = PATHS.imagesDir()
    if (!existsSync(dir)) return
    try {
      const files = readdirSync(dir)
      for (const f of files) {
        if (f.startsWith(`${imageId}.`)) {
          rmSync(join(dir, f), { force: true })
        }
      }
    } catch {
      /* ignore */
    }
  }

  private textPayloadPath(id: string): string {
    return this.payloadPath(id, 'txt')
  }

  private payloadPath(id: string, kind: TextPayloadKind): string {
    return join(PATHS.payloadsDir(), `${id}.${kind}`)
  }

  private writePayload(id: string, kind: TextPayloadKind, content: string): void {
    try {
      writeFileAtomicSync(this.payloadPath(id, kind), content)
    } catch (err) {
      console.error('[ItemStore] Failed to write payload:', err)
    }
  }

  private readPayload(id: string, kind: TextPayloadKind): string | undefined {
    try {
      const p = this.payloadPath(id, kind)
      return existsSync(p) ? readFileSync(p, 'utf8') : undefined
    } catch {
      return undefined
    }
  }

  private writeTextPayload(id: string, text: string): void {
    try {
      writeFileSync(this.textPayloadPath(id), text, 'utf8')
    } catch { /* ignore */ }
  }

  private removeTextPayload(id: string): void {
    this.payloadSigs.delete(id)
    try {
      const p = this.textPayloadPath(id)
      if (existsSync(p)) rmSync(p, { force: true })
    } catch { /* ignore */ }
    for (const kind of ['html', 'rtf'] as const) {
      try {
        rmSync(this.payloadPath(id, kind), { force: true })
      } catch { /* ignore */ }
    }
  }

  public getFullHtml(id: string): string | undefined {
    const item = this.items.find((x) => x.id === id)
    if (!item || item.data.kind !== 'text') return undefined
    return item.data.html || this.readPayload(id, 'html') || undefined
  }

  public getRtf(id: string): string | undefined {
    const item = this.items.find((x) => x.id === id)
    if (!item || item.data.kind !== 'text') return undefined
    return this.readPayload(id, 'rtf') || undefined
  }

  public getRichText(id: string): { text: string; html?: string; rtf?: string } | null {
    const item = this.items.find((x) => x.id === id)
    if (!item || item.data.kind !== 'text') return null
    const rich: { text: string; html?: string; rtf?: string } = { text: this.getFullText(id) }
    const html = this.getFullHtml(id)
    const rtf = this.getRtf(id)
    if (html) rich.html = html
    if (rtf) rich.rtf = rtf
    return rich
  }

  public getFullText(id: string): string {
    const item = this.items.find((x) => x.id === id)
    if (!item || item.data.kind !== 'text') return ''
    if (item.data.hasFullPayload) {
      try {
        const p = this.textPayloadPath(id)
        if (existsSync(p)) {
          return readFileSync(p, 'utf8')
        }
      } catch { /* ignore */ }
    }
    return item.data.text
  }

  /* ------------------------------- DTO ----------------------------------- */

  /** Snapshot the whole list as renderer-safe DTOs (images inlined). */
  toDto(): ClipboardItemDto[] {
    return this.items.map((it) => {
      if (it.data.kind === 'image') {
        const { kind, imageId, width, height, bytes, fileBytes, ext, source, fileName } = it.data
        return {
          ...it,
          data: { kind, imageId, width, height, bytes, fileBytes, ext, source, fileName, preview: thumbnailUrlForStoredImage(imageId) }
        }
      }
      if (it.data.kind === 'image-collection') {
        const imagesWithPreviews = it.data.images.map((img) => ({
          ...img,
          preview: thumbnailUrlForStoredImage(img.imageId)
        }))
        return {
          ...it,
          data: { kind: 'image-collection', images: imagesWithPreviews }
        }
      }
      if (it.data.kind === 'files') {
        // Build per-file metadata entries. Generate image preview protocol URLs for image files.
        let imagePreviewCount = 0
        const entries = it.data.paths.map((p) => {
          const entry = buildFileEntry(p)
          if (entry.isImage && imagePreviewCount < 20) {
            imagePreviewCount++
            return {
              ...entry,
              preview: thumbnailUrlForFile(p)
            }
          }
          return entry
        })
        return {
          ...it,
          data: { ...it.data, entries }
        }
      }
      if (it.data.kind === 'text') {
        const d = it.data
        return {
          ...it,
          data: {
            kind: 'text',
            text: d.text,
            isUrl: d.isUrl,
            isColor: d.isColor,
            hasFullPayload: d.hasFullPayload,
            previewText: d.previewText
          }
        }
      }
      return { ...it, data: it.data }
    })
  }

  /** Persist a brand-new image captured from the clipboard to its PNG file. */
  stageImageBytes(imageId: string, png: Buffer, ext = 'png'): void {
    try {
      writeFileSync(this.imagePath(imageId, ext), png)
    } catch {
      /* ignore */
    }
  }

  stageOriginalImage(imageId: string, bytes: Buffer, ext: 'tiff'): void {
    try {
      writeFileSync(this.originalImagePath(imageId, ext), bytes)
    } catch (err) {
      console.error('[ItemStore] Failed to store original image bytes:', err)
    }
  }

  private originalImagePath(imageId: string, ext: 'tiff'): string {
    return join(PATHS.imagesDir(), `${imageId}.orig.${ext}`)
  }

  private readImageFile(file: string): Buffer | null {
    try {
      const st = statSync(file)
      return st.isFile() && st.size > 0 && st.size <= MAX_ORIGINAL_IMAGE_BYTES ? readFileSync(file) : null
    } catch {
      return null
    }
  }

  storedImageBytes(imageId: string, ext?: string): { original: { type: string; bytes: Buffer }; png?: Buffer } | null {
    if (!imageId) return null
    if (ext && ext.replace(/^\./, '').toLowerCase() !== 'png') return null
    const stored = this.readImageFile(join(PATHS.imagesDir(), `${imageId}.png`))
    const png = stored && isPngBytes(stored) ? stored : undefined
    const tiff = this.readImageFile(this.originalImagePath(imageId, 'tiff'))
    if (tiff && isTiffBytes(tiff)) return { original: { type: MAC_TIFF_TYPE, bytes: tiff }, png }
    return png ? { original: { type: MAC_PNG_TYPE, bytes: png } } : null
  }

  /* --------------------------- export / import --------------------------- */

  private exportImage(img: ClipboardImageFields): PinnedExportImage | null {
    const file = this.resolveStoredImagePath(img.imageId, img.ext)
    if (!file) return null
    let png = this.readImageFile(file)
    if (png && !isPngBytes(png)) {
      try {
        const decoded = nativeImage.createFromPath(file)
        png = decoded.isEmpty() ? null : decoded.toPNG()
      } catch {
        png = null
      }
    }
    if (!png || png.length === 0) return null
    const out: PinnedExportImage = { width: img.width, height: img.height, bytes: img.bytes, png: png.toString('base64') }
    if (img.source) out.source = img.source
    if (img.fileName) out.fileName = img.fileName
    return out
  }

  private exportItem(it: ClipboardItem): PinnedExportItem | null {
    const common: PinnedExportCommon = { capturedAt: it.capturedAt }
    if (it.title) common.title = it.title
    if (it.sourceApp) common.sourceApp = it.sourceApp
    const data = it.data
    if (data.kind === 'text') {
      const rich = this.getRichText(it.id)
      if (!rich) return null
      const out: PinnedExportItem = { ...common, kind: 'text', text: rich.text, isUrl: !!data.isUrl }
      if (data.isColor) out.isColor = true
      if (rich.html) out.html = rich.html
      if (rich.rtf) out.rtf = rich.rtf
      return out
    }
    if (data.kind === 'image') {
      const image = this.exportImage(data)
      return image ? { ...common, kind: 'image', ...image } : null
    }
    if (data.kind === 'image-collection') {
      const images = data.images.map((img) => this.exportImage(img)).filter((img): img is PinnedExportImage => img !== null)
      return images.length > 0 ? { ...common, kind: 'image-collection', images } : null
    }
    return { ...common, kind: 'files', paths: [...data.paths] }
  }

  exportPinned(): PinnedExport {
    const items: PinnedExportItem[] = []
    for (const it of this.items) {
      if (!it.pinned) continue
      const entry = this.exportItem(it)
      if (entry) items.push(entry)
    }
    return { format: PINNED_EXPORT_FORMAT, version: PINNED_EXPORT_VERSION, exportedAt: new Date().toISOString(), items }
  }

  private importImage(raw: unknown): { fields: ClipboardImageFields; png: Buffer } | null {
    if (!isRecord(raw)) return null
    const { width, height, bytes, source, fileName, png } = raw
    if (!isDimension(width) || !isDimension(height)) return null
    if (typeof png !== 'string' || !png || png.length > Math.ceil(MAX_ORIGINAL_IMAGE_BYTES / 3) * 4) return null
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(png)) return null
    const buffer = Buffer.from(png, 'base64')
    if (!isPngBytes(buffer)) return null
    try {
      if (nativeImage.createFromBuffer(buffer).isEmpty()) return null
    } catch {
      return null
    }
    const fields: ClipboardImageFields = {
      imageId: createId(),
      width,
      height,
      bytes: typeof bytes === 'number' && Number.isInteger(bytes) && bytes > 0 ? bytes : buffer.length,
      ext: 'png'
    }
    if (source === 'screenshot' || source === 'image') fields.source = source
    if (typeof fileName === 'string' && fileName && fileName.length <= 255 && !/[\\/\x00-\x1f]/.test(fileName)) {
      fields.fileName = fileName
    }
    return { fields, png: buffer }
  }

  private importItem(raw: unknown): { data: ItemData; images: Array<{ imageId: string; png: Buffer }>; html?: string; rtf?: string } | null {
    if (!isRecord(raw)) return null
    if (raw.kind === 'text') {
      const { text, html, rtf } = raw
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_IMPORT_TEXT_CHARS) return null
      return {
        data: { kind: 'text', text, isUrl: raw.isUrl === true, ...(raw.isColor === true ? { isColor: true } : {}) },
        images: [],
        html: typeof html === 'string' && html && html.length <= MAX_PAYLOAD_CHARS ? html : undefined,
        rtf: typeof rtf === 'string' && rtf && rtf.length <= MAX_PAYLOAD_CHARS ? rtf : undefined
      }
    }
    if (raw.kind === 'image') {
      const image = this.importImage(raw)
      return image ? { data: { kind: 'image', ...image.fields }, images: [{ imageId: image.fields.imageId, png: image.png }] } : null
    }
    if (raw.kind === 'image-collection') {
      if (!Array.isArray(raw.images) || raw.images.length === 0 || raw.images.length > MAX_STACK) return null
      const images = raw.images.map((img) => this.importImage(img))
      if (images.some((img) => img === null)) return null
      const valid = images as Array<{ fields: ClipboardImageFields; png: Buffer }>
      return {
        data: { kind: 'image-collection', images: valid.map((img) => img.fields) },
        images: valid.map((img) => ({ imageId: img.fields.imageId, png: img.png }))
      }
    }
    if (raw.kind === 'files') {
      const { paths } = raw
      if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_IMPORT_PATHS) return null
      if (!paths.every((p) => isValidFilePath(p))) return null
      const resolved = (paths as string[]).map(resolveImportedPath).filter((p): p is string => p !== null)
      if (resolved.length === 0) return null
      return { data: { kind: 'files', paths: [...new Set(resolved)] }, images: [] }
    }
    return null
  }

  importPinned(doc: unknown): number {
    if (!isRecord(doc) || doc.format !== PINNED_EXPORT_FORMAT || doc.version !== PINNED_EXPORT_VERSION) return 0
    if (!Array.isArray(doc.items) || doc.items.length > MAX_IMPORT_ITEMS) return 0
    const now = Date.now()
    let added = 0
    let changed = false
    for (const raw of doc.items) {
      const parsed = this.importItem(raw)
      if (!parsed) continue
      const sig = contentSignature(parsed.data)
      const existingId = this.sigToId.get(sig)
      const existing = existingId ? this.items.find((it) => it.id === existingId) : undefined
      if (existing) {
        if (!existing.pinned) {
          existing.pinned = true
          changed = true
        }
        continue
      }
      const id = createId()
      let data = parsed.data
      if (data.kind === 'text') {
        if (parsed.html) data.html = parsed.html
        data = this.storeTextPayloads(id, data, sig, parsed.rtf)
      }
      for (const image of parsed.images) this.stageImageBytes(image.imageId, image.png)
      const entry = raw as Record<string, unknown>
      const capturedAt = typeof entry.capturedAt === 'number' && entry.capturedAt > 0 && entry.capturedAt <= now ? entry.capturedAt : now
      const item: ClipboardItem = { id, data, capturedAt, hitCount: 1, pinned: true }
      const title = cleanTitle(entry.title)
      const sourceApp = cleanSourceApp(entry.sourceApp)
      if (title) item.title = title
      if (sourceApp) item.sourceApp = sourceApp
      this.items.push(item)
      this.sigToId.set(sig, id)
      added++
      changed = true
    }
    if (changed) this.persistSync()
    return added
  }
}

/** Check if a file path points to an image by extension. */
function isImageExt(p: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?|jfif|pjpeg|pjp)$/i.test(p)
}

function isPreviewableImage(p: string): boolean {
  return isImageExt(p) || (process.platform === 'darwin' && /\.hei[cf]$/i.test(p))
}

/**
 * Build display metadata for a single file path. `size` is best-effort (0 when
 * the file can't be stat'd — e.g. a path on a disconnected drive); the renderer
 * hides the size label when it's 0.
 */
const fileEntryCache = new Map<string, FileEntry>()

function buildFileEntry(p: string): FileEntry {
  if (fileEntryCache.has(p)) return fileEntryCache.get(p)!
  let size = 0
  let isDirectory = false
  try {
    const st = statSync(p)
    size = st.size
    isDirectory = st.isDirectory()
    if (isDirectory && process.platform === 'darwin' && /\.app\/*$/i.test(p)) {
      isDirectory = false
      size = 0
    }
  } catch {
    /* file missing / unreadable — size stays 0 */
  }
  const ext = isDirectory ? '' : (extname(p).slice(1) || '').toLowerCase()
  const name = pathBasename(p)
  const entry: FileEntry = {
    name,
    ext,
    size,
    isImage: !isDirectory && isPreviewableImage(p),
    isDirectory
  }
  if (fileEntryCache.size > 500) fileEntryCache.clear()
  fileEntryCache.set(p, entry)
  return entry
}
