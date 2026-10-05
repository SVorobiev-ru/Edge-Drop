/**
 * IPC handler registration.
 *
 * Each `ipcMain.handle` here mirrors a contract in `shared/ipc.ts`. The
 * renderer calls them through the typed preload bridge, so a signature mismatch
 * is a compile-time error rather than a runtime one.
 */
import { app, ipcMain, clipboard, nativeImage, shell, net, screen, BrowserWindow, globalShortcut } from 'electron'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { psHost, getSystemPowerShellPath, getWritableCwd } from './powershell'
import { filterValidPaths, isExistingFilePath } from './pathValidation'
import { type SendMap, type SendChannel } from '../../shared/ipc'
import { getStore, loadSettings, saveSettings, pushState, addFiles, getWatcher, writeStoredImageToPasteboard } from './state'
import { applyMacWindowOptions, sendToMainWindow, setInteractive, setHeartbeatPaused, setHotZoneWidth, repositionWindow, getDisplayListOptions, popUpAndRetract, setWindowFocusable, captureExternalForeground, traceFg, resolvePasteTarget, isInteractive } from './window'
import { getOnboardingWindow } from './onboardingWindow'
import { rebuildTrayMenu } from './tray'
import { startDragOut, resolveDragData, prestageDrag, stageDragFile } from './drag'
import { clipboardSignature, formatTabularDataForClipboard, signatureMatchesItem, localPathFromFileUrl, writeRichTextToClipboard } from '../clipboard/formats'
import type { ClipboardItem, DragRequest, ItemData, MergeResult, PasteOptions } from '../../shared/types'
import { DEFAULT_PASTE_QUEUE_HOTKEY, defaultToggleHotkey } from '../../shared/types'
import { quitAndInstallUpdate, checkForUpdatesManual, startUpdateDownload, syncAutoUpdaterState, getCachedUpdateState, triggerBackgroundCheck } from './updater'
import { createId } from '../store/ids'
import { isStoreBuild } from './config'
import { applyLaunchAtLogin, refreshLaunchAtLoginFromOs } from './loginItems'
import { toUnpackagedFilePath, toUnpackagedFilePaths } from '../store/paths'
import { isPasteableEmoji } from '../../shared/emoji'
import { pressedMouseButtons, mouseButtonsAvailable } from './macNative'
import { waitForMouseRelease } from './macDrag'
import { refreshScreenshotWatcher } from './macScreenshots'
import { writeFileUrls, addFileUrlToCurrentItem, addImageDataToFirstItem, pasteboardChangeCount } from './macPasteboard'
import { PasteQueue, type QueuePasteResult } from './pasteQueue'
import { refreshImageTextRecognition, startImageTextRecognition, wakeImageTextRecognition } from './ocr'
import { handle } from './ipcHandle'
import { toast } from './toast'
import { registerAccessibilityIpc, simulateMacPaste } from './macAccessibility'
import { pasteQueueHotkeyRejection, registerSettingsIpc, reregisterGlobalShortcuts } from './settingsIpc'
import { registerItemContextMenuIpc } from './itemContextMenu'
import { registerSelectionIpc, startSelectionDrag } from './selectionOps'

