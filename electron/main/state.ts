/**
 * Central runtime state & renderer notification hub.
 *
 * Owns the single ItemStore and ClipboardWatcher instances and provides typed
 * helpers to broadcast changes to the renderer. Every mutation goes through
 * here so there's one path that re-pushes the DTO list.
 */
import { ItemStore } from '../store/ItemStore'
import { ClipboardWatcher, stampCapturedImage } from '../clipboard/ClipboardWatcher'
import { clipboardSequenceAvailable, takeCapturedOriginalImage, takeCapturedRtf, MAC_PNG_TYPE, MAC_TIFF_TYPE } from '../clipboard/formats'
import { loadSettings, saveSettings } from '../store/settings'
import type { ClipboardItemDto, ItemData, Settings, SourceApp, ToggleSource } from '../../shared/types'
import { MAX_STACK } from '../../shared/types'
import { BrowserWindow, nativeImage, powerMonitor } from 'electron'
import { isStagedTempPath } from '../store/paths'
import { prefetchFileIcons } from './drag'
import { forgetStagedItems, reconcileTempOnStartup } from './stagedTemp'
import { persistStoredThumbnail } from './thumbnailCache'
import { runtime } from './config'
import { getMainWindow, registerClipboardUpdateListener, requestPollBoost } from './window'
import { toast } from './toast'
import { scheduleTrayMenuRebuild } from './tray'
import { installMacAppMenu } from './macAppMenu'
import { frontmostApp, ownBundleId } from './macSourceApp'
import { writeImageData } from './macPasteboard'

const store = new ItemStore((removed) => forgetStagedItems(removed))
const watcher = new ClipboardWatcher(process.platform === 'darwin' && clipboardSequenceAvailable() ? 250 : 600, 220)
let pruneTimer: ReturnType<typeof setInterval> | null = null
let wakeTimer: ReturnType<typeof setTimeout> | null = null

function handleSystemSleep(): void {
  watcher.setPaused(true)
}

function handleSystemWake(): void {
  watcher.resyncSignature()
  watcher.setPaused(true)
  // First hover after sleep/unlock otherwise hits a SLOW poll tick and feels
  // laggy. Hold FAST briefly; self-expiring, idle battery behavior unchanged.
  try { requestPollBoost(8000) } catch { /* ignore */ }

  if (wakeTimer !== null) clearTimeout(wakeTimer)
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    watcher.resyncSignature()
    watcher.setPaused(loadSettings().incognito)
  }, 1500)
}

let imageAddedListener: (() => void) | null = null

export function setImageAddedListener(listener: (() => void) | null): void {
  imageAddedListener = listener
}

function recordCapture(data: ItemData, png?: Buffer, image?: Electron.NativeImage, sourceApp?: SourceApp): void {
  const original = takeCapturedOriginalImage(data)
  const rtf = takeCapturedRtf(data)
  if (loadSettings().incognito) return
  store.pruneExpired(loadSettings().autoDeleteHours)
  if (data.kind === 'image' && png && data.imageId) {
    if (!store.hasDuplicate(data)) {
      if (original?.type === MAC_PNG_TYPE) data.fileBytes = original.bytes.length
      store.stageImageBytes(data.imageId, original?.type === MAC_PNG_TYPE ? original.bytes : png)
      if (original?.type === MAC_TIFF_TYPE) store.stageOriginalImage(data.imageId, original.bytes, 'tiff')
      if (image) persistStoredThumbnail(data.imageId, image)
    }
    png = undefined as any
  }
  if (data.kind === 'files' && data.paths) {
    prefetchFileIcons(data.paths)
  }
  store.add(data, loadSettings().historyLimit, { sourceApp, rtf })
  pushState.items()
  if (data.kind === 'image' || data.kind === 'image-collection') imageAddedListener?.()
}

export function writeStoredImageToPasteboard(data: ItemData, namedPath?: string): boolean {
  if (process.platform !== 'darwin' || data.kind !== 'image') return false
  const stored = store.storedImageBytes(data.imageId, data.ext)
  if (!stored) return false
  return writeImageData(stored.original, { png: stored.png, fileUrlPath: namedPath })
}

export function addScreenshotToHistory(png: Buffer, fileName?: string): boolean {
  if (loadSettings().incognito) return false
  const image = nativeImage.createFromBuffer(png)
  const size = image.getSize()
  if (!size.width || !size.height) return false
  const data: ItemData = {
    kind: 'image',
    imageId: '',
    width: size.width,
    height: size.height,
    bytes: 0,
    source: 'screenshot',
    fileName
  }
  stampCapturedImage(data, png)
  recordCapture(data, png, image)
  return true
}

