/**
 * Reading & categorizing the system clipboard.
 *
 * Electron's `clipboard` API doesn't emit native change events, so we poll and
 * need to detect *what kind* of thing is on the clipboard each tick. The
 * priority is: files > image > html(rich) > text. We also pull a few "rich"
 * variants out of raw Windows formats (copied files arrive as FileNameW).
 */
import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import koffi from 'koffi'
import type { ClipboardImageSource, ItemData } from '../../shared/types'

let getSeqNum: (() => number) | null = null
let getPasteboardTypes: (() => string[]) | null = null
let getPasteboardFilePaths: (() => string[]) | null = null
if (process.platform === 'win32') {
  try {
    const user32 = koffi.load('user32.dll')
    getSeqNum = user32.func('uint32 GetClipboardSequenceNumber()')
  } catch (err) {
    console.error('[formats] Failed to load GetClipboardSequenceNumber from user32.dll:', err)
  }
}

// macOS: NSPasteboard.generalPasteboard.changeCount via the ObjC runtime.
// Cheap (no clipboard read) and bumps exactly once per copy — the macOS
// equivalent of GetClipboardSequenceNumber.
if (process.platform === 'darwin') {
  try {
    const objc = koffi.load('/usr/lib/libobjc.A.dylib')
    const getClass = objc.func('void *objc_getClass(const char *name)')
    const sel = objc.func('void *sel_registerName(const char *name)')
    const msgPtr = objc.func('objc_msgSend', 'void *', ['void *', 'void *'])
    const msgLong = objc.func('objc_msgSend', 'long', ['void *', 'void *'])
    const msgAt = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'ulong'])
    const msgStr = objc.func('objc_msgSend', 'str', ['void *', 'void *'])
    const msgObj = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *'])
    const msgFromUtf8 = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'str'])
    const cls = getClass('NSPasteboard')
    const clsString = getClass('NSString')
    const clsUrl = getClass('NSURL')
    const selGeneral = sel('generalPasteboard')
    const selCount = sel('changeCount')
    const selTypes = sel('types')
    const selLength = sel('count')
    const selAt = sel('objectAtIndex:')
    const selUtf8 = sel('UTF8String')
    const selItems = sel('pasteboardItems')
    const selStringForType = sel('stringForType:')
    const selFromUtf8 = sel('stringWithUTF8String:')
    const selUrlWithString = sel('URLWithString:')
    const selPath = sel('path')
    if (cls && selGeneral && selCount) {
      getSeqNum = () => {
        const pb = msgPtr(cls, selGeneral)
        return pb ? Number(msgLong(pb, selCount)) + 1 : 0
      }
    }
    if (cls && selGeneral && selTypes && selLength && selAt && selUtf8) {
      getPasteboardTypes = () => {
        const pb = msgPtr(cls, selGeneral)
        const arr = pb ? msgPtr(pb, selTypes) : null
        if (!arr) return []
        const n = Number(msgLong(arr, selLength))
        const out: string[] = []
        for (let i = 0; i < n; i++) {
          const item = msgAt(arr, selAt, i)
          const name = item ? msgStr(item, selUtf8) : null
          if (typeof name === 'string' && name) out.push(name)
        }
        return out
      }
    }
    if (cls && clsString && clsUrl && selGeneral && selItems && selLength && selAt && selUtf8 && selStringForType && selFromUtf8 && selUrlWithString && selPath) {
      getPasteboardFilePaths = () => {
        const pb = msgPtr(cls, selGeneral)
        const items = pb ? msgPtr(pb, selItems) : null
        const type = items ? msgFromUtf8(clsString, selFromUtf8, 'public.file-url') : null
        if (!items || !type) return []
        const n = Number(msgLong(items, selLength))
        const out: string[] = []
        for (let i = 0; i < n; i++) {
          const item = msgAt(items, selAt, i)
          const raw = item ? msgObj(item, selStringForType, type) : null
          const rawText = raw ? msgStr(raw, selUtf8) : null
          if (typeof rawText !== 'string' || !/^file:/i.test(rawText)) continue
          const url = msgObj(clsUrl, selUrlWithString, raw)
          const nsPath = url ? msgPtr(url, selPath) : null
          const path = nsPath ? msgStr(nsPath, selUtf8) : null
          if (typeof path === 'string' && path.startsWith('/')) out.push(path)
        }
        return out
      }
    }
  } catch (err) {
    console.error('[formats] NSPasteboard changeCount unavailable, falling back to signature polling:', err)
  }
}

