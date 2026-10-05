import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/types'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  windows: [] as Array<Record<string, any>>,
  sent: [] as Array<{ channel: string; payload: any }>,
  screenHandlers: {} as Record<string, () => void>,
  powerHandlers: {} as Record<string, () => void>,
  shortcuts: new Map<string, () => void>(),
  registerResult: true,
  openExternal: vi.fn(),
  cursor: { x: 700, y: 500 },
  displays: [] as Array<Record<string, any>>,
  settings: {} as Record<string, any>,
  fullscreenDisplay: null as number | null,
  fullscreen: false,
  fullscreenListener: null as ((displayId: number | null) => void) | null,
  fullscreenQueries: [] as Array<number | undefined>,
  fullscreenMonitorCalls: [] as string[]
}))

vi.mock('../electron/main/macNative', () => ({
  frontmostPid: () => 0,
  activatePid: () => true,
  weAreFrontmost: () => false
}))

vi.mock('koffi', () => import('./helpers/koffiMock'))

vi.mock('electron', async () => {
  const { electronMock, fakeBrowserWindowClass, fakeEmitter } = await import('./helpers/electronMock')
  return electronMock({
    BrowserWindow: fakeBrowserWindowClass(mocks),
    screen: {
      ...fakeEmitter(() => mocks.screenHandlers),
      getPrimaryDisplay: () => mocks.displays[0],
      getAllDisplays: () => mocks.displays,
      getCursorScreenPoint: () => ({ ...mocks.cursor })
    },
    shell: { openExternal: (...args: unknown[]) => mocks.openExternal(...args) },
    powerMonitor: fakeEmitter(() => mocks.powerHandlers),
    globalShortcut: {
      register: (accelerator: string, fn: () => void) => {
        if (!mocks.registerResult) return false
        mocks.shortcuts.set(accelerator, fn)
        return true
      },
      unregister: (accelerator: string) => {
        mocks.shortcuts.delete(accelerator)
      },
      isRegistered: (accelerator: string) => mocks.shortcuts.has(accelerator)
    }
  })
})

vi.mock('../electron/main/config', () => ({
  APP_CONFIG: { is: { dev: false } },
  runtime: { quitting: false }
}))

vi.mock('../electron/store/paths', async () => (await import('./helpers/pathsMock')).pathsModuleMock({ PATHS: { icon: () => '/mock/icon.png', settingsFile: () => '/mock/userData/settings.json' } }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const existsSync = (p: string) => (p === '/mock/userData/settings.json' ? true : actual.existsSync(p))
  return { ...actual, existsSync, default: { ...actual, existsSync } }
})

vi.mock('../electron/store/settings', async () => (await import('./helpers/settingsMock')).settingsModuleMock(mocks))

vi.mock('../electron/main/fullscreen', () => ({
  isFullscreenAppActive: (displayId?: number) => {
    mocks.fullscreenQueries.push(displayId)
    if (!mocks.fullscreen) return false
    return mocks.fullscreenDisplay === null || displayId === undefined || mocks.fullscreenDisplay === displayId
  },
  registerFullscreenActiveListener: (fn: (displayId: number | null) => void) => {
    mocks.fullscreenListener = fn
  },
  pauseFullscreenMonitor: () => {
    mocks.fullscreenMonitorCalls.push('pause')
  },
  resumeFullscreenMonitor: () => {
    mocks.fullscreenMonitorCalls.push('resume')
  }
}))

type WindowModule = typeof import('../electron/main/window')

const BUILT_IN = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 25, width: 1512, height: 957 },
  scaleFactor: 2
}
const EXTERNAL = {
  id: 2,
  bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
  workArea: { x: 1512, y: 25, width: 1920, height: 1055 },
  scaleFactor: 1
}

let win: WindowModule

async function load(platform: string): Promise<WindowModule> {
  setPlatform(platform)
  vi.resetModules()
  return import('../electron/main/window')
}

function cursorMessages(): any[] {
  return mocks.sent.filter((m) => m.channel === 'window:cursor-edge').map((m) => m.payload)
}

function toggles(): any[] {
  return mocks.sent.filter((m) => m.channel === 'window:toggle').map((m) => m.payload)
}

function moveTo(x: number, y: number, ms = 400): any[] {
  mocks.cursor = { x, y }
  mocks.sent.length = 0
  vi.advanceTimersByTime(ms)
  return cursorMessages()
}

