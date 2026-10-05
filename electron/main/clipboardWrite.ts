import { clipboard, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { psHost } from './powershell'
import { filterValidPaths } from './pathValidation'
import { getStore, writeStoredImageToPasteboard } from './state'
import { stageDragFile } from './drag'
import { clipboardSignature, formatTabularDataForClipboard, signatureMatchesItem, writeRichTextToClipboard } from '../clipboard/formats'
import type { ClipboardItem, ItemData } from '../../shared/types'
import { toUnpackagedFilePath, toUnpackagedFilePaths } from '../store/paths'
import { writeFileUrls, addFileUrlToCurrentItem, addImageDataToFirstItem, pasteboardChangeCount } from './macPasteboard'

let macNamedImageWrite: { src: string; named: string } | null = null

/**
 * Returns true if the current system clipboard content matches the given item data.
 *
 * Delegates to the pure, unit-tested matcher in formats.ts, which strips the
 * Win32 sequence-number prefix before comparing — without that strip, text
 * ownership checks could never match on real Windows sessions.
 *
 * Used before delete/clear to decide whether to clear the system clipboard.
 * Clearing is only done when the deleted item IS the thing currently on the
 * clipboard; deleting an old history entry that the user has since replaced
 * must never wipe their current clipboard contents.
 */
export function clipboardMatchesItem(item: ClipboardItem): boolean {
  const fullText =
    item.data.kind === 'text' && item.data.hasFullPayload
      ? getStore().getFullText(item.id)
      : undefined
  const sig = clipboardSignature()
  if (process.platform === 'darwin' && macNamedImageWrite && sig.replace(/^seq:\d+:/, '') === `files:${macNamedImageWrite.named}`) {
    const image = item.data.kind === 'image' ? item.data : item.data.kind === 'image-collection' ? item.data.images[0] : null
    if (image) {
      const src = getStore().resolveStoredImagePath(image.imageId, image.ext)
      return !!src && toUnpackagedFilePath(src) === macNamedImageWrite.src
    }
  }
  return signatureMatchesItem(sig, item.data, fullText)
}

/**
 * Write file *references* onto the system clipboard so that paste in Explorer,
 * Word, Slack, and every other shell-aware app copies the actual files.
 *
 * WHY POWERSHELL: Electron's clipboard API calls EmptyClipboard() on every
 * write. Sequential calls (writeBuffer then writeText) leave only the LAST
 * format — which was always the plain path string, making every paste land as
 * text. PowerShell's Clipboard.SetFileDropList writes CF_HDROP + FileNameW +
 * Shell IDList Array + all other shell formats in a single atomic transaction.
 * Paths are base64-encoded so any character (spaces, quotes, Unicode) is safe.
 *
 * Returns false when no valid path remained (e.g. every source file was
 * deleted since capture) so callers can surface an explicit error.
 */
export async function writeFileListToClipboard(rawPaths: string[]): Promise<boolean> {
  const validPaths = toUnpackagedFilePaths(filterValidPaths(rawPaths))
  if (validPaths.length === 0) return false
  if (process.platform === 'win32') {
    try {
      const addLines = validPaths
        .map(p => `$c.Add([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(p, 'utf8').toString('base64')}')))|Out-Null`)
        .join(';')
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$c=New-Object System.Collections.Specialized.StringCollection',
        addLines,
        '[Windows.Forms.Clipboard]::SetFileDropList($c)'
      ].join(';')
      await psHost.run(script, 3000)
      return true
    } catch (err) {
      console.error('[ipc] writeFileListToClipboard PowerShell failed, using text fallback:', err)
    }
  }
  if (process.platform === 'darwin') {
    if (writeFileUrls(validPaths)) return true
    try {
      const jxa = "function run(argv){ObjC.import('AppKit');var pb=$.NSPasteboard.generalPasteboard;pb.clearContents;var a=$.NSMutableArray.array;argv.forEach(function(p){a.addObject($.NSURL.fileURLWithPath(p))});return pb.writeObjects(a)&&pb.pasteboardItems.count==argv.length}"
      const out = await new Promise<string>((resolve, reject) => {
        execFile('osascript', ['-l', 'JavaScript', '-e', jxa, ...validPaths], { timeout: 3000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout ?? ''))))
      })
      if (out.trim() !== 'true') throw new Error(`pasteboard does not hold all ${validPaths.length} files`)
      return true
    } catch (err) {
      console.error('[ipc] writeFileListToClipboard (macOS) failed, using text fallback:', err)
    }
  }
  // Non-Windows / PowerShell failure fallback: plain text paths (best-effort)
  clipboard.clear()
  clipboard.writeText(validPaths.join('\r\n'))
  return true
}

