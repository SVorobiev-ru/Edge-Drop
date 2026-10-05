export const PANEL_WIDTH_MIN = 240
export const PANEL_WIDTH_MAX = 420
export const PANEL_WIDTH_DEFAULT = 270
export const PANEL_WIDTH_STEP = 10

export const PANEL_LENGTH_MIN = 0.3
export const PANEL_LENGTH_MAX = 1
export const PANEL_LENGTH_DEFAULT = 0.6

export const DOCK_HEIGHT_MIN = 170
export const DOCK_HEIGHT_MAX = 400
export const DOCK_HEIGHT_DEFAULT = 210

export const DOCK_WIDTH_MIN = 480
export const DOCK_WIDTH_MAX = 3000
export const DOCK_WIDTH_DEFAULT = 1080

export function clampPanelWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PANEL_WIDTH_DEFAULT
  const stepped = Math.round(value / PANEL_WIDTH_STEP) * PANEL_WIDTH_STEP
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, stepped))
}

/** Length of a side panel as a fraction of the work area height. */
export function clampPanelLength(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return PANEL_LENGTH_DEFAULT
  return Math.min(PANEL_LENGTH_MAX, Math.max(PANEL_LENGTH_MIN, value))
}

export function clampDockHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DOCK_HEIGHT_DEFAULT
  return Math.min(DOCK_HEIGHT_MAX, Math.max(DOCK_HEIGHT_MIN, Math.round(value)))
}

export function clampDockWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DOCK_WIDTH_DEFAULT
  return Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, Math.round(value)))
}
