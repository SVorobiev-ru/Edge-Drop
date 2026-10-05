import { ipcMain, screen, type BrowserWindow } from 'electron'
import { mouseButtonsAvailable, pressedMouseButtons, setPanelCursor } from './macNative'
import {
  displayUnderPoint,
  grabFraction,
  isHorizontalEdge,
  MAC_EDGES,
  panelSizes,
  pickDragPlacement,
  placementMoved,
  samePlacement,
  type DragAnchor,
  type DragPlacement,
  type PanelSizes,
  type PlacementDisplay
} from '../../shared/panelPlacement'
import { loadSettings } from '../store/settings'
import type { PanelCursor, PanelDragPlacement, PanelDragResult, Settings, SolidRect } from '../../shared/types'

const TICK_MS = 16
const REVEAL_TIMEOUT_MS = 400
const IDLE_TIMEOUT_MS = 5000

export interface PanelDragDeps {
  getWindow(): BrowserWindow | null
  /** The display the window is placed on. */
  getDisplayId(): number | undefined
  commit(target: DragPlacement): Settings
  restore(): void
}

export interface PanelDrag {
  isActive(): boolean
  /** Ends a running drag without saving, e.g. when the renderer goes away. */
  cancel(): void
  registerIpc(): void
}

interface ActiveDrag {
  anchor: DragAnchor
  start: DragPlacement
  placement: DragPlacement
  sizes: PanelSizes
  displays: PlacementDisplay[]
  windowDisplayId: number
  lastCursor: { x: number; y: number }
  lastMoveAt: number
}

function sanitizeBlade(input: unknown): SolidRect | null {
  if (!input || typeof input !== 'object') return null
  const { x, y, width, height } = input as Record<string, unknown>
  const values = [x, y, width, height]
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000)) return null
  if ((width as number) <= 0 || (height as number) <= 0) return null
  return { x: x as number, y: y as number, width: width as number, height: height as number }
}

function sanitizeCursor(input: unknown): PanelCursor {
  return input === 'ew-resize' || input === 'ns-resize' ? input : null
}

function placementMessage(placement: DragPlacement): PanelDragPlacement {
  return {
    displayId: placement.displayId,
    edge: placement.edge,
    offset: placement.offset,
    area: { width: placement.workArea.width, height: placement.workArea.height }
  }
}

/**
 * The window covers the work area of one display, so the panel moves along
 * the edges of that display without the window changing. Only a move to
 * another display moves the window; it stays hidden until the renderer has
 * drawn the panel there.
 */
