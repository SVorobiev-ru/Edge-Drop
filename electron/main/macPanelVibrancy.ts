import { ipcMain, nativeTheme, type BrowserWindow } from 'electron'
import { showPanelVibrancy, hidePanelVibrancy, type VibrancyEdge } from './macNative'
import { notePanelState, type PanelStateReport } from './clickThrough'
import { loadSettings } from '../store/settings'

function vibrancyEdge(position: unknown): VibrancyEdge {
  return position === 'right' || position === 'top' || position === 'bottom' ? position : 'left'
}

export interface PanelVibrancy {
  hide(): void
  handlePanelState(state: unknown, sender?: Electron.WebContents): void
  registerIpc(): void
}

export function createPanelVibrancy(getWindow: () => BrowserWindow | null): PanelVibrancy {
  let shown = false
  let ipcRegistered = false

  function hide(): void {
    if (!shown) return
    shown = false
    hidePanelVibrancy()
  }

  function sync(report: PanelStateReport): void {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    const settings = loadSettings()
    const blade = report.open ? report.rects[0] : undefined
    if (!blade || settings.vibrancy !== true) {
      hide()
      return
    }
    shown = showPanelVibrancy(win.getNativeWindowHandle(), {
      frame: blade,
      contentHeight: win.getContentBounds().height,
      dark: nativeTheme.shouldUseDarkColors,
      edge: vibrancyEdge(report.edge ?? settings.stickPosition),
      radius: 24
    })
  }

  function handlePanelState(state: unknown, sender?: Electron.WebContents): void {
    const win = getWindow()
    if (process.platform !== 'darwin' || !win || win.isDestroyed()) return
    if (sender && sender !== win.webContents) return
    const report = notePanelState(state, Date.now())
    if (report) sync(report)
  }

  function registerIpc(): void {
    if (ipcRegistered) return
    ipcRegistered = true
    ipcMain.handle('window:panel-state', (event, state) => handlePanelState(state, event.sender))
  }

  return { hide, handlePanelState, registerIpc }
}
