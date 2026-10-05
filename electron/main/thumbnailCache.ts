/**
 * Bounded thumbnail production + caching for the edgelocal://thumb/ route.
 *
 * WHY: every thumbnail request used to decode the FULL original screenshot
 * (a 4K capture is ~33 MB of raw bitmap), resize to 240 px, PNG-encode, and
 * throw everything away — while telling the renderer `no-cache`, guaranteeing
 * the same expensive work repeated on every list reorder/scroll. With
 * hundreds of image cards this starved the CPU exactly while animations run.
 *
 * Now:
 *  - A tiny LRU (64 entries, ~1.5 MB worst case) serves hot thumbnails as
 *    pre-encoded buffers with zero decode work.
 *  - Responses carry validators (ETag -> 304) and long freshness for
 *    content-addressed captures, so Chromium reuses its decoded bitmap and
 *    rarely asks again at all.
 *
 * Keys include mtime+size so externally replaced files are never served stale.
 */
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { nativeImage } from 'electron'
import { convertHeicToPng } from './macHeic'
import { PATHS } from '../store/paths'
import { writeFileAtomicSync } from '../store/atomicWrite'

const MAX_THUMBNAIL_EDGE_PX = 240
const LRU_MAX_ENTRIES = 64
const HEIC_EXTS = new Set(['.heic', '.heif'])
const HEIC_PREVIEW_EDGE_PX = 2048

export interface ThumbnailPayload {
  etag: string
  contentType: string
  body: Buffer
}

const lru = new Map<string, ThumbnailPayload>()

function lruGet(key: string): ThumbnailPayload | undefined {
  const hit = lru.get(key)
  if (!hit) return undefined
  // Refresh insertion order for LRU semantics.
  lru.delete(key)
  lru.set(key, hit)
  return hit
}

function lruPut(key: string, value: ThumbnailPayload): void {
  lru.delete(key)
  lru.set(key, value)
  if (lru.size > LRU_MAX_ENTRIES) {
    const oldest = lru.keys().next().value
    if (oldest !== undefined) lru.delete(oldest)
  }
}

/** Test hook: drop all cached thumbnails. */
export function clearThumbnailCache(): void {
  lru.clear()
}

/** Test hook: number of cached payloads. */
export function thumbnailCacheSize(): number {
  return lru.size
}

interface FileFacts {
  mtimeMs: number
  size: number
}

function readFacts(filePath: string): FileFacts | null {
  try {
    const st = statSync(filePath)
    if (!st.isFile()) return null
    return { mtimeMs: Math.floor(st.mtimeMs), size: st.size }
  } catch {
    return null
  }
}

/**
 * Produce (or fetch from LRU) the encoded 240 px PNG for a raster image.
 * Returns null when the source cannot be read or decoded.
 */
export function getThumbnailPayload(filePath: string): ThumbnailPayload | null {
  const facts = readFacts(filePath)
  if (!facts) return null

  const key = `${filePath}|${facts.mtimeMs}:${facts.size}`
  const cached = lruGet(key)
  if (cached) return cached

  const imageId = process.platform === 'darwin' ? storedImageId(filePath) : null
  if (!imageId) return encodeThumbnail(filePath, key)

  const persisted = readPersistedThumbnail(imageId, facts)
  if (persisted) {
    const payload: ThumbnailPayload = { etag: etagFor(key), contentType: 'image/png', body: persisted }
    lruPut(key, payload)
    return payload
  }

  const payload = encodeThumbnail(filePath, key)
  if (payload) writePersistedThumbnail(imageId, payload.body)
  return payload
}

function etagFor(key: string): string {
  return `"${createHash('sha256').update(key).digest('hex')}"`
}

function storedImageId(filePath: string): string | null {
  try {
    const dir = dirname(filePath)
    const imagesDir = PATHS.imagesDir()
    const same = process.platform === 'win32' ? dir.toLowerCase() === imagesDir.toLowerCase() : dir === imagesDir
    if (!same) return null
    return basename(filePath).split('.')[0] || null
  } catch {
    return null
  }
}

