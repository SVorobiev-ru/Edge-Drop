import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/types'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  windows: [] as Array<Record<string, any>>,
  extraWindows: [] as Array<Record<string, any>>,
  sent: [] as Array<{ channel: string; payload: any }>,
  screenHandlers: {} as Record<string, () => void>,
  cursor: { x: 700, y: 500 },
  display: {
    id: 1,
    bounds: { x: 0, y: 0, width: 1512, height: 982 },
    workArea: { x: 0, y: 25, width: 1512, height: 957 },
    scaleFactor: 2
  },
  settings: {} as Record<string, any>,
  saveSettings: vi.fn(),
  settingsFileExists: true,
  fullscreen: false,
  fullscreenListener: null as (() => void) | null,
  readDockOrientation: vi.fn()
}))

vi.mock('../electron/main/macNative', () => ({
  frontmostPid: () => 0,
  activatePid: () => true,
  weAreFrontmost: () => false
}))

vi.mock('koffi', () => import('./helpers/koffiMock'))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const existsSync = (p: string) => (p === '/mock/userData/settings.json' ? mocks.settingsFileExists : actual.existsSync(p))
  return { ...actual, existsSync, default: { ...actual, existsSync } }
})

vi.mock('electron', async () => {
  const { electronMock, fakeBrowserWindowClass, fakeEmitter } = await import('./helpers/electronMock')
  return electronMock({
    BrowserWindow: fakeBrowserWindowClass(mocks),
    screen: {
      ...fakeEmitter(() => mocks.screenHandlers),
      getPrimaryDisplay: () => mocks.display,
      getAllDisplays: () => [mocks.display],
      getCursorScreenPoint: () => ({ ...mocks.cursor })
    }
  })
})

vi.mock('../electron/main/config', () => ({
  APP_CONFIG: { is: { dev: false } },
  runtime: { quitting: false }
}))

vi.mock('../electron/store/paths', async () => (await import('./helpers/pathsMock')).pathsModuleMock({ PATHS: { icon: () => '/mock/icon.png', settingsFile: () => '/mock/userData/settings.json' } }))
vi.mock('../electron/store/settings', async () => (await import('./helpers/settingsMock')).settingsModuleMock(mocks))

vi.mock('../electron/main/fullscreen', () => ({
  isFullscreenAppActive: () => mocks.fullscreen,
  registerFullscreenActiveListener: (fn: () => void) => {
    mocks.fullscreenListener = fn
  }
}))

vi.mock('../electron/main/macScreen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/main/macScreen')>()
  return { ...actual, readDockOrientation: () => mocks.readDockOrientation() }
})

type WindowModule = typeof import('../electron/main/window')

let win: WindowModule

async function loadWindowModule(platform: string): Promise<WindowModule> {
  setPlatform(platform)
  vi.resetModules()
  return import('../electron/main/window')
}

function levelCalls(w: Record<string, any>): string[] {
  return w.setAlwaysOnTop.mock.calls.map((c: unknown[]) => String(c[1]))
}

function cursorEdgeMessages(): any[] {
  return mocks.sent.filter((m) => m.channel === 'window:cursor-edge').map((m) => m.payload)
}

function pollAt(x: number, y: number, frames = 6): any {
  mocks.cursor = { x, y }
  mocks.sent.length = 0
  vi.advanceTimersByTime(16 * frames)
  const messages = cursorEdgeMessages()
  return messages[messages.length - 1]
}

