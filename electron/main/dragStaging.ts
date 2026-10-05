import { copyFileSync, mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { getUnpackagedTempDir, toUnpackagedFilePaths } from '../store/paths'
import type { ItemData } from '../../shared/types'
import { getStore } from './state'
import { recordStagedFiles } from './stagedTemp'

function stampForFilename(capturedAt?: number): string {
  const d = capturedAt ? new Date(capturedAt) : new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const seconds = String(d.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}.${minutes}.${seconds}`
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim() || 'Image'
}

/**
 * Filename for a staged clipboard bitmap.
 * Screenshots keep the Windows-style Screenshot stamp; other bitmaps use Image
 * (or the original name when the clipboard provided one).
 */
export function formatClipboardImageFilename(
  capturedAt?: number,
  ext = 'png',
  opts?: { source?: 'screenshot' | 'image'; fileName?: string; indexSuffix?: number }
): string {
  const cleanExt = ext.replace(/^\./, '') || 'png'
  const suffix = typeof opts?.indexSuffix === 'number' && opts.indexSuffix > 1 ? ` (${opts.indexSuffix})` : ''
  if (opts?.fileName) {
    const safe = sanitizeFileName(opts.fileName)
    const base = safe.replace(/\.[^.]+$/, '')
    const givenExt = (safe.match(/\.([a-z0-9]+)$/i)?.[1] || cleanExt).toLowerCase()
    return `${base}${suffix}.${givenExt}`
  }
  const prefix = opts?.source === 'image' ? 'Image' : 'Screenshot'
  return `${prefix} ${stampForFilename(capturedAt)}${suffix}.${cleanExt}`
}

/** @deprecated use formatClipboardImageFilename */
export function formatScreenshotFilename(capturedAt?: number, ext = 'png', indexSuffix?: number): string {
  return formatClipboardImageFilename(capturedAt, ext, { source: 'screenshot', indexSuffix })
}

export const textOwners = new WeakMap<ItemData, string>()

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function snippetFileName(text: string): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ')
  const cleaned = words.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim()
  const cut = (cleaned.length > 40 ? cleaned.slice(0, 40) : cleaned).replace(/[. ]+$/, '')
  const safe = WINDOWS_RESERVED_NAME.test(cut.split('.')[0].trim()) ? `_${cut}` : cut
  return `${safe || 'Snippet'}.txt`
}

const snippetCache = new Map<string, string>()

function textDigest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function sameFileText(path: string, text: string): boolean {
  try {
    if (statSync(path).size !== Buffer.byteLength(text, 'utf8')) return false
    return readFileSync(path, 'utf8') === text
  } catch {
    return false
  }
}

export function stageTextSnippet(ownerId: string, data: Extract<ItemData, { kind: 'text' }>): string | null {
  const text = fullTextFor(ownerId, data)
  const digest = textDigest(text)
  const key = `${ownerId}:${digest}`
  const cached = snippetCache.get(key)
  if (cached && existsSync(cached)) return cached

  const temp = getUnpackagedTempDir()
  try {
    mkdirSync(temp, { recursive: true })
  } catch {
    return null
  }
  const base = snippetFileName(text).replace(/\.txt$/, '')
  let dest = join(temp, `${base}.txt`)
  let n = 2
  while (existsSync(dest) && !sameFileText(dest, text) && n < 1000) {
    dest = join(temp, `${base} (${n}).txt`)
    n++
  }
  try {
    if (existsSync(dest) && !sameFileText(dest, text)) {
      dest = join(temp, `Snippet_${digest.slice(0, 16)}.txt`)
      writeFileSync(dest, text, 'utf8')
    } else if (!existsSync(dest)) {
      writeFileSync(dest, text, 'utf8')
    }
  } catch {
    return null
  }
  snippetCache.set(key, dest)
  if (snippetCache.size > STAGED_CACHE_MAX) {
    const first = snippetCache.keys().next().value
    if (first) snippetCache.delete(first)
  }
  try {
    recordStagedFiles(data, [dest])
  } catch { /* ignore */ }
  return dest
}

/* ------------------------------------------------------------------ */
/* Staging                                                             */
/* ------------------------------------------------------------------ */

interface Staged {
  file: string
  files?: string[]
}

const stagedCache = new Map<string, Staged>()
const STAGED_CACHE_MAX = 64

function getStagedCacheKey(data: ItemData, capturedAt?: number): string {
  switch (data.kind) {
    case 'files':
      return `files:${data.paths.join('|')}`
    case 'image':
      return `img:${data.imageId}:${data.ext || 'png'}:${capturedAt || 0}`
    case 'image-collection':
      return `imgs:${data.images.map((i) => i.imageId).join('|')}:${capturedAt || 0}`
    case 'text': {
      const ownerId = textOwners.get(data)
      const digest = textDigest(fullTextFor(ownerId, data))
      return ownerId ? `text:${ownerId}:${digest}` : `text:sha256:${digest}`
    }
  }
}

function fullTextFor(ownerId: string | undefined, data: Extract<ItemData, { kind: 'text' }>): string {
  return ownerId && data.hasFullPayload ? getStore().getFullText(ownerId) || data.text : data.text
}

/**
 * Resolve a unique destination path inside `temp` for a staged image.
 *
 * WHY NOT A BLIND existsSync SKIP: images inside one collection share the
 * parent's capturedAt stamp, so distinct photos computed identical names —
 * the first staged file won and every sibling silently reused it. We now
 * treat an existing candidate as reusable ONLY when its size matches the
 * expected payload; otherwise we append Windows-style " (2)", " (3)"…
 * until the name is genuinely free.
 */
function resolveUniqueImageDest(temp: string, fileName: string, ext: string, expectedBytes: number): string {
  const cleanExt = ext.replace(/^\./, '') || 'png'
  const base = fileName.replace(/\.[^.]+$/, '')
  let candidate = join(temp, `${base}.${cleanExt}`)
  if (!existsSync(candidate)) return candidate

  // Existing file: reusable only if it plausibly holds this exact payload.
  try {
    if (expectedBytes > 0 && statSync(candidate).size === expectedBytes) return candidate
  } catch { /* fall through to suffixing */ }

  let n = 2
  do {
    candidate = join(temp, `${base} (${n}).${cleanExt}`)
    n++
  } while (existsSync(candidate) && n < 1000)
  return candidate
}

/** Resolve the item to a concrete file path to hand to the OS. */
export function stageDragFile(
  data: ItemData,
  capturedAt?: number,
  opts?: { indexSuffix?: number }
): Staged | null {
  const cacheKey = getStagedCacheKey(data, capturedAt)
  const cached = stagedCache.get(cacheKey)
  if (cached && existsSync(cached.file)) {
    return cached
  }

  const temp = getUnpackagedTempDir()
  mkdirSync(temp, { recursive: true })
  let result: Staged | null = null

  switch (data.kind) {
    case 'files': {
      const real = data.paths.filter((p) => existsSync(p))
      if (!real.length) return null
      const exposed = toUnpackagedFilePaths(real)
      result = { file: exposed[0], files: exposed }
      break
    }
    case 'image': {
      const src = getStore().getImagePath(data.imageId, data.ext)
      if (!existsSync(src)) return null
      const ext = extname(src) || '.png'
      const fileName = formatClipboardImageFilename(capturedAt, ext, {
        source: data.source,
        fileName: data.fileName,
        indexSuffix: opts?.indexSuffix
      })
      // Sub-images of one collection share the parent's stamp; guarantee a
      // distinct file per photo instead of blind-reusing an existing name.
      const dest = resolveUniqueImageDest(temp, fileName, ext, data.bytes || 0)
      try {
        copyFileSync(src, dest)
      } catch {
        return null
      }
      result = { file: dest, files: [dest] }
      break
    }
    case 'image-collection': {
      const paths: string[] = []
      let idx = 1
      for (const img of data.images) {
        const src = getStore().getImagePath(img.imageId, img.ext)
        if (existsSync(src)) {
          const ext = extname(src) || '.png'
          const fileName = formatClipboardImageFilename(capturedAt, ext, {
            source: img.source,
            fileName: img.fileName,
            indexSuffix: idx
          })
          const dest = resolveUniqueImageDest(temp, fileName, ext, img.bytes || 0)
          try {
            copyFileSync(src, dest)
            paths.push(dest)
            idx++
          } catch {
            // skip failed copies
          }
        }
      }
      if (!paths.length) return null
      result = { file: paths[0], files: paths }
      break
    }
    case 'text': {
      const id = `${Date.now().toString(36)}`
      const dest = join(temp, `Snippet_${id}.txt`)
      const text = fullTextFor(textOwners.get(data), data)
      try {
        writeFileSync(dest, text, 'utf8')
      } catch {
        return null
      }
      result = { file: dest, files: [dest] }
      break
    }
  }

  if (result) {
    stagedCache.set(cacheKey, result)
    if (stagedCache.size > STAGED_CACHE_MAX) {
      const first = stagedCache.keys().next().value
      if (first) stagedCache.delete(first)
    }
    // Lifecycle tracking: register generated artifacts with the staged-temp
    // manager so they are reaped when their owning history item dies.
    // Only paths inside our managed temp roots are recorded — original user
    // files exposed by `files` bundles are never tracked.
    try {
      recordStagedFiles(data, result.files ?? [result.file])
    } catch {
      /* ignore — staging itself already succeeded */
    }
  }

  return result
}
