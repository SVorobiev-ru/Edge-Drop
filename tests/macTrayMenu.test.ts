import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => void

interface FakeTray {
  handlers: Record<string, Handler>
  setToolTip: ReturnType<typeof vi.fn>
  setIgnoreDoubleClickEvents: ReturnType<typeof vi.fn>
  setImage: ReturnType<typeof vi.fn>
  setContextMenu: ReturnType<typeof vi.fn>
  popUpContextMenu: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  on: (event: string, fn: Handler) => void
}

const mocks = vi.hoisted(() => ({
  trays: [] as FakeTray[],
  menus: [] as Array<{ template: Array<Record<string, unknown>> }>,
  notifications: [] as Array<{ title: string; body: string }>,
  notificationSupported: true,
  indexExists: true,
  settings: { language: 'en', toggleHotkey: 'Alt+C', incognito: false, hoverActivation: true, stickPosition: 'left' } as Record<string, unknown>,
  appFocus: vi.fn(),
  setVisible: vi.fn(),
  windowFocus: vi.fn(),
  togglePanel: vi.fn(),
  markExplicitOpen: vi.fn(),
  openSettings: vi.fn()
}))

vi.mock('electron', () => {
  const image = {
    isEmpty: () => true,
    resize: () => image,
    toPNG: () => Buffer.from('png')
  }
  return {
    app: {
      focus: (...args: unknown[]) => mocks.appFocus(...args),
      quit: vi.fn(),
      getPreferredSystemLanguages: () => ['en-US']
    },
    Tray: vi.fn().mockImplementation(function () {
      const tray: FakeTray = {
        handlers: {},
        setToolTip: vi.fn(),
        setIgnoreDoubleClickEvents: vi.fn(),
        setImage: vi.fn(),
        setContextMenu: vi.fn(),
        popUpContextMenu: vi.fn(),
        destroy: vi.fn(),
        isDestroyed: () => false,
        on: (event, fn) => {
          tray.handlers[event] = fn
        }
      }
      mocks.trays.push(tray)
      return tray
    }),
    Menu: {
      buildFromTemplate: (template: Array<Record<string, unknown>>) => {
        const menu = { template }
        mocks.menus.push(menu)
        return menu
      }
    },
    Notification: Object.assign(
      vi.fn().mockImplementation(function (opts: { title: string; body: string }) {
        mocks.notifications.push(opts)
        return { show: vi.fn() }
      }),
      { isSupported: () => mocks.notificationSupported }
    ),
    nativeImage: {
      createFromPath: () => image,
      createFromBuffer: () => image,
      createEmpty: () => image
    },
    nativeTheme: { shouldUseDarkColors: true, on: vi.fn() },
    screen: { on: vi.fn() }
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: (p: string) => (p === '/mock/index.json' ? mocks.indexExists : false)
  }
})

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFileSync: () => {
      throw new Error('reg unavailable')
    }
  }
})

vi.mock('../electron/store/paths', () => ({
  PATHS: {
    indexFile: () => '/mock/index.json',
    icon: () => '/mock/icon.png',
    trayIcon: () => '/mock/tray.png',
    trayDarkIcon: () => '/mock/tray-dark.png'
  }
}))

vi.mock('../electron/store/settings', () => ({
  loadSettings: () => mocks.settings,
  saveSettings: (patch: Record<string, unknown>) => {
    mocks.settings = { ...mocks.settings, ...patch }
    return mocks.settings
  }
}))

vi.mock('../electron/main/window', () => ({
  getMainWindow: () => ({ focus: mocks.windowFocus }),
  setVisible: (...args: unknown[]) => mocks.setVisible(...args),
  repositionWindow: vi.fn(),
  getDisplayListOptions: () => [],
  registerWindowRepositionListener: vi.fn(),
  popUpAndRetract: vi.fn(),
  markExplicitOpen: () => mocks.markExplicitOpen()
}))

vi.mock('../electron/main/state', () => ({
  pushState: {
    togglePanel: () => mocks.togglePanel(),
    openSettings: () => mocks.openSettings(),
    settings: vi.fn()
  }
}))

