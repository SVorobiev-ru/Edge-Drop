import { clipboard, globalShortcut } from 'electron'
import { execFile } from 'node:child_process'
import { psHost, getSystemPowerShellPath, getWritableCwd } from './powershell'
import { getStore, loadSettings, pushState, getWatcher } from './state'
import { sendToMainWindow, traceFg, resolvePasteTarget, isInteractive } from './window'
import type { ClipboardItem, ClipboardItemDto, DragRequest, ItemData, PasteOptions } from '../../shared/types'
import { DEFAULT_PASTE_QUEUE_HOTKEY } from '../../shared/types'
import { isStoreBuild } from './config'
import { isPasteableEmoji } from '../../shared/emoji'
import { PasteQueue, type QueuePasteResult } from './pasteQueue'
import { toast } from './toast'
import { simulateMacPaste } from './macAccessibility'
import { writeFileListToClipboard, writeImageToClipboard, writeItemToClipboard } from './clipboardWrite'

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
export function flushPastePromotions(): void {
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

export async function withClipboardWrite<T>(settleMs: number, mode: 'resync' | 'invalidate', run: () => Promise<T>): Promise<T> {
  getWatcher().setPaused(true)
  try {
    return await run()
  } finally {
    settleWatcher(settleMs, mode)
  }
}

function itemOwnPaths(data: ItemData, paths: readonly string[] | undefined): string[] {
  if (data.kind !== 'files' || !paths || paths.length === 0) return []
  return paths.filter((p) => data.paths.includes(p))
}

async function writeSubitemToClipboard(data: ClipboardItemDto['data'], req: DragRequest, toastMissingFiles: boolean): Promise<boolean> {
  const ownPaths = itemOwnPaths(data, req.paths)
  if (ownPaths.length > 0) {
    // Write real file references so pasting into Explorer copies the file,
    // not a path string.
    const wrote = await writeFileListToClipboard(ownPaths)
    if (!wrote && toastMissingFiles) toast('toast.fileUnavailable', 'error')
    return wrote
  }
  if (data.kind === 'image-collection' && req.imageId) {
    const img = data.images.find((i) => i.imageId === req.imageId)
    if (img) {
      // Single image from a collection: write full bitmap + file reference atomically.
      const src = getStore().resolveStoredImagePath(img.imageId, img.ext)
      const wrote = await writeImageToClipboard(src)
      if (!wrote) toast('toast.imageUnavailable', 'error')
      return wrote
    }
  }
  return false
}

export async function copySubitem(req: DragRequest): Promise<boolean> {
  // Resolve a single sub-item (one file of a bundle, or one image of a
  // collection) and write just that onto the clipboard — not the whole item.
  const dto = getStore().toDto().find((d) => d.id === req.id)
  if (!dto) return false

  getWatcher().setPaused(true)
  const wrote = await writeSubitemToClipboard(dto.data, req, true)

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

  // Resync the watcher signature after paste so standard OS Ctrl+V does NOT
  // increment item hitCounts or re-order items.
  return withClipboardWrite(350, 'resync', async (): Promise<QueuePasteResult> => {
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
    return 'pasted'
  })
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

  return withClipboardWrite(350, 'invalidate', async () => {
    const wrote = await writeSubitemToClipboard(dto.data, req, false)

    if (!wrote) return false
    markSelfWrite()

    // DO NOT promote/bump hitCount here — same reason as item:paste.
    // Only the watcher (genuine user Ctrl+C) should increment hitCount.

    // Pass false to explicitly close and avoid toggle race conditions.
    if (!keepsPanelOpenAfterPaste()) pushState.togglePanel(false)

    // Wait for layout updates, then keys under the uniform rule.
    await sendPasteKeys()
    return true
  })
}

export async function pasteEmoji(text: string): Promise<boolean> {
  if (!isPasteableEmoji(text)) return false
  const now = Date.now()
  if (now - _lastEmojiPasteTime < EMOJI_PASTE_GUARD_MS) return false
  _lastEmojiPasteTime = now

  await serializePaste(() => withClipboardWrite(350, 'resync', async () => {
    // Write + paste keys only. Do NOT add() to history — picker inserts are
    // a paste tool, not a capture. The resync (and on macOS the noted own
    // write) keeps this write from being captured when the watcher resumes.
    // A later copy of the same emoji from another app still lands: it gets
    // a new clipboard sequence number (Win32 sequence, macOS change count).
    if (process.platform === 'darwin') clipboard.clear()
    clipboard.writeText(text.trim())
    markSelfWrite()
    await sendPasteKeys(40)
  }))
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
