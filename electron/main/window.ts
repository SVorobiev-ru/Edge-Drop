/**
 * The edge panel BrowserWindow.
 *
 * The window is the full *expanded* size and sits at the edge of the stick
 * display's work area. It is transparent and frameless, and is normally
 * click-through (`setIgnoreMouseEvents(true, { forward: false })`) so the
 * desktop stays fully usable. Edge detection does NOT rely on DOM pointer
 * events: the main-process cursor poll (startCursorPoll) reads the OS cursor
 * position directly every tick, which also keeps working during OS file
 * drags — the edge dwell opens the panel and makes the main window
 * interactive, and the drop then lands on the main window.
 *
 * NOTE: this module must NOT import from state.ts to avoid circular dependencies.
 */
import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
export { requestPollBoost, startCursorPoll, stopCursorPoll, registerMacLockScreenHooks } from './cursorPoll'
import { APP_CONFIG } from './config'
import { runtime } from './config'
import { PATHS } from '../store/paths'
import { enforceClickThrough, noteForced, resetRendererState } from './clickThrough'
import { loadSettings } from '../store/settings'
import { registerFullscreenActiveListener } from './fullscreen'
import { panelPlacementChanged } from './macScreen'
import { installMacWebGuards } from './webGuard'
import { applyMacWindowOptionsTo } from './macWindowOptions'
import { mainWindow, interactive, openedExplicitly, sendToMainWindow, assignMainWindow } from './windowState'
import { registerWindowMessageFn, addClipboardFormatListenerFn, removeClipboardFormatListenerFn, getHwnd, applyNoActivateStyle } from './winFocus'
import { currentStickDisplayId, lastPanelPlacement, assignLastPanelPlacement, updateCachedWorkArea, panelDrag, getStickGeometry, applyMacInitialStickPosition, popUpAndRetract, repositionWindow } from './displays'
import { setInteractive, panelVibrancy } from './panelInteractive'

export { getMainWindow, sendToMainWindow, isInteractive } from './windowState'
export { applyNoActivateStyle, traceFg, captureExternalForeground, holdsOwnForeground, restoreFgAwaited, restoreExternalFocusAwaited, resolvePasteTarget, syncMacEscapeCapture, setWindowFocusable } from './winFocus'
export { previewActive, currentHotZoneWidth, currentStickDisplayId, updateCachedWorkArea, setHotZoneWidth, setStickDisplayId, setPreviewMode, registerPanelDragIpc, registerWindowRepositionListener, getActiveDisplayId, getDisplayListOptions, popUpAndRetract, repositionWindow } from './displays'
export { markExplicitOpen, setInteractive, handlePanelState, registerPanelStateIpc } from './panelInteractive'

const onTaskbarCreatedListeners: Array<() => void> = []
export function registerTaskbarCreatedListener(fn: () => void): void {
  onTaskbarCreatedListeners.push(fn)
}

const onClipboardUpdateListeners: Array<() => void> = []
export function registerClipboardUpdateListener(fn: () => void): void {
  onClipboardUpdateListeners.push(fn)
}

const WM_CLIPBOARDUPDATE = 0x031D

export function applyMacWindowOptions(settings: Pick<ReturnType<typeof loadSettings>, 'theme' | 'hideFromScreenCapture'> = loadSettings()): void {
  applyMacWindowOptionsTo(mainWindow, settings)
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let heartbeatPaused = false

/**
 * Temporarily suspend the always-on-top heartbeat.
 *
 * The heartbeat calls setAlwaysOnTop() every 2 000 ms, which reasserts z-order
 * via SetWindowPos(HWND_TOPMOST) on Windows.  During a native drag the OS
 * renders the drag-ghost image using the DWM compositor at a layer that sits
 * BELOW HWND_TOPMOST windows.  Every heartbeat tick therefore pushes our
 * window in front of the ghost, making it disappear during any drag.
 *
 * Pausing the heartbeat for the duration of the drag keeps the window at its
 * current z-position and lets the DWM ghost stay visible for the full drag.
 * The heartbeat is re-enabled (and immediately re-asserts always-on-top) when
 * the drag ends.
 */
export function setHeartbeatPaused(paused: boolean): void {
  heartbeatPaused = paused
  if (process.platform === 'darwin') return
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    if (paused) {
      // Temporarily lower window z-band from 'screen-saver' to 'normal' during active drag
      // so the Windows DWM drag-ghost image renders ON TOP of our window.
      mainWindow.setAlwaysOnTop(true, 'normal')
    } else {
      // Re-assert z-order immediately when drag ends so the window snaps back
      // to the correct level without waiting for the next heartbeat tick.
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
    }
  }
}

