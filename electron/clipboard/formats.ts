/**
 * Reading & categorizing the system clipboard.
 *
 * Electron's `clipboard` API doesn't emit native change events, so we poll and
 * need to detect *what kind* of thing is on the clipboard each tick. The
 * priority is: files > image > html(rich) > text. We also pull a few "rich"
 * variants out of raw Windows formats (copied files arrive as FileNameW).
 */
import { clipboard } from 'electron'
import type { ItemData } from '../../shared/types'
import { readFileListAsync, readFileListFast, clipboardAdvertisesFileList } from './clipboardFiles'
import { getClipboardSequenceNumber, macPasteboardTypes } from './nativeClipboard'
import { isClipboardExcluded } from './clipboardExclusion'
import { URL_RE, COLOR_HEX_RE, MAX_PAYLOAD_CHARS, MAX_ORIGINAL_IMAGE_BYTES, MAC_PNG_TYPE, MAC_TIFF_TYPE, MAC_RTF_TYPE, htmlWriteLimit, countNewlines, isHeavyTabularText, normalizeClipboardText, isScreenshotOrImageIntent, formatTabularDataForClipboard, localPathFromClipboardFileUrl, extractClipboardImageFileName, detectClipboardImageSource } from './clipboardClassify'

export { getClipboardSequenceNumber, clipboardSequenceAvailable, macPasteboardTypes, macNativeFilePaths } from './nativeClipboard'
export { macFilePaths, CF_FILE_LIST, clipboardHasFileNameW, clipboardFilesContentKey, clipboardAdvertisesFileList } from './clipboardFiles'
export { hasExcludedPasteboardType, isClipboardExcluded } from './clipboardExclusion'
export { localPathFromFileUrl, localPathFromClipboardFileUrl, extractClipboardImageFileName, detectClipboardImageSource, MAX_ITEM_HTML_CHARS, MAX_PAYLOAD_CHARS, MAX_ORIGINAL_IMAGE_BYTES, MAC_PNG_TYPE, MAC_TIFF_TYPE, isRemoteClipboard, normalizeClipboardText, clipboardTextContent, isScreenshotOrImageIntent, formatTabularDataForClipboard } from './clipboardClassify'

/**
 * Async snapshot of the current clipboard into a single ItemData, or null.
 *
 * Order matters: a file copy should win over its text fallback, an image wins
 * over nothing, otherwise we keep text (preferring HTML if it carries rich text).
 *
 * This is async because reading the full multi-file list from a Windows
 * Explorer copy requires a PowerShell round-trip (GetFileDropList).
 */
const capturedImages = new WeakMap<ItemData, Electron.NativeImage>()

export function takeCapturedImage(data: ItemData): Electron.NativeImage | undefined {
  const img = capturedImages.get(data)
  capturedImages.delete(data)
  return img
}

export interface OriginalImage {
  type: typeof MAC_PNG_TYPE | typeof MAC_TIFF_TYPE
  bytes: Buffer
}

const capturedOriginals = new WeakMap<ItemData, OriginalImage>()
const capturedRtf = new WeakMap<ItemData, string>()

export function takeCapturedOriginalImage(data: ItemData): OriginalImage | undefined {
  const original = capturedOriginals.get(data)
  capturedOriginals.delete(data)
  return original
}

export function takeCapturedRtf(data: ItemData): string | undefined {
  const rtf = capturedRtf.get(data)
  capturedRtf.delete(data)
  return rtf
}

export function isPngBytes(bytes: Buffer): boolean {
  return bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a
}

export function isTiffBytes(bytes: Buffer): boolean {
  if (bytes.length <= 8) return false
  const head = bytes.readUInt32BE(0)
  return head === 0x49492a00 || head === 0x4d4d002a
}

function readPasteboardBytes(type: string, types: string[] | null): Buffer | null {
  if (types && !types.includes(type)) return null
  try {
    const bytes = clipboard.readBuffer(type)
    return bytes && bytes.length > 0 && bytes.length <= MAX_ORIGINAL_IMAGE_BYTES ? bytes : null
  } catch {
    return null
  }
}

function readOriginalImage(): OriginalImage | null {
  if (process.platform !== 'darwin') return null
  const types = macPasteboardTypes()
  const png = readPasteboardBytes(MAC_PNG_TYPE, types)
  if (png && isPngBytes(png)) return { type: MAC_PNG_TYPE, bytes: png }
  const tiff = readPasteboardBytes(MAC_TIFF_TYPE, types)
  if (tiff && isTiffBytes(tiff)) return { type: MAC_TIFF_TYPE, bytes: tiff }
  return null
}

