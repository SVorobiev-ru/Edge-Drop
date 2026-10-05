import { describe, expect, it } from 'vitest'
import { intersectBoxes, placeMenu } from '../src/lib/menuPlacement'

const bounds = { top: 100, left: 0, right: 270, bottom: 700 }

describe('dropdown placement', () => {
  it('opens below the trigger when there is room', () => {
    const p = placeMenu({ anchor: { top: 200, left: 20, right: 250, bottom: 230 }, bounds, menuWidth: 230, menuHeight: 180, prefer: 'down', align: 'stretch' })
    expect(p).toEqual({ top: 236, left: 20, width: 230, maxHeight: 456, direction: 'down' })
  })

  it('flips upward when the space below is too small', () => {
    const p = placeMenu({ anchor: { top: 600, left: 20, right: 250, bottom: 630 }, bounds, menuWidth: 230, menuHeight: 180, prefer: 'down', align: 'stretch' })
    expect(p.direction).toBe('up')
    expect(p.top).toBe(600 - 6 - 180)
    expect(p.top + 180).toBeLessThanOrEqual(600)
  })

  it('flips downward when an upward menu does not fit above', () => {
    const p = placeMenu({ anchor: { top: 120, left: 200, right: 250, bottom: 148 }, bounds, menuWidth: 190, menuHeight: 140, prefer: 'up', align: 'end' })
    expect(p.direction).toBe('down')
    expect(p.top).toBe(154)
  })

  it('takes the larger side and caps the height when neither side fits', () => {
    const tight = { top: 0, left: 0, right: 270, bottom: 300 }
    const p = placeMenu({ anchor: { top: 100, left: 20, right: 250, bottom: 130 }, bounds: tight, menuWidth: 230, menuHeight: 400, prefer: 'up', align: 'stretch' })
    expect(p.direction).toBe('down')
    expect(p.maxHeight).toBe(300 - 8 - 136)
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(tight.bottom - 8)
  })

  it('aligns to the trigger end and stays inside the horizontal bounds', () => {
    const p = placeMenu({ anchor: { top: 640, left: 190, right: 256, bottom: 668 }, bounds, menuWidth: 190, menuHeight: 140, prefer: 'up', align: 'end' })
    expect(p.left).toBe(256 - 190)
    const wide = placeMenu({ anchor: { top: 640, left: 10, right: 60, bottom: 668 }, bounds, menuWidth: 400, menuHeight: 140, prefer: 'up', align: 'end' })
    expect(wide.width).toBe(270 - 16)
    expect(wide.left).toBe(8)
    expect(wide.left + wide.width).toBeLessThanOrEqual(bounds.right - 8)
  })

  it('respects the caller height cap', () => {
    const p = placeMenu({ anchor: { top: 200, left: 20, right: 250, bottom: 230 }, bounds, menuWidth: 230, menuHeight: 600, prefer: 'down', align: 'stretch', maxHeight: 180 })
    expect(p.maxHeight).toBe(180)
    expect(p.direction).toBe('down')
  })

  it('intersects the panel with the window', () => {
    expect(intersectBoxes({ top: 0, left: 0, right: 300, bottom: 900 }, { top: -50, left: 10, right: 280, bottom: 1000 })).toEqual({ top: 0, left: 10, right: 280, bottom: 900 })
  })
})