function isFirstRunWithoutSettings(): boolean {
  try {
    return !existsSync(PATHS.settingsFile())
  } catch {
    return false
  }
}

export function createWindow(): BrowserWindow {
  const macFirstRun = process.platform === 'darwin' && isFirstRunWithoutSettings()
  const { x, y, width, height } = getStickGeometry()
  assignLastPanelPlacement({ displayId: currentStickDisplayId, bounds: { x, y, width, height } })

  assignMainWindow(mainWindow, new BrowserWindow({
    icon: PATHS.icon(),
    x,
    y,
    width,
    height,
    show: false,
    frame: false,
    fullscreenable: false,
    maximizable: false,
    minWidth: 320,
    minHeight: 240,
    movable: false,
    resizable: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    backgroundColor: '#00000000',
    roundedCorners: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  }))

  if (process.platform === 'darwin') {
    try { mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }) } catch { /* ignore */ }
    applyMacWindowOptions()
  }

  // Start click-through with no forwarding — edge detection is done via cursor poll.
  if (process.platform === 'darwin') enforceClickThrough(mainWindow)
  else mainWindow.setIgnoreMouseEvents(true, { forward: false })

  // Apply WS_EX_NOACTIVATE so clicking the panel never steals OS focus from the active application.
  applyNoActivateStyle(mainWindow, true)

  if (process.platform === 'win32' && addClipboardFormatListenerFn) {
    try {
      const hwnd = getHwnd(mainWindow)
      if (hwnd) {
        addClipboardFormatListenerFn(hwnd)
        mainWindow.hookWindowMessage(WM_CLIPBOARDUPDATE, () => {
          for (const listener of onClipboardUpdateListeners) {
            try { listener() } catch (err) {
              console.error('[Main] Error in clipboard-update listener:', err)
            }
          }
        })
        mainWindow.on('closed', () => {
          try { removeClipboardFormatListenerFn?.(hwnd) } catch { /* ignore */ }
        })
      }
    } catch (err) {
      console.error('[Main] Failed to register clipboard format listener:', err)
    }
  }

  // Listen for Windows Explorer restart/crash to purge ghost taskbar icons and restore tray.
  if (process.platform === 'win32' && registerWindowMessageFn) {
    try {
      const taskbarCreatedMsg = registerWindowMessageFn('TaskbarCreated')
      if (taskbarCreatedMsg > 0) {
        mainWindow.hookWindowMessage(taskbarCreatedMsg, () => {
          console.log('[Main] TaskbarCreated message received from Windows Explorer — refreshing taskbar state & tray')
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setSkipTaskbar(true)
            mainWindow.setAlwaysOnTop(true, 'screen-saver')
          }
          for (const listener of onTaskbarCreatedListeners) {
            try { listener() } catch (err) { console.error('[Main] Error in onTaskbarCreated listener:', err) }
          }
        })
      }
    } catch (err) {
      console.error('[Main] Failed to hook TaskbarCreated window message:', err)
    }
  }

  registerFullscreenActiveListener((fullscreenDisplayId) => {
    if (panelDrag.isActive()) return
    const settings = loadSettings()
    if (settings.suppressInFullscreen && (settings.hoverActivation ?? true)) {
      if (process.platform === 'darwin' && (!interactive || openedExplicitly)) return
      if (
        process.platform === 'darwin' &&
        typeof fullscreenDisplayId === 'number' &&
        currentStickDisplayId !== undefined &&
        fullscreenDisplayId !== currentStickDisplayId
      ) return
      sendToMainWindow('window:toggle', false)
      setInteractive(false)
    }
  })

  const handleDisplayChange = (triggerPopUp = false) => {
    updateCachedWorkArea()
    console.log('[Main] Display metrics/topology changed — validating bounds and repositioning window')
    const placementBefore = lastPanelPlacement
    repositionWindow()
    if (triggerPopUp) {
      if (process.platform === 'darwin' && !panelPlacementChanged(placementBefore, lastPanelPlacement)) return
      popUpAndRetract(1500)
    }
  }

  // Fix 2: Debounce display-metrics-changed.
  //
  // When a TV is in mirror mode, Windows can fire this event 5–20 times in rapid
  // succession each time the TV turns on/off, wakes, or renegotiates EDID.
  // Without debouncing, each of those 20 calls hits repositionWindow() while the
  // display list is in a transitional state, potentially resolving to the wrong
  // display at intermediate frames.
  //
  // 600ms is enough for Windows DWM to finish all its display-topology bookkeeping
  // after a single physical event, while being fast enough to feel instantaneous.
  let displayChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null
  const handleDisplayChangeDebounced = (triggerPopUp = false) => {
    if (displayChangeDebounceTimer !== null) {
      clearTimeout(displayChangeDebounceTimer)
    }
    displayChangeDebounceTimer = setTimeout(() => {
      displayChangeDebounceTimer = null
      handleDisplayChange(triggerPopUp)
    }, 600)
  }

  // Keep the panel glued to the primary display if the work area changes.
  screen.on('display-metrics-changed', () => handleDisplayChangeDebounced(false))
  screen.on('display-added', () => {
    handleDisplayChangeDebounced(true)
  })
  screen.on('display-removed', () => {
    handleDisplayChangeDebounced(true)
  })

  // Respect OS-level always-on-top reordering.
  mainWindow.on('focus', () => {
    mainWindow?.setAlwaysOnTop(true, 'screen-saver')
  })

  // Open external links in the default browser.
  if (process.platform === 'darwin') {
    installMacWebGuards(mainWindow.webContents)
  } else {
    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })
  }

  // Load the renderer.
  if (APP_CONFIG.is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return
    mainWindow.showInactive()
    // 'screen-saver' level stays above fullscreen browser windows and games.
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    applyNoActivateStyle(mainWindow, true)
  })

  if (process.platform === 'darwin') {
    const resetRenderer = (source: string): void => {
      panelDrag.cancel()
      resetRendererState(Date.now())
      panelVibrancy.hide()
      if (interactive) noteForced(source)
      setInteractive(false)
    }
    mainWindow.webContents.on('did-finish-load', () => resetRenderer('did-finish-load'))
    mainWindow.webContents.on('render-process-gone', () => resetRenderer('render-process-gone'))
    mainWindow.webContents.on('did-start-loading', () => panelDrag.cancel())
  }

  mainWindow.webContents.on('console-message', ({ message, lineNumber, sourceId }) => {
    console.log(`[Renderer] ${message} (${sourceId}:${lineNumber})`)
  })

  mainWindow.on('close', (e) => {
    if (!runtime.quitting) {
      e.preventDefault()
    }
  })

  // Periodic heartbeat: Windows fullscreen apps (Chrome YouTube, games) push
  // floating windows behind them. Re-asserting 'screen-saver' level periodically
  // ensures the panel re-appears when the user exits fullscreen.
  //
  // Power fix: interval increased from 500ms to 2000ms.
  // The old 500ms interval called SetWindowPos(HWND_TOPMOST) 120 times/min,
  // even when nothing was happening. 2000ms reduces this to 30 times/min with
  // no perceptible difference — the panel reappears within 2s of a fullscreen
  // app losing focus, which is already faster than the user notices.
  if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
  heartbeatTimer = null
  if (process.platform !== 'darwin') {
    heartbeatTimer = setInterval(() => {
      if (runtime.quitting || heartbeatPaused || interactive) return
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
      }
    }, 2000)
  }

  if (macFirstRun) applyMacInitialStickPosition()

  return mainWindow
}

export function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/** Toggle the panel between shown (always on top) and fully hidden. */
export function setVisible(visible: boolean): void {
  if (!mainWindow) return
  if (visible) {
    mainWindow.showInactive()
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.setSkipTaskbar(true)
  } else {
    mainWindow.hide()
  }
}