export function getClipboardSequenceNumber(): number {
  if (getSeqNum) {
    try {
      return getSeqNum()
    } catch {
      return 0
    }
  }
  return 0
}

export function clipboardSequenceAvailable(): boolean {
  return getClipboardSequenceNumber() > 0
}

export function macPasteboardTypes(): string[] | null {
  if (process.platform !== 'darwin' || !getPasteboardTypes) return null
  try {
    return getPasteboardTypes()
  } catch {
    return null
  }
}

export function macNativeFilePaths(): string[] | null {
  if (process.platform !== 'darwin' || !getPasteboardFilePaths) return null
  try {
    return getPasteboardFilePaths()
  } catch {
    return null
  }
}
import { getSystemPowerShellPath, getWritableCwd } from '../main/powershell'
import { filterValidPaths } from '../main/pathValidation'
import { isStoreBuild } from '../main/config'

const execFileAsync = promisify(execFile)


/** macOS: list of file paths currently on the pasteboard (Finder copy). */
export function macFilePaths(): string[] | null {
  if (process.platform !== 'darwin') return null
  const native = macNativeFilePaths()
  if (native && native.length) return native
  try {
    const plist = clipboard.read('NSFilenamesPboardType')
    if (plist) {
      const paths = Array.from(plist.matchAll(/<string>([\s\S]*?)<\/string>/g)).map((m) =>
        m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      )
      if (paths.length) return paths
    }
    const url = clipboard.read('public.file-url')
    if (url && url.startsWith('file://')) {
      return [decodeURIComponent(url.replace(/^file:\/\//, '').replace(/^localhost/, ''))]
    }
  } catch {
    /* ignore */
  }
  return null
}

/** Windows clipboard format name for a copied-file list. */
export const CF_FILE_LIST = 'FileNameW'

/**
 * Async version: reads the full list of copied file paths via PowerShell
 * GetFileDropList(), which is the only reliable way to retrieve ALL selected
 * files from a multi-file Explorer copy (CF_HDROP / FileNameW only carries
 * the first file as a legacy single-path fallback).
 *
 * Falls back to parsing the FileNameW UTF-16LE buffer directly if PowerShell
 * is unavailable or times out.
 */
async function readFileListAsync(): Promise<string[] | null> {
  if (process.platform === 'darwin') {
    const mp = macFilePaths()
    if (!mp) return null
    const valid = filterValidPaths(mp)
    return valid.length ? valid : null
  }
  try {
    // First, confirm there is actually a file list on the clipboard before
    // spawning a process.  FileNameW being present is sufficient signal.
    const buf = clipboard.readBuffer(CF_FILE_LIST)
    if (!buf || buf.length < 4) return null

    if (process.platform === 'win32') {
      try {
        const psPath = getSystemPowerShellPath()
        // Await the result so we actually get all paths — the previous
        // implementation fired execFile with a callback that returned from
        // the closure, not from readFileList(), so the result was dropped.
        const { stdout } = await execFileAsync(
          psPath,
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetFileDropList()'
          ],
          { encoding: 'utf8', timeout: 2000, windowsHide: true, ...(isStoreBuild() ? { cwd: getWritableCwd() } : {}) }
        )
        if (stdout) {
          const paths = filterValidPaths(stdout.split(/\r?\n/).map((l) => l.trim()))
          if (paths.length > 0) return paths
        }
      } catch {
        // PowerShell timeout or locked clipboard fallback — parse buffer directly
      }
    }

    // Non-Windows or PowerShell fallback: parse the FileNameW buffer directly.
    // On Windows this will typically only return the first file, but it is
    // better than nothing when PowerShell is unavailable.
    const wide = buf.toString('utf16le')
    const parts = filterValidPaths(wide.split('\u0000').map((s) => s.trim()))
    return parts.length ? parts : null
  } catch {
    return null
  }
}

/** Fast, non-blocking check of FileNameW contents for clipboard signatures. */
function readFileListFast(): string[] | null {
  if (process.platform === 'darwin') return macFilePaths()
  try {
    const buf = clipboard.readBuffer(CF_FILE_LIST)
    if (!buf || buf.length < 4) return null
    const wide = buf.toString('utf16le')
    const parts = wide.split('\u0000').map((s) => s.trim()).filter(Boolean)
    return parts.length ? parts : null
  } catch {
    return null
  }
}

/**
 * True when FileNameW currently holds at least one path.
 *
 * Cheap peek used by the watcher during the post-capture coalesce window.
 * Reads only FileNameW (not CF_BITMAP / FileContents), so it does not
 * retrigger Explorer's delayed-render pipeline.
 */
export function clipboardHasFileNameW(): boolean {
  if (process.platform === 'darwin') return !!macFilePaths()
  try {
    const buf = clipboard.readBuffer(CF_FILE_LIST)
    return !!(buf && buf.length >= 4)
  } catch {
    return false
  }
}

/**
 * Content key for the file drop currently on the clipboard, matching
 * `contentSignature` for `kind: 'files'`.
 *
 * Uses FileNameW plus CF_UNICODETEXT (Explorer writes every selected path as
 * plain text). Does not request CF_BITMAP / FileContents, so it will not
 * retrigger delayed rendering.
 *
 * Closing an Explorer window sends WM_RENDERALLFORMATS and bumps the sequence
 * number without changing the path list — the watcher compares this key to
 * the last capture and ignores that flush.
 */
export function clipboardFilesContentKey(): string | null {
  if (process.platform === 'darwin') {
    const mp = macFilePaths()
    return mp ? `files|${mp.join('\n')}` : null
  }
  try {
    const buf = clipboard.readBuffer(CF_FILE_LIST)
    if (!buf || buf.length < 4) return null
    const fromName = buf
      .toString('utf16le')
      .split('\u0000')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!fromName.length) return null

    let paths = fromName
    try {
      const raw = clipboard.readText()
      if (raw) {
        const lines = raw
          .split(/\r?\n/)
          .map((s) => s.trim().replace(/^"(.*)"$/, '$1'))
          .filter(Boolean)
        if (lines.length >= fromName.length && lines.includes(fromName[0])) {
          paths = lines
        }
      }
    } catch {
      /* FileNameW only */
    }

    return `files|${paths.join('\n')}`
  } catch {
    return null
  }
}

/**
 * True when the clipboard is advertising a real file drop (Explorer, desktop,
 * etc.) even if the path list is not readable yet. FileGroupDescriptor alone
 * is NOT enough — browsers use that for "Copy Image" virtual files.
 */
export function clipboardAdvertisesFileList(): boolean {
  if (clipboardHasFileNameW()) return true
  if (process.platform === 'darwin') {
    const types = macPasteboardTypes()
    return !!types && types.some((t) => t === 'public.file-url' || t === 'NSFilenamesPboardType')
  }
  try {
    return clipboard.availableFormats().some((f) => {
      const l = f.toLowerCase()
      return l === 'filenamew' || l === 'filename' || l.includes('shell idlist')
    })
  } catch {
    return false
  }
}

/**
 * Build a `FileNameW` buffer suitable for `clipboard.writeBuffer()`.
 *
 * This is the reverse of `readFileList()`: UTF-16LE paths separated by NUL
 * chars, terminated with a double NUL. Writing this format lets the Windows
 * clipboard hold actual file *references* so that pasting into Explorer, Word,
 * etc. operates on the real files instead of pasting literal path strings.
 */
export function buildFileListBuffer(paths: string[]): Buffer {
  // Each path separated by NUL, then two trailing NULs to terminate the list.
  const joined = paths.join('\0') + '\0\0'
  return Buffer.from(joined, 'utf16le')
}

const URL_RE = /^(https?:\/\/|www\.)[^\s]+$/i
const COLOR_HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
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

/** Sensitive clipboard formats used by password managers and transient scripts. */
const IGNORED_FORMATS = [
  'ClipboardViewerIgnore',
  'Clipboard Viewer Ignore',
  'ExcludeClipboardContentFromMonitorProcessing',
  'org.nspasteboard.ConcealedType',
  'org.nspasteboard.AutoGeneratedType',
  'com.agilebits.onepassword',
  'com.apple.is-sensitive',
  'com.apple.pasteboard.concealed',
  'KeePassClipFormat',
  'com.bitwarden.concealed'
]

/** Read a DWORD (32-bit uint) from a clipboard format, if present. */
export function _getClipboardDword(format: string): number | undefined {
  try {
    const buf = clipboard.readBuffer(format)
    if (buf && buf.length >= 4) {
      return buf.readUInt32LE(0)
    }
    // If present but empty buffer, we can't return a number, return null to indicate presence without value
    if (buf && buf.length === 0) {
      return -1
    }
  } catch {
    // ignore
  }
  return undefined
}

/**
 * Windows registered clipboard format names are compared case-insensitively by
 * the OS, but `availableFormats()` returns whatever casing the registering app
 * used. So a privacy flag like `ExcludeClipboardContentFromMonitorProcessing`
 * may arrive in any casing — we must match it case-insensitively, otherwise
 * content a password manager / dictation tool explicitly marked "do not record"
 * still leaks into our history (and out of Windows' own Win+V history).
 */
function isIgnoredFormat(format: string): boolean {
  const lower = format.toLowerCase()
  return IGNORED_FORMATS.some((f) => f.toLowerCase() === lower)
}

const MAC_EXCLUDED_PASTEBOARD_TYPES = [
  'org.nspasteboard.ConcealedType',
  'org.nspasteboard.TransientType',
  'org.nspasteboard.AutoGeneratedType',
  'com.agilebits.onepassword',
  'de.petermaurer.TransientPasteboardType',
  'com.typeit4me.clipping',
  'Pasteboard generator type'
]

export function hasExcludedPasteboardType(types: readonly string[]): boolean {
  return types.some((type) => {
    const lower = type.toLowerCase()
    return MAC_EXCLUDED_PASTEBOARD_TYPES.some((t) => t.toLowerCase() === lower) || isIgnoredFormat(type)
  })
}

function isMacClipboardExcluded(): boolean {
  const types = macPasteboardTypes()
  if (types && hasExcludedPasteboardType(types)) return true
  return MAC_EXCLUDED_PASTEBOARD_TYPES.some((t) => {
    try {
      return clipboard.has(t)
    } catch {
      return false
    }
  })
}

/**
 * Checks whether the current clipboard content is marked as sensitive, confidential,
 * or transient (e.g. by password managers, dictation tools, or macro scripts)
 * and should be ignored by clipboard monitors.
 */
export function isClipboardExcluded(): boolean {
  const formats = clipboard.availableFormats()

  if (formats.some((f) => isIgnoredFormat(f))) {
    return true
  }

  if (process.platform === 'darwin' && isMacClipboardExcluded()) {
    return true
  }

  // Explicitly check known privacy formats because Chromium often hides them from availableFormats()
  const checkExplicitExclusion = (format: string, isExcluded: (buf: Buffer) => boolean) => {
    try {
      const buf = clipboard.readBuffer(format)
      if (!buf || buf.length === 0) return false
      return isExcluded(buf)
    } catch {
      return false
    }
  }

  // CanIncludeInClipboardHistory: 0 means DO NOT include
  if (checkExplicitExclusion('CanIncludeInClipboardHistory', (buf) => buf.length >= 4 && buf.readUInt32LE(0) === 0)) {
    return true
  }

  // CanUploadToCloudClipboard: 0 means DO NOT include
  if (checkExplicitExclusion('CanUploadToCloudClipboard', (buf) => buf.length >= 4 && buf.readUInt32LE(0) === 0)) {
    return true
  }

  // ExcludeClipboardContentFromMonitorProcessing: non-zero means EXCLUDE
  if (checkExplicitExclusion('ExcludeClipboardContentFromMonitorProcessing', (buf) => buf.length >= 4 && buf.readUInt32LE(0) !== 0)) {
    return true
  }

  // Clipboard Viewer Ignore: presence of format with data means EXCLUDE
  if (checkExplicitExclusion('Clipboard Viewer Ignore', () => true)) {
    return true
  }

  return false
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
const MAC_RTF_TYPE = 'public.rtf'

function htmlWriteLimit(): number {
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

function countNewlines(s: string, limit: number): number {
  let n = 0
  for (let i = 0; i < s.length && n < limit; i++) {
    if (s.charCodeAt(i) === 10) n++
  }
  return n
}

function isHeavyTabularText(text: string): boolean {
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

/** True if the text payload looks like a single URL. */
export function isUrlText(s: string): boolean {
  return URL_RE.test(s)
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