/**
 * Write a full-resolution bitmap onto the system clipboard.
 *
 * Deliberately does NOT fall back to the low-res renderer preview: silently
 * pasting a 240px thumbnail when the original vanished is worse than an
 * explicit failure. Returns false so callers can show a precise toast.
 */
export async function writeImageToClipboard(imagePath: string | null): Promise<boolean> {
  if (imagePath && existsSync(imagePath)) {
    try {
      const img = nativeImage.createFromPath(imagePath)
      if (!img.isEmpty()) {
        clipboard.clear()
        clipboard.writeImage(img)
        return true
      }
    } catch (err) {
      console.error('[ipc] writeImageToClipboard nativeImage.createFromPath failed:', err)
    }
  }
  return false
}

function addFirstImageToMacFileList(imagePath: string): boolean {
  try {
    const img = nativeImage.createFromPath(imagePath)
    if (img.isEmpty()) return false
    if (addImageDataToFirstItem(img.toPNG(), pasteboardChangeCount())) return true
    console.error('[ipc] image-collection clipboard write (macOS) could not add the first image:', imagePath)
  } catch (err) {
    console.error('[ipc] image-collection clipboard write (macOS) failed to add the first image:', err)
  }
  return false
}

/**
 * Bitmap for apps that read CF_DIB, plus a named file so Explorer paste keeps
 * our friendly filename. Atomic multi-format write via PowerShell DataObject.
 */
async function writeImageWithNamedFile(imagePath: string, namedPath: string): Promise<boolean> {
  if (process.platform === 'darwin') {
    macNamedImageWrite = null
    if (!(await writeImageToClipboard(imagePath))) return false
    if (addFileUrlToCurrentItem(namedPath, pasteboardChangeCount())) {
      macNamedImageWrite = { src: imagePath, named: namedPath }
    } else {
      console.error('[ipc] writeImageWithNamedFile (macOS) could not add the file reference:', namedPath)
    }
    return true
  }
  if (process.platform !== 'win32') return false
  try {
    const b64Img = Buffer.from(imagePath, 'utf8').toString('base64')
    const b64File = Buffer.from(namedPath, 'utf8').toString('base64')
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      `$img=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Img}'))`,
      `$fp=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64File}'))`,
      '$bmp=[Drawing.Image]::FromFile($img)',
      '$d=New-Object Windows.Forms.DataObject',
      '$d.SetImage($bmp)',
      '$c=New-Object System.Collections.Specialized.StringCollection',
      '$c.Add($fp)|Out-Null',
      '$d.SetFileDropList($c)',
      '[Windows.Forms.Clipboard]::SetDataObject($d,$true)',
      '$bmp.Dispose()'
    ].join(';')
    await psHost.run(script, 3000)
    return true
  } catch (err) {
    console.error('[ipc] writeImageWithNamedFile failed:', err)
    return false
  }
}

/**
 * Write any item payload back onto the system clipboard.
 *
 * CONTRACT: every kind resolves its concrete files through the SAME staging
 * engine the native drag-out uses (`stageDragFile`), so paste and drag can
 * never disagree about filenames or content. Returns false when nothing was
 * written (e.g. every source image vanished from disk) so callers can show an
 * explicit error instead of silently degrading quality.
 */
