import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

type Handler = (...args: unknown[]) => void

interface FakeWindow {
  handlers: Record<string, Handler>
  calls: string[]
  loadURL: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  setAlwaysOnTop: (v: boolean) => void
  show: () => void
  focus: () => void
  close: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  once: (event: string, fn: Handler) => void
  on: (event: string, fn: Handler) => void
  webContents: {
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    getURL: () => string
  }
}

const mocks = vi.hoisted(() => ({
  windows: [] as FakeWindow[],
  calls: [] as string[],
  setApplicationMenu: vi.fn(),
  getLoginItemSettings: vi.fn(),
  uptime: vi.fn(),
  isPackaged: true
}))

vi.mock('electron', () => ({
  app: {
    name: 'Edge-Drop',
    get isPackaged() {
      return mocks.isPackaged
    },
    focus: (opts: unknown) => {
      mocks.calls.push(`app.focus:${JSON.stringify(opts)}`)
    },
    getAppPath: () => '/Applications/Edge-Drop.app/Contents/Resources/app.asar',
    getPath: () => '/Applications/Edge-Drop.app/Contents/MacOS/Edge-Drop',
    getLoginItemSettings: (...args: unknown[]) => mocks.getLoginItemSettings(...args)
  },
  Menu: {
    buildFromTemplate: (template: unknown) => ({ template }),
    setApplicationMenu: (...args: unknown[]) => mocks.setApplicationMenu(...args)
  },
  BrowserWindow: vi.fn().mockImplementation(function () {
    const win: FakeWindow = {
      handlers: {},
      calls: mocks.calls,
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      setAlwaysOnTop: (v) => {
        mocks.calls.push(`setAlwaysOnTop:${v}`)
      },
      show: () => {
        mocks.calls.push('show')
      },
      focus: () => {
        mocks.calls.push('win.focus')
      },
      close: vi.fn(),
      isDestroyed: () => false,
      once: (event, fn) => {
        win.handlers[event] = fn
      },
      on: (event, fn) => {
        win.handlers[event] = fn
      },
      webContents: {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
        getURL: () => 'file:///Applications/Edge-Drop.app/Contents/Resources/app.asar/out/renderer/index.html#onboarding'
      }
    }
    mocks.windows.push(win)
    return win
  })
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, uptime: () => mocks.uptime() }
})

vi.mock('../electron/main/state', () => ({
  loadSettings: () => ({ tutorialCompleted: true }),
  saveSettings: (patch: Record<string, unknown>) => patch,
  pushState: { settings: vi.fn() }
}))

const realArgv = process.argv

beforeEach(() => {
  mocks.windows.length = 0
  mocks.calls.length = 0
  mocks.isPackaged = true
  mocks.setApplicationMenu.mockReset()
  mocks.getLoginItemSettings.mockReset()
  mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false, wasOpenedAtLogin: false })
  mocks.uptime.mockReset()
  mocks.uptime.mockReturnValue(86_400)
  delete process.env.APP_BUILD_TARGET
  process.argv = ['/Applications/Edge-Drop.app/Contents/MacOS/Edge-Drop']
})

afterEach(() => {
  process.argv = realArgv
  restorePlatform()
  vi.resetModules()
})

afterAll(() => {
  restorePlatform()
})

describe('application menu', () => {
  it('installs a minimal menu with editing shortcuts on macOS', async () => {
    setPlatform('darwin')
    const { installMacAppMenu } = await import('../electron/main/macAppMenu')
    installMacAppMenu()
    expect(mocks.setApplicationMenu).toHaveBeenCalledTimes(1)
    const { template } = mocks.setApplicationMenu.mock.calls[0][0] as {
      template: Array<{ label?: string; submenu: Array<{ role?: string; label?: string; accelerator?: string; type?: string }> }>
    }
    expect(template.map((m) => m.label)).toEqual(['Edge-Drop', 'Edit', 'Window'])
    expect(template[0].submenu.map((i) => [i.label ?? i.type, i.accelerator])).toEqual([
      ['Settings…', 'Command+,'],
      ['separator', undefined],
      ['Quit Edge-Drop', 'Command+Q']
    ])
    expect(template[2].submenu.map((i) => i.role)).toEqual(['close'])
    expect(template[1].submenu.map((i) => i.role).filter(Boolean)).toEqual([
      'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'
    ])
    const roles = template.flatMap((m) => m.submenu.map((i) => i.role))
    for (const forbidden of ['quit', 'minimize', 'reload', 'forceReload', 'toggleDevTools', 'zoomIn', 'zoomOut', 'resetZoom', 'togglefullscreen']) {
      expect(roles).not.toContain(forbidden)
    }
  })

  it('leaves the menu alone on Windows', async () => {
    setPlatform('win32')
    const { installMacAppMenu } = await import('../electron/main/macAppMenu')
    installMacAppMenu()
    expect(mocks.setApplicationMenu).not.toHaveBeenCalled()
  })
})

