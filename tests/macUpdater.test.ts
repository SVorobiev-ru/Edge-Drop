import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  version: '0.3.2',
  isPackaged: true,
  appPath: '/Applications/Edge-Drop.app/Contents/Resources/app.asar',
  netRequest: vi.fn(),
  openExternal: vi.fn(),
  updateAvailable: vi.fn(),
  updateProgress: vi.fn(),
  updateDownloaded: vi.fn(),
  settings: { updateMode: 'auto' } as Record<string, unknown>
}))

vi.mock('electron', () => ({
  app: {
    getVersion: () => mocks.version,
    get isPackaged() {
      return mocks.isPackaged
    },
    getAppPath: () => mocks.appPath,
    getPath: () => '/Applications/Edge-Drop.app/Contents/MacOS/Edge-Drop'
  },
  net: {
    request: (...args: unknown[]) => mocks.netRequest(...args)
  },
  shell: {
    openExternal: (...args: unknown[]) => mocks.openExternal(...args)
  }
}))

vi.mock('../electron/main/state', () => ({
  pushState: {
    updateAvailable: (...args: unknown[]) => mocks.updateAvailable(...args),
    updateDownloaded: (...args: unknown[]) => mocks.updateDownloaded(...args),
    updateProgress: (...args: unknown[]) => mocks.updateProgress(...args)
  }
}))

vi.mock('../electron/store/settings', () => ({
  getSettings: () => mocks.settings
}))

type Updater = typeof import('../electron/main/updater')

const realPlatform = process.platform
const API_URL = 'https://api.github.com/repos/SVorobiev-ru/Edge-Drop/releases?per_page=30'
const LATEST_PAGE = 'https://github.com/SVorobiev-ru/Edge-Drop/releases/latest'

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function mockRelease(release: Array<Record<string, unknown>> | Record<string, unknown> | string, statusCode = 200): void {
  mocks.netRequest.mockImplementation(() => {
    const handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
    return {
      setHeader: vi.fn(),
      abort: vi.fn(),
      on: (ev: string, cb: (...a: unknown[]) => void) => {
        (handlers[ev] ??= []).push(cb)
      },
      end: () => {
        const response = {
          statusCode,
          on: (ev: string, cb: (chunk?: string) => void) => {
            if (ev === 'data') cb(typeof release === 'string' ? release : JSON.stringify(release))
            if (ev === 'end') cb()
          }
        }
        for (const cb of handlers.response ?? []) cb(response)
      }
    }
  })
}

function mockNetworkError(): void {
  mocks.netRequest.mockImplementation(() => {
    const handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
    return {
      setHeader: vi.fn(),
      abort: vi.fn(),
      on: (ev: string, cb: (...a: unknown[]) => void) => {
        (handlers[ev] ??= []).push(cb)
      },
      end: () => {
        for (const cb of handlers.error ?? []) cb(new Error('net::ERR_INTERNET_DISCONNECTED'))
      }
    }
  })
}

async function loadUpdater(): Promise<Updater> {
  vi.resetModules()
  return import('../electron/main/updater')
}

