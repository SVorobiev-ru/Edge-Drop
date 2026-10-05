import { describe, it, expect } from 'vitest'
import {
  displayUnderPoint,
  dockSpan,
  edgeDistance,
  grabFraction,
  isHorizontalEdge,
  lengthPatch,
  panelLayout,
  panelSizes,
  pickDragEdge,
  pickDragPlacement,
  placementMoved,
  resizeCursor,
  resizedThickness,
  samePlacement,
  thicknessPatch,
  EDGE_SWITCH_HYSTERESIS_PX,
  type DragAnchor,
  type PlacementDisplay
} from '../shared/panelPlacement'
import { DOCK_HEIGHT_MAX, DOCK_HEIGHT_MIN, DOCK_WIDTH_MIN, PANEL_LENGTH_MIN, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN } from '../shared/panelWidth'
import { computeStickBounds, stickWindowWidth, windowFillsWorkArea } from '../electron/main/geometry'
import { isPanelDragTarget, PANEL_DRAG_EXCLUDE_SELECTOR } from '../src/hooks/usePanelDrag'

function display(id: number, x: number, y: number, width: number, height: number, menuBar = 0, dock = 0, scaleFactor = 2): PlacementDisplay {
  return {
    id,
    bounds: { x, y, width, height },
    workArea: { x, y: y + menuBar, width, height: height - menuBar - dock },
    scaleFactor
  }
}

const LEFT = display(1, -1920, 0, 1920, 1080, 25, 0, 1)
const MAIN = display(2, 0, 0, 1728, 1117, 37, 70)
const RIGHT = display(3, 1728, -200, 2560, 1440, 25)
const ABOVE = display(4, 0, -1080, 1920, 1080, 25, 0, 1)
const DISPLAYS = [LEFT, MAIN, RIGHT]
const SIZES = panelSizes({})

function anchorAt(cursor: { x: number; y: number }, extra: Partial<DragAnchor> = {}): DragAnchor {
  return { displayId: MAIN.id, edge: 'left', offset: 0.5, cursor, grab: 0.05, ...extra }
}

function area(d: PlacementDisplay) {
  return { width: d.workArea.width, height: d.workArea.height }
}

describe('displayUnderPoint', () => {
  it('returns the display that contains the point', () => {
    expect(displayUnderPoint(DISPLAYS, { x: -10, y: 500 })?.id).toBe(1)
    expect(displayUnderPoint(DISPLAYS, { x: 10, y: 10 })?.id).toBe(2)
    expect(displayUnderPoint(DISPLAYS, { x: 1800, y: -150 })?.id).toBe(3)
  })

  it('falls back to the nearest display for a point in a gap', () => {
    expect(displayUnderPoint(DISPLAYS, { x: 500, y: 1300 })?.id).toBe(2)
    expect(displayUnderPoint(DISPLAYS, { x: -500, y: 1200 })?.id).toBe(1)
  })

  it('returns undefined without displays', () => {
    expect(displayUnderPoint([], { x: 0, y: 0 })).toBeUndefined()
  })
})

describe('pickDragEdge', () => {
  const wa = MAIN.workArea

  it('picks the nearest of the four edges', () => {
    expect(pickDragEdge({ x: 40, y: 500 }, wa, null)).toBe('left')
    expect(pickDragEdge({ x: 1700, y: 500 }, wa, null)).toBe('right')
    expect(pickDragEdge({ x: 800, y: 60 }, wa, null)).toBe('top')
    expect(pickDragEdge({ x: 800, y: 1000 }, wa, null)).toBe('bottom')
  })

  it('treats the menu bar and the Dock as the top and bottom edges', () => {
    expect(pickDragEdge({ x: 800, y: 5 }, wa, null)).toBe('top')
    expect(pickDragEdge({ x: 800, y: 1100 }, wa, null)).toBe('bottom')
    expect(edgeDistance({ x: 800, y: 1100 }, wa, 'bottom')).toBeLessThan(0)
  })

  it('keeps the current edge near a corner until another edge is clearly closer', () => {
    const corner = { x: 100, y: wa.y + 100 + EDGE_SWITCH_HYSTERESIS_PX - 1 }
    expect(pickDragEdge(corner, wa, null)).toBe('left')
    expect(pickDragEdge({ x: 100 + EDGE_SWITCH_HYSTERESIS_PX - 1, y: wa.y + 100 }, wa, 'left')).toBe('left')
    expect(pickDragEdge({ x: 100 + EDGE_SWITCH_HYSTERESIS_PX, y: wa.y + 100 }, wa, 'left')).toBe('top')
  })

  it('offers only the allowed edges', () => {
    expect(pickDragEdge({ x: 800, y: 1000 }, wa, null, ['left', 'right', 'top'])).toBe('left')
  })
})

