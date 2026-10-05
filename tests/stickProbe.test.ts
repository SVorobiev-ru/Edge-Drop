import { describe, expect, it } from 'vitest'
import {
  FAST_POLL_PROXIMITY_PX,
  MAC_FAST_POLL_PROXIMITY_PX,
  isInMacReportBand,
  isNearProximity,
  isNearProximityMac,
  isPointInRect,
  probeStickEdge,
  shouldSendCursorEdge
} from '../electron/main/stickProbe'
import { panelPlacementChanged } from '../electron/main/macScreen'

const display = { x: 0, y: 0, width: 1512, height: 982 }

describe('fast poll proximity', () => {
  it('keeps the Windows rule: anything up to 450px, with no lower bound', () => {
    expect(FAST_POLL_PROXIMITY_PX).toBe(450)
    expect(isNearProximity(450)).toBe(true)
    expect(isNearProximity(451)).toBe(false)
    expect(isNearProximity(-2000)).toBe(true)
  })

  it('on macOS is limited to 0..120px from the edge', () => {
    expect(MAC_FAST_POLL_PROXIMITY_PX).toBe(120)
    const at = (distFromEdge: number) => isNearProximityMac({ distFromEdge, cursor: { x: Math.max(0, distFromEdge), y: 400 }, displayBounds: display })
    expect(at(0)).toBe(true)
    expect(at(120)).toBe(true)
    expect(at(121)).toBe(false)
    expect(at(449)).toBe(false)
  })

  it('on macOS never counts a cursor beyond the edge', () => {
    expect(isNearProximityMac({ distFromEdge: -1, cursor: { x: -1, y: 400 }, displayBounds: display })).toBe(false)
    expect(isNearProximityMac({ distFromEdge: -900, cursor: { x: -900, y: 400 }, displayBounds: display })).toBe(false)
  })

  it('on macOS requires the cursor inside the display of the panel on the other axis too', () => {
    expect(isNearProximityMac({ distFromEdge: 40, cursor: { x: 40, y: 981 }, displayBounds: display })).toBe(true)
    expect(isNearProximityMac({ distFromEdge: 40, cursor: { x: 40, y: 982 }, displayBounds: display })).toBe(false)
    expect(isNearProximityMac({ distFromEdge: 40, cursor: { x: 40, y: -300 }, displayBounds: display })).toBe(false)
  })

  it('treats display bounds as half-open', () => {
    expect(isPointInRect({ x: 0, y: 0 }, display)).toBe(true)
    expect(isPointInRect({ x: 1511, y: 981 }, display)).toBe(true)
    expect(isPointInRect({ x: 1512, y: 10 }, display)).toBe(false)
  })
})

describe('macOS cursor report band', () => {
  const band = (distFromEdge: number, cursor: { x: number; y: number }, stickPosition: 'left' | 'right' | 'top' | 'bottom' = 'left', hotZoneWidth = 3) =>
    isInMacReportBand({ distFromEdge, cursor, displayBounds: display, stickPosition, hotZoneWidth })

  it('covers the trigger zone with the overshoot buffer and the hint margin', () => {
    expect(band(-30, { x: -30, y: 400 })).toBe(true)
    expect(band(-31, { x: -31, y: 400 })).toBe(false)
    expect(band(28, { x: 28, y: 400 })).toBe(true)
    expect(band(29, { x: 29, y: 400 })).toBe(false)
  })

  it('grows with a wider hot zone', () => {
    expect(band(37, { x: 37, y: 400 }, 'left', 12)).toBe(true)
    expect(band(38, { x: 38, y: 400 }, 'left', 12)).toBe(false)
  })

  it('ends where the display ends along the edge', () => {
    expect(band(2, { x: 2, y: 1200 })).toBe(false)
    expect(band(2, { x: 2, y: -1 })).toBe(false)
    expect(band(2, { x: 2000, y: 2 }, 'top')).toBe(false)
    expect(band(2, { x: 700, y: 2 }, 'top')).toBe(true)
    expect(band(2, { x: 2000, y: 980 }, 'bottom')).toBe(false)
    expect(band(2, { x: 700, y: 980 }, 'bottom')).toBe(true)
  })
})

describe('bottom edge probe', () => {
  const wa = { x: 0, y: 25, width: 1512, height: 887 }

  it('measures the distance up from the bottom of the work area', () => {
    expect(probeStickEdge({ cursor: { x: 700, y: 25 + 886 }, workArea: wa, stickPosition: 'bottom', hotZoneWidth: 3 })).toMatchObject({ distFromEdge: 1, inEdge: true })
    expect(probeStickEdge({ cursor: { x: 700, y: 25 + 880 }, workArea: wa, stickPosition: 'bottom', hotZoneWidth: 3 })).toMatchObject({ distFromEdge: 7, inEdge: false })
    expect(probeStickEdge({ cursor: { x: 700, y: 960 }, workArea: wa, stickPosition: 'bottom', hotZoneWidth: 3 }).distFromEdge).toBeLessThan(0)
  })
})

describe('cursor-edge IPC gating', () => {
  const base = {
    platform: 'darwin',
    stateChanged: false,
    interactive: false,
    nearEdge: true,
    inReportBand: false,
    wasInReportBand: false,
    positionChangedEnough: true
  }

  it('stays silent on macOS outside the trigger zone while the panel is closed', () => {
    expect(shouldSendCursorEdge(base)).toBe(false)
  })

  it('reports movement inside the trigger zone on macOS', () => {
    expect(shouldSendCursorEdge({ ...base, inReportBand: true })).toBe(true)
    expect(shouldSendCursorEdge({ ...base, inReportBand: true, positionChangedEnough: false })).toBe(false)
  })

  it('sends one last position when the cursor leaves the trigger zone', () => {
    expect(shouldSendCursorEdge({ ...base, wasInReportBand: true, positionChangedEnough: false })).toBe(true)
  })

  it('always reports while the panel is open and on an edge state change', () => {
    expect(shouldSendCursorEdge({ ...base, interactive: true, positionChangedEnough: false })).toBe(true)
    expect(shouldSendCursorEdge({ ...base, stateChanged: true, positionChangedEnough: false })).toBe(true)
  })

  it('keeps the Windows rule: any movement within the 450px strip is reported', () => {
    expect(shouldSendCursorEdge({ ...base, platform: 'win32' })).toBe(true)
    expect(shouldSendCursorEdge({ ...base, platform: 'win32', positionChangedEnough: false })).toBe(false)
    expect(shouldSendCursorEdge({ ...base, platform: 'win32', nearEdge: false, inReportBand: true, wasInReportBand: true })).toBe(false)
  })
})

describe('panel placement after a display change', () => {
  const placement = { displayId: 1, bounds: { x: 0, y: 25, width: 384, height: 957 } }

  it('is unchanged when another display comes or goes', () => {
    expect(panelPlacementChanged(placement, { displayId: 1, bounds: { ...placement.bounds } })).toBe(false)
  })

  it('changes when the panel lands on another display', () => {
    expect(panelPlacementChanged(placement, { ...placement, displayId: 2 })).toBe(true)
  })

  it('changes when the bounds of the panel change', () => {
    expect(panelPlacementChanged(placement, { displayId: 1, bounds: { ...placement.bounds, height: 1055 } })).toBe(true)
    expect(panelPlacementChanged(placement, { displayId: 1, bounds: { ...placement.bounds, x: 1512 } })).toBe(true)
  })

  it('treats a missing placement as a change unless both are missing', () => {
    expect(panelPlacementChanged(null, placement)).toBe(true)
    expect(panelPlacementChanged(null, null)).toBe(false)
  })
})
