import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  isPackaged: true,
  status: 'not-registered' as string | undefined,
  registerSticks: true,
  queryThrows: false,
  settings: { launchAtLogin: true } as { launchAtLogin: boolean },
  saved: [] as Array<Record<string, unknown>>,
  setLoginItemSettings: vi.fn(),
  getLoginItemSettings: vi.fn(),
  execFileSync: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged
    },
    getPath: () => '/Applications/Edge-Drop.app/Contents/MacOS/Edge-Drop',
    getAppPath: () => '/Applications/Edge-Drop.app/Contents/Resources/app.asar',
    setLoginItemSettings: (...args: unknown[]) => mocks.setLoginItemSettings(...args),
    getLoginItemSettings: (...args: unknown[]) => mocks.getLoginItemSettings(...args)
  }
}))

vi.mock('../electron/store/settings', async () => (await import('./helpers/settingsMock')).settingsModuleMock(mocks))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFileSync: (...args: unknown[]) => mocks.execFileSync(...args)
  }
})

import {
  applyLaunchAtLogin,
  reconcileLaunchAtLoginOnStartup,
  refreshLaunchAtLoginFromOs
} from '../electron/main/loginItems'
import { DEFAULT_SETTINGS } from '../shared/types'

describe('macOS launch-at-login lifecycle', () => {
  beforeEach(() => {
    setPlatform('darwin')
    delete process.env.APP_BUILD_TARGET
    mocks.isPackaged = true
    mocks.status = 'not-registered'
    mocks.registerSticks = true
    mocks.queryThrows = false
    mocks.settings = { launchAtLogin: true }
    mocks.saved.length = 0
    mocks.setLoginItemSettings.mockReset()
    mocks.getLoginItemSettings.mockReset()
    mocks.execFileSync.mockReset()
    mocks.getLoginItemSettings.mockImplementation(() => {
      if (mocks.queryThrows) throw new Error('query failed')
      return { openAtLogin: mocks.status === 'enabled', status: mocks.status }
    })
    mocks.setLoginItemSettings.mockImplementation((opts: { openAtLogin: boolean }) => {
      if (!mocks.registerSticks) return
      if (mocks.status === 'requires-approval' && opts.openAtLogin) return
      mocks.status = opts.openAtLogin ? 'enabled' : 'not-registered'
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restorePlatform()
  })

  afterAll(() => {
    restorePlatform()
  })

  it('keeps launch at login on by default, like on Windows', () => {
    expect(DEFAULT_SETTINGS.launchAtLogin).toBe(true)
  })

  it('registers the login item on first launch and keeps the setting on', async () => {
    const result = await reconcileLaunchAtLoginOnStartup()
    expect(mocks.setLoginItemSettings).toHaveBeenCalledTimes(1)
    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, type: 'mainAppService' })
    expect(result.launchAtLogin).toBe(true)
    expect(mocks.saved).toEqual([])
  })

  it('does not register again when the login item is already enabled', async () => {
    mocks.status = 'enabled'
    const result = await reconcileLaunchAtLoginOnStartup()
    expect(mocks.setLoginItemSettings).not.toHaveBeenCalled()
    expect(result.launchAtLogin).toBe(true)
    expect(mocks.saved).toEqual([])
  })

  it('settles after one pass: repeated reconciles do not re-apply', async () => {
    await reconcileLaunchAtLoginOnStartup()
    await reconcileLaunchAtLoginOnStartup()
    await reconcileLaunchAtLoginOnStartup()
    expect(mocks.setLoginItemSettings).toHaveBeenCalledTimes(1)
    expect(mocks.saved).toEqual([])
  })

  it('never touches the Windows registry', async () => {
    await reconcileLaunchAtLoginOnStartup()
    mocks.status = 'enabled'
    await reconcileLaunchAtLoginOnStartup()
    mocks.settings = { launchAtLogin: false }
    await reconcileLaunchAtLoginOnStartup()
    expect(mocks.execFileSync).not.toHaveBeenCalled()
  })

  it('reflects OFF when the user disabled Edge-Drop in Login Items', async () => {
    mocks.status = 'requires-approval'
    const result = await reconcileLaunchAtLoginOnStartup()
    expect(result.launchAtLogin).toBe(false)
    expect(mocks.saved).toEqual([{ launchAtLogin: false }])
    expect(mocks.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('keeps the setting on when registration does not stick', async () => {
    mocks.registerSticks = false
    const result = await reconcileLaunchAtLoginOnStartup()
    expect(result.launchAtLogin).toBe(true)
    expect(mocks.saved).toEqual([])
  })

  it('keeps the saved preference and does not register when the OS query fails', async () => {
    mocks.queryThrows = true
    const result = await reconcileLaunchAtLoginOnStartup()
    expect(result.launchAtLogin).toBe(true)
    expect(mocks.saved).toEqual([])
    expect(mocks.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('unregisters a leftover login item when the setting is off', async () => {
    mocks.settings = { launchAtLogin: false }
    mocks.status = 'enabled'
    const result = await reconcileLaunchAtLoginOnStartup()
    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false, type: 'mainAppService' })
    expect(result.launchAtLogin).toBe(false)
    expect(mocks.status).toBe('not-registered')
  })

  it('leaves everything alone when the setting is off and nothing is registered', async () => {
    mocks.settings = { launchAtLogin: false }
    const result = await reconcileLaunchAtLoginOnStartup()
    expect(mocks.setLoginItemSettings).not.toHaveBeenCalled()
    expect(result.launchAtLogin).toBe(false)
    expect(mocks.saved).toEqual([])
  })

  it.each([
    ['the login item gets registered', 'not-registered', false],
    ['the login item is already enabled', 'enabled', false],
    ['the OS query fails', 'not-registered', true]
  ] as const)('returns settings saved by someone else while reconciling when %s', async (_name, status, queryThrows) => {
    mocks.status = status
    mocks.getLoginItemSettings.mockImplementation(() => {
      mocks.settings = { ...mocks.settings, stickPosition: 'right' } as typeof mocks.settings
      if (queryThrows) throw new Error('query failed')
      return { openAtLogin: mocks.status === 'enabled', status: mocks.status }
    })

    const result = await reconcileLaunchAtLoginOnStartup()

    expect(result).toMatchObject({ launchAtLogin: true, stickPosition: 'right' })
    expect(mocks.saved).toEqual([])
  })

  it('does nothing in an unpackaged run', async () => {
    mocks.isPackaged = false
    const result = await reconcileLaunchAtLoginOnStartup()
    expect(result.launchAtLogin).toBe(true)
    expect(mocks.getLoginItemSettings).not.toHaveBeenCalled()
    expect(mocks.setLoginItemSettings).not.toHaveBeenCalled()

    await expect(applyLaunchAtLogin(false)).resolves.toEqual({ enabled: false, blockedByUser: false, ok: true })
    await expect(refreshLaunchAtLoginFromOs()).resolves.toEqual({ launchAtLogin: true })
    expect(mocks.setLoginItemSettings).not.toHaveBeenCalled()
    expect(mocks.saved).toEqual([])
  })

  it('reports a blocked enable so the UI can point to Login Items', async () => {
    mocks.status = 'requires-approval'
    await expect(applyLaunchAtLogin(true)).resolves.toEqual({ enabled: false, blockedByUser: true, ok: true })
  })

  it('the settings poll mirrors a login item switched off in System Settings', async () => {
    mocks.status = 'enabled'
    await expect(refreshLaunchAtLoginFromOs()).resolves.toEqual({ launchAtLogin: true })
    mocks.status = 'requires-approval'
    await expect(refreshLaunchAtLoginFromOs()).resolves.toEqual({ launchAtLogin: false })
    expect(mocks.saved).toEqual([{ launchAtLogin: false }])
  })

  it('the settings poll keeps the saved value when the OS query fails', async () => {
    mocks.queryThrows = true
    await expect(refreshLaunchAtLoginFromOs()).resolves.toEqual({ launchAtLogin: true })
    expect(mocks.saved).toEqual([])
  })
})