describe('pickDragPlacement', () => {
  const start = { x: 100, y: 500 }

  it('returns the start placement while the cursor has not moved, so the panel does not jump', () => {
    const anchor = anchorAt(start, { offset: 0.3172 })
    const p = pickDragPlacement({ cursor: start, displays: DISPLAYS, sizes: SIZES, anchor, current: null })
    expect(p).toMatchObject({ displayId: MAIN.id, edge: 'left', offset: 0.3172 })
    expect(placementMoved(anchor, p!)).toBe(false)
  })

  it('slides along the start edge with the cursor', () => {
    const anchor = anchorAt(start)
    const free = MAIN.workArea.height * (1 - SIZES.length)
    const p = pickDragPlacement({ cursor: { x: 140, y: 600 }, displays: DISPLAYS, sizes: SIZES, anchor, current: { displayId: 2, edge: 'left' } })
    expect(p?.edge).toBe('left')
    expect(p?.offset).toBeCloseTo(0.5 + 100 / free, 3)
    const before = panelLayout({ edge: 'left', area: area(MAIN), offset: 0.5, sizes: SIZES })
    const after = panelLayout({ edge: 'left', area: area(MAIN), offset: p!.offset, sizes: SIZES })
    expect(after.y - before.y).toBeCloseTo(100, 0)
  })

  it('clamps the offset to the ends of the edge', () => {
    const anchor = anchorAt(start)
    expect(pickDragPlacement({ cursor: { x: 0, y: -2000 }, displays: [MAIN], sizes: SIZES, anchor, current: null })).toMatchObject({ edge: 'left', offset: 0 })
    expect(pickDragPlacement({ cursor: { x: 0, y: 1110 }, displays: [MAIN], sizes: SIZES, anchor, current: { displayId: 2, edge: 'left' } })).toMatchObject({ edge: 'left', offset: 1 })
  })

  it('moves to the bottom edge and keeps the grabbed point of the dock under the cursor', () => {
    const anchor = anchorAt(start, { grab: 0.25 })
    const cursor = { x: 700, y: 1030 }
    const p = pickDragPlacement({ cursor, displays: DISPLAYS, sizes: SIZES, anchor, current: { displayId: 2, edge: 'left' } })
    expect(p?.edge).toBe('bottom')
    const dock = panelLayout({ edge: 'bottom', area: area(MAIN), offset: p!.offset, sizes: SIZES })
    expect(dock.y + dock.height).toBe(MAIN.workArea.height)
    expect(MAIN.workArea.x + dock.x + 0.25 * dock.width).toBeCloseTo(cursor.x, 0)
  })

  it('moves to the right edge of the same display', () => {
    const p = pickDragPlacement({ cursor: { x: 1690, y: 400 }, displays: DISPLAYS, sizes: SIZES, anchor: anchorAt(start), current: { displayId: 2, edge: 'left' } })
    expect(p).toMatchObject({ displayId: 2, edge: 'right' })
    expect(p?.workArea).toEqual(MAIN.workArea)
  })

  it('crosses to the display under the cursor and attaches to its nearest edge', () => {
    const toRight = pickDragPlacement({ cursor: { x: 1760, y: 300 }, displays: DISPLAYS, sizes: SIZES, anchor: anchorAt(start), current: { displayId: 2, edge: 'right' } })
    expect(toRight).toMatchObject({ displayId: 3, edge: 'left', scaleFactor: 2 })
    expect(toRight?.workArea).toEqual(RIGHT.workArea)
    const toLeft = pickDragPlacement({ cursor: { x: -30, y: 900 }, displays: DISPLAYS, sizes: SIZES, anchor: anchorAt(start), current: { displayId: 2, edge: 'left' } })
    expect(toLeft).toMatchObject({ displayId: 1, edge: 'right', scaleFactor: 1 })
  })

  it('uses the bottom edge of a display arranged above', () => {
    const p = pickDragPlacement({ cursor: { x: 900, y: -20 }, displays: [MAIN, ABOVE], sizes: SIZES, anchor: anchorAt(start), current: { displayId: 2, edge: 'top' } })
    expect(p).toMatchObject({ displayId: 4, edge: 'bottom' })
  })

  it('ignores the current edge of another display', () => {
    const p = pickDragPlacement({ cursor: { x: 1740, y: 500 }, displays: DISPLAYS, sizes: SIZES, anchor: anchorAt(start), current: { displayId: 2, edge: 'right' } })
    expect(p?.edge).toBe('left')
  })

  it('centres the dock when the display is too narrow to move it', () => {
    const narrow = display(9, 0, 0, 1000, 800)
    const p = pickDragPlacement({ cursor: { x: 300, y: 790 }, displays: [narrow], sizes: SIZES, anchor: anchorAt(start, { displayId: 9 }), current: null })
    expect(p).toMatchObject({ edge: 'bottom', offset: 0.5 })
  })

  it('keeps the offset where a side panel fills the height', () => {
    const tall = panelSizes({ panelHeight: 1 })
    const p = pickDragPlacement({ cursor: { x: 100, y: 800 }, displays: [MAIN], sizes: tall, anchor: anchorAt(start), current: null })
    expect(p?.offset).toBe(0.5)
  })

  it('returns null without displays', () => {
    expect(pickDragPlacement({ cursor: start, displays: [], sizes: SIZES, anchor: anchorAt(start), current: null })).toBeNull()
  })

  it('compares placements', () => {
    const a = { displayId: 2, edge: 'left' as const, offset: 0.5 }
    expect(samePlacement(a, { ...a })).toBe(true)
    expect(samePlacement(a, { ...a, offset: 0.50001 })).toBe(false)
    expect(placementMoved(a, { ...a, offset: 0.50004 })).toBe(false)
    expect(placementMoved(a, { ...a, offset: 0.5002 })).toBe(true)
    expect(placementMoved(a, { ...a, edge: 'bottom' })).toBe(true)
    expect(placementMoved(a, { ...a, displayId: 3 })).toBe(true)
  })
})

