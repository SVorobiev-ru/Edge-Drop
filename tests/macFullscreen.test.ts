import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  options: vi.fn<() => number | null>(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  spaceCallback: null as (() => void) | null
}))

vi.mock('koffi', () => ({
  default: { load: () => ({ func: () => () => null }) }
}))

vi.mock('electron', () => ({
  systemPreferences: {
    subscribeWorkspaceNotification: (name: string, cb: () => void) => {
      mocks.subscribe(name)
      mocks.spaceCallback = cb
      return 7
    },
    unsubscribeWorkspaceNotification: (id: number) => mocks.unsubscribe(id)
  }
}))

vi.mock('../electron/main/macPresentation', () => ({
  NS_PRESENTATION_FULLSCREEN: 1 << 10,
  systemPresentationOptions: () => mocks.options(),
  isFullscreenPresentation: (options: number) => (options & (1 << 10)) !== 0
}))

type FullscreenModule = typeof import('../electron/main/fullscreen')

const realPlatform = process.platform
const FULLSCREEN = 1 << 10
const AUTO_HIDE_DOCK = 1 << 0
const AUTO_HIDE_MENU_BAR = 1 << 2

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

let fs: FullscreenModule

async function load(platform: string): Promise<FullscreenModule> {
  setPlatform(platform)
  vi.resetModules()
  return import('../electron/main/fullscreen')
}

describe('macOS fullscreen detection (fullscreen.ts)', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    mocks.options.mockReset()
    mocks.options.mockReturnValue(0)
    mocks.subscribe.mockReset()
    mocks.unsubscribe.mockReset()
    mocks.spaceCallback = null
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    fs = await load('darwin')
  })

  afterEach(() => {
    fs.stopFullscreenMonitor()
    vi.useRealTimers()
    vi.restoreAllMocks()
    setPlatform(realPlatform)
  })

  afterAll(() => {
    setPlatform(realPlatform)
  })

  it('reports no fullscreen on a normal desktop Space', () => {
    const listener = vi.fn()
    fs.registerFullscreenActiveListener(listener)
    fs.triggerFullscreenCheck()
    expect(fs.isFullscreenAppActive()).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('detects a fullscreen Space and notifies the listener', () => {
    const listener = vi.fn()
    fs.registerFullscreenActiveListener(listener)
    mocks.options.mockReturnValue(FULLSCREEN | AUTO_HIDE_DOCK | AUTO_HIDE_MENU_BAR)
    fs.triggerFullscreenCheck()
    expect(fs.isFullscreenAppActive()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not treat auto-hide flags alone as fullscreen', () => {
    mocks.options.mockReturnValue(AUTO_HIDE_DOCK | AUTO_HIDE_MENU_BAR)
    fs.triggerFullscreenCheck()
    expect(fs.isFullscreenAppActive()).toBe(false)
  })

  it('clears the cache after leaving the fullscreen Space', () => {
    mocks.options.mockReturnValue(FULLSCREEN)
    fs.triggerFullscreenCheck()
    expect(fs.isFullscreenAppActive()).toBe(true)
    mocks.options.mockReturnValue(0)
    fs.triggerFullscreenCheck()
    expect(fs.isFullscreenAppActive()).toBe(false)
  })

  it('keeps the previous verdict when the native call is unavailable', () => {
    mocks.options.mockReturnValue(FULLSCREEN)
    fs.triggerFullscreenCheck()
    mocks.options.mockReturnValue(null)
    fs.triggerFullscreenCheck()
    expect(fs.isFullscreenAppActive()).toBe(true)
  })

  it('seeds the cache and polls periodically once the monitor starts', () => {
    const listener = vi.fn()
    fs.registerFullscreenActiveListener(listener)
    fs.startFullscreenMonitor()
    expect(mocks.options).toHaveBeenCalledTimes(1)
    expect(fs.isFullscreenAppActive()).toBe(false)

    mocks.options.mockReturnValue(FULLSCREEN)
    vi.advanceTimersByTime(800)
    expect(fs.isFullscreenAppActive()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    mocks.options.mockReturnValue(0)
    vi.advanceTimersByTime(800)
    expect(fs.isFullscreenAppActive()).toBe(false)
  })

  it('checks immediately and once more shortly after a Space change', () => {
    fs.startFullscreenMonitor()
    expect(mocks.subscribe).toHaveBeenCalledWith('NSWorkspaceActiveSpaceDidChangeNotification')
    expect(mocks.spaceCallback).not.toBeNull()

    mocks.options.mockReturnValue(0)
    mocks.spaceCallback?.()
    expect(fs.isFullscreenAppActive()).toBe(false)

    mocks.options.mockReturnValue(FULLSCREEN)
    vi.advanceTimersByTime(300)
    expect(fs.isFullscreenAppActive()).toBe(true)
  })

  it('starting twice subscribes and polls once', () => {
    fs.startFullscreenMonitor()
    fs.startFullscreenMonitor()
    expect(mocks.subscribe).toHaveBeenCalledTimes(1)
    mocks.options.mockClear()
    vi.advanceTimersByTime(800)
    expect(mocks.options).toHaveBeenCalledTimes(1)
  })

  it('stop unsubscribes, stops polling and clears the cache', () => {
    mocks.options.mockReturnValue(FULLSCREEN)
    fs.startFullscreenMonitor()
    expect(fs.isFullscreenAppActive()).toBe(true)

    fs.stopFullscreenMonitor()
    expect(mocks.unsubscribe).toHaveBeenCalledWith(7)
    expect(fs.isFullscreenAppActive()).toBe(false)

    mocks.options.mockClear()
    vi.advanceTimersByTime(5000)
    expect(mocks.options).not.toHaveBeenCalled()
  })

  it('stays a no-op on platforms without a detector', async () => {
    fs = await load('linux')
    mocks.options.mockReturnValue(FULLSCREEN)
    fs.startFullscreenMonitor()
    fs.triggerFullscreenCheck()
    vi.advanceTimersByTime(5000)
    expect(fs.isFullscreenAppActive()).toBe(false)
    expect(mocks.subscribe).not.toHaveBeenCalled()
  })

  it('never consults the macOS detector on Windows', async () => {
    fs = await load('win32')
    mocks.options.mockClear()
    mocks.options.mockReturnValue(FULLSCREEN)
    fs.startFullscreenMonitor()
    vi.advanceTimersByTime(1600)
    expect(mocks.options).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()
  })
})