export async function writeItemToClipboard(data: ItemData, capturedAt?: number, itemId?: string): Promise<boolean> {
  switch (data.kind) {
    case 'text': {
      if (process.platform === 'darwin') {
        const rich = itemId ? getStore().getRichText(itemId) : null
        writeRichTextToClipboard(rich ?? { text: data.text, html: data.html })
        return true
      }
      const formatted = formatTabularDataForClipboard(data.text, data.html)
      clipboard.clear()
      clipboard.write({ text: formatted.text, html: formatted.html })
      return true
    }

    case 'image': {
      // Fix: recover via directory scan before giving up; abort explicitly
      // when the original is unrecoverable instead of pasting a blurry
      // low-res preview.
      const src = getStore().resolveStoredImagePath(data.imageId, data.ext)
      if (!src) return false

      const staged = stageDragFile(data, capturedAt)
      const named = staged?.file && existsSync(staged.file) ? toUnpackagedFilePath(staged.file) : undefined
      if (process.platform === 'darwin') {
        macNamedImageWrite = null
        if (writeStoredImageToPasteboard(data, named)) {
          if (named) macNamedImageWrite = { src: toUnpackagedFilePath(src), named }
          return true
        }
      }
      if (named) {
        // Full-res bitmap + friendly-named file reference in one atomic
        // multi-format write, so Explorer keeps "Screenshot …" naming while
        // pixel-oriented apps get CF_DIB.
        if (await writeImageWithNamedFile(toUnpackagedFilePath(src), named)) return true
      }
      // Fallback: full-resolution bitmap only (no filename reference).
      return writeImageToClipboard(src)
    }

    case 'image-collection': {
      // Fix: stage through the shared engine so every file gets the same
      // indexed pretty names drag-out produces ("Screenshot … (2).png")
      // instead of raw storage ids ("<hex>.png").
      const staged = stageDragFile(data, capturedAt)
      const stagedFiles = staged?.files ?? []
      if (stagedFiles.length === 0) return false

      const firstImg = data.images[0]
      const firstSrc = firstImg
        ? getStore().resolveStoredImagePath(firstImg.imageId, firstImg.ext)
        : null

      if (stagedFiles.length === 1 && firstSrc) {
        const named = toUnpackagedFilePath(stagedFiles[0])
        if (await writeImageWithNamedFile(toUnpackagedFilePath(firstSrc), named)) return true
        return writeImageToClipboard(firstSrc)
      }

      if (!firstSrc) {
        // No bitmap recoverable — the surviving named file references are
        // still perfectly valid for Explorer-style targets.
        return writeFileListToClipboard(stagedFiles)
      }

      if (process.platform === 'darwin') {
        if (!(await writeFileListToClipboard(stagedFiles))) return false
        addFirstImageToMacFileList(toUnpackagedFilePath(firstSrc))
        return true
      }

      // Multi-file: all pretty-named refs + first image as bitmap.
      try {
        const exposed = stagedFiles.map((p) => toUnpackagedFilePath(p))
        const addLines = exposed
          .map(p => `$c.Add([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(p, 'utf8').toString('base64')}')))|Out-Null`)
          .join(';')
        const b64First = Buffer.from(toUnpackagedFilePath(firstSrc), 'utf8').toString('base64')
        const script = [
          'Add-Type -AssemblyName System.Windows.Forms',
          'Add-Type -AssemblyName System.Drawing',
          `$fp=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64First}'))`,
          '$bmp=[Drawing.Image]::FromFile($fp)',
          '$d=New-Object Windows.Forms.DataObject',
          '$d.SetImage($bmp)',
          '$c=New-Object System.Collections.Specialized.StringCollection',
          addLines,
          '$d.SetFileDropList($c)',
          '[Windows.Forms.Clipboard]::SetDataObject($d,$true)',
          '$bmp.Dispose()'
        ].join(';')
        await psHost.run(script, 3000)
      } catch (err) {
        console.error('[ipc] image-collection clipboard write failed:', err)
        // Full-resolution fallback for the first image (never a low-res preview).
        return writeImageToClipboard(firstSrc)
      }
      return true
    }

    case 'files':
      // Write real file references so pasting into Explorer copies the files,
      // not path strings.
      return writeFileListToClipboard(data.paths)
  }
}