/** Initialize persistence + start the clipboard watcher. */
export function initState(): void {
  store.load({ deferReconcile: true })

  // Reconcile staged temp artifacts with the freshly loaded history: files
  // owned by living items survive, everything else (crash orphans, deleted
  // items' leftovers, legacy pre-registry junk) is removed once. This replaces
  // the old wipe-everything cleanTemp() pass. Runs once — milliseconds.
  try {
    reconcileTempOnStartup(store.list())
  } catch (err) {
    console.error('[State] Staged temp reconciliation failed:', err)
  }

  // One-time v0.2.6 upgrade migration: clear unpinned items once & set default historyLimit to 250
  const currentSettings = loadSettings()
  if (!currentSettings.v026UpgradeCleaned) {
    console.log('[State] Executing one-time v0.2.6 upgrade migration: clearing unpinned items & setting historyLimit to 250...')
    store.clearUnpinned()
    saveSettings({ v026UpgradeCleaned: true, historyLimit: 250 })
  } else if (currentSettings.clearUnpinnedOnRestart) {
    store.clearUnpinned()
  }
  store.pruneExpired(loadSettings().autoDeleteHours)

  for (const item of store.toDto()) {
    if (item.data.kind === 'files' && item.data.paths) {
      prefetchFileIcons(item.data.paths)
    }
  }
  watcher.setCapturePolicy({
    frontmostApp,
    ownBundleId,
    ignoredApps: () => loadSettings().ignoredApps,
    ignoreRemoteClipboard: () => loadSettings().ignoreRemoteClipboard
  })
  watcher.start(recordCapture, () => {
    if (loadSettings().incognito) return
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('ui:copy-flare')
    }
  })
  registerClipboardUpdateListener(() => watcher.nudge())
  watcher.setPaused(loadSettings().incognito)

  powerMonitor.removeListener('suspend', handleSystemSleep)
  powerMonitor.removeListener('lock-screen', handleSystemSleep)
  powerMonitor.removeListener('resume', handleSystemWake)
  powerMonitor.removeListener('unlock-screen', handleSystemWake)

  powerMonitor.on('suspend', handleSystemSleep)
  powerMonitor.on('lock-screen', handleSystemSleep)
  powerMonitor.on('resume', handleSystemWake)
  powerMonitor.on('unlock-screen', handleSystemWake)

  // After a restart-clear, the watcher.start() seeds lastSig from the live
  // clipboard (correct). But if clearUnpinnedOnRestart removed items that are
  // still on the clipboard, the user can re-copy them immediately — this works
  // because start() always re-seeds lastSig fresh from the current clipboard.
  // No extra invalidate() is needed here.

  if (pruneTimer !== null) clearInterval(pruneTimer)
  pruneTimer = setInterval(() => {
    if (runtime.quitting) return
    if (store.pruneExpired(loadSettings().autoDeleteHours)) {
      // Pruned items should be re-capturable if still on the clipboard.
      watcher.resyncSignature()
      pushState.items()
    }
  }, 60_000)
}

export function stopStateTimers(): void {
  if (pruneTimer !== null) {
    clearInterval(pruneTimer)
    pruneTimer = null
  }
}

export function getStore(): ItemStore {
  return store
}

export function getWatcher(): ClipboardWatcher {
  return watcher
}

/** Push updates to all open windows (main window, onboarding window, etc.). */
function send(channel: string, ...args: unknown[]): void {
  if (runtime.quitting) return
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}

let appMenuLanguage: Settings['language'] | undefined

export const pushState = {
  /**
   * Push the item list. `reason` labels WHY so the renderer can react
   * appropriately: 'usage' pushes (drag-out/copy recency bumps) must never
   * trigger the capture copy-indicator flare.
   */
  items(meta?: { reason?: 'usage' | 'capture' }): void {
    const dto: ClipboardItemDto[] = store.toDto()
    send('state:items', dto, meta)
    if (process.platform === 'darwin') scheduleTrayMenuRebuild()
  },
  settings(next: Settings): void {
    send('state:settings', next)
    if (process.platform === 'darwin' && next.language !== appMenuLanguage) {
      appMenuLanguage = next.language
      installMacAppMenu()
    }
  },
  togglePanel(open?: boolean, meta?: { source?: ToggleSource }): void {
    console.log(`[Main] Sending window:toggle event to renderer with open=${open} source=${meta?.source ?? '-'}`)
    if (meta && process.platform === 'darwin') send('window:toggle', open, meta)
    else send('window:toggle', open)
  },
  search(query: string): void {
    send('window:search', query)
  },
  openSettings(): void {
    console.log('[Main] Sending window:open-settings event to renderer')
    send('window:open-settings')
  },
  updateAvailable(info: { version: string }): void {
    console.log('[Main] Sending app:update-available event to renderer:', info)
    send('app:update-available', info)
  },
  updateProgress(progress: { percent: number; bytesPerSecond?: number; transferred?: number; total?: number }): void {
    send('app:update-progress', progress)
  },
  updateDownloaded(info: { version: string }): void {
    console.log('[Main] Sending app:update-downloaded event to renderer:', info)
    send('app:update-downloaded', info)
  },
  toast
}

/** Re-export for handlers that mutate settings then need to broadcast. */
export { loadSettings, saveSettings }

/**
 * Result of importing dropped files: how many stacks were created and whether
 * any overflow was chunked, so the IPC layer can show an informative toast.
 */
export interface AddFilesResult {
  /** Total number of separate items/stacks created (1 means a single bundle). */
  stacksCreated: number
}

/**
 * Import dropped file paths the same way Explorer Ctrl+C is captured:
 * keep the original paths (and names). Do not copy image bytes into the
 * internal image store — that made drag-out invent a Screenshot filename.
 */
export function addFiles(paths: string[]): AddFilesResult {
  const clean = paths.filter((p) => !isStagedTempPath(p))
  if (clean.length === 0) return { stacksCreated: 0 }

  prefetchFileIcons(clean)

  const limit = loadSettings().historyLimit
  let stacksCreated = 0
  for (let i = 0; i < clean.length; i += MAX_STACK) {
    const chunk = clean.slice(i, i + MAX_STACK)
    store.add({ kind: 'files', paths: chunk }, limit)
    stacksCreated++
  }

  if (stacksCreated > 0) pushState.items({ reason: 'usage' }) // manual drag-in import: never a capture
  return { stacksCreated }
}
