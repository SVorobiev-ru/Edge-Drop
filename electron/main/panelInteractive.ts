import { applyClickThroughMode, enforceClickThrough, noteInteractive } from './clickThrough'
import { createPanelVibrancy } from './macPanelVibrancy'
import { mainWindow, interactive, explicitOpenMarkedAt, assignInteractive, assignOpenedExplicitly, assignExplicitOpenMarkedAt } from './windowState'
import { applyNoActivateStyle, captureExternalForeground, syncMacEscapeCapture } from './winFocus'

const EXPLICIT_OPEN_TTL_MS = 1000

/**
 * Toggle whether the panel swallows pointer events.
 *
 * - interactive=false (collapsed) -> click-through: Windows passes ALL mouse
 *   clicks to apps beneath. Edge detection is done by the main-process cursor
 *   poll (startCursorPoll), which reads screen.getCursorScreenPoint() directly,
 *   so no mouse-event forwarding is needed.
 * - interactive=true  (expanded) -> normal interactive window: the black blade
 *   captures all clicks.
 */
let gcTimer: ReturnType<typeof setTimeout> | null = null

export function markExplicitOpen(): void {
  if (process.platform !== 'darwin' || interactive) return
  assignExplicitOpenMarkedAt(Date.now())
}

export function setInteractive(value: boolean): void {
  if (!mainWindow) return
  if (value === interactive) {
    if (!value && process.platform === 'darwin') enforceClickThrough(mainWindow)
    return
  }
  assignInteractive(value)
  if (process.platform === 'darwin') noteInteractive(value, Date.now())
  assignOpenedExplicitly(value && explicitOpenMarkedAt > 0 && Date.now() - explicitOpenMarkedAt <= EXPLICIT_OPEN_TTL_MS)
  assignExplicitOpenMarkedAt(0)
  if (value) {
    // Panel is open: disable click-through so user can interact.
    // Remember who is in front BEFORE any search typing can steal focus.
    captureExternalForeground()
    // Cancel any pending idle GC: collecting during the open animation is
    // what made fast reopen-after-close hitch. The next close re-arms it.
    if (gcTimer !== null) {
      clearTimeout(gcTimer)
      gcTimer = null
    }
    if (process.platform === 'darwin') applyClickThroughMode(mainWindow, 'solid')
    else mainWindow.setIgnoreMouseEvents(false)
    // Use 'screen-saver' level to stay above fullscreen apps (YouTube fullscreen, games, etc.)
    // 'floating' (HWND_TOPMOST) can be pushed behind by fullscreen D3D/browser windows.
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.setSkipTaskbar(true)
    applyNoActivateStyle(mainWindow, true)
  } else {
    // Panel is closed: full click-through, no forwarding needed.
    if (process.platform === 'darwin') {
      enforceClickThrough(mainWindow)
      panelVibrancy.hide()
    } else {
      mainWindow.setIgnoreMouseEvents(true, { forward: false })
    }
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.setSkipTaskbar(true)
    applyNoActivateStyle(mainWindow, true)

    // Trigger gentle idle memory cleanup 1.5s after panel closes to reclaim RAM
    if (global.gc) {
      if (gcTimer !== null) clearTimeout(gcTimer)
      gcTimer = setTimeout(() => {
        gcTimer = null
        if (!interactive && global.gc) {
          try { global.gc() } catch { /* ignore */ }
        }
      }, 1500)
    }
  }
  syncMacEscapeCapture()
}

export const panelVibrancy = createPanelVibrancy(() => mainWindow)

export const handlePanelState = panelVibrancy.handlePanelState
export const registerPanelStateIpc = panelVibrancy.registerIpc
