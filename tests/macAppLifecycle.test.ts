import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { restorePlatform, setPlatform } from './helpers/platform'

type Handler = (...args: any[]) => any

const mocks = vi.hoisted(() => ({
  appHandlers: {} as Record<string, Handler>,
  ready: null as Promise<void> | null,
  isPackaged: true,
  inApplications: true,
  changeCount: 7,
  calls: [] as string[],
  runtime: { quitting: false },
  app: {
    disableHardwareAcceleration: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    setAsDefaultProtocolClient: vi.fn(),
    isInApplicationsFolder: vi.fn(),
    setPath: vi.fn(),
    exit: vi.fn(),
    quit: vi.fn()
  },
  createWindow: vi.fn(),
  createTray: vi.fn(),
  initState: vi.fn(),
  ensureDirs: vi.fn(),
  loadSettings: vi.fn(),
  getStore: vi.fn(),
  reconcile: vi.fn(),
  persistSync: vi.fn(),
  flushStagedTempRegistry: vi.fn(),
  shutdownMacUpdates: vi.fn(),
  stopImageTextRecognition: vi.fn(),
  closeQuickLook: vi.fn()
}))

vi.mock('electron', async () => {
  const { electronMock } = await import('./helpers/electronMock')
  return electronMock({
    app: {
      ...mocks.app,
      get isPackaged() {
        return mocks.isPackaged
      },
      isInApplicationsFolder: () => {
        mocks.app.isInApplicationsFolder()
        return mocks.inApplications
      },
      exit: (code: number) => {
        mocks.calls.push(`exit(${code})`)
        mocks.app.exit(code)
      },
      on: (event: string, fn: Handler) => {
        mocks.appHandlers[event] = fn
      },
      whenReady: () => mocks.ready,
      enableSandbox: vi.fn(),
      commandLine: { appendSwitch: vi.fn() },
      setAppUserModelId: vi.fn(),
      dock: { hide: vi.fn() }
    },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
    session: { defaultSession: { setPermissionRequestHandler: vi.fn() } }
  })
})

vi.mock('koffi', () => ({ default: { version: '2.0.0-test' } }))
vi.mock('../electron/main/config', () => ({
  APP_CONFIG: { imageProtocol: 'edgelocal', is: { dev: false } },
  runtime: mocks.runtime,
  isStoreBuild: () => false,
  shouldStartHidden: () => false
}))
vi.mock('../electron/store/paths', async () => ({ ...(await import('./helpers/pathsMock')).pathsModuleMock(), ensureDirs: mocks.ensureDirs }))
vi.mock('../electron/main/window', () => ({
  createWindow: mocks.createWindow,
  getMainWindow: () => null,
  setInteractive: vi.fn(),
  markExplicitOpen: vi.fn(),
  setVisible: vi.fn(),
  startCursorPoll: vi.fn(),
  stopCursorPoll: () => mocks.calls.push('stopCursorPoll'),
  stopHeartbeat: vi.fn(),
  setHotZoneWidth: vi.fn(),
  registerTaskbarCreatedListener: vi.fn(),
  registerMacLockScreenHooks: vi.fn(),
  syncMacEscapeCapture: vi.fn(),
  registerPanelStateIpc: vi.fn(),
  registerPanelDragIpc: vi.fn()
}))
vi.mock('../electron/main/tray', () => ({ createTray: mocks.createTray, registerIncognitoApplier: vi.fn(), refreshTray: vi.fn(), openPanelFromShell: vi.fn() }))
vi.mock('../electron/main/ipc', () => ({ registerIpc: vi.fn(), registerSendListeners: vi.fn() }))
vi.mock('../electron/main/loginItems', () => ({ reconcileLaunchAtLoginOnStartup: mocks.reconcile }))
vi.mock('../electron/main/drag', () => ({ prewarmDragIcons: vi.fn() }))
vi.mock('../electron/main/state', async () =>
  (await import('./helpers/stateMock')).stateModuleMock({
    initState: mocks.initState,
    getStore: mocks.getStore,
    loadSettings: mocks.loadSettings,
    getWatcher: () => ({ stop: () => mocks.calls.push('watcher.stop'), setPaused: vi.fn() }),
    stopStateTimers: vi.fn(),
    addScreenshotToHistory: vi.fn(),
    setImageAddedListener: vi.fn()
  })
)
vi.mock('../electron/main/updater', () => ({ initAutoUpdater: vi.fn(), shutdownMacUpdates: mocks.shutdownMacUpdates }))
vi.mock('../electron/main/macScreenshots', () => ({ startScreenshotWatcher: vi.fn(), stopScreenshotWatcher: vi.fn() }))
vi.mock('../electron/main/onboardingWindow', () => ({ createOnboardingWindow: vi.fn() }))
vi.mock('../electron/main/macAppMenu', () => ({ installMacAppMenu: vi.fn() }))
vi.mock('../electron/main/fullscreen', () => ({ startFullscreenMonitor: vi.fn(), stopFullscreenMonitor: vi.fn(), triggerFullscreenCheck: vi.fn() }))
vi.mock('../electron/main/stagedTemp', () => ({ flushStagedTempRegistry: mocks.flushStagedTempRegistry }))
vi.mock('../electron/main/ocr', () => ({ stopImageTextRecognition: mocks.stopImageTextRecognition, wakeImageTextRecognition: vi.fn() }))
vi.mock('../electron/main/quickLook', () => ({ closeQuickLook: mocks.closeQuickLook }))
vi.mock('../electron/main/macPasteboard', () => ({ pasteboardChangeCount: () => mocks.changeCount }))
vi.mock('../electron/main/imageProtocol', () => ({ resolveStoredImage: vi.fn(), resolveEmojiAsset: vi.fn(), emojiAssetDir: vi.fn() }))
vi.mock('../electron/main/thumbnailCache', () => ({ getThumbnailPayloadAsync: vi.fn(), thumbnailCacheControl: vi.fn(), isMacHeicPath: vi.fn(), getHeicPreviewPng: vi.fn() }))

