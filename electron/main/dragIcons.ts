import { app, nativeImage } from 'electron'
import { Resvg } from '@resvg/resvg-js'
import { existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import type { ItemData } from '../../shared/types'
import { fileKindOfPath } from '../../shared/fileKind'
import { buildFileDragSvg } from './fileSvg'

// Arial Unicode covers CJK, Arabic, Hebrew, Thai and Devanagari; Resvg cannot
// draw Apple Color Emoji.
const MAC_RESVG_FONT = {
  loadSystemFonts: false,
  fontFiles: ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'].filter((file) => existsSync(file)),
  defaultFontFamily: 'Helvetica',
  sansSerifFamily: 'Helvetica',
}

function resvgFontOptions(): { font?: typeof MAC_RESVG_FONT } {
  return process.platform === 'darwin' ? { font: MAC_RESVG_FONT } : {}
}

function isMacAppBundle(p: string): boolean {
  return process.platform === 'darwin' && /\.app\/*$/i.test(p)
}

export function isDirectoryPath(p: string): boolean {
  return statSync(p).isDirectory() && !isMacAppBundle(p)
}

/* ------------------------------------------------------------------ */
/* Drag icon (with small in-memory cache)                              */
/* ------------------------------------------------------------------ */

/** Cache recently built drag icons to avoid re-reading images. */
const iconCache = new Map<string, Electron.NativeImage>()
const ICON_CACHE_MAX = 64

/** Pre-fetch OS file icons into cache so dragIcon is synchronous. */
export function prefetchFileIcons(paths: string[]): void {
  for (const p of paths) {
    if (!p) continue
    const ext = extname(p).toLowerCase() || p
    if (!iconCache.has(ext)) {
      app.getFileIcon(p, { size: 'normal' }).then((icon) => {
        if (icon && !icon.isEmpty()) {
          // Store under the extension only — the previous per-full-path second
          // entry grew the map without bound across a long session.
          iconCache.set(ext, icon)
          trimIconCache()
        }
      }).catch(() => {})
    }
  }
}

/** Hard cap for both caches sharing this map, oldest entries evicted first. */
function trimIconCache(): void {
  while (iconCache.size > ICON_CACHE_MAX) {
    const first = iconCache.keys().next().value
    if (first === undefined) break
    iconCache.delete(first)
  }
}

/** A clean 1x1 transparent fallback so Windows uses default OS file icon without green box. */
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
let emptyIcon: Electron.NativeImage | null = null

function getFileDragIcon(): Electron.NativeImage {
  if (emptyIcon && !emptyIcon.isEmpty()) return emptyIcon
  emptyIcon = nativeImage.createFromBuffer(TRANSPARENT_PNG)
  return emptyIcon
}

/**
 * Build the ghost image shown under the cursor during the drag.
 * We use real image thumbnails or custom SVG card stacks rendered via Resvg.
 */
export function dragIcon(data: ItemData): Electron.NativeImage {
  try {
    if (data.kind === 'image' || data.kind === 'image-collection') {
      const isCollection = data.kind === 'image-collection'
      const count = isCollection ? data.images.length : 1
      if (count === 0) return getFileDragIcon()
      return createFileStackDragIcon(Array(count).fill('image.png'), Array(count).fill({ isDirectory: false }))
    }

    if (data.kind === 'files') {
      const count = data.paths.length
      if (count === 0) return getFileDragIcon()
      return createFileStackDragIcon(data.paths, data.entries)
    }

    if (data.kind === 'text') {
      return createTextDragIcon(data.text)
    }
  } catch {}
  return getFileDragIcon()
}

/** Generate a custom standalone SVG PNG icon representing file kinds with count badge. */
export function createFileStackDragIcon(paths: string[], entries?: Array<{ isDirectory?: boolean }>): Electron.NativeImage {
  const count = paths.length
  if (count === 0) return getFileDragIcon()

  const kinds = paths.slice(0, 3).map((p, idx) => {
    let isDir = entries?.[idx]?.isDirectory
    if (isDir === undefined) {
      try {
        if (existsSync(p)) {
          isDir = isDirectoryPath(p)
        }
      } catch {}
    }
    if (isDir && isMacAppBundle(p)) isDir = false
    return fileKindOfPath(p, isDir, process.platform === 'darwin')
  })
  const cacheKey = `stack|pastel-svg|${kinds.join('-')}|${count}`
  const cached = iconCache.get(cacheKey)
  if (cached && !cached.isEmpty()) {
    return cached
  }

  const svg = buildFileDragSvg(kinds, count)

  try {
    const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, ...resvgFontOptions() })
    const pngData = resvg.render().asPng()
    const img = nativeImage.createFromBuffer(pngData, { scaleFactor: 2 })
    if (!img.isEmpty()) {
      iconCache.set(cacheKey, img)
      if (iconCache.size > ICON_CACHE_MAX) {
        const first = iconCache.keys().next().value
        if (first) iconCache.delete(first)
      }
      return img
    }
  } catch {}
  return getFileDragIcon()
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '&': return '&amp;'
      case "'": return '&apos;'
      case '"': return '&quot;'
    }
    return c
  })
}