export function createPanelDrag(deps: PanelDragDeps): PanelDrag {
  let active: ActiveDrag | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let revealTimer: ReturnType<typeof setTimeout> | null = null
  let ipcRegistered = false
  let unclaimedResult: PanelDragResult | null = null
  let cursorShown = false

  function stopTimer(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  function hideUntilReveal(win: BrowserWindow): void {
    win.setOpacity(0)
    if (revealTimer !== null) clearTimeout(revealTimer)
    revealTimer = setTimeout(reveal, REVEAL_TIMEOUT_MS)
  }

  function reveal(): void {
    if (revealTimer !== null) clearTimeout(revealTimer)
    revealTimer = null
    const win = deps.getWindow()
    if (win && !win.isDestroyed()) win.setOpacity(1)
  }

  function showCursor(cursor: PanelCursor): void {
    if (!cursor && !cursorShown) return
    cursorShown = setPanelCursor(cursor) && cursor !== null
  }

  function tick(): void {
    const win = deps.getWindow()
    const drag = active
    if (!drag || !win || win.isDestroyed()) {
      finish(false)
      return
    }
    if (mouseButtonsAvailable() && pressedMouseButtons() === 0) {
      unclaimedResult = finish(true)
      return
    }
    const cursor = screen.getCursorScreenPoint()
    const now = Date.now()
    if (cursor.x !== drag.lastCursor.x || cursor.y !== drag.lastCursor.y) {
      drag.lastCursor = cursor
      drag.lastMoveAt = now
    } else if (!mouseButtonsAvailable() && now - drag.lastMoveAt > IDLE_TIMEOUT_MS) {
      finish(false)
      return
    }
    const next = pickDragPlacement({ cursor, displays: drag.displays, sizes: drag.sizes, anchor: drag.anchor, current: drag.placement })
    if (!next || samePlacement(next, drag.placement)) return
    drag.placement = next
    if (next.displayId !== drag.windowDisplayId) {
      drag.windowDisplayId = next.displayId
      hideUntilReveal(win)
      win.setBounds({ ...next.workArea })
    }
    win.webContents.send('window:panel-drag-placement', placementMessage(next))
  }

  function start(blade: unknown): boolean {
    const win = deps.getWindow()
    const rect = sanitizeBlade(blade)
    if (process.platform !== 'darwin' || active || !rect || !win || win.isDestroyed()) return false
    unclaimedResult = null
    const settings = loadSettings()
    const displays = screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor }))
    const bounds = win.getBounds()
    const display = displays.find((d) => d.id === deps.getDisplayId())
      ?? displayUnderPoint(displays, { x: bounds.x + rect.x + rect.width / 2, y: bounds.y + rect.y + rect.height / 2 })
    if (!display) return false
    const edge = MAC_EDGES.includes(settings.stickPosition) ? settings.stickPosition : 'left'
    const offset = (isHorizontalEdge(edge) ? settings.horizontalOffset : settings.verticalOffset) ?? 0.5
    const cursor = screen.getCursorScreenPoint()
    const placement: DragPlacement = { displayId: display.id, workArea: { ...display.workArea }, scaleFactor: display.scaleFactor, edge, offset }
    active = {
      anchor: {
        displayId: display.id,
        edge,
        offset,
        cursor,
        grab: grabFraction(edge, rect, { x: cursor.x - bounds.x, y: cursor.y - bounds.y })
      },
      start: placement,
      placement,
      sizes: panelSizes(settings),
      displays,
      windowDisplayId: display.id,
      lastCursor: cursor,
      lastMoveAt: Date.now()
    }
    timer = setInterval(tick, TICK_MS)
    return true
  }

  function finish(commit: boolean): PanelDragResult | null {
    stopTimer()
    const drag = active
    active = null
    const win = deps.getWindow()
    if (!drag || !win || win.isDestroyed()) return null
    if (commit && placementMoved(drag.start, drag.placement)) {
      return { moved: true, settings: deps.commit(drag.placement) }
    }
    if (drag.windowDisplayId !== drag.start.displayId) hideUntilReveal(win)
    deps.restore()
    return { moved: false, settings: loadSettings() }
  }

  function registerIpc(): void {
    if (ipcRegistered) return
    ipcRegistered = true
    ipcMain.handle('window:panel-drag-start', (event, blade) => {
      const win = deps.getWindow()
      if (!win || win.isDestroyed() || event.sender !== win.webContents) return false
      return start(blade)
    })
    ipcMain.handle('window:panel-drag-end', (event, commit) => {
      const win = deps.getWindow()
      if (!win || win.isDestroyed() || event.sender !== win.webContents) return null
      if (!active) {
        const result = unclaimedResult
        unclaimedResult = null
        return result
      }
      return finish(commit !== false)
    })
    ipcMain.handle('window:panel-drag-reveal', (event) => {
      const win = deps.getWindow()
      if (!win || win.isDestroyed() || event.sender !== win.webContents) return
      reveal()
    })
    ipcMain.handle('window:panel-cursor', (event, cursor) => {
      const win = deps.getWindow()
      if (process.platform !== 'darwin' || !win || win.isDestroyed() || event.sender !== win.webContents) return
      showCursor(sanitizeCursor(cursor))
    })
  }

  function cancel(): void {
    showCursor(null)
    if (active) finish(false)
  }

  return { isActive: () => active !== null, cancel, registerIpc }
}
