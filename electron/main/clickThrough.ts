import type { BrowserWindow } from 'electron'
import type { SolidRect, StickPosition } from '../../shared/types'

export type ClickThroughMode = 'closed' | 'solid' | 'forward'

const HIT_TOLERANCE_PX = 5
const CLOSED_GRACE_MS = 600
const OPEN_COMMIT_GRACE_MS = 1500
const RENEWAL_TIMEOUT_MS = 5000
const MAX_RECTS = 16
const MAX_COORD = 100000

export interface PanelStateReport {
  open: boolean
  rects: SolidRect[]
  /** The edge the panel is drawn at, which differs from the settings while it is dragged. */
  edge?: StickPosition
}

const EDGES: readonly unknown[] = ['left', 'right', 'top', 'bottom']

interface ClickThroughState {
  rendererOpen: boolean
  rects: SolidRect[]
  reportedAt: number
  interactiveSince: number
  mode: ClickThroughMode | null
  lastForced: string | null
}

function initialState(): ClickThroughState {
  return { rendererOpen: false, rects: [], reportedAt: 0, interactiveSince: 0, mode: null, lastForced: null }
}

let state: ClickThroughState = initialState()

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_COORD
}

export function sanitizeRect(input: unknown): SolidRect | null {
  if (!input || typeof input !== 'object') return null
  const { x, y, width, height } = input as Record<string, unknown>
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return null
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

function sanitizePanelState(input: unknown): PanelStateReport | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as { open?: unknown; rects?: unknown; edge?: unknown }
  if (typeof raw.open !== 'boolean') return null
  const rects: SolidRect[] = []
  if (raw.open && Array.isArray(raw.rects)) {
    for (const r of raw.rects.slice(0, MAX_RECTS)) {
      const rect = sanitizeRect(r)
      if (rect) rects.push(rect)
    }
  }
  const report: PanelStateReport = { open: raw.open, rects }
  if (EDGES.includes(raw.edge)) report.edge = raw.edge as StickPosition
  return report
}

export function notePanelState(input: unknown, now: number): PanelStateReport | null {
  const report = sanitizePanelState(input)
  if (!report) return null
  state.rendererOpen = report.open
  state.rects = report.rects
  state.reportedAt = now
  return report
}

export function noteInteractive(value: boolean, now: number): void {
  state.interactiveSince = value ? now : 0
}

export function resetRendererState(now: number): void {
  state.rendererOpen = false
  state.rects = []
  state.reportedAt = now
}

function isInsideSolid(point: { x: number; y: number }, rects: SolidRect[] = state.rects, tolerance = HIT_TOLERANCE_PX): boolean {
  return rects.some((r) =>
    point.x >= r.x - tolerance &&
    point.x <= r.x + r.width + tolerance &&
    point.y >= r.y - tolerance &&
    point.y <= r.y + r.height + tolerance
  )
}

export interface ClickThroughVerdict {
  mode: ClickThroughMode
  force?: string
  closeRenderer?: boolean
}

export function clickThroughVerdict(input: {
  interactive: boolean
  cursor: { x: number; y: number }
  now: number
  mouseButtons: () => number
  /** A panel drag is running: the reported rects lag behind the moving window. */
  holdOpen?: boolean
}): ClickThroughVerdict {
  const { interactive, cursor, now } = input
  if (!interactive) return { mode: 'closed' }

  if (!state.rendererOpen) {
    const closing = state.reportedAt > state.interactiveSince
    const since = Math.max(state.reportedAt, state.interactiveSince)
    if (now - since > (closing ? CLOSED_GRACE_MS : OPEN_COMMIT_GRACE_MS)) {
      return closing
        ? { mode: 'closed', force: 'renderer-closed' }
        : { mode: 'closed', force: 'open-not-committed', closeRenderer: true }
    }
    return { mode: closing ? 'forward' : 'solid' }
  }

  if (state.rects.length === 0) return { mode: 'solid' }

  const inside = isInsideSolid(cursor)
  if (!inside && !input.holdOpen && now - state.reportedAt > RENEWAL_TIMEOUT_MS) {
    return { mode: 'closed', force: 'renewal-timeout', closeRenderer: true }
  }
  if (inside) return { mode: 'solid' }
  if (state.mode === 'solid' && input.mouseButtons() !== 0) return { mode: 'solid' }
  return { mode: 'forward' }
}

export function applyClickThroughMode(win: BrowserWindow | null, mode: ClickThroughMode, force = false): boolean {
  if (!win || win.isDestroyed()) return false
  if (!force && state.mode === mode) return false
  if (mode === 'solid') win.setIgnoreMouseEvents(false)
  else win.setIgnoreMouseEvents(true, { forward: mode === 'forward' })
  state.mode = mode
  return true
}

export function enforceClickThrough(win: BrowserWindow | null): void {
  applyClickThroughMode(win, 'closed', true)
}

export function noteForced(source: string): void {
  state.lastForced = source
  console.log(`[ClickThrough] forced click-through: ${source}`)
}

export function getClickThroughState(): Readonly<ClickThroughState> {
  return { ...state, rects: state.rects.map((r) => ({ ...r })) }
}

export function resetClickThroughState(): void {
  state = initialState()
}