describe('panelLayout', () => {
  const view = { width: 1728, height: 1010 }

  it('matches the existing side panel position', () => {
    const sizes = panelSizes({ panelWidth: 300, panelHeight: 0.65 })
    for (const offset of [0, 0.37, 1]) {
      const panelH = view.height * 0.65
      const midY = Math.round(panelH / 2 + offset * (view.height - panelH))
      expect(panelLayout({ edge: 'left', area: view, offset, sizes })).toEqual({ x: 0, y: midY - panelH / 2, width: 300, height: panelH })
      expect(panelLayout({ edge: 'right', area: view, offset, sizes }).x).toBe(view.width - 300)
    }
  })

  it('puts the top dock at the top and the bottom dock at the bottom of the work area', () => {
    const sizes = panelSizes({ dockHeight: 260, dockWidth: 900 })
    const top = panelLayout({ edge: 'top', area: view, offset: 0, sizes })
    const bottom = panelLayout({ edge: 'bottom', area: view, offset: 1, sizes })
    expect(top).toEqual({ x: 30, y: 0, width: 900, height: 260 })
    expect(bottom).toEqual({ x: view.width - 900 - 30, y: view.height - 260, width: 900, height: 260 })
  })

  it('places the dock the same way as the Windows top window', () => {
    const wa = { x: 0, y: 0, width: 1728, height: 1010 }
    for (const offset of [0, 0.25, 0.8]) {
      const bounds = computeStickBounds({ position: 'top', displays: [{ id: 1, workArea: wa, isPrimary: true }], windowWidth: 0, horizontalOffset: offset })
      expect(panelLayout({ edge: 'top', area: view, offset, sizes: SIZES }).x).toBe(bounds.x + 30)
    }
  })

  it('never makes the dock wider than the work area allows', () => {
    expect(panelLayout({ edge: 'bottom', area: { width: 1000, height: 700 }, offset: 0.5, sizes: panelSizes({ dockWidth: 2400 }) }).width).toBe(940)
    expect(dockSpan(1000)).toEqual({ width: 940, minX: 30, maxX: 30 })
  })

  it('uses defaults that match the current layout', () => {
    expect(SIZES).toEqual({ width: 270, length: 0.6, dockWidth: 1080, dockHeight: 210 })
    expect(isHorizontalEdge('top')).toBe(true)
    expect(isHorizontalEdge('bottom')).toBe(true)
    expect(isHorizontalEdge('left')).toBe(false)
  })

  it('measures the grabbed point along the panel length', () => {
    expect(grabFraction('left', { x: 0, y: 200, width: 270, height: 600 }, { x: 100, y: 230 })).toBeCloseTo(0.05)
    expect(grabFraction('bottom', { x: 300, y: 800, width: 1000, height: 210 }, { x: 550, y: 820 })).toBeCloseTo(0.25)
    expect(grabFraction('top', { x: 300, y: 0, width: 1000, height: 210 }, { x: 2000, y: 10 })).toBe(1)
  })
})

