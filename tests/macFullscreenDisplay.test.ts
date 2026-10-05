import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  options: 0 as number | null,
  frontmostPid: 500,
  windows: [] as Array<{ pid: number; layer: number; bounds: { x: number; y: number; width: number; height: number } }> | null,
  displays: [] as Array<{ id: number; bounds: { x: number; y: number; width: number; height: number } }>,
  onScreenWindows: vi.fn()
}))

vi.mock('koffi', () => import('./helpers/koffiMock'))

vi.mock('electron', () => ({
  systemPreferences: {
    subscribeWorkspaceNotification: () => 1,
    unsubscribeWorkspaceNotification: vi.fn()
  },
  screen: { getAllDisplays: () => mocks.displays }
}))

vi.mock('../electron/main/macNative', () => ({
  frontmostPid: () => mocks.frontmostPid
}))

vi.mock('../electron/main/macPresentation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/main/macPresentation')>()
  return {
    ...actual,
    systemPresentationOptions: () => mocks.options,
    onScreenWindows: () => {
      mocks.onScreenWindows()
      return mocks.windows
    }
  }
})

type FullscreenModule = typeof import('../electron/main/fullscreen')

const FULLSCREEN = 1 << 10
const BUILT_IN = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }
const EXTERNAL = { id: 2, bounds: { x: 1512, y: -98, width: 2560, height: 1440 } }

async function load(platform: string): Promise<FullscreenModule> {
  setPlatform(platform)
  vi.resetModules()
  return import('../electron/main/fullscreen')
}

describe('fullscreenDisplayId', () => {
  it('finds the display covered by a window of the frontmost app', async () => {
    const { fullscreenDisplayId } = await import('../electron/main/macPresentation')
    const windows = [
      { pid: 500, layer: 0, bounds: { ...EXTERNAL.bounds } },
      { pid: 500, layer: 0, bounds: { x: 100, y: 100, width: 800, height: 600 } },
      { pid: 777, layer: 0, bounds: { ...BUILT_IN.bounds } }
    ]
    expect(fullscreenDisplayId(windows, 500, [BUILT_IN, EXTERNAL])).toBe(2)
    expect(fullscreenDisplayId(windows, 777, [BUILT_IN, EXTERNAL])).toBe(1)
  })

  it('accepts a full-screen window that starts below the notch', async () => {
    const { fullscreenDisplayId } = await import('../electron/main/macPresentation')
    const windows = [{ pid: 500, layer: 0, bounds: { x: 0, y: 38, width: 1512, height: 944 } }]
    expect(fullscreenDisplayId(windows, 500, [BUILT_IN, EXTERNAL])).toBe(1)
  })

  it('prefers the exact cover over a maximized window on another display', async () => {
    const { fullscreenDisplayId } = await import('../electron/main/macPresentation')
    const windows = [
      { pid: 500, layer: 0, bounds: { x: 0, y: 38, width: 1512, height: 944 } },
      { pid: 500, layer: 0, bounds: { ...EXTERNAL.bounds } }
    ]
    expect(fullscreenDisplayId(windows, 500, [BUILT_IN, EXTERNAL])).toBe(2)
  })

  it('gives up when the display cannot be told apart', async () => {
    const { fullscreenDisplayId } = await import('../electron/main/macPresentation')
    const both = [
      { pid: 500, layer: 0, bounds: { ...BUILT_IN.bounds } },
      { pid: 500, layer: 0, bounds: { ...EXTERNAL.bounds } }
    ]
    expect(fullscreenDisplayId(both, 500, [BUILT_IN, EXTERNAL])).toBeNull()
    expect(fullscreenDisplayId([], 500, [BUILT_IN, EXTERNAL])).toBeNull()
    expect(fullscreenDisplayId(both, 0, [BUILT_IN, EXTERNAL])).toBeNull()
  })

  it('ignores overlays above the normal window layer and windows that are not full-screen', async () => {
    const { fullscreenDisplayId } = await import('../electron/main/macPresentation')
    const windows = [
      { pid: 500, layer: 25, bounds: { ...BUILT_IN.bounds } },
      { pid: 500, layer: 0, bounds: { x: 0, y: 25, width: 756, height: 957 } },
      { pid: 500, layer: 0, bounds: { x: 0, y: 500, width: 1512, height: 482 } }
    ]
    expect(fullscreenDisplayId(windows, 500, [BUILT_IN, EXTERNAL])).toBeNull()
  })
})

