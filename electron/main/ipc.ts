/**
 * IPC handler registration.
 *
 * Each `ipcMain.handle` here mirrors a contract in `shared/ipc.ts`. The
 * renderer calls them through the typed preload bridge, so a signature mismatch
 * is a compile-time error rather than a runtime one.
 */
import { app, clipboard, shell, globalShortcut } from 'electron'
import { isExistingFilePath } from './pathValidation'
import { getStore, loadSettings, saveSettings, pushState, addFiles, getWatcher } from './state'
import { applyMacWindowOptions, setInteractive, setPreviewMode, setHotZoneWidth, repositionWindow, getDisplayListOptions, popUpAndRetract, setWindowFocusable, captureExternalForeground, traceFg } from './window'
import { rebuildTrayMenu } from './tray'
import { warmMainLanguage } from './language'
import type { MergeResult } from '../../shared/types'
import { defaultToggleHotkey } from '../../shared/types'
import { quitAndInstallUpdate, checkForUpdatesManual, startUpdateDownload, syncAutoUpdaterState, getCachedUpdateState, triggerBackgroundCheck } from './updater'
import { isStoreBuild } from './config'
import { applyLaunchAtLogin, refreshLaunchAtLoginFromOs } from './loginItems'
import { refreshScreenshotWatcher } from './macScreenshots'
import { refreshImageTextRecognition, startImageTextRecognition } from './ocr'
import { handle } from './ipcHandle'
import { toast } from './toast'
import { registerAccessibilityIpc } from './macAccessibility'
import { pasteQueueHotkeyRejection, registerSettingsIpc, reregisterGlobalShortcuts } from './settingsIpc'
import { registerItemContextMenuIpc } from './itemContextMenu'
import { registerSelectionIpc } from './selectionOps'
import { copyItem, copySubitem, flushPastePromotions, pasteEmoji, pasteItemById, pasteQueue, pasteSubitem } from './pastePipeline'
import { deleteItem, deleteItems } from './itemOps'
import { registerDropImportIpc } from './dropImport'

export { writeFileListToClipboard, writeImageToClipboard, writeItemToClipboard } from './clipboardWrite'
export { simulatePaste, keepsPanelOpenAfterPaste, promotesOnCopy, markSelfWrite, promotePasted, copyItem, settleWatcher, withClipboardWrite, copySubitem, takePasteSlot, pasteItem, serializePaste, sendPasteKeys, pasteItemById, pasteSubitem, pasteEmoji, pasteQueue } from './pastePipeline'
export { deleteItem, deleteItems, removeSubitem } from './itemOps'
export { cursorPointInSenderWindow, nextDragGeneration, awaitMacDragEnd } from './dragEnd'
export { registerSendListeners } from './dragIpc'
export { fetchDroppedImage } from './dropImport'

/** Apply launch-at-login to the OS and return the state Windows actually kept. */
export async function syncLoginItemSettings(launchAtLogin?: boolean): Promise<void> {
  const wantLaunch = launchAtLogin ?? loadSettings().launchAtLogin
  const result = await applyLaunchAtLogin(wantLaunch)
  if (!result.ok) {
    console.error('[IPC] launch-at-login apply did not stick. wanted=', wantLaunch, 'result=', result)
  }
}

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

  registerDropImportIpc()

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
    if (patch.language !== undefined) {
      await warmMainLanguage(next.language)
      const latest = loadSettings()
      pushState.settings(latest)
      rebuildTrayMenu()
      return latest
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
    setPreviewMode(active)
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