describe('panel resize', () => {
  const view = { width: 1728, height: 1000 }

  it('moves the inner edge with the cursor on every edge', () => {
    expect(resizedThickness({ start: 270, dx: 40, dy: 0, edge: 'left' })).toBe(310)
    expect(resizedThickness({ start: 270, dx: -40, dy: 0, edge: 'right' })).toBe(310)
    expect(resizedThickness({ start: 210, dx: 0, dy: 30, edge: 'top' })).toBe(240)
    expect(resizedThickness({ start: 210, dx: 0, dy: -30, edge: 'bottom' })).toBe(240)
  })

  it('keeps the thickness within its limits', () => {
    expect(thicknessPatch({ edge: 'left', sizes: SIZES, dx: 500, dy: 0 })).toEqual({ panelWidth: PANEL_WIDTH_MAX })
    expect(thicknessPatch({ edge: 'right', sizes: SIZES, dx: 500, dy: 0 })).toEqual({ panelWidth: PANEL_WIDTH_MIN })
    expect(thicknessPatch({ edge: 'left', sizes: SIZES, dx: 13, dy: 0 })).toEqual({ panelWidth: 280 })
    expect(thicknessPatch({ edge: 'top', sizes: SIZES, dx: 0, dy: 500 })).toEqual({ dockHeight: DOCK_HEIGHT_MAX })
    expect(thicknessPatch({ edge: 'bottom', sizes: SIZES, dx: 0, dy: 500 })).toEqual({ dockHeight: DOCK_HEIGHT_MIN })
    expect(thicknessPatch({ edge: 'bottom', sizes: SIZES, dx: 0, dy: -33 })).toEqual({ dockHeight: 243 })
  })

  it('moves the dragged end of a side panel and keeps the other end in place', () => {
    const before = panelLayout({ edge: 'left', area: view, offset: 0.5, sizes: SIZES })
    const end = lengthPatch({ edge: 'left', side: 'end', area: view, sizes: SIZES, offset: 0.5, delta: 100 })
    const afterEnd = panelLayout({ edge: 'left', area: view, offset: end.verticalOffset!, sizes: panelSizes({ panelHeight: end.panelHeight }) })
    expect(afterEnd.y).toBeCloseTo(before.y, 0)
    expect(afterEnd.y + afterEnd.height).toBeCloseTo(before.y + before.height + 100, 0)

    const start = lengthPatch({ edge: 'right', side: 'start', area: view, sizes: SIZES, offset: 0.5, delta: -80 })
    const afterStart = panelLayout({ edge: 'right', area: view, offset: start.verticalOffset!, sizes: panelSizes({ panelHeight: start.panelHeight }) })
    expect(afterStart.y).toBeCloseTo(before.y - 80, 0)
    expect(afterStart.y + afterStart.height).toBeCloseTo(before.y + before.height, 0)
  })

  it('keeps a side panel inside the work area and above its minimum length', () => {
    const short = lengthPatch({ edge: 'left', side: 'end', area: view, sizes: SIZES, offset: 0.5, delta: -2000 })
    expect(short.panelHeight).toBeCloseTo(PANEL_LENGTH_MIN, 4)
    const long = lengthPatch({ edge: 'left', side: 'start', area: view, sizes: SIZES, offset: 0.5, delta: -2000 })
    const rect = panelLayout({ edge: 'left', area: view, offset: long.verticalOffset!, sizes: panelSizes({ panelHeight: long.panelHeight }) })
    expect(rect.y).toBeCloseTo(0, 0)
    expect(rect.y + rect.height).toBeCloseTo(800, 0)
    const full = lengthPatch({ edge: 'left', side: 'end', area: view, sizes: panelSizes({ panelHeight: 0.9 }), offset: 0, delta: 5000 })
    expect(full).toEqual({ panelHeight: 1, verticalOffset: 0 })
  })

  it('moves the dragged end of a dock and keeps the other end in place', () => {
    const before = panelLayout({ edge: 'bottom', area: view, offset: 0.5, sizes: SIZES })
    const left = lengthPatch({ edge: 'bottom', side: 'start', area: view, sizes: SIZES, offset: 0.5, delta: 120 })
    expect(left.dockWidth).toBe(SIZES.dockWidth - 120)
    const after = panelLayout({ edge: 'bottom', area: view, offset: left.horizontalOffset!, sizes: panelSizes({ dockWidth: left.dockWidth }) })
    expect(after.x).toBeCloseTo(before.x + 120, 0)
    expect(after.x + after.width).toBeCloseTo(before.x + before.width, 0)
  })

  it('keeps a dock between its minimum width and the work area', () => {
    const narrow = lengthPatch({ edge: 'top', side: 'end', area: view, sizes: SIZES, offset: 0.5, delta: -5000 })
    expect(narrow.dockWidth).toBe(DOCK_WIDTH_MIN)
    const wide = lengthPatch({ edge: 'top', side: 'end', area: view, sizes: SIZES, offset: 0, delta: 5000 })
    expect(wide).toEqual({ dockWidth: view.width - 60, horizontalOffset: 0 })
  })

  it('shows the cursor that matches the resized axis', () => {
    expect(resizeCursor('left', 'inner')).toBe('ew-resize')
    expect(resizeCursor('right', 'start')).toBe('ns-resize')
    expect(resizeCursor('top', 'inner')).toBe('ns-resize')
    expect(resizeCursor('bottom', 'end')).toBe('ew-resize')
  })
})

