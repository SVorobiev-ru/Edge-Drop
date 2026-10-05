import { describe, expect, it } from 'vitest'
import {
  FLYOUT_GAP,
  sideFlyoutDockOffset,
  sideFlyoutHoverRect,
  sideFlyoutMaxHeight,
  sideFlyoutOrigin,
  sideFlyoutPlacement,
  type FlyoutAnchorRect,
  type FlyoutHoverRect,
  type SideFlyoutPlacement
} from '../src/lib/flyoutPlacement'
import { DEFAULT_SETTINGS, type Settings, type StickPosition } from '../shared/types'

const VIEWPORT = { width: 1440, height: 900 }
const ANCHOR = { x: 900, y: 40, width: 28, height: 28 }

function settingsFor(edge: StickPosition): Settings {
  return { ...DEFAULT_SETTINGS, panelHeight: 0.7, verticalOffset: 0.3, horizontalOffset: 0.4, stickPosition: edge }
}

type SmallCase = [
  name: string,
  edge: StickPosition,
  horizontalWidth: number,
  anchor: FlyoutAnchorRect | null,
  height: number,
  placement: Partial<SideFlyoutPlacement>,
  maxHeight: number,
  origin: { originX: number; originY: number },
  hoverRect: FlyoutHoverRect,
  dockOffset: { top?: number; bottom?: number } | null,
  left: number | null
]