describe('macOS updates: check, notify, open the release page', () => {
  beforeEach(() => {
    setPlatform('darwin')
    delete process.env.APP_BUILD_TARGET
    mocks.version = '0.3.2-mac.1'
    mocks.isPackaged = true
    mocks.appPath = '/Applications/Edge-Drop.app/Contents/Resources/app.asar'
    mocks.settings = { updateMode: 'auto' }
    for (const fn of [mocks.netRequest, mocks.openExternal, mocks.updateAvailable, mocks.updateProgress, mocks.updateDownloaded]) fn.mockReset()
    mocks.openExternal.mockResolvedValue(undefined)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    setPlatform(realPlatform)
  })

  afterAll(() => {
    setPlatform(realPlatform)
  })

  it('exposes the fork repository as a constant', async () => {
    const updater = await loadUpdater()
    expect(updater.MAC_UPDATE_REPO).toBe('SVorobiev-ru/Edge-Drop')
  })

  it('queries the fork releases endpoint', async () => {
    const updater = await loadUpdater()
    mockRelease([{ tag_name: 'v0.3.2-mac.1' }])
    await updater.checkForUpdatesManual()
    expect(mocks.netRequest).toHaveBeenCalledTimes(1)
    expect(mocks.netRequest).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', url: API_URL }))
  })

  it('reports a newer release as available and caches it for the renderer', async () => {
    const updater = await loadUpdater()
    mockRelease([{ tag_name: 'v0.4.0-mac.1', html_url: 'https://github.com/SVorobiev-ru/Edge-Drop/releases/tag/v0.4.0-mac.1' }])
    await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'available', version: '0.4.0-mac.1' })
    expect(mocks.updateAvailable).toHaveBeenCalledWith({ version: '0.4.0-mac.1' })
    expect(updater.getCachedUpdateState()).toEqual({ hasUpdate: true, latestVersion: '0.4.0-mac.1', downloaded: false })
  })

  it('reports up-to-date when the latest release is the running version', async () => {
    const updater = await loadUpdater()
    mockRelease([{ tag_name: 'v0.3.2-mac.1' }])
    await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'up-to-date', version: '0.3.2-mac.1' })
    expect(mocks.updateAvailable).not.toHaveBeenCalled()
    expect(updater.getCachedUpdateState()).toBeNull()
  })

  it('reports up-to-date when the latest release is older', async () => {
    const updater = await loadUpdater()
    mockRelease([{ tag_name: 'v0.3.1-mac.4' }])
    await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'up-to-date', version: '0.3.2-mac.1' })
    expect(mocks.updateAvailable).not.toHaveBeenCalled()
  })

  it('reports an error on a network failure instead of claiming up-to-date', async () => {
    const updater = await loadUpdater()
    mockNetworkError()
    const result = await updater.checkForUpdatesManual()
    expect(result.status).toBe('error')
    expect(result.error).toBeTruthy()
    expect(mocks.updateAvailable).not.toHaveBeenCalled()
  })

  it('reports an error on a non-200 response and on a malformed body', async () => {
    const updater = await loadUpdater()
    mockRelease({ message: 'Not Found' }, 404)
    expect((await updater.checkForUpdatesManual()).status).toBe('error')
    mockRelease('<html>', 200)
    expect((await updater.checkForUpdatesManual()).status).toBe('error')
    mockRelease({ tag_name: 'v0.4.0-mac.1' }, 200)
    expect((await updater.checkForUpdatesManual()).status).toBe('error')
    expect(mocks.updateAvailable).not.toHaveBeenCalled()
  })

  describe('fork version scheme X.Y.Z-mac.N', () => {
    it('parses plain and fork versions', async () => {
      const { parseMacVersion } = await loadUpdater()
      expect(parseMacVersion('0.3.2-mac.1')).toEqual({ base: [0, 3, 2], revision: 1 })
      expect(parseMacVersion('v0.3.2-mac.12')).toEqual({ base: [0, 3, 2], revision: 12 })
      expect(parseMacVersion('0.3.2')).toEqual({ base: [0, 3, 2], revision: 0 })
      for (const bad of ['', 'latest', '0.3', '0.3.2-beta.1', '0.3.2-mac', '0.3.2-mac.x', '0.3.2-mac.1.2', '0.3.2.1']) {
        expect(parseMacVersion(bad)).toBeNull()
      }
    })

    it.each([
      ['0.3.2-mac.2', '0.3.2-mac.1', 1],
      ['0.3.2-mac.10', '0.3.2-mac.9', 1],
      ['0.3.2-mac.1', '0.3.2-mac.1', 0],
      ['v0.3.2-mac.1', '0.3.2-mac.1', 0],
      ['0.3.2-mac.1', '0.3.2-mac.2', -1],
      ['0.4.0-mac.1', '0.3.2-mac.5', 1],
      ['0.3.10-mac.1', '0.3.9-mac.7', 1],
      ['1.0.0-mac.1', '0.99.99-mac.99', 1],
      ['0.3.2-mac.1', '0.3.2', 1],
      ['0.3.2', '0.3.2-mac.1', -1],
      ['0.3.3', '0.3.2-mac.9', 1],
      ['0.3.2', '0.3.2', 0]
    ])('compares %s with %s as %i', async (a, b, expected) => {
      const { compareMacVersions } = await loadUpdater()
      expect(compareMacVersions(a, b)).toBe(expected)
      expect(compareMacVersions(b, a)).toBe(-expected || 0)
    })

    it('picks the highest fork release regardless of the order in the list', async () => {
      const { pickLatestMacRelease } = await loadUpdater()
      expect(pickLatestMacRelease([
        { tag_name: 'v0.3.2-mac.5', html_url: 'a' },
        { tag_name: 'v0.4.0-mac.1', html_url: 'b' },
        { tag_name: 'v0.3.2-mac.12', html_url: 'c' }
      ])).toEqual({ version: '0.4.0-mac.1', htmlUrl: 'b' })
    })

    it('skips drafts, prereleases, tags outside the fork scheme and malformed entries', async () => {
      const { pickLatestMacRelease } = await loadUpdater()
      expect(pickLatestMacRelease([
        { tag_name: 'v0.9.0-mac.1', draft: true },
        { tag_name: 'v0.8.0-mac.1', prerelease: true },
        { tag_name: 'v0.7.0' },
        { tag_name: 'v0.6.0-beta.1' },
        { tag_name: 42 },
        null,
        { tag_name: 'v0.3.2-mac.2', html_url: 'ok' }
      ])).toEqual({ version: '0.3.2-mac.2', htmlUrl: 'ok' })
      expect(pickLatestMacRelease([])).toBeNull()
      expect(pickLatestMacRelease({ tag_name: 'v0.3.2-mac.2' })).toBeNull()
    })

    it('offers the next fork revision of the same upstream version', async () => {
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.3.2-mac.1' }, { tag_name: 'v0.3.2-mac.2' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'available', version: '0.3.2-mac.2' })
    })

    it('offers a newer upstream version over a higher revision of the current one', async () => {
      mocks.version = '0.3.2-mac.5'
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.4.0-mac.1' }, { tag_name: 'v0.3.2-mac.5' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'available', version: '0.4.0-mac.1' })
    })

    it('does not offer anything to a packaged build with a plain upstream version and no readable macRevision', async () => {
      mocks.version = '0.3.2'
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.3.2-mac.1' }, { tag_name: 'v0.4.0-mac.1' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'up-to-date', version: '0.3.2' })
      expect(mocks.updateAvailable).not.toHaveBeenCalled()
      expect(updater.getCachedUpdateState()).toBeNull()
    })

    it('ignores a release without the fork suffix and a prerelease', async () => {
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.4.0' }, { tag_name: 'v0.5.0-mac.1', prerelease: true }, { tag_name: 'v0.3.2-mac.1' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'up-to-date', version: '0.3.2-mac.1' })
      expect(mocks.updateAvailable).not.toHaveBeenCalled()
    })

    it('reports up-to-date when the fork has no releases yet', async () => {
      const updater = await loadUpdater()
      mockRelease([])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'up-to-date', version: '0.3.2-mac.1' })
    })

    it('leaves the Windows comparison untouched', async () => {
      const { readFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const src = readFileSync(join(process.cwd(), 'electron/main/updater.ts'), 'utf8')
      const winCheck = src.slice(src.indexOf('// 1. Fast path'))
      expect(winCheck).toContain('semverCompare(latestVersion, currentVersion) > 0')
      expect(winCheck).not.toContain('compareMacVersions')
      expect(src).toContain("url = 'https://api.github.com/repos/Deepender25/Edge-Drop/releases/latest'")
    })
  })

  describe('unpackaged dev run', () => {
    async function devAppPath(packageJson: string | null): Promise<string> {
      const { mkdtempSync, writeFileSync } = await import('node:fs')
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const dir = mkdtempSync(join(tmpdir(), 'edge-drop-updater-'))
      if (packageJson !== null) writeFileSync(join(dir, 'package.json'), packageJson)
      return dir
    }

    beforeEach(() => {
      mocks.isPackaged = false
      mocks.version = '0.3.2'
    })

    it('takes the revision from macRevision in package.json and reports up-to-date', async () => {
      mocks.appPath = await devAppPath(JSON.stringify({ version: '0.3.2', macRevision: 1 }))
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.3.2-mac.1' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'up-to-date', version: '0.3.2-mac.1' })
      expect(mocks.updateAvailable).not.toHaveBeenCalled()
      expect(updater.getCachedUpdateState()).toBeNull()
    })

    it('still offers a release newer than the dev revision', async () => {
      mocks.appPath = await devAppPath(JSON.stringify({ version: '0.3.2', macRevision: 1 }))
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.3.2-mac.2' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'available', version: '0.3.2-mac.2' })
      mockRelease([{ tag_name: 'v0.4.0-mac.1' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'available', version: '0.4.0-mac.1' })
    })

    it('does not offer a release older than the dev revision', async () => {
      mocks.appPath = await devAppPath(JSON.stringify({ version: '0.3.2', macRevision: 3 }))
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.3.2-mac.2' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'up-to-date', version: '0.3.2-mac.3' })
    })

    it.each([
      ['a missing package.json', null],
      ['a malformed package.json', '{ not json'],
      ['a package.json without macRevision', JSON.stringify({ version: '0.3.2' })],
      ['a non-integer macRevision', JSON.stringify({ version: '0.3.2', macRevision: '1' })],
      ['a zero macRevision', JSON.stringify({ version: '0.3.2', macRevision: 0 })]
    ])('does not report an update with %s', async (_name, packageJson) => {
      mocks.appPath = await devAppPath(packageJson)
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.4.0-mac.1' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'up-to-date', version: '0.3.2' })
      expect(mocks.updateAvailable).not.toHaveBeenCalled()
      expect(updater.getCachedUpdateState()).toBeNull()
    })

    it('keeps a version that already carries the fork suffix', async () => {
      mocks.version = '0.3.2-mac.4'
      mocks.appPath = await devAppPath(null)
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.3.2-mac.5' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'available', version: '0.3.2-mac.5' })
    })

    it('does not read package.json when the packaged version already carries the fork suffix', async () => {
      mocks.isPackaged = true
      mocks.version = '0.3.2-mac.1'
      mocks.appPath = await devAppPath(JSON.stringify({ version: '0.3.2', macRevision: 9 }))
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.3.2-mac.2' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'available', version: '0.3.2-mac.2' })
    })
  })

  describe('packaged build without the fork suffix', () => {
    async function packagedAppPath(packageJson: string | null): Promise<string> {
      const { mkdtempSync, writeFileSync } = await import('node:fs')
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const dir = mkdtempSync(join(tmpdir(), 'edge-drop-updater-'))
      if (packageJson !== null) writeFileSync(join(dir, 'package.json'), packageJson)
      return dir
    }

    beforeEach(() => {
      mocks.isPackaged = true
      mocks.version = '0.3.2'
    })

    it('takes the revision from macRevision and reports up-to-date instead of a permanent update', async () => {
      mocks.appPath = await packagedAppPath(JSON.stringify({ version: '0.3.2', macRevision: 1 }))
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.3.2-mac.1' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'up-to-date', version: '0.3.2-mac.1' })
      expect(mocks.updateAvailable).not.toHaveBeenCalled()
      expect(updater.getCachedUpdateState()).toBeNull()
    })

    it('still offers a release newer than its revision', async () => {
      mocks.appPath = await packagedAppPath(JSON.stringify({ version: '0.3.2', macRevision: 1 }))
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.3.2-mac.2' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'available', version: '0.3.2-mac.2' })
    })

    it.each([
      ['a missing package.json', null],
      ['a malformed package.json', '{ not json'],
      ['a package.json without macRevision', JSON.stringify({ version: '0.3.2' })]
    ])('does not report an update with %s', async (_name, packageJson) => {
      mocks.appPath = await packagedAppPath(packageJson)
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.4.0-mac.1' }])
      await expect(updater.checkForUpdatesManual()).resolves.toEqual({ status: 'up-to-date', version: '0.3.2' })
      expect(mocks.updateAvailable).not.toHaveBeenCalled()
      expect(updater.getCachedUpdateState()).toBeNull()
    })
  })

  it('opens the release page instead of downloading', async () => {
    const updater = await loadUpdater()
    const page = 'https://github.com/SVorobiev-ru/Edge-Drop/releases/tag/v0.4.0-mac.1'
    mockRelease([{ tag_name: 'v0.4.0-mac.1', html_url: page }])
    await updater.checkForUpdatesManual()
    await updater.startUpdateDownload()
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
    expect(mocks.openExternal).toHaveBeenCalledWith(page)
    expect(mocks.updateProgress).not.toHaveBeenCalled()
    expect(mocks.updateDownloaded).not.toHaveBeenCalled()
  })

  it.each([
    'http://github.com/SVorobiev-ru/Edge-Drop/releases/tag/v0.4.0-mac.1',
    'https://github.com.evil.example/SVorobiev-ru/Edge-Drop',
    'https://evil.example/github.com/release',
    'https://user@github.com/SVorobiev-ru/Edge-Drop/releases/tag/v0.4.0-mac.1',
    'https://user:secret@github.com/SVorobiev-ru/Edge-Drop/releases/tag/v0.4.0-mac.1',
    'https://github.com:8443/SVorobiev-ru/Edge-Drop/releases/tag/v0.4.0-mac.1',
    'https://github.com/evil/Edge-Drop/releases/tag/v0.4.0-mac.1',
    'https://github.com/SVorobiev-ru/Edge-Drop',
    'https://github.com/SVorobiev-ru/Edge-Drop/releases-evil/tag/v0.4.0-mac.1',
    'https://github.com/SVorobiev-ru/Edge-Drop/releases/../../../evil/payload',
    'file:///Applications/Calculator.app',
    'not a url',
    undefined
  ])('falls back to the fork releases page for an untrusted html_url: %s', async (htmlUrl) => {
    const updater = await loadUpdater()
    mockRelease([{ tag_name: 'v0.4.0-mac.1', html_url: htmlUrl }])
    await updater.checkForUpdatesManual()
    await updater.startUpdateDownload()
    expect(mocks.openExternal).toHaveBeenCalledWith(LATEST_PAGE)
  })

  it('passes the normalized URL to the browser', async () => {
    const updater = await loadUpdater()
    mockRelease([{ tag_name: 'v0.4.0-mac.1', html_url: 'HTTPS://GitHub.com:443/SVorobiev-ru/Edge-Drop/releases/x/../tag/v0.4.0-mac.1' }])
    await updater.checkForUpdatesManual()
    await updater.startUpdateDownload()
    expect(mocks.openExternal).toHaveBeenCalledWith('https://github.com/SVorobiev-ru/Edge-Drop/releases/tag/v0.4.0-mac.1')
  })

  it('opens the fork releases page when nothing was checked yet', async () => {
    const updater = await loadUpdater()
    await updater.startUpdateDownload()
    expect(mocks.openExternal).toHaveBeenCalledWith(LATEST_PAGE)
    expect(mocks.netRequest).not.toHaveBeenCalled()
  })

  it('does not throw when the browser cannot be opened', async () => {
    const updater = await loadUpdater()
    mocks.openExternal.mockRejectedValue(new Error('no handler'))
    await expect(updater.startUpdateDownload()).resolves.toBeUndefined()
  })

  it('quitAndInstallUpdate and syncAutoUpdaterState stay no-ops', async () => {
    const updater = await loadUpdater()
    expect(() => updater.quitAndInstallUpdate()).not.toThrow()
    expect(() => updater.syncAutoUpdaterState()).not.toThrow()
    expect(mocks.netRequest).not.toHaveBeenCalled()
  })

  describe('background checks follow updateMode', () => {
    it.each(['auto', 'notify'])('checks 3s after launch in %s mode and notifies the renderer', async (mode) => {
      vi.useFakeTimers()
      mocks.settings = { updateMode: mode }
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.4.0-mac.1' }])
      updater.initAutoUpdater()
      expect(mocks.netRequest).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2999)
      expect(mocks.netRequest).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(mocks.netRequest).toHaveBeenCalledTimes(1)
      expect(mocks.updateAvailable).toHaveBeenCalledWith({ version: '0.4.0-mac.1' })
      expect(mocks.openExternal).not.toHaveBeenCalled()
    })

    it('stays network-silent in off mode', async () => {
      vi.useFakeTimers()
      mocks.settings = { updateMode: 'off' }
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.4.0-mac.1' }])
      updater.initAutoUpdater()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(mocks.netRequest).not.toHaveBeenCalled()
    })

    it('checks after switching into a checking mode and cancels when switched off', async () => {
      vi.useFakeTimers()
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.4.0-mac.1' }])
      mocks.settings = { updateMode: 'notify' }
      updater.triggerBackgroundCheck()
      mocks.settings = { updateMode: 'off' }
      updater.triggerBackgroundCheck()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(mocks.netRequest).not.toHaveBeenCalled()

      mocks.settings = { updateMode: 'notify' }
      updater.triggerBackgroundCheck()
      updater.triggerBackgroundCheck()
      await vi.advanceTimersByTimeAsync(3000)
      expect(mocks.netRequest).toHaveBeenCalledTimes(1)
    })

    it('swallows a failed background check', async () => {
      vi.useFakeTimers()
      const updater = await loadUpdater()
      mockNetworkError()
      updater.initAutoUpdater()
      await vi.advanceTimersByTimeAsync(3000)
      expect(mocks.netRequest).toHaveBeenCalledTimes(1)
      expect(mocks.updateAvailable).not.toHaveBeenCalled()
    })
  })

  it('never loads electron-updater', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'electron/main/updater.ts'), 'utf8')
    const macCheck = src.slice(src.indexOf('async function checkMacRelease'), src.indexOf('export async function checkForUpdatesManual'))
    expect(macCheck).not.toContain('autoUpdater')
    expect(macCheck).not.toContain('electron-updater')
  })
})