const realArgv = process.argv

async function startMain(platform: string, args: string[] = []): Promise<void> {
  setPlatform(platform)
  process.argv = [...realArgv, ...args]
  vi.resetModules()
  await import('../electron/main/index')
  await Promise.resolve()
  await Promise.resolve()
}

let written: string[]

beforeEach(() => {
  mocks.appHandlers = {}
  mocks.ready = Promise.resolve()
  mocks.isPackaged = true
  mocks.inApplications = true
  mocks.changeCount = 7
  mocks.calls.length = 0
  mocks.runtime.quitting = false
  for (const fn of [...Object.values(mocks.app), mocks.createWindow, mocks.createTray, mocks.initState, mocks.ensureDirs, mocks.getStore, mocks.loadSettings, mocks.reconcile, mocks.persistSync, mocks.flushStagedTempRegistry, mocks.shutdownMacUpdates, mocks.stopImageTextRecognition, mocks.closeQuickLook]) fn.mockReset()
  mocks.app.requestSingleInstanceLock.mockReturnValue(true)
  mocks.loadSettings.mockReturnValue({ tutorialCompleted: true, hotZoneWidth: 3, incognito: false, language: 'en' })
  mocks.reconcile.mockResolvedValue({})
  mocks.persistSync.mockImplementation(() => mocks.calls.push('persistSync'))
  mocks.getStore.mockReturnValue({ persistSync: mocks.persistSync, list: () => [] })
  written = []
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
    written.push(String(chunk))
    return true
  }) as never)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.argv = realArgv
  vi.useRealTimers()
  vi.restoreAllMocks()
  restorePlatform()
})

describe('main process startup', () => {
  it.each(['darwin', 'win32'])('uses software compositing on %s', async (platform) => {
    mocks.ready = new Promise(() => {})
    await startMain(platform)
    expect(mocks.app.disableHardwareAcceleration).toHaveBeenCalledTimes(1)
  })
})

