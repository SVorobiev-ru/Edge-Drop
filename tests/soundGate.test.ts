import { describe, expect, it } from 'vitest'
import { createSoundGate } from '../src/lib/soundEffects'

describe('slider tick throttle', () => {
  it('lets one tick through per interval and drops the rest', () => {
    let now = 1000
    const gate = createSoundGate(45, () => now)
    expect(gate()).toBe(true)
    expect(gate()).toBe(false)
    now += 20
    expect(gate()).toBe(false)
    now += 25
    expect(gate()).toBe(true)
  })

  it('collapses a burst of value changes into a few ticks', () => {
    let now = 0
    const gate = createSoundGate(45, () => now)
    let played = 0
    for (let i = 0; i < 100; i++) {
      if (gate()) played++
      now += 4
    }
    expect(played).toBe(9)
  })

  it('recovers when the clock goes backwards', () => {
    let now = 10_000
    const gate = createSoundGate(45, () => now)
    expect(gate()).toBe(true)
    now = 500
    expect(gate()).toBe(true)
  })
})
