export type MouseReleaseResult = 'released' | 'timeout'

export interface MouseReleaseOptions {
  intervalMs?: number
  maxWaitMs?: number
}

export const MOUSE_RELEASE_POLL_MS = 20
export const MOUSE_RELEASE_MAX_WAIT_MS = 5 * 60 * 1000

export function waitForMouseRelease(
  pressedButtons: () => number,
  options: MouseReleaseOptions = {}
): Promise<MouseReleaseResult> {
  const intervalMs = Math.max(1, options.intervalMs ?? MOUSE_RELEASE_POLL_MS)
  const maxWaitMs = options.maxWaitMs ?? MOUSE_RELEASE_MAX_WAIT_MS
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const poll = (): void => {
      let pressed = 0
      try {
        pressed = pressedButtons()
      } catch {
        pressed = 0
      }
      if (!pressed) {
        resolve('released')
        return
      }
      if (Date.now() - startedAt >= maxWaitMs) {
        resolve('timeout')
        return
      }
      setTimeout(poll, intervalMs)
    }
    setTimeout(poll, intervalMs)
  })
}
