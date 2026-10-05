import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  version: '0.3.2',
  isPackaged: true,
  appPath: '/Applications/Edge-Drop.app/Contents/Resources/app.asar',
  netRequest: vi.fn(),
  openExternal: vi.fn(),
  updateAvailable: vi.fn(),
  updateProgress: vi.fn(),
  updateDownloaded: vi.fn(),
  toast: vi.fn(),
  quit: vi.fn(),
  prepare: vi.fn(),
  launch: vi.fn(),
  discard: vi.fn(),
  removeUnfinished: vi.fn(),
  cancelInstaller: vi.fn(),
  powerOn: vi.fn(),
  powerOff: vi.fn(),
  appListeners: new Map<string, (...args: unknown[]) => void>(),
  settings: { updateMode: 'auto' } as Record<string, unknown>
}))

vi.mock('electron', () => ({
  app: {
    getVersion: () => mocks.version,
    get isPackaged() {
      return mocks.isPackaged
    },
    getAppPath: () => mocks.appPath,
    getPath: () => '/Applications/Edge-Drop.app/Contents/MacOS/Edge-Drop',
    quit: (...args: unknown[]) => mocks.quit(...args),
    once: (event: string, cb: (...args: unknown[]) => void) => {
      mocks.appListeners.set(event, cb)
    },
    removeListener: (event: string, cb: (...args: unknown[]) => void) => {
      if (mocks.appListeners.get(event) === cb) mocks.appListeners.delete(event)
    }
  },
  net: {
    request: (...args: unknown[]) => mocks.netRequest(...args)
  },
  shell: {
    openExternal: (...args: unknown[]) => mocks.openExternal(...args)
  },
  powerMonitor: {
    on: (...args: unknown[]) => mocks.powerOn(...args),
    removeListener: (...args: unknown[]) => mocks.powerOff(...args)
  }
}))

vi.mock('../electron/main/state', () => ({
  pushState: {
    updateAvailable: (...args: unknown[]) => mocks.updateAvailable(...args),
    updateDownloaded: (...args: unknown[]) => mocks.updateDownloaded(...args),
    updateProgress: (...args: unknown[]) => mocks.updateProgress(...args),
    toast: (...args: unknown[]) => mocks.toast(...args)
  }
}))

vi.mock('../electron/main/macUpdateInstall', () => ({
  prepareMacUpdate: (...args: unknown[]) => mocks.prepare(...args),
  launchMacInstaller: (...args: unknown[]) => mocks.launch(...args),
  discardPreparedMacUpdate: (...args: unknown[]) => mocks.discard(...args),
  removeUnfinishedMacUpdateDirs: (...args: unknown[]) => mocks.removeUnfinished(...args)
}))

vi.mock('../electron/store/settings', async () => (await import('./helpers/settingsMock')).settingsModuleMock(mocks))

type Updater = typeof import('../electron/main/updater')

const API_URL = 'https://api.github.com/repos/SVorobiev-ru/Edge-Drop/releases?per_page=30'
const LATEST_PAGE = 'https://github.com/SVorobiev-ru/Edge-Drop/releases/latest'

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