describe('onboarding window focus', () => {
  it('activates the app before focusing the window on macOS', async () => {
    setPlatform('darwin')
    const { createOnboardingWindow } = await import('../electron/main/onboardingWindow')
    createOnboardingWindow()
    mocks.windows[0].handlers['ready-to-show']()
    expect(mocks.calls).toEqual([
      'setAlwaysOnTop:true',
      'show',
      'app.focus:{"steal":true}',
      'win.focus',
      'setAlwaysOnTop:false'
    ])
  })

  it('re-activates the app when the window is requested again on macOS', async () => {
    setPlatform('darwin')
    const { createOnboardingWindow } = await import('../electron/main/onboardingWindow')
    createOnboardingWindow()
    mocks.calls.length = 0
    createOnboardingWindow()
    expect(mocks.windows).toHaveLength(1)
    expect(mocks.calls).toEqual(['app.focus:{"steal":true}', 'win.focus'])
  })

  it('does not call app.focus on Windows', async () => {
    setPlatform('win32')
    const { createOnboardingWindow } = await import('../electron/main/onboardingWindow')
    createOnboardingWindow()
    mocks.windows[0].handlers['ready-to-show']()
    createOnboardingWindow()
    expect(mocks.calls).toEqual(['setAlwaysOnTop:true', 'show', 'win.focus', 'setAlwaysOnTop:false', 'win.focus'])
  })
})

describe('login launch detection on macOS', () => {
  async function loadConfig(): Promise<typeof import('../electron/main/config')> {
    setPlatform('darwin')
    return import('../electron/main/config')
  }

  it('first manual launch is not hidden: the login item is not registered yet', async () => {
    mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false, status: 'not-registered' })
    mocks.uptime.mockReturnValue(40)
    const { shouldStartHidden } = await loadConfig()
    expect(shouldStartHidden()).toBe(false)
  })

  it('a launch right after boot with an enabled login item is hidden', async () => {
    mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: 'enabled' })
    mocks.uptime.mockReturnValue(40)
    const { shouldStartHidden, wasLaunchedAtLogin } = await loadConfig()
    expect(wasLaunchedAtLogin()).toBe(true)
    expect(shouldStartHidden()).toBe(true)
    expect(mocks.getLoginItemSettings).toHaveBeenCalledWith({ type: 'mainAppService' })
  })

  it('a manual launch long after boot is not hidden even with an enabled login item', async () => {
    mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: 'enabled' })
    mocks.uptime.mockReturnValue(7200)
    const { shouldStartHidden } = await loadConfig()
    expect(shouldStartHidden()).toBe(false)
  })

  it('a login item waiting for approval does not count as a login launch', async () => {
    mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: 'requires-approval' })
    mocks.uptime.mockReturnValue(40)
    const { shouldStartHidden } = await loadConfig()
    expect(shouldStartHidden()).toBe(false)
  })

  it('falls back to openAtLogin when the status is unavailable', async () => {
    mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true })
    mocks.uptime.mockReturnValue(40)
    const { shouldStartHidden } = await loadConfig()
    expect(shouldStartHidden()).toBe(true)
  })

  it('still honours wasOpenedAtLogin where macOS reports it', async () => {
    mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true, wasOpenedAtLogin: true })
    const { shouldStartHidden } = await loadConfig()
    expect(shouldStartHidden()).toBe(true)
  })

  it('an unpackaged run is never treated as a login launch', async () => {
    mocks.isPackaged = false
    mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: 'enabled' })
    mocks.uptime.mockReturnValue(40)
    const { shouldStartHidden } = await loadConfig()
    expect(shouldStartHidden()).toBe(false)
  })

  it('a failing login item query is not treated as a login launch', async () => {
    mocks.getLoginItemSettings.mockImplementation(() => {
      throw new Error('not ready')
    })
    mocks.uptime.mockReturnValue(40)
    const { shouldStartHidden } = await loadConfig()
    expect(shouldStartHidden()).toBe(false)
  })

  it('the uptime heuristic is not applied on Windows', async () => {
    setPlatform('win32')
    mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: 'enabled' })
    mocks.uptime.mockReturnValue(40)
    const { shouldStartHidden } = await import('../electron/main/config')
    expect(shouldStartHidden()).toBe(false)
  })
})
