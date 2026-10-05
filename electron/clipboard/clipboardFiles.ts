import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getSystemPowerShellPath, getWritableCwd } from '../main/powershell'
import { filterValidPaths } from '../main/pathValidation'
import { isStoreBuild } from '../main/config'
import { macNativeFilePaths, macPasteboardTypes } from './nativeClipboard'

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
export async function readFileListAsync(): Promise<string[] | null> {
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
export function readFileListFast(): string[] | null {
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