describe('macOS window behaviour (window.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.windows.length = 0
    mocks.extraWindows.length = 0
    mocks.sent.length = 0
    mocks.screenHandlers = {}
    mocks.cursor = { x: 700, y: 500 }
    mocks.display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1512, height: 982 },
      workArea: { x: 0, y: 25, width: 1512, height: 957 },
      scaleFactor: 2
    }
    mocks.settings = { ...DEFAULT_SETTINGS }
    mocks.saveSettings.mockReset()
    mocks.settingsFileExists = true
    mocks.fullscreen = false
    mocks.fullscreenListener = null
    mocks.readDockOrientation.mockReset()
    mocks.readDockOrientation.mockResolvedValue('bottom')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
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

  describe('always-on-top heartbeat', () => {
    it('does not run on macOS', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      const w = mocks.windows[0]
      w.setAlwaysOnTop.mockClear()
      vi.advanceTimersByTime(10000)
      expect(w.setAlwaysOnTop).not.toHaveBeenCalled()
    })

    it('still re-asserts the level every 2s on Windows', async () => {
      win = await loadWindowModule('win32')
      win.createWindow()
      const w = mocks.windows[0]
      w.setAlwaysOnTop.mockClear()
      vi.advanceTimersByTime(6000)
      expect(levelCalls(w)).toEqual(['screen-saver', 'screen-saver', 'screen-saver'])
    })
  })

  describe('setHeartbeatPaused', () => {
    it('leaves the window level alone on macOS', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      const w = mocks.windows[0]
      w.setAlwaysOnTop.mockClear()
      win.setHeartbeatPaused(true)
      win.setHeartbeatPaused(false)
      expect(w.setAlwaysOnTop).not.toHaveBeenCalled()
    })

    it('lowers and restores the level on Windows', async () => {
      win = await loadWindowModule('win32')
      win.createWindow()
      const w = mocks.windows[0]
      w.setAlwaysOnTop.mockClear()
      win.setHeartbeatPaused(true)
      win.setHeartbeatPaused(false)
      expect(levelCalls(w)).toEqual(['normal', 'screen-saver'])
    })
  })

  describe('window creation', () => {
    it('creates a panel visible on every Space including fullscreen ones on macOS', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      const w = mocks.windows[0]
      expect(w.options.type).toBe('panel')
      expect(w.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, expect.objectContaining({ visibleOnFullScreen: true }))
    })

    it('places the top panel below the menu bar', async () => {
      mocks.settings = { ...DEFAULT_SETTINGS, stickPosition: 'top' }
      win = await loadWindowModule('darwin')
      win.createWindow()
      expect(mocks.windows[0].options.y).toBe(25)
    })
  })

  describe('first-run stick position', () => {
    it('moves the panel to the right when the Dock is on the left', async () => {
      mocks.settingsFileExists = false
      mocks.readDockOrientation.mockResolvedValue('left')
      win = await loadWindowModule('darwin')
      win.createWindow()
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.saveSettings).toHaveBeenCalledWith({ stickPosition: 'right' })
      const bounds = mocks.windows[0].setBounds.mock.calls.at(-1)[0]
      expect(bounds.x + bounds.width).toBe(1512)
    })

    it.each(['right', 'bottom'] as const)('saves and sends nothing when the Dock is on the %s', async (orientation) => {
      mocks.settingsFileExists = false
      mocks.readDockOrientation.mockResolvedValue(orientation)
      win = await loadWindowModule('darwin')
      win.createWindow()
      mocks.windows[0].setBounds.mockClear()
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.readDockOrientation).toHaveBeenCalledTimes(1)
      expect(mocks.saveSettings).not.toHaveBeenCalled()
      expect(mocks.windows[0].setBounds).not.toHaveBeenCalled()
      expect(mocks.sent.filter((m) => m.channel === 'state:settings')).toEqual([])
    })

    it('keeps a position the user picked while the Dock orientation was being read', async () => {
      mocks.settingsFileExists = false
      let resolveOrientation: (value: string) => void = () => {}
      mocks.readDockOrientation.mockReturnValue(new Promise((resolve) => {
        resolveOrientation = resolve
      }))
      win = await loadWindowModule('darwin')
      win.createWindow()
      mocks.settings = { ...mocks.settings, stickPosition: 'top' }
      mocks.windows[0].setBounds.mockClear()
      resolveOrientation('left')
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.saveSettings).not.toHaveBeenCalled()
      expect(mocks.settings.stickPosition).toBe('top')
      expect(mocks.windows[0].setBounds).not.toHaveBeenCalled()
      expect(mocks.sent.filter((m) => m.channel === 'state:settings')).toEqual([])
    })

    it('saves nothing when the Dock orientation cannot be read', async () => {
      mocks.settingsFileExists = false
      mocks.readDockOrientation.mockResolvedValue(null)
      win = await loadWindowModule('darwin')
      win.createWindow()
      mocks.windows[0].setBounds.mockClear()
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.saveSettings).not.toHaveBeenCalled()
      expect(mocks.windows[0].setBounds).not.toHaveBeenCalled()
      expect(mocks.sent.filter((m) => m.channel === 'state:settings')).toEqual([])
    })

    it('sends the chosen position to every open window, not only the panel', async () => {
      mocks.settingsFileExists = false
      mocks.readDockOrientation.mockResolvedValue('left')
      const onboardingSend = vi.fn()
      mocks.extraWindows.push({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: onboardingSend } })
      mocks.extraWindows.push({ isDestroyed: () => true, webContents: { isDestroyed: () => true, send: vi.fn() } })
      win = await loadWindowModule('darwin')
      win.createWindow()
      await vi.advanceTimersByTimeAsync(0)
      expect(onboardingSend).toHaveBeenCalledTimes(1)
      expect(onboardingSend).toHaveBeenCalledWith('state:settings', expect.objectContaining({ stickPosition: 'right' }))
      expect(mocks.sent).toContainEqual({ channel: 'state:settings', payload: expect.objectContaining({ stickPosition: 'right' }) })
      expect(mocks.extraWindows[1].webContents.send).not.toHaveBeenCalled()
    })

    it('never touches the position of an existing user', async () => {
      mocks.settingsFileExists = true
      mocks.readDockOrientation.mockResolvedValue('left')
      win = await loadWindowModule('darwin')
      win.createWindow()
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.readDockOrientation).not.toHaveBeenCalled()
      expect(mocks.saveSettings).not.toHaveBeenCalled()
    })

    it('does nothing on Windows even without a settings file', async () => {
      mocks.settingsFileExists = false
      win = await loadWindowModule('win32')
      win.createWindow()
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.readDockOrientation).not.toHaveBeenCalled()
      expect(mocks.saveSettings).not.toHaveBeenCalled()
    })
  })

  describe('display changes', () => {
    it.each(['darwin', 'win32'])('does not read the Dock on %s', async (platform) => {
      win = await loadWindowModule(platform)
      win.createWindow()
      mocks.screenHandlers['display-metrics-changed']()
      vi.advanceTimersByTime(600)
      expect(mocks.readDockOrientation).not.toHaveBeenCalled()
    })

    it('follows the panel to the new work area when the Dock becomes visible on its side', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      mocks.display = { ...mocks.display, workArea: { x: 70, y: 25, width: 1442, height: 957 } }
      mocks.screenHandlers['display-metrics-changed']()
      vi.advanceTimersByTime(600)
      expect(mocks.windows[0].setBounds.mock.calls.at(-1)[0].x).toBe(70)
    })
  })

  describe('cursor poll', () => {
    it('top on macOS: reports the physical top as the edge and the work-area top as away from it', async () => {
      mocks.settings = { ...DEFAULT_SETTINGS, stickPosition: 'top' }
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()

      expect(pollAt(700, 300)).toBeUndefined()
      const atTop = pollAt(700, 0, 12)
      expect(atTop.y).toBe(0)
      expect(atTop.inEdge).toBe(true)
      expect(pollAt(700, 26).y).toBe(26)
    })

    it('top on macOS: an open panel keeps window-relative coordinates and survives the menu bar', async () => {
      mocks.settings = { ...DEFAULT_SETTINGS, stickPosition: 'top' }
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()
      win.setInteractive(true)

      expect(pollAt(700, 125).y).toBe(100)
      const inMenuBar = pollAt(700, 12)
      expect(inMenuBar.y).toBeGreaterThanOrEqual(-30)
      expect(inMenuBar.y).toBeLessThanOrEqual(218)
      expect(inMenuBar.y).toBeGreaterThan(3)
    })

    it('top on Windows: stays relative to the work area', async () => {
      mocks.settings = { ...DEFAULT_SETTINGS, stickPosition: 'top' }
      win = await loadWindowModule('win32')
      win.createWindow()
      win.startCursorPoll()

      expect(pollAt(700, 300).y).toBe(275)
      expect(pollAt(700, 26).y).toBe(1)
      expect(pollAt(700, 0).y).toBe(-25)
    })

    it('left next to a visible Dock on macOS: only a rest in the band reports the edge', async () => {
      mocks.display = { ...mocks.display, workArea: { x: 70, y: 25, width: 1442, height: 957 } }
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()

      expect(pollAt(300, 500)).toBeUndefined()
      const resting = pollAt(78, 500, 12)
      expect(resting.inEdge).toBe(true)
      expect(resting.x).toBeLessThanOrEqual(3)
      expect(pollAt(50, 500).x).toBeGreaterThan(3)
    })

    it('left next to a taskbar-like inset on Windows: passes raw coordinates', async () => {
      mocks.display = { ...mocks.display, workArea: { x: 70, y: 25, width: 1442, height: 957 } }
      win = await loadWindowModule('win32')
      win.createWindow()
      win.startCursorPoll()

      expect(pollAt(78, 500).x).toBe(8)
      expect(pollAt(50, 500).x).toBe(-20)
    })

    it('stays silent while a fullscreen Space is active and resumes afterwards', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()

      mocks.fullscreen = true
      expect(pollAt(0, 500)).toBeUndefined()

      mocks.fullscreen = false
      const back = pollAt(0, 480)
      expect(back.x).toBe(0)
    })

    it('keeps tracking the cursor for a panel opened in a fullscreen Space on macOS', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()
      mocks.fullscreen = true
      expect(pollAt(0, 500)).toBeUndefined()

      win.setInteractive(true)
      expect(pollAt(200, 500).x).toBe(200)

      win.setInteractive(false)
      expect(pollAt(0, 480)).toBeUndefined()
    })

    it('stays silent in fullscreen on Windows even for an open panel', async () => {
      win = await loadWindowModule('win32')
      win.createWindow()
      win.startCursorPoll()
      mocks.fullscreen = true
      win.setInteractive(true)
      expect(pollAt(200, 500)).toBeUndefined()
    })

    it('polls through fullscreen when suppression is turned off', async () => {
      mocks.settings = { ...DEFAULT_SETTINGS, suppressInFullscreen: false }
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()
      mocks.fullscreen = true
      expect(pollAt(0, 500).x).toBe(0)
    })
  })

  describe('fullscreen listener', () => {
    function toggles(): any[] {
      return mocks.sent.filter((m) => m.channel === 'window:toggle')
    }

    it('collapses a panel opened by hovering the edge when a fullscreen Space becomes active', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()
      expect(pollAt(0, 500).inEdge).toBe(true)
      win.setInteractive(true)
      mocks.sent.length = 0
      mocks.fullscreen = true
      mocks.fullscreenListener?.()
      expect(mocks.sent).toContainEqual({ channel: 'window:toggle', payload: false })
      expect(win.isInteractive()).toBe(false)
    })

    it('leaves a panel opened by hotkey or menu bar icon alone on macOS', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()
      pollAt(700, 500)
      mocks.fullscreen = true
      win.markExplicitOpen()
      win.setInteractive(true)
      mocks.sent.length = 0
      mocks.fullscreenListener?.()
      mocks.fullscreenListener?.()
      expect(toggles()).toEqual([])
      expect(win.isInteractive()).toBe(true)
    })

    it('keeps an explicitly opened panel when the user moves to a fullscreen Space', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()
      pollAt(700, 500)
      win.markExplicitOpen()
      win.setInteractive(true)
      mocks.fullscreen = true
      mocks.sent.length = 0
      mocks.fullscreenListener?.()
      expect(toggles()).toEqual([])
      expect(win.isInteractive()).toBe(true)
    })

    it('keeps a panel opened by hotkey 100 ms after the cursor touched the edge in a fullscreen Space', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()
      mocks.fullscreen = true
      mocks.settings = { ...DEFAULT_SETTINGS, suppressInFullscreen: false }
      expect(pollAt(0, 500).inEdge).toBe(true)
      mocks.settings = { ...DEFAULT_SETTINGS }
      vi.advanceTimersByTime(100)
      win.markExplicitOpen()
      win.setInteractive(true)
      mocks.sent.length = 0
      mocks.fullscreenListener?.()
      expect(toggles()).toEqual([])
      expect(win.isInteractive()).toBe(true)
    })

    it('applies the explicit mark when the panel opens within a second', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.markExplicitOpen()
      vi.advanceTimersByTime(900)
      win.setInteractive(true)
      mocks.sent.length = 0
      mocks.fullscreen = true
      mocks.fullscreenListener?.()
      expect(toggles()).toEqual([])
      expect(win.isInteractive()).toBe(true)
    })

    it('drops an explicit mark the renderer did not use within a second, so a later hover open stays a hover open', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.markExplicitOpen()
      vi.advanceTimersByTime(1100)
      win.setInteractive(true)
      mocks.sent.length = 0
      mocks.fullscreen = true
      mocks.fullscreenListener?.()
      expect(toggles()).toEqual([{ channel: 'window:toggle', payload: false }])
      expect(win.isInteractive()).toBe(false)
    })

    it('treats an open without the explicit mark as a hover open however long the cursor rested at the edge', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()
      expect(pollAt(0, 500).inEdge).toBe(true)
      vi.advanceTimersByTime(600)
      win.setInteractive(true)
      mocks.sent.length = 0
      mocks.fullscreenListener?.()
      expect(toggles()).toEqual([{ channel: 'window:toggle', payload: false }])
      expect(win.isInteractive()).toBe(false)
    })

    it('ignores the explicit mark while the panel is already open, since the toggle closes it', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()
      expect(pollAt(0, 500).inEdge).toBe(true)
      win.setInteractive(true)
      win.markExplicitOpen()
      win.setInteractive(false)
      win.setInteractive(true)
      mocks.sent.length = 0
      mocks.fullscreenListener?.()
      expect(toggles()).toEqual([{ channel: 'window:toggle', payload: false }])
    })

    it('does not send a close to a panel that is not open on macOS', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      mocks.sent.length = 0
      mocks.fullscreenListener?.()
      expect(toggles()).toEqual([])
    })

    it('forgets the explicit open once the panel closes', async () => {
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()
      pollAt(700, 500)
      win.markExplicitOpen()
      win.setInteractive(true)
      win.setInteractive(false)
      expect(pollAt(0, 500).inEdge).toBe(true)
      win.setInteractive(true)
      mocks.sent.length = 0
      mocks.fullscreenListener?.()
      expect(toggles()).toEqual([{ channel: 'window:toggle', payload: false }])
    })

    it('does nothing when hover activation or suppression is off', async () => {
      mocks.settings = { ...DEFAULT_SETTINGS, hoverActivation: false }
      win = await loadWindowModule('darwin')
      win.createWindow()
      win.startCursorPoll()
      expect(pollAt(0, 500).inEdge).toBe(true)
      win.setInteractive(true)
      mocks.sent.length = 0
      mocks.fullscreenListener?.()
      expect(toggles()).toEqual([])
      expect(win.isInteractive()).toBe(true)
    })

    it('on Windows still closes whatever is open, however it was opened', async () => {
      win = await loadWindowModule('win32')
      win.createWindow()
      win.startCursorPoll()
      pollAt(700, 500)
      win.markExplicitOpen()
      win.setInteractive(true)
      mocks.sent.length = 0
      mocks.fullscreenListener?.()
      expect(toggles()).toEqual([{ channel: 'window:toggle', payload: false }])
      expect(win.isInteractive()).toBe(false)

      mocks.sent.length = 0
      mocks.fullscreenListener?.()
      expect(toggles()).toEqual([{ channel: 'window:toggle', payload: false }])
    })
  })
})
