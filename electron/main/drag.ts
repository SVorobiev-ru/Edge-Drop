/**
 * Native drag-out of items into other applications.
 *
 * Electron's supported drag-out path is `webContents.startDrag({ file, icon })`,
 * which must be called from the `ipcMain.on` handler (not an async invoke
 * handler) so `event.sender` is the exact webContents that initiated the drag.
 * This ensures the OLE drag gesture flows correctly on Windows.
 *
 * Before dragging we stage the item's content as a temp file:
 *   - image  -> <id>.png (its persisted bytes, copied to temp)
 *   - text   -> <id>.txt
 *   - files  -> the *original* file paths (drag the real thing, not a copy)
 *
 * The temp files are cleaned up on the next app start (see cleanTemp).
 */
import { type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import type { ClipboardItem, DragRequest, ItemData } from '../../shared/types'
import { getStore } from './state'
import { dragIcon, createFileStackDragIcon, isDirectoryPath, prefetchFileIcons } from './dragIcons'
import { stageDragFile, stageTextSnippet, textOwners } from './dragStaging'

export { prefetchFileIcons, prewarmDragIcons } from './dragIcons'
export { formatClipboardImageFilename, formatScreenshotFilename, snippetFileName, stageDragFile } from './dragStaging'

/**
 * Resolve a DragRequest into concrete ItemData along with capture timestamp.
 *
 * If `paths` is provided (dragging one file out of an expanded bundle), synthesize
 * a singleton `files` item. If `imageId` is provided, resolve that ONE image of
 * an image-collection and report its sibling index (1-based) via `subIndex` so
 * staging can give it a collision-free filename — every image in a collection
 * shares the parent's capturedAt stamp, and identical stamps otherwise collapse
 * every sub-drag onto the first-staged file.
 */
export function resolveDragData(req: DragRequest): { data: ItemData; capturedAt?: number; subIndex?: number } | null {
  if (req.paths && req.paths.length > 0) {
    prefetchFileIcons(req.paths)
    const parentItem = getStore().get(req.id)
    let entries: Array<{ name: string; ext: string; size: number; isImage: boolean; isDirectory?: boolean; preview?: string }> | undefined
    if (parentItem && parentItem.data.kind === 'files') {
      const parentEntries = parentItem.data.entries
      entries = req.paths.map((p) => {
        const found = parentEntries?.find((e) => e.name === p || p.endsWith(e.name) || p === e.name)
        if (found) return found
        let isDir = false
        try {
          if (existsSync(p)) isDir = isDirectoryPath(p)
        } catch {}
        return { name: p, ext: '', size: 0, isImage: false, isDirectory: isDir }
      })
    }
    return { data: { kind: 'files', paths: req.paths, entries } }
  }
  const item = getStore().get(req.id)
  if (!item) return null

  if (item.data.kind === 'files') {
    prefetchFileIcons(item.data.paths)
  }

  if (req.imageId) {
    if (item.data.kind === 'image-collection') {
      const idx = item.data.images.findIndex((i) => i.imageId === req.imageId)
      if (idx >= 0) {
        return { data: { kind: 'image', ...item.data.images[idx] }, capturedAt: item.capturedAt, subIndex: idx + 1 }
      }
      // Requested image no longer exists in this collection. Refuse the drag
      // rather than silently dragging the whole collection (which surfaced as
      // "dragging any row always delivered the top image").
      console.warn('[Drag] sub-image not found in collection; aborting drag. id=', req.id, 'imageId=', req.imageId)
      return null
    }
    console.warn('[Drag] imageId requested for non-collection item; aborting drag. id=', req.id)
    return null
  }
  if (item.data.kind === 'text') textOwners.set(item.data, item.id)
  return { data: item.data, capturedAt: item.capturedAt }
}

export function startDragOut(sender: WebContents, data: ItemData, capturedAt?: number, subIndex?: number): boolean {
  const staged = stageDragFile(data, capturedAt, typeof subIndex === 'number' ? { indexSuffix: subIndex } : undefined)
  if (!staged) return false

  const icon = dragIcon(data)
  const item: Electron.Item = { file: staged.file, icon }
  if (staged.files) {
    item.files = staged.files
  }
  sender.startDrag(item)
  return true
}

export type SelectionStage =
  | { ok: true; paths: string[]; iconPaths: string[] }
  | { ok: false; error: 'toast.imageUnavailable' | 'toast.fileUnavailable' }

export function stageSelectionFiles(items: readonly ClipboardItem[]): SelectionStage {
  const paths: string[] = []
  const iconPaths: string[] = []
  for (const item of items) {
    const data = item.data
    if (data.kind === 'text') {
      const file = stageTextSnippet(item.id, data)
      if (!file) return { ok: false, error: 'toast.fileUnavailable' }
      paths.push(file)
      iconPaths.push(file)
      continue
    }
    const staged = stageDragFile(data, item.capturedAt)
    const files = staged ? staged.files ?? [staged.file] : []
    if (files.length === 0) {
      return { ok: false, error: data.kind === 'files' ? 'toast.fileUnavailable' : 'toast.imageUnavailable' }
    }
    paths.push(...files)
    iconPaths.push(...(data.kind === 'files' ? files : files.map(() => 'image.png')))
  }
  const seen = new Set<string>()
  const unique: string[] = []
  const uniqueIcons: string[] = []
  paths.forEach((p, i) => {
    if (seen.has(p)) return
    seen.add(p)
    unique.push(p)
    uniqueIcons.push(iconPaths[i])
  })
  return { ok: true, paths: unique, iconPaths: uniqueIcons }
}

export function startMultiDragOut(sender: WebContents, paths: string[], iconPaths: string[]): boolean {
  if (paths.length === 0) return false
  sender.startDrag({ file: paths[0], files: paths, icon: createFileStackDragIcon(iconPaths) })
  return true
}

/** Pre-stage a drag request in the background so drag initiation is 0ms. */
export function prestageDrag(req: DragRequest): void {
  try {
    const resolved = resolveDragData(req)
    if (!resolved) return
    const { data, capturedAt, subIndex } = resolved
    stageDragFile(data, capturedAt, typeof subIndex === 'number' ? { indexSuffix: subIndex } : undefined)
    dragIcon(data)
  } catch {}
}