function readPasteboardRtf(): string | undefined {
  if (process.platform !== 'darwin') return undefined
  const types = macPasteboardTypes()
  if (types && !types.includes(MAC_RTF_TYPE)) return undefined
  try {
    const rtf = clipboard.readRTF()
    return rtf && rtf.length <= MAX_PAYLOAD_CHARS ? rtf : undefined
  } catch {
    return undefined
  }
}

export function writeRichTextToClipboard(content: { text: string; html?: string; rtf?: string }): void {
  const formatted = formatTabularDataForClipboard(content.text, content.html)
  const data: Electron.Data = { text: formatted.text }
  if (formatted.html) data.html = formatted.html
  if (content.rtf) data.rtf = content.rtf
  clipboard.clear()
  clipboard.write(data)
}

function imageCapture(img: Electron.NativeImage, text: string, html: string): ItemData {
  const size = img.getSize()
  const data: ItemData = {
    kind: 'image',
    imageId: '',
    width: size.width,
    height: size.height,
    bytes: 0,  // placeholder — ClipboardWatcher overwrites this with the actual PNG buffer length
    source: detectClipboardImageSource(text, html),
    fileName: extractClipboardImageFileName(text, html)
  }
  capturedImages.set(data, img)
  const original = readOriginalImage()
  if (original) capturedOriginals.set(data, original)
  return data
}

export async function readClipboard(): Promise<ItemData | null> {
  if (isClipboardExcluded()) {
    return null
  }

  // Files first — a file copy also places text on the clipboard, which we ignore.
  const files = await readFileListAsync()
  if (files && files.length) return { kind: 'files', paths: files }

  // Explorer advertises FileNameW / Shell IDList before the path list is
  // readable. Falling through to the preview bitmap would record a screenshot
  // of the first file, then a second files card when the paths arrive.
  if (clipboardAdvertisesFileList()) return null

  // Text first. Excel/Sheets copies of a large range put a huge CF_BITMAP of
  // the selection plus megabytes of CF_HTML. Decoding those on the UI thread
  // stalls the window; shipping the HTML through persist/IPC makes it jitter.
  const rawText = clipboard.readText()
  const trimmedText = rawText.trim()
  const heavyTable = isHeavyTabularText(rawText)
  const skipBitmap = rawText.includes('\t') || countNewlines(rawText, 2) >= 2

  let rawHtml = ''
  if (!heavyTable) {
    rawHtml = clipboard.readHTML()
  }
  const trimmedHtml = rawHtml.trim()

  const localFromHtml = localPathFromClipboardFileUrl(trimmedHtml) || localPathFromClipboardFileUrl(trimmedText)
  if (localFromHtml) return { kind: 'files', paths: [localFromHtml] }

  let hasImage = false
  let img: ReturnType<typeof clipboard.readImage> | null = null
  if (!skipBitmap) {
    img = clipboard.readImage()
    hasImage = !img.isEmpty()
  }

  // Snipping Tool (Window mode, Freeform, Rectangular) or browser images:
  if (img && isScreenshotOrImageIntent(hasImage, trimmedText, trimmedHtml)) {
    return imageCapture(img, trimmedText, trimmedHtml)
  }

  // Text intent (Notepad, Word, VS Code text copy, Excel/Google Sheets tabular copy, rich HTML copy)
  if (trimmedText) {
    let html: string | undefined
    if (trimmedHtml && trimmedHtml !== trimmedText && rawHtml.length <= htmlWriteLimit()) {
      html = rawHtml
    }

    const textToStore = normalizeClipboardText(rawText)

    const isUrl = URL_RE.test(trimmedText)
    const isColor = COLOR_HEX_RE.test(trimmedText)

    const data: ItemData = { kind: 'text', text: textToStore, html, isUrl, isColor }
    const rtf = heavyTable ? undefined : readPasteboardRtf()
    if (rtf) capturedRtf.set(data, rtf)
    return data
  }

  // Fallback to image if no text
  if (hasImage && img) {
    return imageCapture(img, trimmedText, trimmedHtml)
  }

  return null
}