function persistedThumbnailPath(imageId: string): string {
  return join(PATHS.thumbnailsDir(), `${imageId}.png`)
}

function readPersistedThumbnail(imageId: string, source: FileFacts): Buffer | null {
  try {
    const thumbPath = persistedThumbnailPath(imageId)
    const st = statSync(thumbPath)
    if (!st.isFile() || st.size === 0 || Math.floor(st.mtimeMs) < source.mtimeMs) return null
    return readFileSync(thumbPath)
  } catch {
    return null
  }
}

function writePersistedThumbnail(imageId: string, body: Buffer): void {
  try {
    mkdirSync(PATHS.thumbnailsDir(), { recursive: true })
    writeFileAtomicSync(persistedThumbnailPath(imageId), body)
  } catch {}
}

function scaleToThumbnail(img: Electron.NativeImage): Electron.NativeImage {
  const { width, height } = img.getSize()
  const scale = Math.min(1, MAX_THUMBNAIL_EDGE_PX / Math.max(width, height))
  return scale < 1
    ? img.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        quality: 'good'
      })
    : img
}

export function persistStoredThumbnail(imageId: string, img: Electron.NativeImage): void {
  try {
    if (process.platform !== 'darwin' || !imageId || img.isEmpty()) return
    writePersistedThumbnail(imageId, scaleToThumbnail(img).toPNG())
  } catch {}
}

function encodeThumbnail(sourcePath: string, key: string): ThumbnailPayload | null {
  try {
    const img = nativeImage.createFromPath(sourcePath)
    if (img.isEmpty()) return null

    const body = scaleToThumbnail(img).toPNG()
    const payload: ThumbnailPayload = {
      // Content-fingerprint validator: any change to the source file flips
      // mtime/size, producing a fresh key AND a fresh etag together.
      etag: etagFor(key),
      contentType: 'image/png',
      body
    }
    lruPut(key, payload)
    return payload
  } catch {
    return null
  }
}

const pendingHeic = new Map<string, Promise<ThumbnailPayload | null>>()

export function isMacHeicPath(filePath: string): boolean {
  return process.platform === 'darwin' && HEIC_EXTS.has(extname(filePath).toLowerCase())
}

export async function getHeicPreviewPng(filePath: string): Promise<Buffer | null> {
  if (!isMacHeicPath(filePath)) return null
  const tmp = await convertHeicToPng(filePath, HEIC_PREVIEW_EDGE_PX, 'preview')
  if (!tmp) return null
  try {
    return readFileSync(tmp)
  } catch {
    return null
  } finally {
    try {
      rmSync(tmp, { force: true })
    } catch {}
  }
}

export async function getThumbnailPayloadAsync(filePath: string): Promise<ThumbnailPayload | null> {
  if (!isMacHeicPath(filePath)) {
    return getThumbnailPayload(filePath)
  }

  const facts = readFacts(filePath)
  if (!facts) return null

  const key = `${filePath}|${facts.mtimeMs}:${facts.size}`
  const cached = lruGet(key)
  if (cached) return cached

  const inFlight = pendingHeic.get(key)
  if (inFlight) return inFlight

  const job = (async () => {
    const tmp = await convertHeicToPng(filePath, MAX_THUMBNAIL_EDGE_PX, 'thumb')
    if (!tmp) return null
    try {
      return encodeThumbnail(tmp, key)
    } finally {
      try {
        rmSync(tmp, { force: true })
      } catch {}
    }
  })()
  pendingHeic.set(key, job)
  try {
    return await job
  } finally {
    pendingHeic.delete(key)
  }
}

/**
 * Cache policy for a thumbnail response.
 *  - Stored captures (`edgelocal://thumb/<imageId>`) are content-addressed:
 *    the id is minted once per capture and its bytes are never rewritten, so
 *    the representation is effectively immutable.
 *  - External file thumbnails may change on disk; give them short freshness
 *    plus mandatory-ish revalidation via ETag.
 */
export function thumbnailCacheControl(isStoredCapture: boolean): string {
  return isStoredCapture
    ? 'private, max-age=31536000, immutable'
    : 'private, max-age=300'
}
