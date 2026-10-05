import type { Settings, StickPosition } from './types'
import {
  clampDockHeight,
  clampDockWidth,
  clampPanelLength,
  clampPanelWidth,
  DOCK_WIDTH_DEFAULT,
  DOCK_WIDTH_MAX,
  DOCK_WIDTH_MIN,
  PANEL_LENGTH_MAX,
  PANEL_LENGTH_MIN
} from './panelWidth'

export interface PlacementRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacementDisplay {
  id: number
  bounds: PlacementRect
  workArea: PlacementRect
  scaleFactor?: number
}

export interface PanelSizes {
  /** Thickness of a side panel, px. */
  width: number
  /** Length of a side panel as a fraction of the work area height. */
  length: number
  dockWidth: number
  dockHeight: number
}

export interface DragPlacement {
  displayId: number
  workArea: PlacementRect
  scaleFactor?: number
  edge: StickPosition
  /** verticalOffset for the left and right edges, horizontalOffset for the top and bottom edges. */
  offset: number
}

export interface DragAnchor {
  displayId: number
  edge: StickPosition
  offset: number
  cursor: { x: number; y: number }
  /** Where the panel was grabbed, 0..1 along its length. */
  grab: number
}

export type ResizeSide = 'inner' | 'start' | 'end'

export const MAC_EDGES: readonly StickPosition[] = ['left', 'right', 'top', 'bottom']
export const EDGE_SWITCH_HYSTERESIS_PX = 24

const DOCK_SIDE_GAP = 60
const DOCK_SIDE_PAD = 30
const OFFSET_PRECISION = 10000
const MOVED_EPSILON = 1 / OFFSET_PRECISION

export function isHorizontalEdge(edge: unknown): edge is 'top' | 'bottom' {
  return edge === 'top' || edge === 'bottom'
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundOffset(value: number): number {
  return Math.round(clamp01(value) * OFFSET_PRECISION) / OFFSET_PRECISION
}

function contains(rect: PlacementRect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}

function distanceSq(rect: PlacementRect, point: { x: number; y: number }): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width))
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height))
  return dx * dx + dy * dy
}

export function displayUnderPoint(displays: PlacementDisplay[], point: { x: number; y: number }): PlacementDisplay | undefined {
  const hit = displays.find((d) => contains(d.bounds, point))
  if (hit) return hit
  let nearest: PlacementDisplay | undefined
  let best = Infinity
  for (const d of displays) {
    const dist = distanceSq(d.bounds, point)
    if (dist < best) {
      best = dist
      nearest = d
    }
  }
  return nearest
}

export function panelSizes(settings: Partial<Pick<Settings, 'panelWidth' | 'panelHeight' | 'dockWidth' | 'dockHeight'>>): PanelSizes {
  return {
    width: clampPanelWidth(settings.panelWidth),
    length: clampPanelLength(settings.panelHeight),
    dockWidth: clampDockWidth(settings.dockWidth),
    dockHeight: clampDockHeight(settings.dockHeight)
  }
}

/** Span of a top or bottom dock along an area of the given width, matching computeStickBounds. */
export function dockSpan(areaWidth: number, dockWidth = DOCK_WIDTH_DEFAULT): { width: number; minX: number; maxX: number } {
  const width = Math.max(0, Math.min(areaWidth - DOCK_SIDE_GAP, dockWidth))
  const pad = areaWidth >= width + DOCK_SIDE_GAP ? DOCK_SIDE_PAD : 0
  return { width, minX: pad, maxX: Math.max(pad, areaWidth - width - pad) }
}

/** The panel rectangle inside an area of the given size (the work area on macOS). */
export function panelLayout(input: {
  edge: StickPosition
  area: { width: number; height: number }
  offset: number
  sizes: PanelSizes
}): PlacementRect {
  const { edge, area, sizes } = input
  const offset = clamp01(input.offset)
  if (isHorizontalEdge(edge)) {
    const span = dockSpan(area.width, sizes.dockWidth)
    const height = Math.min(sizes.dockHeight, area.height)
    return {
      x: span.minX + Math.round((span.maxX - span.minX) * offset),
      y: edge === 'top' ? 0 : area.height - height,
      width: span.width,
      height
    }
  }
  const height = area.height * sizes.length
  const mid = Math.round(height / 2 + offset * (area.height - height))
  return { x: edge === 'right' ? area.width - sizes.width : 0, y: mid - height / 2, width: sizes.width, height }
}