describe('macOS updates: check, notify, download and install', () => {
  beforeEach(() => {
    setPlatform('darwin')
    delete process.env.APP_BUILD_TARGET
    mocks.version = '0.3.2-mac.1'
    mocks.isPackaged = true
    mocks.appPath = '/Applications/Edge-Drop.app/Contents/Resources/app.asar'
    mocks.settings = { updateMode: 'auto' }
    for (const fn of [mocks.netRequest, mocks.openExternal, mocks.updateAvailable, mocks.updateProgress, mocks.updateDownloaded, mocks.toast, mocks.quit, mocks.prepare, mocks.launch, mocks.discard, mocks.removeUnfinished, mocks.cancelInstaller, mocks.powerOn, mocks.powerOff]) fn.mockReset()
    mocks.appListeners.clear()
    mocks.launch.mockReturnValue(mocks.cancelInstaller)
    mocks.openExternal.mockResolvedValue(undefined)
    mocks.prepare.mockRejectedValue(new Error('not prepared in this test'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    restorePlatform()
  })

  afterAll(() => {
    restorePlatform()
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

  describe('in-app download and install', () => {
    const page = 'https://github.com/SVorobiev-ru/Edge-Drop/releases/tag/v0.4.0-mac.1'
    const assets = [{ name: 'Edge-Drop-0.4.0-mac.1-mac-arm64.zip', browser_download_url: 'x', size: 10 }]
    const prepared = { version: '0.4.0-mac.1', target: '/Applications/Edge-Drop.app', appPath: '/tmp/u/app/Edge-Drop.app', workDir: '/tmp/u' }

    async function checked(): Promise<Updater> {
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.4.0-mac.1', html_url: page, assets }])
      await updater.checkForUpdatesManual()
      return updater
    }

    it('downloads and verifies the release of the running architecture, then reports it downloaded', async () => {
      const updater = await checked()
      mocks.prepare.mockImplementation(async (input: { onProgress: (p: unknown) => void }) => {
        input.onProgress({ percent: 40, bytesPerSecond: 1, transferred: 4, total: 10 })
        return prepared
      })
      await expect(updater.startUpdateDownload()).resolves.toBeUndefined()
      expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ version: '0.4.0-mac.1', assets, repo: 'SVorobiev-ru/Edge-Drop', arch: process.arch }))
      expect(mocks.updateProgress).toHaveBeenCalledWith({ percent: 40, bytesPerSecond: 1, transferred: 4, total: 10 })
      expect(mocks.updateDownloaded).toHaveBeenCalledWith({ version: '0.4.0-mac.1' })
      expect(updater.getCachedUpdateState()).toEqual({ hasUpdate: true, latestVersion: '0.4.0-mac.1', downloaded: true })
      expect(mocks.openExternal).not.toHaveBeenCalled()
    })

    it('runs one download for concurrent requests', async () => {
      const updater = await checked()
      mocks.prepare.mockResolvedValue(prepared)
      await Promise.all([updater.startUpdateDownload(), updater.startUpdateDownload()])
      expect(mocks.prepare).toHaveBeenCalledTimes(1)
      await updater.startUpdateDownload()
      expect(mocks.prepare).toHaveBeenCalledTimes(1)
      expect(mocks.updateDownloaded).toHaveBeenCalledTimes(2)
    })

    it('falls back to the release page, resets the renderer and rejects when the download fails', async () => {
      const updater = await checked()
      mocks.updateAvailable.mockReset()
      mocks.prepare.mockRejectedValue(new Error('checksum mismatch'))
      await expect(updater.startUpdateDownload()).rejects.toThrow('checksum mismatch')
      expect(mocks.openExternal).toHaveBeenCalledWith(page)
      expect(mocks.toast).toHaveBeenCalledWith('toast.updateInstallFailed', 'error')
      expect(mocks.updateAvailable).toHaveBeenCalledWith({ version: '0.4.0-mac.1' })
      expect(updater.getCachedUpdateState()).toEqual({ hasUpdate: true, latestVersion: '0.4.0-mac.1', downloaded: false })
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
      await expect(updater.startUpdateDownload()).rejects.toThrow()
      expect(mocks.openExternal).toHaveBeenCalledWith(LATEST_PAGE)
    })

    it('passes the normalized URL to the browser', async () => {
      const updater = await loadUpdater()
      mockRelease([{ tag_name: 'v0.4.0-mac.1', html_url: 'HTTPS://GitHub.com:443/SVorobiev-ru/Edge-Drop/releases/x/../tag/v0.4.0-mac.1' }])
      await updater.checkForUpdatesManual()
      await expect(updater.startUpdateDownload()).rejects.toThrow()
      expect(mocks.openExternal).toHaveBeenCalledWith('https://github.com/SVorobiev-ru/Edge-Drop/releases/tag/v0.4.0-mac.1')
    })

    it('opens the fork releases page when nothing was checked yet', async () => {
      const updater = await loadUpdater()
      await expect(updater.startUpdateDownload()).rejects.toThrow()
      expect(mocks.openExternal).toHaveBeenCalledWith(LATEST_PAGE)
      expect(mocks.netRequest).not.toHaveBeenCalled()
      expect(mocks.prepare).not.toHaveBeenCalled()
    })

    it('reports the download failure even when the browser cannot be opened', async () => {
      const updater = await checked()
      mocks.openExternal.mockRejectedValue(new Error('no handler'))
      mocks.prepare.mockRejectedValue(new Error('offline'))
      await expect(updater.startUpdateDownload()).rejects.toThrow('offline')
    })

    it('installs a verified update and quits', async () => {
      const updater = await checked()
      mocks.prepare.mockResolvedValue(prepared)
      await updater.startUpdateDownload()
      updater.quitAndInstallUpdate()
      await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledTimes(1))
      expect(mocks.launch).toHaveBeenCalledWith(prepared)
      updater.discardMacUpdate()
      expect(mocks.discard).not.toHaveBeenCalled()
    })

    it('stops the installer, opens the release page and allows another install when the quit is cancelled', async () => {
      const updater = await checked()
      mocks.prepare.mockResolvedValue(prepared)
      await updater.startUpdateDownload()
      vi.useFakeTimers()
      updater.quitAndInstallUpdate()
      await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledTimes(1))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(mocks.cancelInstaller).toHaveBeenCalledTimes(1)
      expect(mocks.openExternal).toHaveBeenCalledWith(page)
      expect(mocks.toast).toHaveBeenCalledWith('toast.updateInstallFailed', 'error')
      expect(mocks.appListeners.has('will-quit')).toBe(false)
      updater.quitAndInstallUpdate()
      await vi.waitFor(() => expect(mocks.launch).toHaveBeenCalledTimes(2))
    })

    it('leaves the installer running when the quit goes ahead', async () => {
      const updater = await checked()
      mocks.prepare.mockResolvedValue(prepared)
      await updater.startUpdateDownload()
      vi.useFakeTimers()
      updater.quitAndInstallUpdate()
      await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledTimes(1))
      mocks.appListeners.get('will-quit')?.()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(mocks.cancelInstaller).not.toHaveBeenCalled()
      expect(mocks.openExternal).not.toHaveBeenCalled()
      updater.shutdownMacUpdates()
      expect(mocks.discard).not.toHaveBeenCalled()
      expect(mocks.removeUnfinished).not.toHaveBeenCalled()
    })

    it('stops the schedule and removes downloaded and unfinished updates on quit', async () => {
      const updater = await checked()
      vi.useFakeTimers()
      updater.initAutoUpdater()
      const resume = mocks.powerOn.mock.calls.find((call) => call[0] === 'resume')?.[1]
      expect(resume).toBeTypeOf('function')
      mocks.prepare.mockResolvedValue(prepared)
      await updater.startUpdateDownload()
      updater.shutdownMacUpdates()
      expect(mocks.powerOff).toHaveBeenCalledWith('resume', resume)
      expect(mocks.discard).toHaveBeenCalledWith(prepared)
      expect(mocks.removeUnfinished).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(3000)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('opens the release page and stays running when the installer cannot start', async () => {
      const updater = await checked()
      mocks.prepare.mockResolvedValue(prepared)
      await updater.startUpdateDownload()
      mocks.launch.mockImplementation(() => {
        throw new Error('EACCES')
      })
      updater.quitAndInstallUpdate()
      await vi.waitFor(() => expect(mocks.openExternal).toHaveBeenCalledWith(page))
      expect(mocks.quit).not.toHaveBeenCalled()
      expect(mocks.toast).toHaveBeenCalledWith('toast.updateInstallFailed', 'error')
    })

    it('opens the release page when install is requested without a verified update', async () => {
      const updater = await loadUpdater()
      expect(() => updater.quitAndInstallUpdate()).not.toThrow()
      await vi.waitFor(() => expect(mocks.openExternal).toHaveBeenCalledWith(LATEST_PAGE))
      expect(mocks.quit).not.toHaveBeenCalled()
      expect(mocks.launch).not.toHaveBeenCalled()
      expect(mocks.netRequest).not.toHaveBeenCalled()
    })

    it('removes a downloaded but not installed update on quit', async () => {
      const updater = await checked()
      mocks.prepare.mockResolvedValue(prepared)
      await updater.startUpdateDownload()
      updater.discardMacUpdate()
      expect(mocks.discard).toHaveBeenCalledWith(prepared)
    })

    it('keeps syncAutoUpdaterState a no-op', async () => {
      const updater = await loadUpdater()
      expect(() => updater.syncAutoUpdaterState()).not.toThrow()
      expect(mocks.netRequest).not.toHaveBeenCalled()
    })
  })

  describe('scheduled checks', () => {
    const HOUR = 60 * 60 * 1000
    const TICK = 10 * 60 * 1000
    const resumeHandlers = () => mocks.powerOn.mock.calls.filter((call) => call[0] === 'resume').map((call) => call[1] as () => void)

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-05T08:00:00Z'))
      mocks.settings = { updateMode: 'notify' }
      mockRelease([])
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    describe('isMacScheduledCheckDue', () => {
      it('is never due in the off mode', async () => {
        const { isMacScheduledCheckDue } = await loadUpdater()
        expect(isMacScheduledCheckDue({ mode: 'off', now: 100 * HOUR, lastCheckAt: 0, minGapMs: 6 * HOUR })).toBe(false)
        expect(isMacScheduledCheckDue({ mode: 'off', now: 100 * HOUR, lastCheckAt: HOUR, minGapMs: 6 * HOUR })).toBe(false)
      })

      it('is due when no check ran yet', async () => {
        const { isMacScheduledCheckDue } = await loadUpdater()
        expect(isMacScheduledCheckDue({ mode: 'notify', now: HOUR, lastCheckAt: 0, minGapMs: 24 * HOUR })).toBe(true)
      })

      it('waits for the whole gap', async () => {
        const { isMacScheduledCheckDue, MAC_UPDATE_CHECK_INTERVAL_MS, MAC_UPDATE_RESUME_MIN_GAP_MS } = await loadUpdater()
        expect(MAC_UPDATE_CHECK_INTERVAL_MS).toBe(24 * HOUR)
        expect(MAC_UPDATE_RESUME_MIN_GAP_MS).toBe(6 * HOUR)
        const last = 10 * HOUR
        expect(isMacScheduledCheckDue({ mode: 'auto', now: last + 6 * HOUR - 1, lastCheckAt: last, minGapMs: 6 * HOUR })).toBe(false)
        expect(isMacScheduledCheckDue({ mode: 'auto', now: last + 6 * HOUR, lastCheckAt: last, minGapMs: 6 * HOUR })).toBe(true)
        expect(isMacScheduledCheckDue({ mode: 'auto', now: last + 23 * HOUR, lastCheckAt: last, minGapMs: 24 * HOUR })).toBe(false)
        expect(isMacScheduledCheckDue({ mode: 'auto', now: last + 24 * HOUR, lastCheckAt: last, minGapMs: 24 * HOUR })).toBe(true)
      })

      it('is due after the clock moved backwards', async () => {
        const { isMacScheduledCheckDue } = await loadUpdater()
        expect(isMacScheduledCheckDue({ mode: 'notify', now: 5 * HOUR, lastCheckAt: 9 * HOUR, minGapMs: 24 * HOUR })).toBe(true)
      })
    })

    it('checks after launch and then once every 24 hours', async () => {
      const updater = await loadUpdater()
      updater.initAutoUpdater()
      await vi.advanceTimersByTimeAsync(3000)
      expect(mocks.netRequest).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(23 * HOUR)
      expect(mocks.netRequest).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(HOUR + TICK)
      expect(mocks.netRequest).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(24 * HOUR + TICK)
      expect(mocks.netRequest).toHaveBeenCalledTimes(3)
    })

    it('checks on resume only when the last check is at least 6 hours old', async () => {
      const updater = await loadUpdater()
      updater.initAutoUpdater()
      await vi.advanceTimersByTimeAsync(3000)
      expect(mocks.netRequest).toHaveBeenCalledTimes(1)
      expect(resumeHandlers()).toHaveLength(1)
      const [resume] = resumeHandlers()

      await vi.advanceTimersByTimeAsync(2 * HOUR)
      resume()
      await vi.advanceTimersByTimeAsync(10)
      expect(mocks.netRequest).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(4 * HOUR)
      resume()
      await vi.advanceTimersByTimeAsync(10)
      expect(mocks.netRequest).toHaveBeenCalledTimes(2)

      resume()
      await vi.advanceTimersByTimeAsync(10)
      expect(mocks.netRequest).toHaveBeenCalledTimes(2)
    })

    it('stays network-silent in the off mode, on the timer and on resume', async () => {
      mocks.settings = { updateMode: 'off' }
      const updater = await loadUpdater()
      updater.initAutoUpdater()
      await vi.advanceTimersByTimeAsync(49 * HOUR)
      resumeHandlers()[0]?.()
      await vi.advanceTimersByTimeAsync(HOUR)
      expect(mocks.netRequest).not.toHaveBeenCalled()
    })

    it('starts checking again once the mode leaves off', async () => {
      mocks.settings = { updateMode: 'off' }
      const updater = await loadUpdater()
      updater.initAutoUpdater()
      await vi.advanceTimersByTimeAsync(5 * HOUR)
      expect(mocks.netRequest).not.toHaveBeenCalled()

      mocks.settings = { updateMode: 'notify' }
      await vi.advanceTimersByTimeAsync(TICK + 1000)
      expect(mocks.netRequest).toHaveBeenCalledTimes(1)
    })

    it('registers the schedule only once', async () => {
      const updater = await loadUpdater()
      updater.initAutoUpdater()
      updater.initAutoUpdater()
      expect(resumeHandlers()).toHaveLength(1)
    })

    it('a manual check resets the 24 hour window', async () => {
      const updater = await loadUpdater()
      updater.initAutoUpdater()
      await vi.advanceTimersByTimeAsync(3000)
      await vi.advanceTimersByTimeAsync(20 * HOUR)
      await updater.checkForUpdatesManual()
      expect(mocks.netRequest).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(10 * HOUR)
      expect(mocks.netRequest).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(14 * HOUR + TICK)
      expect(mocks.netRequest).toHaveBeenCalledTimes(3)
    })
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

  it('does not import electron-updater statically', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'electron/main/updater.ts'), 'utf8')
    expect(src).not.toMatch(/^import\b[^\n]*['"]electron-updater['"]/m)
  })

  it('never loads electron-updater on macOS', async () => {
    const loader = (await import('node:module')).default as unknown as { _load: (request: string, ...rest: unknown[]) => unknown }
    const originalLoad = loader._load
    const load = vi.spyOn(loader, '_load').mockImplementation(function (this: unknown, request: string, ...rest: unknown[]) {
      return request === 'electron-updater' ? { autoUpdater: {} } : originalLoad.call(this, request, ...rest)
    })
    const loadedUpdater = () => load.mock.calls.filter((call) => call[0] === 'electron-updater')
    vi.useFakeTimers()
    const updater = await loadUpdater()
    mockRelease([{ tag_name: 'v0.4.0-mac.1' }])
    updater.initAutoUpdater()
    await vi.advanceTimersByTimeAsync(3000)
    await updater.checkForUpdatesManual()
    await updater.startUpdateDownload().catch(() => {})
    updater.syncAutoUpdaterState()
    expect(loadedUpdater()).toEqual([])

    setPlatform('win32')
    await updater.checkForUpdatesManual().catch(() => {})
    expect(loadedUpdater()).toHaveLength(1)
  })
})
