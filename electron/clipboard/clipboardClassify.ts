import { clipboard } from 'electron'
import { existsSync } from 'node:fs'
import type { ClipboardImageSource } from '../../shared/types'
import { macPasteboardTypes } from './nativeClipboard'
import { macFilePaths } from './clipboardFiles'

export const URL_RE = /^(https?:\/\/|www\.)[^\s]+$/i
export const COLOR_HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FILE_URL_RE = /file:\/\/\/?([^\s"'<>]+)/i
const POSIX_FILE_URL_RE = /file:\/\/(?:localhost)?(\/[^\s"'<>]+)/i
const POSIX_BARE_FILE_URL_RE = /^file:\/\/(?:localhost)?(\/[^\s<>]+)/i

export function localPathFromFileUrl(raw: string): string | null {
  if (process.platform === 'win32') return localPathFromClipboardFileUrl(raw)
  const posix = raw.trim().match(POSIX_BARE_FILE_URL_RE)
  if (!posix) return null
  try {
    const decoded = decodeURIComponent(posix[1])
    return existsSync(decoded) ? decoded : null
  } catch {
    return null
  }
}

/** Turn a clipboard file:// URL into a local path if that file exists. */
export function localPathFromClipboardFileUrl(raw: string): string | null {
  if (process.platform !== 'win32') {
    const posix = raw.match(POSIX_FILE_URL_RE)
    if (!posix) return null
    try {
      const decoded = decodeURIComponent(posix[1])
      return existsSync(decoded) ? decoded : null
    } catch {
      return null
    }
  }
  const m = raw.match(FILE_URL_RE)
  if (!m) return null
  try {
    let decoded = decodeURIComponent(m[1].replace(/"/g, ''))
    if (/^[a-zA-Z]:[\\/]/.test(decoded) || decoded.startsWith('\\\\')) {
      decoded = decoded.replace(/\//g, '\\')
    } else if (/^[a-zA-Z]\//.test(decoded)) {
      decoded = decoded.replace(/^([a-zA-Z])\//, '$1:\\').replace(/\//g, '\\')
    }
    return existsSync(decoded) ? decoded : null
  } catch {
    return null
  }
}

export function extractClipboardImageFileName(text: string, html: string): string | undefined {
  const fromHtml = localPathFromClipboardFileUrl(html)
  if (fromHtml) {
    const base = fromHtml.replace(/^.*[\\/]/, '')
    if (base) return base
  }
  const fromText = localPathFromClipboardFileUrl(text)
  if (fromText) {
    const base = fromText.replace(/^.*[\\/]/, '')
    if (base) return base
  }
  const http = text.match(/^(https?:\/\/.+)\/([^/?#]+)$/i)
  if (http && /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(http[2])) {
    try {
      return decodeURIComponent(http[2])
    } catch {
      return http[2]
    }
  }
  return undefined
}

function detectMacClipboardImageSource(text: string, html: string): ClipboardImageSource {
  if (text.trim() || html.trim()) return 'image'
  try {
    const formats = clipboard.availableFormats().map((f) => f.toLowerCase())
    if (formats.some((f) => !f.startsWith('image/'))) return 'image'
  } catch {}
  if (macFilePaths()) return 'image'
  const types = macPasteboardTypes()
  if (types && types.some((t) => /file-url|public\.url|filenames|promise|plain-text|html|rtf/i.test(t))) return 'image'
  return 'screenshot'
}

export function detectClipboardImageSource(text: string, html: string): ClipboardImageSource {
  if (process.platform === 'darwin') return detectMacClipboardImageSource(text, html)
  try {
    const formats = clipboard.availableFormats().map((f) => f.toLowerCase())
    if (formats.some((f) => /screenshot|snipping|screen\s*clip|screenclip/.test(f))) {
      return 'screenshot'
    }
    if (formats.some((f) => /filegroupdescriptor|filecontents|filenamew|shell idlist/.test(f))) {
      return 'image'
    }
  } catch {
    /* ignore */
  }

  if (localPathFromClipboardFileUrl(html) || localPathFromClipboardFileUrl(text)) return 'image'
  if (/^<img\b/i.test(html.trim()) || URL_RE.test(text.trim())) return 'image'

  const trimmed = text.trim()
  if (
    trimmed &&
    !URL_RE.test(trimmed) &&
    !trimmed.includes('\t') &&
    trimmed.split(/\r?\n/).filter(Boolean).length === 1 &&
    trimmed.length <= 200
  ) {
    return 'screenshot'
  }

  if (!trimmed && !html.trim()) return 'screenshot'
  return 'image'
}

/**
 * Async snapshot of the current clipboard into a single ItemData, or null.
 *
 * Order matters: a file copy should win over its text fallback, an image wins
/** HTML kept on an item for rich paste. Larger blobs stall persist, IPC, and React. */
export const MAX_ITEM_HTML_CHARS = 32_768
export const MAX_PAYLOAD_CHARS = 4_000_000
export const MAX_ORIGINAL_IMAGE_BYTES = 64 * 1024 * 1024
const MAC_REMOTE_CLIPBOARD_TYPE = 'com.apple.is-remote-clipboard'
export const MAC_PNG_TYPE = 'public.png'
export const MAC_TIFF_TYPE = 'public.tiff'
export const MAC_RTF_TYPE = 'public.rtf'

export function htmlWriteLimit(): number {
  return process.platform === 'darwin' ? MAX_PAYLOAD_CHARS : MAX_ITEM_HTML_CHARS
}

export function isRemoteClipboard(): boolean {
  if (process.platform !== 'darwin') return false
  const types = macPasteboardTypes()
  if (types) return types.includes(MAC_REMOTE_CLIPBOARD_TYPE)
  try {
    if (clipboard.availableFormats().includes(MAC_REMOTE_CLIPBOARD_TYPE)) return true
  } catch {}
  try {
    return clipboard.has(MAC_REMOTE_CLIPBOARD_TYPE)
  } catch {
    return false
  }
}
const HEAVY_TEXT_CHARS = 8_192
const HEAVY_TEXT_LINES = 40

export function countNewlines(s: string, limit: number): number {
  let n = 0
  for (let i = 0; i < s.length && n < limit; i++) {
    if (s.charCodeAt(i) === 10) n++
  }
  return n
}

export function isHeavyTabularText(text: string): boolean {
  if (!text.includes('\t')) return false
  return text.length > HEAVY_TEXT_CHARS || countNewlines(text, HEAVY_TEXT_LINES) >= HEAVY_TEXT_LINES
}

/** Scan a short prefix only — Excel HTML for a large range can be many MB. */
function htmlLooksLikeRichDocument(html: string): boolean {
  if (!html) return false
  const head = html.length > 4096 ? html.slice(0, 4096) : html
  return /<table\b|<tr\b|<td\b|<th\b|google-sheets|data-sheets|urn:schemas-microsoft-com:office:spreadsheet|excel|<html\b|<body\b|<p\b|<pre\b|<code\b|<ul\b|<ol\b|<li\b/i.test(head)
}

/**
 * Normalize clipboard text the same way `readClipboard` stores it, so the
 * watcher can cheap-compare a late Explorer/Excel format against the last capture
 * without decoding HTML or bitmaps.
 */
export function normalizeClipboardText(rawText: string): string {
  return rawText.includes('\t') ? rawText.replace(/\r?\n+$/, '') : rawText.trim()
}

/** Plain-text snapshot for coalesce checks. Does not read HTML or images. */
export function clipboardTextContent(): string | null {
  try {
    const raw = clipboard.readText()
    if (!raw) return null
    const n = normalizeClipboardText(raw)
    return n || null
  } catch {
    return null
  }
}

/**
 * Helper to determine whether a clipboard payload containing an image and text
 * is intended as an image (e.g. Snipping Tool window capture, browser "Copy Image",
 * or screenshot tool) or as text (e.g. Excel/Google Sheets tabular data, rich text,
 * multiline documents, code).
 */
export function isScreenshotOrImageIntent(hasImage: boolean, rawText: string, rawHtml: string): boolean {
  if (!hasImage) return false
  if (!rawText) return true

  if (process.platform === 'darwin') {
    if (/^<img\b[^>]*>$/i.test(rawText)) return true
    if (/^(?:<meta\b[^>]*>\s*)*<img\b[^>]*>$/i.test(rawHtml)) return true
    return URL_RE.test(rawText)
  }

  // Single bare image tag from browser "Copy Image" (e.g. <img src="...">)
  if (/^<img\b[^>]*>$/i.test(rawText) || /^<img\b[^>]*\/?>$/i.test(rawHtml)) return true

  // Single URL without any other text (browser "Copy Image" often sets image URL as text)
  if (URL_RE.test(rawText) && rawText.length < 500) return true

  // Spreadsheets (Excel, Google Sheets, Calc) & tabular text:
  // 1. Tab characters (\t) indicate column separators
  if (rawText.includes('\t')) return false

  // 2. Multiline text (multiple rows) indicates real tabular data, document paragraphs, or code
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length > 1) return false

  // 3. Spreadsheet HTML markup tags & rich office metadata (prefix only)
  if (htmlLooksLikeRichDocument(rawHtml)) return false

  // 4. If text is long (> 200 chars), it is a text document, not a window title
  if (rawText.length > 200) return false

  // Snipping tool window mode: single-line window title text <= 200 chars without tabs or HTML structure
  return true
}

/**
 * Format text and HTML data for clipboard write back.
 *
 * 1. Normalizes line breaks to Windows CRLF (\r\n). On Windows, Microsoft Excel and
 *    other spreadsheet applications use \r\n to separate table rows. If bare \n (LF)
 *    is used, Excel interprets the newline as an in-cell line feed (Alt+Enter) and
 *    pastes the entire multiline table into a SINGLE cell!
 *
 * 2. If the text contains tab characters (\t), it represents spreadsheet tabular cells.
 *    If no valid <table> HTML is provided (or if only non-table wrappers like
 *    <google-sheets-html-origin> <div> exist), we synthesize a standard HTML <table>
 *    so that spreadsheet apps (Excel, Google Sheets, Calc) and office apps (Word, Outlook)
 *    distribute rows and columns across the cell grid rather than dumping text into one cell.
 */
export function formatTabularDataForClipboard(text: string, rawHtml?: string): { text: string; html?: string } {
  if (!text) return { text: '', html: rawHtml && rawHtml.length <= htmlWriteLimit() ? rawHtml : undefined }

  // Normalize all line breaks to CRLF (\r\n) for Windows
  const crlfText = process.platform === 'win32' ? text.replace(/\r?\n/g, '\r\n') : text
  const htmlIfSmall = rawHtml && rawHtml.length <= htmlWriteLimit() ? rawHtml : undefined

  // Check if content has tab characters indicating column separators
  if (text.includes('\t')) {
    // If rawHtml already contains a standard table tag, use it — but never
    // paste megabytes of Excel CF_HTML back; TSV+CRLF is enough for the grid.
    if (htmlIfSmall && /<table\b[^>]*>/i.test(htmlIfSmall)) {
      return { text: crlfText, html: htmlIfSmall }
    }

    if (isHeavyTabularText(text)) {
      return { text: crlfText }
    }

    // Otherwise, generate a clean, standard HTML table from the TSV content
    const rows = text.split(/\r?\n/)
    const htmlRows = rows.map((row) => {
      const cells = row.split('\t').map((cell) => {
        const escaped = cell
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;')
        return `<td>${escaped}</td>`
      }).join('')
      return `<tr>${cells}</tr>`
    }).join('')

    const htmlTable = `<table border="0" cellpadding="0" cellspacing="0"><tbody>${htmlRows}</tbody></table>`
    return { text: crlfText, html: htmlTable }
  }

  return { text: crlfText, html: htmlIfSmall }
}