function openExplicitly(): void {
  win.markExplicitOpen()
  win.setInteractive(true)
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.windows.length = 0
  mocks.sent.length = 0
  mocks.screenHandlers = {}
  mocks.powerHandlers = {}
  mocks.shortcuts.clear()
  mocks.registerResult = true
  mocks.openExternal.mockReset()
  mocks.cursor = { x: 700, y: 500 }
  mocks.displays = [BUILT_IN]
  mocks.settings = { ...DEFAULT_SETTINGS }
  mocks.fullscreen = false
  mocks.fullscreenDisplay = null
  mocks.fullscreenListener = null
  mocks.fullscreenQueries = []
  mocks.fullscreenMonitorCalls = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  win?.stopCursorPoll()
  win?.stopHeartbeat()
  vi.useRealTimers()
  vi.restoreAllMocks()
  restorePlatform()
})

afterAll(() => {
  restorePlatform()
})

describe('cursor poll on macOS', () => {
  it('sends nothing while the cursor is far from the edge', async () => {
    win = await load('darwin')
    win.createWindow()
    win.startCursorPoll()

    expect(moveTo(700, 500, 2000)).toEqual([])
    expect(moveTo(400, 300, 2000)).toEqual([])
    expect(moveTo(200, 800, 2000)).toEqual([])
  })

  it('sends nothing for a cursor on a display beyond the edge', async () => {
    win = await load('darwin')
    win.createWindow()
    win.startCursorPoll()

    expect(moveTo(-900, 500, 2000)).toEqual([])
    expect(moveTo(-1200, 300, 2000)).toEqual([])
  })

  it('reports the trigger zone, then one last position after the cursor left it', async () => {
    win = await load('darwin')
    win.createWindow()
    win.startCursorPoll()

    const atEdge = moveTo(1, 500)
    expect(atEdge.length).toBeGreaterThan(0)
    expect(atEdge[atEdge.length - 1].inEdge).toBe(true)

    const away = moveTo(600, 500, 2000)
    expect(away).toHaveLength(1)
    expect(away[0]).toMatchObject({ x: 600, inEdge: false })
  })

  it('polls slowly outside the 120px strip and fast inside it', async () => {
    win = await load('darwin')
    win.createWindow()
    win.startCursorPoll()
    win.setInteractive(true)

    mocks.cursor = { x: 300, y: 500 }
    vi.advanceTimersByTime(3000)
    win.setInteractive(false)
    vi.advanceTimersByTime(3000)

    const spy = vi.spyOn(mocks.windows[0], 'isVisible')
    spy.mockClear()
    vi.advanceTimersByTime(1500)
    expect(spy.mock.calls.length).toBeLessThanOrEqual(21)

    mocks.cursor = { x: 100, y: 500 }
    vi.advanceTimersByTime(200)
    spy.mockClear()
    vi.advanceTimersByTime(1600)
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(90)
  })

  it('does not hold the fast poll after launch', async () => {
    win = await load('darwin')
    win.createWindow()
    win.startCursorPoll()

    const spy = vi.spyOn(mocks.windows[0], 'isVisible')
    vi.advanceTimersByTime(1500)
    expect(spy.mock.calls.length).toBeLessThanOrEqual(21)
  })

  it('keeps the 8 second fast window after launch on Windows', async () => {
    win = await load('win32')
    win.createWindow()
    win.startCursorPoll()

    mocks.cursor = { x: 1400, y: 500 }
    const spy = vi.spyOn(mocks.windows[0], 'isVisible')
    vi.advanceTimersByTime(1600)
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(90)
  })

  it('keeps reporting movement within 450px on Windows', async () => {
    win = await load('win32')
    win.createWindow()
    win.startCursorPoll()

    expect(moveTo(300, 500).length).toBeGreaterThan(0)
    expect(moveTo(310, 520).length).toBeGreaterThan(0)
  })

  it('asks the fullscreen monitor about the display of the panel', async () => {
    win = await load('darwin')
    win.createWindow()
    win.startCursorPoll()
    vi.advanceTimersByTime(200)
    expect(mocks.fullscreenQueries.length).toBeGreaterThan(0)
    expect(new Set(mocks.fullscreenQueries)).toEqual(new Set([1]))
  })
})