describe('per-display fullscreen suppression (fullscreen.ts)', () => {
  let fs: FullscreenModule

  beforeEach(async () => {
    vi.useFakeTimers()
    mocks.options = 0
    mocks.frontmostPid = 500
    mocks.windows = [{ pid: 500, layer: 0, bounds: { ...EXTERNAL.bounds } }]
    mocks.displays = [BUILT_IN, EXTERNAL]
    mocks.onScreenWindows.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    fs = await load('darwin')
  })

  afterEach(() => {
    fs.stopFullscreenMonitor()
    vi.useRealTimers()
    vi.restoreAllMocks()
    restorePlatform()
  })

  afterAll(() => {
    restorePlatform()
  })

  it('suppresses hover only on the display that shows the full-screen window', () => {
    mocks.options = FULLSCREEN
    fs.triggerFullscreenCheck()

    expect(fs.isFullscreenAppActive(2)).toBe(true)
    expect(fs.isFullscreenAppActive(1)).toBe(false)
  })

  it('stays global for callers that do not name a display', () => {
    mocks.options = FULLSCREEN
    fs.triggerFullscreenCheck()
    expect(fs.isFullscreenAppActive()).toBe(true)
  })

  it('keeps the global behaviour when the display cannot be determined', () => {
    mocks.options = FULLSCREEN
    mocks.windows = null
    fs.triggerFullscreenCheck()
    expect(fs.isFullscreenAppActive(1)).toBe(true)
    expect(fs.isFullscreenAppActive(2)).toBe(true)

    mocks.windows = []
    fs.triggerFullscreenCheck()
    expect(fs.isFullscreenAppActive(1)).toBe(true)
  })

  it('keeps the global behaviour when Edge-Drop itself is frontmost', () => {
    mocks.options = FULLSCREEN
    mocks.frontmostPid = process.pid
    fs.triggerFullscreenCheck()
    expect(fs.isFullscreenAppActive(1)).toBe(true)
  })

  it('does not read the window list with a single display or outside fullscreen', () => {
    fs.triggerFullscreenCheck()
    expect(mocks.onScreenWindows).not.toHaveBeenCalled()
    expect(fs.isFullscreenAppActive(1)).toBe(false)

    mocks.displays = [BUILT_IN]
    mocks.options = FULLSCREEN
    fs.triggerFullscreenCheck()
    expect(mocks.onScreenWindows).not.toHaveBeenCalled()
    expect(fs.isFullscreenAppActive(1)).toBe(true)
  })

  it('tells the listener which display went full-screen', () => {
    const listener = vi.fn()
    fs.registerFullscreenActiveListener(listener)
    mocks.options = FULLSCREEN
    fs.triggerFullscreenCheck()
    expect(listener).toHaveBeenCalledWith(2)

    mocks.windows = null
    fs.triggerFullscreenCheck()
    expect(listener).toHaveBeenLastCalledWith(null)
  })

  it('forgets the display when fullscreen ends', () => {
    mocks.options = FULLSCREEN
    fs.triggerFullscreenCheck()
    mocks.options = 0
    fs.triggerFullscreenCheck()
    expect(fs.isFullscreenAppActive(2)).toBe(false)

    mocks.options = FULLSCREEN
    mocks.windows = null
    fs.triggerFullscreenCheck()
    expect(fs.isFullscreenAppActive(1)).toBe(true)
  })
})