/** Generate a custom quote card PNG icon for text dragging. */
function createTextDragIcon(text: string): Electron.NativeImage {
  const cleaned = text.replace(/[\r\n]+/g, ' ').trim()
  let line1 = cleaned.substring(0, 28)
  let line2 = cleaned.substring(28, 56)
  
  if (cleaned.length > 28 && !cleaned.charAt(28).match(/\s/)) {
    const lastSpace = line1.lastIndexOf(' ')
    if (lastSpace > 15) {
      line1 = cleaned.substring(0, lastSpace)
      line2 = cleaned.substring(lastSpace + 1, lastSpace + 29)
    }
  }
  if (cleaned.length > line1.length + line2.length) {
    line2 = line2.replace(/.{3}$/, '...')
  }

  const width = 330
  const height = 92

  const defsSvg = `
    <defs>
      <clipPath id="textClip">
        <rect x="58" y="0" width="255" height="${height}" />
      </clipPath>
    </defs>
  `
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${defsSvg}
    <rect x="2" y="2" width="${width - 4}" height="${height - 4}" rx="14" fill="#000000" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" />
    
    <!-- Accent Icon -->
    <svg x="18" y="32" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#A0A0A5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>

    <!-- Text Content -->
    <g clip-path="url(#textClip)">
      <text x="58" y="42" font-family="sans-serif" font-size="15" font-weight="600" fill="#FFFFFF">${escapeXml(line1)}</text>
      ${line2 ? `<text x="58" y="66" font-family="sans-serif" font-size="14" font-weight="400" fill="#A0A0A5">${escapeXml(line2)}</text>` : ''}
    </g>
  </svg>`

  try {
    const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, ...resvgFontOptions() })
    const pngData = resvg.render().asPng()
    const img = nativeImage.createFromBuffer(pngData, { scaleFactor: 2 })
    if (!img.isEmpty()) return img
  } catch {}
  return getFileDragIcon()
}

/** Pre-warm common drag icons asynchronously in background so first drag is instant. */
export function prewarmDragIcons(): void {
  setTimeout(() => {
    const commonKinds = [
      'pdf', 'word', 'excel', 'powerpoint', 'archive',
      'text', 'code', 'audio', 'video', 'image',
      'executable', 'folder', 'file'
    ]
    const queue: string[][] = [
      ...commonKinds.map((k) => [`dummy.${k}`]),
      ['dummy.image', 'dummy.image'],
      ['dummy.image', 'dummy.image', 'dummy.image']
    ]
    const renderNext = (): void => {
      const paths = queue.shift()
      if (!paths) return
      try {
        createFileStackDragIcon(paths)
      } catch {
        return
      }
      setImmediate(renderNext)
    }
    renderNext()
  }, 400)
}
