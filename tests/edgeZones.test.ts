import { describe, expect, it } from 'vitest'
import { BUFFER_PX, TRIGGER_PX, isInSplitEdgeZone } from '../shared/edgeZones'

const WIDTH = 384

describe('split drop zone at the stick edge', () => {
  it('left: the strip next to the left edge splits, the rest of the panel does not', () => {
    expect(isInSplitEdgeZone({ x: 0, y: 400, windowWidth: WIDTH, stickPosition: 'left' })).toBe(true)
    expect(isInSplitEdgeZone({ x: 100, y: 400, windowWidth: WIDTH, stickPosition: 'left' })).toBe(true)
    expect(isInSplitEdgeZone({ x: 101, y: 400, windowWidth: WIDTH, stickPosition: 'left' })).toBe(false)
    expect(isInSplitEdgeZone({ x: 300, y: 10, windowWidth: WIDTH, stickPosition: 'left' })).toBe(false)
  })

  it('right: the strip next to the right edge splits, the left side does not', () => {
    expect(isInSplitEdgeZone({ x: WIDTH, y: 400, windowWidth: WIDTH, stickPosition: 'right' })).toBe(true)
    expect(isInSplitEdgeZone({ x: WIDTH - 100, y: 400, windowWidth: WIDTH, stickPosition: 'right' })).toBe(true)
    expect(isInSplitEdgeZone({ x: WIDTH - 101, y: 400, windowWidth: WIDTH, stickPosition: 'right' })).toBe(false)
    expect(isInSplitEdgeZone({ x: 20, y: 10, windowWidth: WIDTH, stickPosition: 'right' })).toBe(false)
  })

  it('top: only the strip under the top edge splits, whatever the x', () => {
    expect(isInSplitEdgeZone({ x: 20, y: 80, windowWidth: WIDTH, stickPosition: 'top' })).toBe(true)
    expect(isInSplitEdgeZone({ x: WIDTH - 20, y: 0, windowWidth: WIDTH, stickPosition: 'top' })).toBe(true)
    expect(isInSplitEdgeZone({ x: 20, y: 81, windowWidth: WIDTH, stickPosition: 'top' })).toBe(false)
    expect(isInSplitEdgeZone({ x: WIDTH - 20, y: 400, windowWidth: WIDTH, stickPosition: 'top' })).toBe(false)
  })

  it('bottom: only the strip above the bottom edge splits', () => {
    expect(isInSplitEdgeZone({ x: 20, y: 920, windowWidth: WIDTH, windowHeight: 1000, stickPosition: 'bottom' })).toBe(true)
    expect(isInSplitEdgeZone({ x: 20, y: 919, windowWidth: WIDTH, windowHeight: 1000, stickPosition: 'bottom' })).toBe(false)
    expect(isInSplitEdgeZone({ x: 20, y: 999, windowWidth: WIDTH, stickPosition: 'bottom' })).toBe(false)
  })

  it('the same drop point gives a different answer after the panel moves to another edge', () => {
    const drop = { x: 20, y: 400, windowWidth: WIDTH }
    expect(isInSplitEdgeZone({ ...drop, stickPosition: 'left' })).toBe(true)
    expect(isInSplitEdgeZone({ ...drop, stickPosition: 'right' })).toBe(false)
    expect(isInSplitEdgeZone({ ...drop, stickPosition: 'top' })).toBe(false)
  })

  it('follows the window width, so the preview-wide window keeps the zone at its right edge', () => {
    expect(isInSplitEdgeZone({ x: 760, y: 400, windowWidth: 820, stickPosition: 'right' })).toBe(true)
    expect(isInSplitEdgeZone({ x: 360, y: 400, windowWidth: 820, stickPosition: 'right' })).toBe(false)
  })
})

describe('edge band constants', () => {
  it('keeps the values the hover logic and the macOS cursor mapping were tuned for', () => {
    expect(TRIGGER_PX).toBe(3)
    expect(BUFFER_PX).toBe(30)
  })
})