describe('quitting on macOS', () => {
  it('stops text recognition and Quick Look, persists and then arms a watchdog', async () => {
    mocks.ready = new Promise(() => {})
    await startMain('darwin')
    vi.useFakeTimers()

    mocks.appHandlers['before-quit']()

    expect(mocks.runtime.quitting).toBe(true)
    expect(mocks.stopImageTextRecognition).toHaveBeenCalledTimes(1)
    expect(mocks.closeQuickLook).toHaveBeenCalledTimes(1)
    expect(mocks.shutdownMacUpdates).toHaveBeenCalledTimes(1)
    expect(mocks.flushStagedTempRegistry).toHaveBeenCalledTimes(1)
    expect(mocks.calls).toEqual(['stopCursorPoll', 'watcher.stop', 'persistSync'])

    await vi.advanceTimersByTimeAsync(2999)
    expect(mocks.app.exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.calls).toEqual(['stopCursorPoll', 'watcher.stop', 'persistSync', 'exit(0)'])
  })

  it('arms the watchdog only once and still quits when persisting fails', async () => {
    mocks.ready = new Promise(() => {})
    await startMain('darwin')
    vi.useFakeTimers()
    mocks.persistSync.mockImplementation(() => {
      throw new Error('disk full')
    })

    mocks.appHandlers['before-quit']()
    mocks.appHandlers['before-quit']()

    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.app.exit).toHaveBeenCalledTimes(1)
    expect(mocks.app.exit).toHaveBeenCalledWith(0)
  })

  it('keeps the Windows quit path without the mac shutdown steps or a watchdog', async () => {
    mocks.ready = new Promise(() => {})
    await startMain('win32')
    vi.useFakeTimers()

    mocks.appHandlers['before-quit']()

    expect(mocks.persistSync).toHaveBeenCalledTimes(1)
    expect(mocks.stopImageTextRecognition).not.toHaveBeenCalled()
    expect(mocks.closeQuickLook).not.toHaveBeenCalled()
    expect(mocks.shutdownMacUpdates).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('edgedrop:// registration', () => {
  it('claims the scheme from a packaged build in the Applications folder', async () => {
    await startMain('darwin')
    expect(mocks.createWindow).toHaveBeenCalledTimes(1)
    expect(mocks.app.setAsDefaultProtocolClient).toHaveBeenCalledWith('edgedrop')
  })

  it('leaves the scheme alone outside the Applications folder', async () => {
    mocks.inApplications = false
    await startMain('darwin')
    expect(mocks.createWindow).toHaveBeenCalledTimes(1)
    expect(mocks.app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })

  it('leaves the scheme alone in a development run', async () => {
    mocks.isPackaged = false
    await startMain('darwin')
    expect(mocks.createWindow).toHaveBeenCalledTimes(1)
    expect(mocks.app.isInApplicationsFolder).not.toHaveBeenCalled()
    expect(mocks.app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })

  it('never claims the scheme on Windows', async () => {
    await startMain('win32')
    expect(mocks.createWindow).toHaveBeenCalledTimes(1)
    expect(mocks.app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })
})

describe('smoke test mode in the main process', () => {
  function smokeResult(): Record<string, unknown> {
    const line = written.find((chunk) => chunk.includes('"smokeTest"'))
    expect(line).toBeDefined()
    return JSON.parse(line!)
  }

  it('reports the pasteboard change count and exits before the single-instance lock and the app setup', async () => {
    await startMain('darwin', ['--smoke-test'])

    expect(smokeResult()).toMatchObject({ smokeTest: true, ok: true, changeCount: 7, koffi: '2.0.0-test', arch: process.arch })
    expect(mocks.app.exit).toHaveBeenCalledWith(0)
    expect(mocks.app.requestSingleInstanceLock).not.toHaveBeenCalled()
    for (const fn of [mocks.createWindow, mocks.createTray, mocks.initState, mocks.ensureDirs, mocks.getStore, mocks.loadSettings, mocks.reconcile]) {
      expect(fn).not.toHaveBeenCalled()
    }
    expect(mocks.appHandlers['open-url']).toBeUndefined()
  })

  it('runs in a throwaway profile that is removed afterwards', async () => {
    await startMain('darwin', ['--smoke-test'])

    expect(mocks.app.setPath).toHaveBeenCalledTimes(1)
    const [name, profileDir] = mocks.app.setPath.mock.calls[0] as [string, string]
    expect(name).toBe('userData')
    expect(profileDir).toContain('edge-drop-smoke-')
    expect(existsSync(profileDir)).toBe(false)
  })

  it('fails with exit code 1 when the pasteboard is unreadable', async () => {
    mocks.changeCount = -1
    await startMain('darwin', ['--smoke-test'])

    expect(smokeResult()).toMatchObject({ smokeTest: true, ok: false, changeCount: -1 })
    expect(mocks.app.exit).toHaveBeenCalledWith(1)
  })

  it('is ignored off darwin', async () => {
    await startMain('win32', ['--smoke-test'])

    expect(written.some((chunk) => chunk.includes('"smokeTest"'))).toBe(false)
    expect(mocks.app.requestSingleInstanceLock).toHaveBeenCalledTimes(1)
    expect(mocks.createWindow).toHaveBeenCalledTimes(1)
  })
})