describe('panel window geometry', () => {
  it('covers the work area of the stick display on macOS for every edge', () => {
    const wa = { x: 1728, y: 25, width: 2560, height: 1415 }
    const displays = [{ id: 1, workArea: { x: 0, y: 37, width: 1728, height: 1010 }, isPrimary: true }, { id: 2, workArea: wa }]
    expect(windowFillsWorkArea('darwin')).toBe(true)
    expect(windowFillsWorkArea('win32')).toBe(false)
    for (const position of ['left', 'right', 'top', 'bottom'] as const) {
      const r = computeStickBounds({ position, displays, displayId: 2, windowWidth: 384, fillWorkArea: true })
      expect({ x: r.x, y: r.y, width: r.width, height: r.height }).toEqual(wa)
    }
  })

  it('keeps the Windows sizes', () => {
    expect(stickWindowWidth({ panelWidth: 270, previewActive: false })).toBe(384)
    expect(stickWindowWidth({ panelWidth: 270, previewActive: true })).toBe(820)
  })
})

describe('header drag target', () => {
  function target(match: (selector: string) => boolean) {
    return { closest: (selector: string) => (match(selector) ? {} : null) }
  }

  it('accepts empty header space', () => {
    expect(isPanelDragTarget(target(() => false))).toBe(true)
  })

  it('rejects controls inside the header', () => {
    expect(isPanelDragTarget(target(() => true))).toBe(false)
    for (const part of ['button', 'input', '.rubber-segment', '[role="tab"]', '.header-search']) {
      expect(PANEL_DRAG_EXCLUDE_SELECTOR.split(', ')).toContain(part)
    }
  })

  it('rejects targets that are not elements', () => {
    expect(isPanelDragTarget(null)).toBe(false)
    expect(isPanelDragTarget({})).toBe(false)
  })
})