function startRange(area: { width: number; height: number }, edge: StickPosition, sizes: PanelSizes): { min: number; max: number; length: number } {
  if (isHorizontalEdge(edge)) {
    const span = dockSpan(area.width, sizes.dockWidth)
    return { min: span.minX, max: span.maxX, length: span.width }
  }
  const length = area.height * sizes.length
  return { min: 0, max: Math.max(0, area.height - length), length }
}

/** Distance from a point to an edge of the work area; negative outside it. */
export function edgeDistance(point: { x: number; y: number }, workArea: PlacementRect, edge: StickPosition): number {
  switch (edge) {
    case 'left': return point.x - workArea.x
    case 'right': return workArea.x + workArea.width - point.x
    case 'top': return point.y - workArea.y
    case 'bottom': return workArea.y + workArea.height - point.y
  }
}

/** The edge nearest to the point; the current edge is kept until another one is clearly closer. */
export function pickDragEdge(
  point: { x: number; y: number },
  workArea: PlacementRect,
  current: StickPosition | null,
  edges: readonly StickPosition[] = MAC_EDGES
): StickPosition {
  let best = edges[0]
  let bestDist = Infinity
  for (const edge of edges) {
    const dist = Math.max(0, edgeDistance(point, workArea, edge))
    if (dist < bestDist) {
      best = edge
      bestDist = dist
    }
  }
  if (current && current !== best && edges.includes(current)) {
    const currentDist = Math.max(0, edgeDistance(point, workArea, current))
    if (currentDist - bestDist < EDGE_SWITCH_HYSTERESIS_PX) return current
  }
  return best
}

/**
 * Where the dragged panel sits: attached to the nearest edge of the display
 * under the cursor, slid along it with the cursor. On the edge it started from
 * the panel keeps its distance to the cursor; elsewhere the grabbed point of
 * the panel stays under the cursor.
 */
export function pickDragPlacement(input: {
  cursor: { x: number; y: number }
  displays: PlacementDisplay[]
  sizes: PanelSizes
  anchor: DragAnchor
  current: Pick<DragPlacement, 'displayId' | 'edge'> | null
  edges?: readonly StickPosition[]
}): DragPlacement | null {
  const { cursor, sizes, anchor, current } = input
  const display = displayUnderPoint(input.displays, cursor)
  if (!display) return null
  const wa = display.workArea
  const edge = pickDragEdge(cursor, wa, current?.displayId === display.id ? current.edge : null, input.edges)
  const horizontal = isHorizontalEdge(edge)
  const range = startRange({ width: wa.width, height: wa.height }, edge, sizes)
  const free = range.max - range.min
  let offset: number
  if (!(free > 0)) {
    offset = 0.5
  } else if (display.id === anchor.displayId && edge === anchor.edge) {
    const delta = horizontal ? cursor.x - anchor.cursor.x : cursor.y - anchor.cursor.y
    offset = roundOffset(anchor.offset + delta / free)
  } else {
    const along = horizontal ? cursor.x - wa.x : cursor.y - wa.y
    offset = roundOffset((along - clamp01(anchor.grab) * range.length - range.min) / free)
  }
  return { displayId: display.id, workArea: { ...wa }, scaleFactor: display.scaleFactor, edge, offset }
}

export function samePlacement(a: Pick<DragPlacement, 'displayId' | 'edge' | 'offset'>, b: Pick<DragPlacement, 'displayId' | 'edge' | 'offset'>): boolean {
  return a.displayId === b.displayId && a.edge === b.edge && a.offset === b.offset
}

export function placementMoved(from: Pick<DragPlacement, 'displayId' | 'edge' | 'offset'>, to: Pick<DragPlacement, 'displayId' | 'edge' | 'offset'>): boolean {
  return from.displayId !== to.displayId || from.edge !== to.edge || Math.abs(from.offset - to.offset) >= MOVED_EPSILON
}