describe('screen lock on macOS', () => {
  it('pauses the poll on lock and resumes it on unlock', async () => {
    win = await load('darwin')
    win.createWindow()
    win.startCursorPoll()
    win.registerMacLockScreenHooks()
    expect(Object.keys(mocks.powerHandlers).sort()).toEqual(['lock-screen', 'resume', 'unlock-screen'])

    const spy = vi.spyOn(mocks.windows[0], 'isVisible')
    mocks.powerHandlers['lock-screen']()
    spy.mockClear()
    vi.advanceTimersByTime(5000)
    expect(spy).not.toHaveBeenCalled()

    win.startCursorPoll()
    vi.advanceTimersByTime(1000)
    expect(spy).not.toHaveBeenCalled()

    mocks.powerHandlers['unlock-screen']()
    vi.advanceTimersByTime(1000)
    expect(spy.mock.calls.length).toBeGreaterThan(0)
    expect(mocks.fullscreenMonitorCalls).toEqual(['pause', 'resume'])
  })

  it('registers nothing on Windows', async () => {
    win = await load('win32')
    win.createWindow()
    win.registerMacLockScreenHooks()
    expect(mocks.powerHandlers).toEqual({})
  })

  it('registers the hooks only once', async () => {
    win = await load('darwin')
    win.createWindow()
    const on = vi.fn()
    win.registerMacLockScreenHooks()
    mocks.powerHandlers = new Proxy({}, { set: (_t, key) => { on(key); return true } }) as Record<string, () => void>
    win.registerMacLockScreenHooks()
    expect(on).not.toHaveBeenCalled()
  })
})

describe('Escape capture on macOS', () => {
  it('captures Escape only while an explicitly opened panel is open', async () => {
    win = await load('darwin')
    win.createWindow()
    expect(mocks.shortcuts.has('Escape')).toBe(false)

    openExplicitly()
    expect(mocks.shortcuts.has('Escape')).toBe(true)

    win.setInteractive(false)
    expect(mocks.shortcuts.has('Escape')).toBe(false)
  })

  it('does not capture Escape for a hover open', async () => {
    win = await load('darwin')
    win.createWindow()
    win.setInteractive(true)
    expect(mocks.shortcuts.has('Escape')).toBe(false)
  })

  it('closes the panel and releases the key at once when Escape is pressed', async () => {
    win = await load('darwin')
    win.createWindow()
    openExplicitly()
    mocks.sent.length = 0

    mocks.shortcuts.get('Escape')?.()
    expect(toggles()).toEqual([false])
    expect(mocks.shortcuts.has('Escape')).toBe(false)
  })

  it('hands Escape to the search field while it owns the keyboard and takes it back afterwards', async () => {
    win = await load('darwin')
    win.createWindow()
    openExplicitly()

    win.setWindowFocusable(true)
    expect(mocks.shortcuts.has('Escape')).toBe(false)

    win.setWindowFocusable(false)
    expect(mocks.shortcuts.has('Escape')).toBe(true)

    win.setInteractive(false)
    expect(mocks.shortcuts.has('Escape')).toBe(false)
  })

  it('does not capture Escape when the panel opens with the search field already focused', async () => {
    win = await load('darwin')
    win.createWindow()
    win.setWindowFocusable(true)
    openExplicitly()
    expect(mocks.shortcuts.has('Escape')).toBe(false)
  })

  it('re-registers after the shortcuts were wiped while the panel is open', async () => {
    win = await load('darwin')
    win.createWindow()
    openExplicitly()
    mocks.shortcuts.clear()

    win.syncMacEscapeCapture()
    expect(mocks.shortcuts.has('Escape')).toBe(true)
  })

  it('releases Escape when the screen locks', async () => {
    win = await load('darwin')
    win.createWindow()
    win.registerMacLockScreenHooks()
    openExplicitly()

    mocks.powerHandlers['lock-screen']()
    expect(mocks.shortcuts.has('Escape')).toBe(false)
    mocks.powerHandlers['unlock-screen']()
    expect(mocks.shortcuts.has('Escape')).toBe(true)
  })

  it('survives a refused registration', async () => {
    win = await load('darwin')
    win.createWindow()
    mocks.registerResult = false
    openExplicitly()
    expect(mocks.shortcuts.has('Escape')).toBe(false)
    expect(() => win.setInteractive(false)).not.toThrow()
  })

  it('never registers Escape on Windows', async () => {
    win = await load('win32')
    win.createWindow()
    win.markExplicitOpen()
    win.setInteractive(true)
    win.syncMacEscapeCapture()
    expect(mocks.shortcuts.size).toBe(0)
  })
})