const SMALL_CASES: SmallCase[] = [
  ['language left', 'left', 270, ANCHOR, 230, { stickPosition: 'left', isHorizontal: false, isTop: false, panelH: 630, panelTop: 81, dock: { x: 0, y: 81, width: 270, height: 630, edge: 'left' }, flyoutWidth: 280, anchorCenterX: 135, flyoutLeft: 12 }, 606, { originX: 0, originY: 0.5 }, { top: 281, bottom: 511 }, null, null],
  ['style left', 'left', 320, ANCHOR, 180, { stickPosition: 'left', isHorizontal: false, isTop: false, panelH: 630, panelTop: 81, dock: { x: 0, y: 81, width: 270, height: 630, edge: 'left' }, flyoutWidth: 280, anchorCenterX: 135, flyoutLeft: 12 }, 606, { originX: 0, originY: 0.5 }, { top: 306, bottom: 486 }, null, null],
  ['style left no anchor', 'left', 320, null, 180, { stickPosition: 'left', isHorizontal: false, isTop: false, panelH: 630, panelTop: 81, dock: { x: 0, y: 81, width: 270, height: 630, edge: 'left' }, flyoutWidth: 280, anchorCenterX: 135, flyoutLeft: 12 }, 606, { originX: 0, originY: 0.5 }, { top: 306, bottom: 486 }, null, null],
  ['style left far anchor', 'left', 320, { x: 5, width: 0 }, 180, { stickPosition: 'left', isHorizontal: false, isTop: false, panelH: 630, panelTop: 81, dock: { x: 0, y: 81, width: 270, height: 630, edge: 'left' }, flyoutWidth: 280, anchorCenterX: 135, flyoutLeft: 12 }, 606, { originX: 0, originY: 0.5 }, { top: 306, bottom: 486 }, null, null],
  ['language right', 'right', 270, ANCHOR, 230, { stickPosition: 'right', isHorizontal: false, isTop: false, panelH: 630, panelTop: 81, dock: { x: 1170, y: 81, width: 270, height: 630, edge: 'right' }, flyoutWidth: 280, anchorCenterX: 135, flyoutLeft: 12 }, 606, { originX: 1, originY: 0.5 }, { top: 281, bottom: 511 }, null, null],
  ['style right', 'right', 320, ANCHOR, 180, { stickPosition: 'right', isHorizontal: false, isTop: false, panelH: 630, panelTop: 81, dock: { x: 1170, y: 81, width: 270, height: 630, edge: 'right' }, flyoutWidth: 280, anchorCenterX: 135, flyoutLeft: 12 }, 606, { originX: 1, originY: 0.5 }, { top: 306, bottom: 486 }, null, null],
  ['style right no anchor', 'right', 320, null, 180, { stickPosition: 'right', isHorizontal: false, isTop: false, panelH: 630, panelTop: 81, dock: { x: 1170, y: 81, width: 270, height: 630, edge: 'right' }, flyoutWidth: 280, anchorCenterX: 135, flyoutLeft: 12 }, 606, { originX: 1, originY: 0.5 }, { top: 306, bottom: 486 }, null, null],
  ['style right far anchor', 'right', 320, { x: 5, width: 0 }, 180, { stickPosition: 'right', isHorizontal: false, isTop: false, panelH: 630, panelTop: 81, dock: { x: 1170, y: 81, width: 270, height: 630, edge: 'right' }, flyoutWidth: 280, anchorCenterX: 135, flyoutLeft: 12 }, 606, { originX: 1, originY: 0.5 }, { top: 306, bottom: 486 }, null, null],
  ['language top', 'top', 270, ANCHOR, 230, { stickPosition: 'top', isHorizontal: true, isTop: true, panelH: 630, panelTop: 81, dock: { x: 150, y: 0, width: 1080, height: 210, edge: 'top' }, flyoutWidth: 270, anchorCenterX: 764, flyoutLeft: 629 }, 260, { originX: 0.5, originY: 0 }, { top: 210, bottom: 452, left: 629, right: 899 }, { top: 222 }, 779],
  ['style top', 'top', 320, ANCHOR, 180, { stickPosition: 'top', isHorizontal: true, isTop: true, panelH: 630, panelTop: 81, dock: { x: 150, y: 0, width: 1080, height: 210, edge: 'top' }, flyoutWidth: 320, anchorCenterX: 764, flyoutLeft: 604 }, 260, { originX: 0.5, originY: 0 }, { top: 210, bottom: 402, left: 604, right: 924 }, { top: 222 }, 754],
  ['style top no anchor', 'top', 320, null, 180, { stickPosition: 'top', isHorizontal: true, isTop: true, panelH: 630, panelTop: 81, dock: { x: 150, y: 0, width: 1080, height: 210, edge: 'top' }, flyoutWidth: 320, anchorCenterX: 540, flyoutLeft: 380 }, 260, { originX: 0.5, originY: 0 }, { top: 210, bottom: 402, left: 380, right: 700 }, { top: 222 }, 530],
  ['style top far anchor', 'top', 320, { x: 5, width: 0 }, 180, { stickPosition: 'top', isHorizontal: true, isTop: true, panelH: 630, panelTop: 81, dock: { x: 150, y: 0, width: 1080, height: 210, edge: 'top' }, flyoutWidth: 320, anchorCenterX: -129, flyoutLeft: 12 }, 260, { originX: 0.08, originY: 0 }, { top: 210, bottom: 402, left: 12, right: 332 }, { top: 222 }, 162],
  ['language bottom', 'bottom', 270, ANCHOR, 230, { stickPosition: 'bottom', isHorizontal: true, isTop: false, panelH: 630, panelTop: 81, dock: { x: 150, y: 690, width: 1080, height: 210, edge: 'bottom' }, flyoutWidth: 270, anchorCenterX: 764, flyoutLeft: 629 }, 260, { originX: 0.5, originY: 1 }, { top: 448, bottom: 690, left: 629, right: 899 }, { bottom: 222 }, 779],
  ['style bottom', 'bottom', 320, ANCHOR, 180, { stickPosition: 'bottom', isHorizontal: true, isTop: false, panelH: 630, panelTop: 81, dock: { x: 150, y: 690, width: 1080, height: 210, edge: 'bottom' }, flyoutWidth: 320, anchorCenterX: 764, flyoutLeft: 604 }, 260, { originX: 0.5, originY: 1 }, { top: 498, bottom: 690, left: 604, right: 924 }, { bottom: 222 }, 754],
  ['style bottom no anchor', 'bottom', 320, null, 180, { stickPosition: 'bottom', isHorizontal: true, isTop: false, panelH: 630, panelTop: 81, dock: { x: 150, y: 690, width: 1080, height: 210, edge: 'bottom' }, flyoutWidth: 320, anchorCenterX: 540, flyoutLeft: 380 }, 260, { originX: 0.5, originY: 1 }, { top: 498, bottom: 690, left: 380, right: 700 }, { bottom: 222 }, 530],
  ['style bottom far anchor', 'bottom', 320, { x: 5, width: 0 }, 180, { stickPosition: 'bottom', isHorizontal: true, isTop: false, panelH: 630, panelTop: 81, dock: { x: 150, y: 690, width: 1080, height: 210, edge: 'bottom' }, flyoutWidth: 320, anchorCenterX: -129, flyoutLeft: 12 }, 260, { originX: 0.08, originY: 1 }, { top: 498, bottom: 690, left: 12, right: 332 }, { bottom: 222 }, 162]
]

type PreviewCase = [name: string, edge: StickPosition, rect: FlyoutAnchorRect | null, placement: Partial<SideFlyoutPlacement>, maxHeight: number]