/** Fraction of the panel length at a point given relative to the panel rectangle. */
export function grabFraction(edge: StickPosition, panel: PlacementRect, point: { x: number; y: number }): number {
  if (isHorizontalEdge(edge)) return panel.width > 0 ? clamp01((point.x - panel.x) / panel.width) : 0.5
  return panel.height > 0 ? clamp01((point.y - panel.y) / panel.height) : 0.5
}

export function resizeCursor(edge: StickPosition, side: ResizeSide): 'ew-resize' | 'ns-resize' {
  const horizontal = isHorizontalEdge(edge)
  if (side === 'inner') return horizontal ? 'ns-resize' : 'ew-resize'
  return horizontal ? 'ew-resize' : 'ns-resize'
}

/** Thickness after dragging the inner edge by (dx, dy); the edge follows the cursor. */
export function resizedThickness(input: { start: number; dx: number; dy: number; edge: StickPosition }): number {
  switch (input.edge) {
    case 'left': return input.start + input.dx
    case 'right': return input.start - input.dx
    case 'top': return input.start + input.dy
    case 'bottom': return input.start - input.dy
  }
}

/** Settings for a drag of the inner edge: panelWidth for a side panel, dockHeight for a dock. */
export function thicknessPatch(input: {
  edge: StickPosition
  sizes: PanelSizes
  dx: number
  dy: number
}): Pick<Settings, 'panelWidth'> | Pick<Settings, 'dockHeight'> {
  const { edge, sizes, dx, dy } = input
  if (isHorizontalEdge(edge)) return { dockHeight: clampDockHeight(resizedThickness({ start: sizes.dockHeight, dx, dy, edge })) }
  return { panelWidth: clampPanelWidth(resizedThickness({ start: sizes.width, dx, dy, edge })) }
}

/**
 * Settings for a drag of one end of the panel along its edge: the dragged end
 * follows the cursor, the other end stays where it is.
 */
export function lengthPatch(input: {
  edge: StickPosition
  side: 'start' | 'end'
  area: { width: number; height: number }
  sizes: PanelSizes
  offset: number
  delta: number
}): Pick<Settings, 'panelHeight' | 'verticalOffset'> | Pick<Settings, 'dockWidth' | 'horizontalOffset'> {
  const { edge, side, area, sizes, offset, delta } = input
  const rect = panelLayout({ edge, area, offset, sizes })
  if (isHorizontalEdge(edge)) {
    const maxWidth = Math.max(0, Math.min(DOCK_WIDTH_MAX, area.width - DOCK_SIDE_GAP))
    const minWidth = Math.min(DOCK_WIDTH_MIN, maxWidth)
    const low = DOCK_SIDE_PAD
    const high = area.width - DOCK_SIDE_PAD
    let start = rect.x
    let width: number
    if (side === 'start') {
      const end = rect.x + rect.width
      width = clamp(end - clamp(rect.x + delta, low, end - minWidth), minWidth, maxWidth)
      start = end - width
    } else {
      width = clamp(clamp(rect.x + rect.width + delta, rect.x + minWidth, high) - rect.x, minWidth, maxWidth)
    }
    const span = dockSpan(area.width, width)
    const free = span.maxX - span.minX
    return {
      dockWidth: Math.round(width),
      horizontalOffset: free > 0 ? roundOffset((start - span.minX) / free) : roundOffset(offset)
    }
  }
  const minLength = area.height * PANEL_LENGTH_MIN
  const maxLength = area.height * PANEL_LENGTH_MAX
  let start = rect.y
  let length: number
  if (side === 'start') {
    const end = rect.y + rect.height
    length = clamp(end - clamp(rect.y + delta, 0, end - minLength), minLength, maxLength)
    start = end - length
  } else {
    length = clamp(clamp(rect.y + rect.height + delta, rect.y + minLength, area.height) - rect.y, minLength, maxLength)
  }
  const free = area.height - length
  return {
    panelHeight: Math.round((length / area.height) * OFFSET_PRECISION) / OFFSET_PRECISION,
    verticalOffset: free > 0.5 ? roundOffset(start / free) : roundOffset(offset)
  }
}