import { createTray, rebuildTrayMenu } from '../electron/main/tray'

const realPlatform = process.platform

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function lastMenu(): { template: Array<Record<string, unknown>> } {
  return mocks.menus[mocks.menus.length - 1]
}

function start(platform: string): FakeTray {
  setPlatform(platform)
  createTray()
  return mocks.trays[mocks.trays.length - 1]
}

beforeEach(() => {
  mocks.trays.length = 0
  mocks.menus.length = 0
  mocks.notifications.length = 0
  mocks.notificationSupported = true
  mocks.indexExists = true
  mocks.settings = { language: 'en', toggleHotkey: 'Alt+C', incognito: false, hoverActivation: true, stickPosition: 'left' }
  for (const fn of [mocks.appFocus, mocks.setVisible, mocks.windowFocus, mocks.togglePanel, mocks.markExplicitOpen, mocks.openSettings]) fn.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  setPlatform(realPlatform)
})

afterAll(() => {
  setPlatform(realPlatform)
})

describe('menu bar icon on macOS', () => {
  it('does not attach a context menu, so clicks reach the app', () => {
    const tray = start('darwin')
    expect(tray.setContextMenu).not.toHaveBeenCalled()
    expect(mocks.menus).toHaveLength(1)
  })

  it('keeps the same tooltip as on Windows', () => {
    const tray = start('darwin')
    expect(tray.setToolTip).toHaveBeenCalledWith('Edge-Drop')
  })

  it('ignores double-click events, so a fast second click arrives as a regular click', () => {
    const tray = start('darwin')
    expect(tray.setIgnoreDoubleClickEvents).toHaveBeenCalledTimes(1)
    expect(tray.setIgnoreDoubleClickEvents).toHaveBeenCalledWith(true)
    tray.handlers.click({ ctrlKey: false })
    tray.handlers.click({ ctrlKey: false })
    expect(mocks.togglePanel).toHaveBeenCalledTimes(2)
  })

  it('left click shows and toggles the panel without opening the menu', () => {
    const tray = start('darwin')
    tray.handlers.click({ ctrlKey: false })
    expect(mocks.setVisible).toHaveBeenCalledWith(true)
    expect(mocks.togglePanel).toHaveBeenCalledTimes(1)
    expect(tray.popUpContextMenu).not.toHaveBeenCalled()
  })

  it('marks the open as explicit before toggling, from the icon and from Show Clipboard', () => {
    const tray = start('darwin')
    tray.handlers.click({ ctrlKey: false })
    expect(mocks.markExplicitOpen).toHaveBeenCalledTimes(1)
    expect(mocks.markExplicitOpen.mock.invocationCallOrder[0]).toBeLessThan(mocks.togglePanel.mock.invocationCallOrder[0])
    const item = lastMenu().template[0] as { click: () => void }
    item.click()
    expect(mocks.markExplicitOpen).toHaveBeenCalledTimes(2)
    expect(mocks.markExplicitOpen.mock.invocationCallOrder[1]).toBeLessThan(mocks.togglePanel.mock.invocationCallOrder[1])
  })

  it('does not mark the open as explicit when the click only opens the menu', () => {
    const tray = start('darwin')
    tray.handlers.click({ ctrlKey: true })
    tray.handlers['right-click']()
    expect(mocks.markExplicitOpen).not.toHaveBeenCalled()
  })

  it('right click pops up a freshly built menu', () => {
    const tray = start('darwin')
    tray.handlers['right-click']()
    expect(mocks.menus).toHaveLength(2)
    expect(tray.popUpContextMenu).toHaveBeenCalledTimes(1)
    expect(tray.popUpContextMenu).toHaveBeenCalledWith(lastMenu())
    expect(mocks.togglePanel).not.toHaveBeenCalled()
  })

  it('control-click opens the menu instead of the panel', () => {
    const tray = start('darwin')
    tray.handlers.click({ ctrlKey: true })
    expect(tray.popUpContextMenu).toHaveBeenCalledWith(lastMenu())
    expect(mocks.togglePanel).not.toHaveBeenCalled()
    expect(mocks.setVisible).not.toHaveBeenCalled()
  })

  it('rebuilds the menu on settings changes and pops up the latest one', () => {
    const tray = start('darwin')
    mocks.settings = { ...mocks.settings, language: 'ru' }
    rebuildTrayMenu()
    expect(tray.setContextMenu).not.toHaveBeenCalled()
    expect(lastMenu().template[0].label).toBe('Показать буфер обмена')
    tray.handlers['right-click']()
    expect(tray.popUpContextMenu).toHaveBeenCalledWith(lastMenu())
  })

  it('brings the app forward when Settings is chosen', () => {
    start('darwin')
    const item = lastMenu().template[1] as { click: () => void }
    item.click()
    expect(mocks.setVisible).toHaveBeenCalledWith(true)
    expect(mocks.appFocus).toHaveBeenCalledWith({ steal: true })
    expect(mocks.windowFocus).toHaveBeenCalledTimes(1)
    expect(mocks.openSettings).toHaveBeenCalledTimes(1)
  })

  it('marks the open as explicit before opening Settings', () => {
    start('darwin')
    const item = lastMenu().template[1] as { click: () => void }
    item.click()
    expect(mocks.markExplicitOpen).toHaveBeenCalledTimes(1)
    expect(mocks.markExplicitOpen.mock.invocationCallOrder[0]).toBeLessThan(mocks.openSettings.mock.invocationCallOrder[0])
  })

  it('only Show Clipboard and Settings mark the open as explicit', () => {
    start('darwin')
    const marked: number[] = []
    const visit = (items: Array<Record<string, unknown>>, top: number | null): void => {
      items.forEach((item, index) => {
        const at = top ?? index
        if (Array.isArray(item.submenu)) visit(item.submenu as Array<Record<string, unknown>>, at)
        if (typeof item.click !== 'function' || item.label === 'Quit') return
        mocks.markExplicitOpen.mockClear()
        ;(item.click as (i: { checked: boolean }) => void)({ checked: true })
        if (mocks.markExplicitOpen.mock.calls.length > 0) marked.push(at)
      })
    }
    visit(lastMenu().template, null)
    expect(marked).toEqual([0, 1])
  })

  it('shows the default hotkey in mac notation in the welcome notification', () => {
    mocks.indexExists = false
    start('darwin')
    expect(mocks.notifications).toHaveLength(1)
    expect(mocks.notifications[0].body).toContain('⌥C')
    expect(mocks.notifications[0].body).not.toMatch(/Alt/)
  })

  it('shows the configured hotkey in the welcome notification', () => {
    mocks.indexExists = false
    mocks.settings = { ...mocks.settings, language: 'ru', toggleHotkey: 'Control+Shift+X' }
    start('darwin')
    expect(mocks.notifications[0].body).toContain('⌃⇧X')
    expect(mocks.notifications[0].body).not.toMatch(/Alt|⌥C/)
  })
})

describe('tray icon on Windows', () => {
  it('attaches the context menu and never steals focus', () => {
    const tray = start('win32')
    expect(tray.setContextMenu).toHaveBeenCalledTimes(1)
    expect(tray.setContextMenu).toHaveBeenCalledWith(lastMenu())
    expect(tray.setIgnoreDoubleClickEvents).not.toHaveBeenCalled()
    const item = lastMenu().template[1] as { click: () => void }
    item.click()
    expect(mocks.appFocus).not.toHaveBeenCalled()
    expect(mocks.markExplicitOpen).not.toHaveBeenCalled()
  })

  it('left click toggles the panel and right click pops up the attached menu', () => {
    const tray = start('win32')
    tray.handlers.click({ ctrlKey: true })
    expect(mocks.togglePanel).toHaveBeenCalledTimes(1)
    tray.handlers['right-click']()
    expect(tray.popUpContextMenu).toHaveBeenCalledWith()
  })

  it('keeps the Windows hotkey wording in the welcome notification', () => {
    mocks.indexExists = false
    mocks.settings = { ...mocks.settings, toggleHotkey: 'Control+Shift+X' }
    start('win32')
    expect(mocks.notifications[0].body).toContain('Alt+C')
  })
})
