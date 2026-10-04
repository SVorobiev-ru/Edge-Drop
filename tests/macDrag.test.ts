import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOUSE_RELEASE_MAX_WAIT_MS, MOUSE_RELEASE_POLL_MS, waitForMouseRelease } from '../electron/main/macDrag'

describe('waitForMouseRelease', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function track<T>(promise: Promise<T>): { value: T | null } {
    const box: { value: T | null } = { value: null }
    void promise.then((v) => {
      box.value = v
    })
    return box
  }

  it('stays pending while a button is held and resolves on the first poll after release', async () => {
    let pressed = 1
    const poll = vi.fn(() => pressed)
    const result = track(waitForMouseRelease(poll, { intervalMs: 20, maxWaitMs: 10_000 }))

    await vi.advanceTimersByTimeAsync(200)
    expect(result.value).toBeNull()
    expect(poll).toHaveBeenCalledTimes(10)

    pressed = 0
    await vi.advanceTimersByTimeAsync(19)
    expect(result.value).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(result.value).toBe('released')
    expect(poll).toHaveBeenCalledTimes(11)
  })

  it('never polls synchronously and resolves after one interval when nothing is pressed', async () => {
    const poll = vi.fn(() => 0)
    const result = track(waitForMouseRelease(poll, { intervalMs: 16 }))

    expect(poll).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15)
    expect(result.value).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(result.value).toBe('released')
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('stops polling once resolved', async () => {
    const poll = vi.fn(() => 0)
    const result = track(waitForMouseRelease(poll, { intervalMs: 20 }))
    await vi.advanceTimersByTimeAsync(20)
    expect(result.value).toBe('released')
    await vi.advanceTimersByTimeAsync(1000)
    expect(poll).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('gives up with "timeout" at the safety ceiling when the button never releases', async () => {
    const poll = vi.fn(() => 1)
    const result = track(waitForMouseRelease(poll, { intervalMs: 20, maxWaitMs: 100 }))

    await vi.advanceTimersByTimeAsync(99)
    expect(result.value).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(result.value).toBe('timeout')
    expect(poll).toHaveBeenCalledTimes(5)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('measures the ceiling by the clock, not by the number of polls', async () => {
    const poll = vi.fn(() => 1)
    const result = track(waitForMouseRelease(poll, { intervalMs: 20, maxWaitMs: 10_000 }))

    await vi.advanceTimersByTimeAsync(20)
    expect(result.value).toBeNull()
    vi.setSystemTime(Date.now() + 10_000)
    await vi.advanceTimersByTimeAsync(20)

    expect(result.value).toBe('timeout')
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('treats a throwing poll as released', async () => {
    const result = track(
      waitForMouseRelease(() => {
        throw new Error('objc failure')
      }, { intervalMs: 20 })
    )
    await vi.advanceTimersByTimeAsync(20)
    expect(result.value).toBe('released')
  })

  it('uses a 16-25ms poll and a multi-minute ceiling by default', async () => {
    expect(MOUSE_RELEASE_POLL_MS).toBeGreaterThanOrEqual(16)
    expect(MOUSE_RELEASE_POLL_MS).toBeLessThanOrEqual(25)
    expect(MOUSE_RELEASE_MAX_WAIT_MS).toBeGreaterThanOrEqual(2 * 60 * 1000)

    const result = track(waitForMouseRelease(() => 1))
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_MAX_WAIT_MS - MOUSE_RELEASE_POLL_MS)
    expect(result.value).toBeNull()
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_POLL_MS)
    expect(result.value).toBe('timeout')
  })
})
