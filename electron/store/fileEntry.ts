import { statSync } from 'node:fs'
import { extname, basename as pathBasename } from 'node:path'
import type { FileEntry } from '../../shared/types'

/** Check if a file path points to an image by extension. */
export function isImageExt(p: string): boolean {
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

export function buildFileEntry(p: string): FileEntry {
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