/**
 * A cheap signature string used to detect that the clipboard *changed* without
 * having to construct a full ItemData or encode images.
 *
 * Strategy:
 *  - Files   → the list of paths (totally stable, always unique per copy)
 *  - Images  → dimensions + a sampled FNV-1a hash of raw pixel bytes
 *  - Text    → the text content itself
 *
 * For images we use `nativeImage.toBitmap()` (raw BGRA, no codec) and walk
 * ~400 evenly-spaced bytes through it.  This is:
 *   - Fast:   no PNG encoding, O(400) byte reads regardless of image size
 *   - Stable: same clipboard content → same pixels → same hash on every poll
 *   - Unique: different images with the same resolution produce different pixel
 *             values in practice, so collisions are astronomically unlikely
 */
export function clipboardSignature(): string {
  const seq = getClipboardSequenceNumber()
  const seqPrefix = seq > 0 ? `seq:${seq}:` : ''

  if (isClipboardExcluded()) {
    return `${seqPrefix}excluded`
  }

  // If files are on the clipboard, their paths are the most stable fingerprint.
  // Use fast, non-blocking read to avoid spawning a child process during polling.
  const files = readFileListFast()
  if (files && files.length) {
    return `${seqPrefix}files:${files.join('\n')}`
  }

  const rawUntrimmed = clipboard.readText()
  // Spreadsheet copies carry a huge selection bitmap. Fingerprint the TSV
  // only — toBitmap() of a 1500-row range stalls the window.
  if (rawUntrimmed.includes('\t') || countNewlines(rawUntrimmed, 2) >= 2) {
    return `${seqPrefix}text:${normalizeClipboardText(rawUntrimmed)}`
  }

  const img = clipboard.readImage()
  const hasImage = !img.isEmpty()
  const rawText = rawUntrimmed.trim()
  const rawHtml = clipboard.readHTML().trim()

  if (isScreenshotOrImageIntent(hasImage, rawText, rawHtml)) {
    const size = img.getSize()
    const bitmap = img.toBitmap()  // raw BGRA — no encoding, just a memory copy

    // FNV-1a over ~400 evenly-spaced bytes.
    const step = Math.max(1, Math.floor(bitmap.length / 400))
    let hash = 0x811c9dc5 // FNV offset basis
    for (let i = 0; i < bitmap.length; i += step) {
      hash ^= bitmap[i]
      hash = Math.imul(hash, 0x01000193) >>> 0 // FNV prime, keep as uint32
    }

    return `${seqPrefix}image:${size.width}x${size.height}:${hash.toString(36)}`
  }

  // Text — the content itself is the fingerprint.
  if (rawText) {
    return `${seqPrefix}text:${rawText}`
  }

  // Fallback to image if no text
  if (hasImage) {
    const size = img.getSize()
    const bitmap = img.toBitmap()
    const step = Math.max(1, Math.floor(bitmap.length / 400))
    let hash = 0x811c9dc5
    for (let i = 0; i < bitmap.length; i += step) {
      hash ^= bitmap[i]
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return `${seqPrefix}image:${size.width}x${size.height}:${hash.toString(36)}`
  }

  return `${seqPrefix}empty`
}

/**
 * Pure matcher: does a clipboard signature (as produced by
 * `clipboardSignature()`) represent exactly this item's content?
 *
 * CRITICAL: signatures carry a Win32 `seq:<n>:` prefix whenever
 * GetClipboardSequenceNumber() > 0 (i.e., virtually always on Windows). The
 * comparison MUST strip that prefix first — comparing the raw string against
 * a bare `text:<content>` made every text/link ownership check silently fail,
 * so deleting an item whose content still sat on the system clipboard never
 * cleared it (and the content could then be re-captured later, appearing to
 * "come back").
 *
 * Image matching keeps the dimension-prefix heuristic (avoids a full pixel
 * read); over-clearing when two same-dimension images are involved is the
 * documented, acceptable trade-off.
 */
export function signatureMatchesItem(sig: string, data: ItemData, fullText?: string): boolean {
  const bare = sig.replace(/^seq:\d+:/, '')
  switch (data.kind) {
    case 'text': {
      const body = fullText && fullText.length > 0 ? fullText : data.text
      if (bare === `text:${body}`) return true
      // Long items store only a 300-char preview; the OS clipboard still has the full string.
      if (data.hasFullPayload && data.text && bare.startsWith(`text:${data.text}`)) return true
      return false
    }
    case 'files':
      return bare === `files:${data.paths.join('\n')}`
    case 'image':
      return bare.startsWith(`image:${data.width}x${data.height}:`)
    case 'image-collection':
      return bare.startsWith('image:')
  }
}