export { isStoreBuild }

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
function clipboardMatchesItem(item: ClipboardItem): boolean {
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

/** Simulate pressing Ctrl+V via PowerShell after returning focus to the previous active window. */
export function simulatePaste(): void {
  if (process.platform === 'darwin') {
    simulateMacPaste()
    return
  }
  if (process.platform === 'win32') {
    // Run via the persistent powershell host for near-zero latency (no process spawn overhead)
    psHost.run("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')", 2000)
      .catch((err) => {
        console.error('[Main] simulatePaste psHost failed, using fallback:', err)
        // Fallback to spawning powershell process via absolute system path
        execFile(getSystemPowerShellPath(), [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
        ], { windowsHide: true, ...(isStoreBuild() ? { cwd: getWritableCwd() } : {}) }, (fallbackErr) => {
          if (fallbackErr) console.error('[Main] simulatePaste fallback error:', fallbackErr)
        })
      })
  }
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

/** Apply launch-at-login to the OS and return the state Windows actually kept. */
export async function syncLoginItemSettings(launchAtLogin?: boolean): Promise<void> {
  const wantLaunch = launchAtLogin ?? loadSettings().launchAtLogin
  const result = await applyLaunchAtLogin(wantLaunch)
  if (!result.ok) {
    console.error('[IPC] launch-at-login apply did not stick. wanted=', wantLaunch, 'result=', result)
  }
}

export function deleteItem(id: string): void {
  const item = getStore().get(id)
  const watcher = getWatcher()
  // Pause first: an in-flight settle timer from the copy that created this
  // item would otherwise readClipboard() after we splice and put it back.
  watcher.setPaused(true)
  try {
    // Resolve clipboard ownership BEFORE mutating the store: if this exact
    // content still sits on the system clipboard it must be cleared first so
    // (a) the staged-temp cleanup inside delete() can never yank a file from
    // under a live OS clipboard reference, and (b) resyncSignature() below
    // locks onto an EMPTY clipboard, making an immediate re-copy of the same
    // content a detectable change instead of an invisible no-op.
    if (item && clipboardMatchesItem(item)) {
      clipboard.clear()
    }
    getStore().delete(id)
  } finally {
    watcher.resyncSignature()
    watcher.setPaused(loadSettings().incognito)
  }
  pasteQueue.prune()
  pushState.items()
}

export function deleteItems(ids: string[]): void {
  if (!ids || ids.length === 0) return
  const items = ids.map((id) => getStore().get(id)).filter((item): item is ClipboardItem => !!item)
  const watcher = getWatcher()
  watcher.setPaused(true)
  try {
    if (items.some((item) => clipboardMatchesItem(item))) {
      clipboard.clear()
    }
    getStore().deleteBatch(ids)
  } finally {
    watcher.resyncSignature()
    watcher.setPaused(loadSettings().incognito)
  }
  pasteQueue.prune()
  pushState.items()
}

export function removeSubitem(req: DragRequest): boolean {
  const success = getStore().removeSubitem(req)
  if (success) pushState.items()
  return success
}

/** macOS keeps the panel open after a paste so several items can go in a row; Windows closes it as before. */
export function keepsPanelOpenAfterPaste(): boolean {
  return process.platform === 'darwin'
}

/** macOS leaves a copied item where it is; Windows promotes it to the top as before. */
export function promotesOnCopy(): boolean {
  return process.platform !== 'darwin'
}

export function markSelfWrite(): void {
  if (process.platform === 'darwin') getWatcher().noteSelfWrite()
}

const deferredPromotions: string[] = []

/**
 * Touch pasted items in the given order (the last one ends on top). While the
 * macOS panel stays open the touch waits until it closes, so cards never
 * reorder under the cursor. Returns true when the touch was deferred.
 */
export function promotePasted(ids: readonly string[]): boolean {
  if (keepsPanelOpenAfterPaste() && isInteractive()) {
    deferredPromotions.push(...ids)
    return true
  }
  for (const id of ids) getStore().touch(id)
  return false
}

/** Applies the promotions held back while the panel was open. */
function flushPastePromotions(): void {
  if (deferredPromotions.length === 0) return
  for (const id of deferredPromotions.splice(0)) getStore().touch(id)
  pushState.items({ reason: 'usage' })
}

export async function copyItem(id: string): Promise<boolean> {
  const item = getStore().get(id)
  console.log('[IPC] item:copy id=', id, 'found=', !!item)
  if (!item) return false

  getWatcher().setPaused(true)
  const ok = await writeItemToClipboard(itemDataWithFullText(item), item.capturedAt, id)
  if (!ok) {
    // Source content (e.g. the staged image file) is unrecoverable. Do not
    // promote a dead item to the top of history — tell the user instead.
    console.log('[IPC] item:copy aborted — source content unavailable')
    toast('toast.imageUnavailable', 'error')
    settleWatcher(200)
    return false
  }
  console.log('[IPC] item:copy wrote to clipboard, kind=', item.data.kind)
  markSelfWrite()

  // Promote: touch() bumps recency WITHOUT re-interpreting content.
  // Re-adding here duplicated long texts — their stored 300-char preview
  // signature differs from the full payload, so add() saw "new content"
  // and created a second entry.
  if (promotesOnCopy()) {
    getStore().touch(id)
    pushState.items({ reason: 'usage' })
  }

  // Unpause after a short delay to allow OS clipboard event to settle.
  // Respect the current incognito state when unpausing.
  settleWatcher(200)

  return true
}

function itemDataWithFullText(item: ClipboardItem): ItemData {
  const fullText = item.data.kind === 'text' ? getStore().getFullText(item.id) : undefined
  return item.data.kind === 'text' && fullText ? { ...item.data, text: fullText } : item.data
}

export function settleWatcher(ms: number, mode?: 'resync' | 'invalidate'): void {
  const watcher = getWatcher()
  setTimeout(() => {
    if (mode === 'resync') watcher.resyncSignature()
    else if (mode === 'invalidate') watcher.invalidateSignature()
    watcher.setPaused(loadSettings().incognito)
  }, ms)
}

function itemOwnPaths(data: ItemData, paths: readonly string[] | undefined): string[] {
  if (data.kind !== 'files' || !paths || paths.length === 0) return []
  return paths.filter((p) => data.paths.includes(p))
}

export async function copySubitem(req: DragRequest): Promise<boolean> {
  // Resolve a single sub-item (one file of a bundle, or one image of a
  // collection) and write just that onto the clipboard — not the whole item.
  const dto = getStore().toDto().find((d) => d.id === req.id)
  if (!dto) return false

  getWatcher().setPaused(true)
  let wrote = false
  const ownPaths = itemOwnPaths(dto.data, req.paths)
  if (ownPaths.length > 0) {
    // Write real file references so pasting into Explorer copies the file,
    // not a path string.
    wrote = await writeFileListToClipboard(ownPaths)
    if (!wrote) toast('toast.fileUnavailable', 'error')
  } else if (dto.data.kind === 'image-collection' && req.imageId) {
    const img = dto.data.images.find((i) => i.imageId === req.imageId)
    if (img) {
      // Single image from a collection: write full bitmap + file reference atomically.
      const src = getStore().resolveStoredImagePath(img.imageId, img.ext)
      wrote = await writeImageToClipboard(src)
      if (!wrote) toast('toast.imageUnavailable', 'error')
    }
  }

  if (!wrote) {
    settleWatcher(200)
    return false
  }
  markSelfWrite()

  // Promote the parent bundle to the top — touch() keeps content/signature
  // intact (re-add risked duplicate long-text entries, same as item:copy).
  if (promotesOnCopy() && getStore().get(req.id)) {
    getStore().touch(req.id)
    pushState.items({ reason: 'usage' })
  }

  settleWatcher(200)

  return true
}

// ---------------------------------------------------------------------------
// Paste guard — prevents double-paste from rapid/double clicks.
// Stored at module scope so it's authoritative across all renderer invocations.
// The renderer-side tryPaste() is a best-effort pre-filter; this is the hard gate.
// ---------------------------------------------------------------------------
let _lastPasteTime = 0
const PASTE_GUARD_MS = 600
const QUEUE_PASTE_GUARD_MS = 150
let _pasteKeysSent: Promise<void> = Promise.resolve()
let _lastEmojiPasteTime = 0
const EMOJI_PASTE_GUARD_MS = 180

export function takePasteSlot(guardMs = PASTE_GUARD_MS): boolean {
  const now = Date.now()
  if (now - _lastPasteTime < guardMs) return false
  _lastPasteTime = now
  return true
}

function writePlainTextToClipboard(id: string): boolean {
  const text = getStore().getFullText(id)
  if (!text) return false
  clipboard.clear()
  clipboard.writeText(text)
  return true
}

export async function pasteItem(id: string, opts?: PasteOptions, guardMs = PASTE_GUARD_MS): Promise<QueuePasteResult> {
  if (!takePasteSlot(guardMs)) {
    console.log('[IPC] item:paste blocked — too soon after last paste')
    return 'busy'
  }
  return serializePaste(() => pasteItemNow(id, opts))
}

async function pasteItemNow(id: string, opts?: PasteOptions): Promise<QueuePasteResult> {
  const item = getStore().get(id)
  console.log('[IPC] item:paste id=', id, 'found=', !!item)
  if (!item) return 'failed'

  // Fast pre-flight BEFORE any UI state changes: if the source content is
  // unrecoverable (e.g. the staged image file vanished), abort with an
  // explicit message while the panel is still open — never close the shelf
  // and then silently paste nothing / a blurry thumbnail.
  if (
    (item.data.kind === 'image' && !getStore().resolveStoredImagePath(item.data.imageId, item.data.ext)) ||
    (item.data.kind === 'image-collection' && !getStore().hasRecoverableCollectionImage(item.data.images))
  ) {
    console.log('[IPC] item:paste aborted — source image no longer available')
    toast('toast.imageUnavailable', 'error')
    return 'failed'
  }

  getWatcher().setPaused(true)

  try {
    // 1. Close panel immediately so Edge-Drop slides shut with 0ms UI lag
    if (!keepsPanelOpenAfterPaste()) pushState.togglePanel(false)

    // 2. Write item to system clipboard
    const plain = process.platform === 'darwin' && opts?.plain === true && item.data.kind === 'text'
    let ok: boolean
    if (plain) {
      ok = writePlainTextToClipboard(id)
    } else {
      ok = await writeItemToClipboard(itemDataWithFullText(item), item.capturedAt, id)
    }
    if (!ok) {
      // Extremely rare race: source vanished between pre-check and write.
      toast(plain ? 'toast.nothingToPaste' : 'toast.imageUnavailable', 'error')
      return 'failed'
    }
    console.log('[IPC] item:paste wrote to clipboard, kind=', item.data.kind, 'plain=', plain)
    markSelfWrite()

    // 3. Touch item timestamp if enabled
    const promotedNow = loadSettings().movePastedToTop !== false && !promotePasted([id])

    // 4. Keys under the uniform rule: clipboard is already written, so
    // resolve WHERE they may go. Verified target -> send after settle;
    // unrecoverable foreground -> toast, never fire blind.
    await sendPasteKeys()

    // 5. Broadcast updated items list after panel has fully closed off-screen (250ms)
    if (promotedNow) {
      setTimeout(() => {
        pushState.items()
      }, 250)
    }
  } finally {
    // Resync the watcher signature after paste so standard OS Ctrl+V does NOT
    // increment item hitCounts or re-order items.
    settleWatcher(350, 'resync')
  }

  return 'pasted'
}

let _pasteChain: Promise<unknown> = Promise.resolve()

/**
 * macOS runs one paste at a time, from the clipboard write to the fired ⌘V:
 * the panel stays open, so clicks can overlap and must not overwrite each
 * other's clipboard before the keys go out.
 */
export function serializePaste<T>(run: () => Promise<T>): Promise<T> {
  if (process.platform !== 'darwin') return run()
  const next = _pasteChain.then(run)
  _pasteChain = next.catch(() => {})
  return next
}

function firePasteKeys(sendDelay: number): Promise<void> {
  _pasteKeysSent = new Promise((resolve) => {
    setTimeout(() => {
      try {
        traceFg('sendKeys')
        simulatePaste()
        setTimeout(() => traceFg('sendKeys+400ms'), 400)
      } finally {
        resolve()
      }
    }, sendDelay)
  })
  return _pasteKeysSent
}

export async function sendPasteKeys(normalDelayMs = 50): Promise<void> {
  const sendDelay = await resolvePasteTarget(normalDelayMs)
  if (sendDelay < 0) {
    toast('toast.pasteFallback', 'info')
    return
  }
  const sent = firePasteKeys(sendDelay)
  if (process.platform === 'darwin') await sent
}

export async function pasteItemById(id: string, opts?: PasteOptions): Promise<boolean> {
  return (await pasteItem(id, opts)) === 'pasted'
}

async function pasteQueuedItem(id: string): Promise<QueuePasteResult> {
  await _pasteKeysSent
  const wait = QUEUE_PASTE_GUARD_MS - (Date.now() - _lastPasteTime)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  return pasteItem(id, { plain: loadSettings().pastePlainText === true }, QUEUE_PASTE_GUARD_MS)
}

export async function pasteSubitem(req: DragRequest): Promise<boolean> {
  if (!takePasteSlot()) {
    console.log('[IPC] item:paste-subitem blocked — too soon after last paste')
    return false
  }
  return serializePaste(() => pasteSubitemNow(req))
}

async function pasteSubitemNow(req: DragRequest): Promise<boolean> {
  const dto = getStore().toDto().find((d) => d.id === req.id)
  if (!dto) return false

  getWatcher().setPaused(true)

  try {
    let wrote = false
    const ownPaths = itemOwnPaths(dto.data, req.paths)
    if (ownPaths.length > 0) {
      wrote = await writeFileListToClipboard(ownPaths)
    } else if (dto.data.kind === 'image-collection' && req.imageId) {
      const img = dto.data.images.find((i) => i.imageId === req.imageId)
      if (img) {
        // Single image from a collection: write full bitmap + file reference atomically.
        const src = getStore().resolveStoredImagePath(img.imageId, img.ext)
        wrote = await writeImageToClipboard(src)
        if (!wrote) toast('toast.imageUnavailable', 'error')
      }
    }

    if (!wrote) return false
    markSelfWrite()

    // DO NOT promote/bump hitCount here — same reason as item:paste.
    // Only the watcher (genuine user Ctrl+C) should increment hitCount.

    // Pass false to explicitly close and avoid toggle race conditions.
    if (!keepsPanelOpenAfterPaste()) pushState.togglePanel(false)

    // Wait for layout updates, then keys under the uniform rule.
    await sendPasteKeys()
  } finally {
    settleWatcher(350, 'invalidate')
  }

  return true
}

export async function pasteEmoji(text: string): Promise<boolean> {
  if (!isPasteableEmoji(text)) return false
  const now = Date.now()
  if (now - _lastEmojiPasteTime < EMOJI_PASTE_GUARD_MS) return false
  _lastEmojiPasteTime = now

  await serializePaste(async () => {
    getWatcher().setPaused(true)
    try {
      // Write + paste keys only. Do NOT add() to history — picker inserts are
      // a paste tool, not a capture. The resync (and on macOS the noted own
      // write) keeps this write from being captured when the watcher resumes.
      // A later copy of the same emoji from another app still lands: it gets
      // a new clipboard sequence number (Win32 sequence, macOS change count).
      if (process.platform === 'darwin') clipboard.clear()
      clipboard.writeText(text.trim())
      markSelfWrite()
      await sendPasteKeys(40)
    } finally {
      settleWatcher(350, 'resync')
    }
  })
  return true
}

export const pasteQueue = new PasteQueue({
  accelerator: () => loadSettings().pasteQueueHotkey || DEFAULT_PASTE_QUEUE_HOTKEY,
  register: (accelerator, handler) => globalShortcut.register(accelerator, handler),
  unregister: (accelerator) => globalShortcut.unregister(accelerator),
  isRegistered: (accelerator) => globalShortcut.isRegistered(accelerator),
  exists: (id) => !!getStore().get(id),
  paste: (id) => pasteQueuedItem(id),
  publish: (ids) => {
    sendToMainWindow('queue:state', { ids })
  },
  toast: (key, params) => toast(key, 'info', params)
})

export function registerIpc(): void {
  handle('state:load', () => {
    return {
      items: getStore().toDto(),
      settings: loadSettings(),
      version: app.getVersion(),
      isStoreBuild: isStoreBuild(),
      updateInfo: getCachedUpdateState()
    }
  })

  handle('app:install-update', () => {
    if (isStoreBuild()) return
    console.log('[IPC] app:install-update requested by renderer — calling quitAndInstallUpdate')
    quitAndInstallUpdate()
  })

  handle('updater:check-manual', async () => {
    if (isStoreBuild()) return { status: 'up-to-date', version: app.getVersion() }
    return checkForUpdatesManual()
  })

  handle('updater:start-download', async () => {
    if (isStoreBuild()) return
    await startUpdateDownload()
  })

  handle('updater:get-state', async () => {
    if (isStoreBuild()) return null
    return getCachedUpdateState()
  })

  handle('app:quit', () => {
    console.log('[IPC] app:quit requested by renderer — quitting application')
    app.quit()
  })

  handle('file:reveal', (filePath) => {
    if (isExistingFilePath(filePath)) {
      try {
        shell.showItemInFolder(filePath)
        return true
      } catch (err) {
        console.error('[IPC] file:reveal failed:', err)
      }
    }
    return false
  })

  handle('item:set-pinned', (id, pinned) => {
    getStore().setPinned(id, pinned)
    return getStore().toDto()
  })

  handle('item:delete', (id) => {
    deleteItem(id)
    return getStore().toDto()
  })

  handle('item:delete-batch', (ids) => {
    deleteItems(ids)
    return getStore().toDto()
  })

  handle('item:clear', () => {
    // Wipe the system clipboard BEFORE the store: nothing the user just
    // cleared may zombie-reappear, and every removed item's staged temp
    // files become safe to reap inside clearUnpinned().
    clipboard.clear()
    getStore().clearUnpinned()
    getWatcher().resyncSignature()
    pasteQueue.prune()
    pushState.items()
    return getStore().toDto()
  })

  handle('item:get-full-text', (id) => {
    return getStore().getFullText(id)
  })

  handle('item:copy', (id) => copyItem(id))

  handle('item:copy-subitem', (req) => copySubitem(req))

  handle('item:paste', (id, opts) => pasteItemById(id, opts))

  handle('item:paste-subitem', (req) => pasteSubitem(req))

  handle('emoji:paste', (text) => pasteEmoji(text))

  handle('item:add-files', (paths) => {
    const result = addFiles(paths)
    // If a large drop was split into several stacks, let the user know why
    // they suddenly see multiple items instead of one bundle.
    if (result.stacksCreated > 1) {
      toast('toast.splitStacks', 'info', { count: result.stacksCreated })
    }
    return getStore().toDto()
  })

  handle('item:add-data', async (data) => {
    if (!data) return getStore().toDto()

    if (data.kind === 'files' && data.paths && data.paths.length > 0) {
      const result = addFiles(data.paths)
      if (result.stacksCreated > 1) {
        toast('toast.splitStacks', 'info', { count: result.stacksCreated })
      }
      return getStore().toDto()
    }

    if (data.kind === 'image' && (data as any).imageUrl) {
      const imageUrl = (data as any).imageUrl as string
      if (/^file:/i.test(imageUrl) && process.platform !== 'win32') {
        const posixPath = localPathFromFileUrl(imageUrl)
        if (posixPath) {
          addFiles([posixPath])
          return getStore().toDto()
        }
      } else if (/^file:/i.test(imageUrl)) {
        const local = imageUrl.replace(/^file:\/\//i, '').replace(/^\/([a-zA-Z]:)/, '$1')
        try {
          const decoded = decodeURIComponent(local).replace(/\//g, '\\')
          if (existsSync(decoded)) {
            addFiles([decoded])
            return getStore().toDto()
          }
        } catch { /* fall through to bitmap import */ }
      }
      try {
        let img = nativeImage.createFromDataURL(imageUrl)
        if (img.isEmpty() && /^https?:\/\//i.test(imageUrl)) {
          const bytes = await fetchDroppedImage(imageUrl)
          img = bytes ? nativeImage.createFromBuffer(bytes) : img
          if (img.isEmpty()) {
            toast('toast.imageUnavailable', 'error')
            return getStore().toDto()
          }
        }
        if (!img.isEmpty()) {
          let png: Buffer | null = img.toPNG()
          const size = img.getSize()
          data.imageId = createId()
          data.bytes = png.length
          data.width = size.width
          data.height = size.height
          data.ext = 'png'
          data.source = 'image'
          const fromUrl = imageUrl.split(/[\\/]/).pop()?.split('?')[0]
          if (fromUrl && /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(fromUrl)) {
            data.fileName = decodeURIComponent(fromUrl)
          }
          getStore().stageImageBytes(data.imageId, png)
          png = null
          img = null as any
        }
      } catch (err) {
        console.error('[IPC] Failed to process dropped web image URL:', err)
      }
    }

    getStore().add(data, loadSettings().historyLimit)
    // Manual drag-in import (text/URL/web image dropped onto the shelf):
    // bookkeeping, not a capture — suppress the copy indicator.
    pushState.items({ reason: 'usage' })
    if (data.kind === 'image') wakeImageTextRecognition()
    return getStore().toDto()
  })

  handle('item:remove-subitem', (req) => removeSubitem(req))

  handle('item:merge', (sourceId, targetId) => {
    const result: MergeResult = getStore().merge(sourceId, targetId)
    if (result.ok) {
      pasteQueue.prune()
      pushState.items()
    } else if (result.reason === 'full') {
      toast(result.message || 'toast.mergeIncompatible', 'info')
    } else if (result.reason === 'incompatible') {
      toast(result.message || 'toast.mergeIncompatible', 'info')
    }
    // 'notfound' fails silently
    return result
  })

  handle('item:split', (req) => {
    console.log('[IPC] item:split called with req=', JSON.stringify(req))
    const success = getStore().split(req)
    console.log('[IPC] item:split success=', success)
    if (success) pushState.items()
    return success
  })

  handle('startup:refresh', async () => {
    return refreshLaunchAtLoginFromOs()
  })

  handle('settings:update', async (patch) => {
    // When the user explicitly picks a display, also persist its geometry so
    // the next reboot can re-identify the monitor via fuzzy bounds matching
    // even after Windows re-assigns numeric display IDs.
    let enrichedPatch = { ...patch }
    if (patch.stickDisplayId !== undefined) {
      const displays = getDisplayListOptions()
      const chosen = displays.find(d => d.id === patch.stickDisplayId)
      if (chosen) {
        // IMPORTANT: persist workArea (not bounds) — geometry.ts Tier-2 fuzzy match
        // compares d.workArea against savedWorkArea. Using bounds (which includes the
        // taskbar) would create a mismatch of ~40px, exceeding the 8px BOUNDS_TOLERANCE
        // and causing Tier-2 to always fail on reboot.
        enrichedPatch = {
          ...enrichedPatch,
          stickDisplayWorkArea: chosen.workArea,
          stickDisplayScaleFactor: chosen.scaleFactor
        }
      }
    }
    if (enrichedPatch.pasteQueueHotkey !== undefined) {
      const rejection = pasteQueueHotkeyRejection(
        enrichedPatch.pasteQueueHotkey,
        enrichedPatch.toggleHotkey || loadSettings().toggleHotkey || defaultToggleHotkey(process.platform === 'darwin')
      )
      if (rejection) {
        const { pasteQueueHotkey: _rejected, ...rest } = enrichedPatch
        enrichedPatch = rest
        toast(rejection, 'error')
      }
    }
    let next = saveSettings(enrichedPatch)
    if (patch.launchAtLogin !== undefined) {
      const applied = await applyLaunchAtLogin(patch.launchAtLogin)
      if (applied.enabled !== next.launchAtLogin) {
        next = saveSettings({ launchAtLogin: applied.enabled })
      }
      if (applied.blockedByUser && patch.launchAtLogin) {
        toast('toast.launchBlockedByWindows', 'info')
      } else if (!applied.ok) {
        toast('toast.launchUpdateFailed', 'error')
      }
    }
    if (patch.hotZoneWidth !== undefined) {
      setHotZoneWidth(patch.hotZoneWidth)
    }
    if (patch.stickPosition !== undefined || patch.stickDisplayId !== undefined || patch.verticalOffset !== undefined || patch.horizontalOffset !== undefined) {
      repositionWindow()
      if (patch.stickPosition !== undefined || patch.stickDisplayId !== undefined) {
        popUpAndRetract(1500)
      }
    }
    if (patch.autoUpdates !== undefined || patch.updateMode !== undefined) {
      syncAutoUpdaterState()
    }
    // Switching into a checking mode checks now — previously nothing happened
    // until the next restart. Switching to 'off' cancels any pending check.
    if (patch.updateMode !== undefined) {
      try {
        triggerBackgroundCheck()
      } catch { /* ignore */ }
    }
    if (patch.toggleHotkey !== undefined) {
      reregisterGlobalShortcuts(patch.toggleHotkey)
    }
    if (patch.pasteQueueHotkey !== undefined) {
      pasteQueue.syncShortcut()
    }
    if (patch.captureScreenshots !== undefined) {
      refreshScreenshotWatcher()
    }
    if (patch.recognizeImageText !== undefined) {
      refreshImageTextRecognition()
    }
    if (patch.theme !== undefined || patch.hideFromScreenCapture !== undefined) {
      applyMacWindowOptions(next)
    }
    pushState.settings(next)
    rebuildTrayMenu()
    return next
  })

  handle('hotkey:pause', (paused) => {
    if (paused) {
      try {
        globalShortcut.unregisterAll()
      } catch { /* ignore */ }
    } else {
      reregisterGlobalShortcuts()
    }
  })

  handle('window:set-interactive', (value) => {
    setInteractive(value)
    if (!value) flushPastePromotions()
  })

  handle('window:set-preview-mode', (active) => {
    import('./window').then(m => m.setPreviewMode(active))
  })

  handle('window:minimize', () => {
    const win = getOnboardingWindow()
    if (win && !win.isDestroyed()) {
      win.minimize()
    }
  })

  handle('window:focus', async (focusable) => {
    const want = focusable ?? true
    traceFg(`window:focus(${want})`)
    if (want) {
      // Last safe instant: we cannot be foreground yet (still NOACTIVATE /
      // non-focusable), so whatever is front is the user's app. Re-capture
      // heals any stale open-time note.
      try {
        captureExternalForeground()
      } catch { /* ignore */ }
    }
    // Release path fully handled inside setWindowFocusable (writes, then
    // before/after-compared verified repair). No pre-restore here: restoring
    // first would only mask the before-reading the repair depends on.
    setWindowFocusable(want)
  })

  handle('displays:list', () => {
    return getDisplayListOptions()
  })

  registerAccessibilityIpc()
  registerSettingsIpc()
  registerItemContextMenuIpc()
  registerSelectionIpc()

  startImageTextRecognition()
}

/**
 * Register fire-and-forget (send) listeners.
 *
 * These use `ipcMain.on` + `event.sender` instead of `ipcMain.handle` because
 * the drag-out gesture must be synchronous — `event.sender.startDrag(...)` only
 * works correctly when called from the same event-loop turn as the renderer's
 * `dragstart` event.
 */
function on<C extends SendChannel>(
  channel: C,
  fn: (sender: Electron.WebContents, ...args: SendMap[C]['args']) => void
): void {
  ipcMain.on(channel, (event, ...args) => fn(event.sender, ...(args as SendMap[C]['args'])))
}

function finishDragOut(sender: Electron.WebContents, req: DragRequest, dragStarted: boolean, isWholeItemDrag: boolean): void {
  const isMac = process.platform === 'darwin'
  console.log(isMac ? '[IPC] drag finished, sending drag-end' : '[IPC] start-drag returned, sending drag-end')
  sender.send('item:drag-end')

  // Re-enable the heartbeat now that the drag is over.
  if (!isMac) setHeartbeatPaused(false)

  // Check if the user dropped the item back onto our window!
  const drop = cursorPointInSenderWindow(sender)
  if (drop) {
    console.log(`[IPC] Drag ended inside window! Triggering internal-drop at x=${drop.x}, y=${drop.y}`)
    sender.send('item:internal-drop', drop)
  }

  if (dragStarted && isWholeItemDrag && !drop) {
    // Usage accounting parity with click-to-paste: a whole-item drag counts
    // as a use ONLY when successfully dropped outside into another application.
    // Dropping back onto the shelf or cancelling does not bump hitCount.
    if (loadSettings().movePastedToTop !== false && getStore().get(req.id)) {
      getStore().touch(req.id)
    }
    // 'usage' reason: this push is bookkeeping from a manual drag-out, so
    // the renderer must NOT flash the capture copy-indicator for it.
    pushState.items({ reason: 'usage' })
  }
}

export function cursorPointInSenderWindow(sender: Electron.WebContents): { x: number; y: number } | null {
  const point = screen.getCursorScreenPoint()
  const win = BrowserWindow.fromWebContents(sender)
  if (!win || win.isDestroyed()) return null
  const bounds = win.getBounds()
  const inside = point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
                 point.y >= bounds.y && point.y <= bounds.y + bounds.height
  return inside ? { x: point.x - bounds.x, y: point.y - bounds.y } : null
}

let dragGeneration = 0
let mouseBridgeWarned = false

export function nextDragGeneration(): number {
  return ++dragGeneration
}

interface MacDragEndOptions {
  tag: string
  verbose: boolean
}

export function awaitMacDragEnd(sender: Electron.WebContents, generation: number, finish: () => void, { tag, verbose }: MacDragEndOptions): void {
  if (!mouseButtonsAvailable()) {
    if (verbose && !mouseBridgeWarned) {
      mouseBridgeWarned = true
      console.warn(`[IPC] ${tag}: mouse button state is unavailable (ObjC bridge not loaded), sending drag-end only`)
    }
    sender.send('item:drag-end')
    return
  }
  waitForMouseRelease(pressedMouseButtons).then((result) => {
    if (generation !== dragGeneration || sender.isDestroyed()) return
    if (result === 'timeout') {
      if (verbose) console.warn(`[IPC] ${tag}: mouse release wait timed out, sending drag-end only`)
      sender.send('item:drag-end')
      return
    }
    finish()
  }).catch((err) => {
    console.error(`[IPC] ${tag}: drag completion failed:`, err)
    if (generation !== dragGeneration) return
    try {
      if (!sender.isDestroyed()) sender.send('item:drag-end')
    } catch (sendErr) {
      if (verbose) console.error(`[IPC] ${tag}: could not send drag-end after failure:`, sendErr)
    }
  })
}

export function registerSendListeners(): void {
  on('item:start-drag', (sender, req) => {
    console.log('[IPC] item:start-drag req=', JSON.stringify(req))
    const resolved = resolveDragData(req)
    if (!resolved) {
      console.log('[IPC] start-drag: no data resolved')
      return
    }
    const { data, capturedAt, subIndex } = resolved
    console.log('[IPC] start-drag: kind=', data.kind)

    // Usage accounting parity with click-to-paste: a whole-item drag counts
    // as a use. Bumps hitCount and moves unpinned items to the top, gated
    // behind the same movePastedToTop setting paste uses. Sub-item drags
    // (one file out of a bundle, one image out of a collection) deliberately
    // do not reorder history - same rule as item:paste-subitem.
    const isWholeItemDrag = !(req.paths && req.paths.length > 0) && !req.imageId
    const isMac = process.platform === 'darwin'

    // Pause the always-on-top heartbeat for the duration of the drag.
    // The heartbeat fires SetWindowPos(HWND_TOPMOST) every 500 ms, which
    // pushes our window in front of the DWM drag-ghost image — making the
    // dragged item appear to vanish ~0.5 s into any drag gesture.
    if (!isMac) setHeartbeatPaused(true)

    const generation = nextDragGeneration()
    const dragStarted = startDragOut(sender, data, capturedAt, subIndex)
    if (!isMac || !dragStarted) {
      finishDragOut(sender, req, dragStarted, isWholeItemDrag)
      return
    }
    awaitMacDragEnd(sender, generation, () => finishDragOut(sender, req, dragStarted, isWholeItemDrag), { tag: 'start-drag', verbose: true })
  })

  on('item:prestage-drag', (_sender, req) => {
    prestageDrag(req)
  })

  on('items:start-drag-multi', (sender, ids) => {
    startSelectionDrag(sender, ids)
  })
}

const IMAGE_URL_TIMEOUT_MS = 15_000
const IMAGE_URL_MAX_BYTES = 25 * 1024 * 1024

export async function fetchDroppedImage(url: string, fetcher: typeof net.fetch = (input, init) => net.fetch(input, init)): Promise<Buffer | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const allowed = process.platform === 'darwin' ? ['https:'] : ['http:', 'https:']
  if (!allowed.includes(parsed.protocol)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_URL_TIMEOUT_MS)
  try {
    const res = await fetcher(parsed.toString(), { signal: controller.signal })
    if (!res.ok || !res.body) return null
    const type = (res.headers.get('content-type') || '').trim().toLowerCase()
    if (!type.startsWith('image/')) return null
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > IMAGE_URL_MAX_BYTES) return null
    const reader = res.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > IMAGE_URL_MAX_BYTES) {
        controller.abort()
        void reader.cancel().catch(() => {})
        return null
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  } catch (err) {
    console.error('[IPC] dropped image URL fetch failed:', err)
    return null
  } finally {
    clearTimeout(timer)
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
