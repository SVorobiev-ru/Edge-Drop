import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setLoginItemSettings: vi.fn(),
  getLoginItemSettings: vi.fn(),
  execFileSync: vi.fn(),
  execFile: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => '/Applications/Edge-Drop.app/Contents/MacOS/Edge-Drop',
    getAppPath: () => '/Applications/Edge-Drop.app/Contents/Resources/app.asar',
    setLoginItemSettings: (...args: unknown[]) => mocks.setLoginItemSettings(...args),
    getLoginItemSettings: (...args: unknown[]) => mocks.getLoginItemSettings(...args)
  }
}))

vi.mock('../electron/store/settings', () => ({
  loadSettings: () => ({ launchAtLogin: true }),
  saveSettings: (patch: Record<string, unknown>) => ({ launchAtLogin: true, ...patch })
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFileSync: (...args: unknown[]) => mocks.execFileSync(...args),
    execFile: (...args: unknown[]) => mocks.execFile(...args)
  }
})

import { applyGithubLaunchAtLogin, applyLaunchAtLogin, readGithubLaunchAtLogin } from '../electron/main/loginItems'

const realPlatform = process.platform

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

describe('macOS launch-at-login (SMAppService)', () => {
  beforeEach(() => {
    setPlatform('darwin')
    mocks.setLoginItemSettings.mockReset()
    mocks.getLoginItemSettings.mockReset()
    mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false })
    mocks.execFileSync.mockReset()
    mocks.execFile.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setPlatform(realPlatform)
  })

  afterAll(() => {
    setPlatform(realPlatform)
  })

  describe('readGithubLaunchAtLogin', () => {
    it('queries the main app service login item', () => {
      readGithubLaunchAtLogin()
      expect(mocks.getLoginItemSettings).toHaveBeenCalledTimes(1)
      expect(mocks.getLoginItemSettings).toHaveBeenCalledWith({ type: 'mainAppService' })
    })

    it("reports status 'enabled' as enabled", () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false, status: 'enabled' })
      expect(readGithubLaunchAtLogin()).toEqual({ enabled: true, blockedByUser: false, ok: true })
    })

    it("reports status 'requires-approval' as disabled and blocked by the user", () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: 'requires-approval' })
      expect(readGithubLaunchAtLogin()).toEqual({ enabled: false, blockedByUser: true, ok: true })
    })

    it("reports status 'not-registered' as disabled and not blocked", () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false, status: 'not-registered' })
      expect(readGithubLaunchAtLogin()).toEqual({ enabled: false, blockedByUser: false, ok: true })
    })

    it("reports status 'not-found' as disabled and not blocked", () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false, status: 'not-found' })
      expect(readGithubLaunchAtLogin()).toEqual({ enabled: false, blockedByUser: false, ok: true })
    })

    it('trusts status over openAtLogin when both are present', () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: 'not-registered' })
      expect(readGithubLaunchAtLogin().enabled).toBe(false)
    })

    it('falls back to openAtLogin when status is missing', () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true })
      expect(readGithubLaunchAtLogin()).toEqual({ enabled: true, blockedByUser: false, ok: true })
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false })
      expect(readGithubLaunchAtLogin()).toEqual({ enabled: false, blockedByUser: false, ok: true })
    })

    it('returns ok:false when getLoginItemSettings throws', () => {
      mocks.getLoginItemSettings.mockImplementation(() => {
        throw new Error('not ready')
      })
      expect(readGithubLaunchAtLogin()).toEqual({ enabled: false, blockedByUser: false, ok: false })
    })
  })

  describe('applyGithubLaunchAtLogin', () => {
    it('enables through setLoginItemSettings with the mainAppService type', () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: 'enabled' })
      applyGithubLaunchAtLogin(true)
      expect(mocks.setLoginItemSettings).toHaveBeenCalledTimes(1)
      expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, type: 'mainAppService' })
    })

    it('disables through setLoginItemSettings with the mainAppService type', () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false, status: 'not-registered' })
      applyGithubLaunchAtLogin(false)
      expect(mocks.setLoginItemSettings).toHaveBeenCalledTimes(1)
      expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false, type: 'mainAppService' })
    })

    it('writes before it reads back', () => {
      const order: string[] = []
      mocks.setLoginItemSettings.mockImplementation(() => order.push('set'))
      mocks.getLoginItemSettings.mockImplementation(() => {
        order.push('get')
        return { openAtLogin: true, status: 'enabled' }
      })
      applyGithubLaunchAtLogin(true)
      expect(order).toEqual(['set', 'get'])
    })

    it('is ok when the read-back state matches enable', () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: 'enabled' })
      expect(applyGithubLaunchAtLogin(true)).toEqual({ enabled: true, blockedByUser: false, ok: true })
    })

    it('is ok when the read-back state matches disable', () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false, status: 'not-registered' })
      expect(applyGithubLaunchAtLogin(false)).toEqual({ enabled: false, blockedByUser: false, ok: true })
    })

    it('is ok when the read-back state matches without a status field', () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true })
      expect(applyGithubLaunchAtLogin(true)).toEqual({ enabled: true, blockedByUser: false, ok: true })
    })

    it('is ok but blocked when macOS requires approval after enabling', () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false, status: 'requires-approval' })
      expect(applyGithubLaunchAtLogin(true)).toEqual({ enabled: false, blockedByUser: true, ok: true })
    })

    it('is not ok when enable did not take effect', () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false, status: 'not-registered' })
      expect(applyGithubLaunchAtLogin(true)).toEqual({ enabled: false, blockedByUser: false, ok: false })
    })

    it('is not ok when disable did not take effect', () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: 'enabled' })
      expect(applyGithubLaunchAtLogin(false)).toEqual({ enabled: true, blockedByUser: false, ok: false })
    })

    it('does not throw when setLoginItemSettings throws and logs the failure', () => {
      mocks.setLoginItemSettings.mockImplementation(() => {
        throw new Error('SMAppService refused')
      })
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false, status: 'not-registered' })
      expect(() => applyGithubLaunchAtLogin(true)).not.toThrow()
      expect(console.error).toHaveBeenCalled()
    })

    it('reports ok:false when setLoginItemSettings throws and the state did not change', () => {
      mocks.setLoginItemSettings.mockImplementation(() => {
        throw new Error('SMAppService refused')
      })
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false, status: 'not-registered' })
      expect(applyGithubLaunchAtLogin(true)).toEqual({ enabled: false, blockedByUser: false, ok: false })
    })

    it('does not throw and reports ok:false when enabling and the read-back throws', () => {
      mocks.getLoginItemSettings.mockImplementation(() => {
        throw new Error('not ready')
      })
      expect(() => applyGithubLaunchAtLogin(true)).not.toThrow()
      expect(applyGithubLaunchAtLogin(true).ok).toBe(false)
    })

    it('reports ok:false when disabling and both the write and the read-back throw', () => {
      mocks.setLoginItemSettings.mockImplementation(() => {
        throw new Error('SMAppService refused')
      })
      mocks.getLoginItemSettings.mockImplementation(() => {
        throw new Error('not ready')
      })
      expect(applyGithubLaunchAtLogin(false).ok).toBe(false)
    })

    it('surfaces the failure through applyLaunchAtLogin when disabling cannot be confirmed', async () => {
      mocks.setLoginItemSettings.mockImplementation(() => {
        throw new Error('SMAppService refused')
      })
      mocks.getLoginItemSettings.mockImplementation(() => {
        throw new Error('not ready')
      })
      expect((await applyLaunchAtLogin(false)).ok).toBe(false)
    })

    it('reports ok:true through applyLaunchAtLogin when disabling is confirmed', async () => {
      mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: false, status: 'not-registered' })
      expect(await applyLaunchAtLogin(false)).toEqual({ enabled: false, blockedByUser: false, ok: true })
    })
  })

  it('never shells out to reg or any other process on darwin', () => {
    mocks.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: 'enabled' })
    readGithubLaunchAtLogin()
    applyGithubLaunchAtLogin(true)
    applyGithubLaunchAtLogin(false)
    mocks.getLoginItemSettings.mockImplementation(() => {
      throw new Error('not ready')
    })
    readGithubLaunchAtLogin()
    applyGithubLaunchAtLogin(true)
    expect(mocks.execFileSync).not.toHaveBeenCalled()
    expect(mocks.execFile).not.toHaveBeenCalled()
  })
})