describe('display changes', () => {
  function popUps(): number {
    return toggles().filter((open) => open === true).length
  }

  it('does not pop the panel up on macOS when another display is added', async () => {
    win = await load('darwin')
    win.createWindow()
    mocks.sent.length = 0

    mocks.displays = [BUILT_IN, EXTERNAL]
    mocks.screenHandlers['display-added']()
    vi.advanceTimersByTime(700)
    expect(popUps()).toBe(0)
  })

  it('does not pop the panel up on macOS when a display the panel is not on goes away', async () => {
    mocks.displays = [BUILT_IN, EXTERNAL]
    win = await load('darwin')
    win.createWindow()
    mocks.sent.length = 0

    mocks.displays = [BUILT_IN]
    mocks.screenHandlers['display-removed']()
    vi.advanceTimersByTime(700)
    expect(popUps()).toBe(0)
  })

  it('pops the panel up on macOS when the bounds of its display changed', async () => {
    win = await load('darwin')
    win.createWindow()
    mocks.sent.length = 0

    mocks.displays = [{ ...BUILT_IN, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 25, width: 1728, height: 1092 } }, EXTERNAL]
    mocks.screenHandlers['display-added']()
    vi.advanceTimersByTime(700)
    expect(popUps()).toBe(1)
  })

  it('pops the panel up on macOS when the panel moved to another display', async () => {
    mocks.displays = [BUILT_IN, EXTERNAL]
    mocks.settings = { ...DEFAULT_SETTINGS, stickDisplayId: 2, stickDisplayWorkArea: EXTERNAL.workArea, stickDisplayScaleFactor: 1 }
    win = await load('darwin')
    win.createWindow()
    mocks.sent.length = 0

    mocks.displays = [BUILT_IN]
    mocks.screenHandlers['display-removed']()
    vi.advanceTimersByTime(700)
    mocks.screenHandlers['display-removed']()
    vi.advanceTimersByTime(700)
    expect(popUps()).toBeGreaterThanOrEqual(1)
  })

  it('still pops the panel up on every display change on Windows', async () => {
    win = await load('win32')
    win.createWindow()
    mocks.sent.length = 0

    mocks.displays = [BUILT_IN, EXTERNAL]
    mocks.screenHandlers['display-added']()
    vi.advanceTimersByTime(700)
    expect(popUps()).toBe(1)
  })
})

describe('fullscreen on another display', () => {
  async function hoverOpen(): Promise<void> {
    win = await load('darwin')
    win.createWindow()
    win.setInteractive(true)
    mocks.sent.length = 0
  }

  it('leaves a hover-opened panel alone when the full-screen window is on another display', async () => {
    await hoverOpen()
    mocks.fullscreenListener?.(2)
    expect(toggles()).toEqual([])
    expect(win.isInteractive()).toBe(true)
  })

  it('closes a hover-opened panel when its own display went full-screen', async () => {
    await hoverOpen()
    mocks.fullscreenListener?.(1)
    expect(toggles()).toEqual([false])
    expect(win.isInteractive()).toBe(false)
  })

  it('closes a hover-opened panel when the display is unknown', async () => {
    await hoverOpen()
    mocks.fullscreenListener?.(null)
    expect(toggles()).toEqual([false])
  })
})

describe('links from the panel', () => {
  it('opens only https and mailto links on macOS', async () => {
    win = await load('darwin')
    win.createWindow()
    const open = mocks.windows[0].openHandler

    expect(open({ url: 'https://github.com/SVorobiev-ru/Edge-Drop' })).toEqual({ action: 'deny' })
    expect(open({ url: 'mailto:a@example.com' })).toEqual({ action: 'deny' })
    expect(open({ url: 'file:///Applications/Calculator.app' })).toEqual({ action: 'deny' })
    expect(open({ url: 'http://example.com' })).toEqual({ action: 'deny' })
    expect(mocks.openExternal.mock.calls.map((c) => c[0])).toEqual(['https://github.com/SVorobiev-ru/Edge-Drop', 'mailto:a@example.com'])
  })

  it('blocks navigation of the panel on macOS', async () => {
    win = await load('darwin')
    win.createWindow()
    const event = { preventDefault: vi.fn() }
    mocks.windows[0].contentsHandlers['will-navigate'](event, 'https://example.com/')
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('keeps the Windows behaviour: every link goes to the system, nothing else is hooked', async () => {
    win = await load('win32')
    win.createWindow()
    const open = mocks.windows[0].openHandler

    expect(open({ url: 'ms-windows-store://review/?ProductId=9P3JMHN9M4NR' })).toEqual({ action: 'deny' })
    expect(open({ url: 'http://example.com' })).toEqual({ action: 'deny' })
    expect(mocks.openExternal).toHaveBeenCalledTimes(2)
    expect(mocks.windows[0].contentsHandlers['will-navigate']).toBeUndefined()
  })
})
