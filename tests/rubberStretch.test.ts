import { describe, expect, it } from 'vitest'
import { MAX_STRETCH_SLOTS, stretchedEdges } from '../src/lib/rubberStretch'

const slot = (i: number) => ({ l: i * 24, r: i * 24 + 24 })

describe('rubber segment stretch', () => {
  it('keeps short jumps as before', () => {
    expect(stretchedEdges(slot(0), slot(1), 80)).toEqual({ l: 24 - 24 * 0.8, r: 48 })
    expect(stretchedEdges(slot(3), slot(1), 80)).toEqual({ l: 24, r: 48 + 48 * 0.8 })
  })

  it('caps the trail of a long jump at two slot widths', () => {
    const right = stretchedEdges(slot(0), slot(6), 80)
    expect(right).toEqual({ l: 144 - 24 * MAX_STRETCH_SLOTS, r: 168 })
    expect(right.r - right.l).toBe(24 * 3)
    const left = stretchedEdges(slot(6), slot(0), 80)
    expect(left.r - left.l).toBe(24 * 3)
  })

  it('does not stretch without travel or with stretch off', () => {
    expect(stretchedEdges(slot(2), slot(2), 80)).toEqual(slot(2))
    expect(stretchedEdges(slot(0), slot(5), 0)).toEqual(slot(5))
  })
})