const PREVIEW_CASES: PreviewCase[] = [
  ['preview left', 'left', { x: 300, y: 500, width: 0, height: 120 }, { panelH: 630, panelTop: 81, dock: { x: 0, y: 81, width: 270, height: 630, edge: 'left' }, flyoutWidth: 440, anchorCenterX: 405, flyoutLeft: 12 }, 606],
  ['preview left no rect', 'left', null, { panelH: 630, panelTop: 81, dock: { x: 0, y: 81, width: 270, height: 630, edge: 'left' }, flyoutWidth: 440, anchorCenterX: 135, flyoutLeft: 12 }, 606],
  ['preview right', 'right', { x: 300, y: 500, width: 0, height: 120 }, { panelH: 630, panelTop: 81, dock: { x: 1170, y: 81, width: 270, height: 630, edge: 'right' }, flyoutWidth: 440, anchorCenterX: -765, flyoutLeft: 12 }, 606],
  ['preview right no rect', 'right', null, { panelH: 630, panelTop: 81, dock: { x: 1170, y: 81, width: 270, height: 630, edge: 'right' }, flyoutWidth: 440, anchorCenterX: 135, flyoutLeft: 12 }, 606],
  ['preview top', 'top', { x: 300, y: 500, width: 0, height: 120 }, { panelH: 630, panelTop: 81, dock: { x: 150, y: 0, width: 1080, height: 210, edge: 'top' }, flyoutWidth: 440, anchorCenterX: 255, flyoutLeft: 35 }, 460],
  ['preview top no rect', 'top', null, { panelH: 630, panelTop: 81, dock: { x: 150, y: 0, width: 1080, height: 210, edge: 'top' }, flyoutWidth: 440, anchorCenterX: 540, flyoutLeft: 320 }, 460],
  ['preview bottom', 'bottom', { x: 300, y: 500, width: 0, height: 120 }, { panelH: 630, panelTop: 81, dock: { x: 150, y: 690, width: 1080, height: 210, edge: 'bottom' }, flyoutWidth: 440, anchorCenterX: 255, flyoutLeft: 35 }, 460],
  ['preview bottom no rect', 'bottom', null, { panelH: 630, panelTop: 81, dock: { x: 150, y: 690, width: 1080, height: 210, edge: 'bottom' }, flyoutWidth: 440, anchorCenterX: 540, flyoutLeft: 320 }, 460]
]

describe('side flyout placement', () => {
  it('keeps the gap between the panel and a flyout', () => {
    expect(FLYOUT_GAP).toBe(12)
  })

  it.each(SMALL_CASES)('%s', (_name, edge, horizontalWidth, anchor, height, expected, maxHeight, origin, hoverRect, dockOffset, left) => {
    const isRight = edge === 'right'
    const placement = sideFlyoutPlacement({
      settings: settingsFor(edge),
      viewport: VIEWPORT,
      isRight,
      horizontalWidth,
      verticalWidth: 280,
      anchorRect: anchor,
      anchorFallbackWidth: 32
    })
    expect(placement).toMatchObject(expected)
    expect(placement.screenH).toBe(900)
    expect(placement.dockLeft).toBe(placement.dock.x)
    expect(sideFlyoutMaxHeight(placement, 260)).toBe(maxHeight)
    expect(sideFlyoutOrigin(placement, isRight)).toEqual(origin)
    expect(sideFlyoutHoverRect(placement, height)).toEqual(hoverRect)
    if (dockOffset) {
      expect(sideFlyoutDockOffset(placement)).toEqual(dockOffset)
      expect(placement.dockLeft + placement.flyoutLeft).toBe(left)
    }
  })

  it.each(PREVIEW_CASES)('%s', (_name, edge, rect, expected, maxHeight) => {
    const placement = sideFlyoutPlacement({
      settings: settingsFor(edge),
      viewport: VIEWPORT,
      isRight: edge === 'right',
      horizontalWidth: 440,
      verticalWidth: 440,
      anchorRect: rect,
      anchorFallbackWidth: 210,
      anchorOnSideEdges: true
    })
    expect(placement).toMatchObject(expected)
    expect(sideFlyoutMaxHeight(placement, Math.min(460, Math.max(200, VIEWPORT.height - 240)))).toBe(maxHeight)
  })

  it('falls back to the side given by isRight when no edge is stored', () => {
    const settings = { ...settingsFor('left'), stickPosition: undefined as unknown as StickPosition }
    const input = { settings, viewport: VIEWPORT, horizontalWidth: 270, verticalWidth: 280, anchorRect: null, anchorFallbackWidth: 32 }
    expect(sideFlyoutPlacement({ ...input, isRight: true }).stickPosition).toBe('right')
    expect(sideFlyoutPlacement({ ...input, isRight: false }).stickPosition).toBe('left')
  })
})
