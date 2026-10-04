import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/types'

const mocks = vi.hoisted(() => ({
  frontmostPid: vi.fn(),
  activatePid: vi.fn(),
  weAreFrontmost: vi.fn(),
  windows: [] as Array<Record<string, any>>,
  calls: [] as string[]
}))

vi.mock('../electron/main/macNative', () => ({
  frontmostPid: () => mocks.frontmostPid(),
  activatePid: (pid: number) => mocks.activatePid(pid),
  weAreFrontmost: () => mocks.weAreFrontmost()
}))

vi.mock('koffi', () => ({
  default: { load: () => ({ func: () => () => null }) }
}))

vi.mock('electron', () => {
  class FakeBrowserWindow {
    setFocusable = vi.fn((focusable: boolean) => {
      mocks.calls.push(`setFocusable(${focusable})`)
    })
    focus = vi.fn()
    isDestroyed = vi.fn(() => false)
    isVisible = vi.fn(() => true)
    getBounds = vi.fn(() => ({ x: 0, y: 0, width: 384, height: 900 }))
    setVisibleOnAllWorkspaces = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    setAlwaysOnTop = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
    on = vi.fn()
    once = vi.fn()
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() }
    constructor() {
      mocks.windows.push(this as unknown as Record<string, any>)
    }
  }
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }
  return {
    BrowserWindow: FakeBrowserWindow,
    app: { focus: vi.fn(), getAppPath: () => '/mock/app', getPath: () => '/mock/userData' },
    screen: {
      on: vi.fn(),
      getPrimaryDisplay: () => display,
      getAllDisplays: () => [display]
    },
    shell: { openExternal: vi.fn() },
    powerMonitor: { on: vi.fn() }
  }
})

vi.mock('../electron/main/config', () => ({
  APP_CONFIG: { is: { dev: false } },
  runtime: { quitting: false }
}))

vi.mock('../electron/store/paths', () => ({
  PATHS: { icon: () => '/mock/icon.png' }
}))

vi.mock('../electron/store/settings', () => ({
  loadSettings: () => ({ ...DEFAULT_SETTINGS }),
  saveSettings: vi.fn((patch: Record<string, unknown>) => ({ ...DEFAULT_SETTINGS, ...patch }))
}))

vi.mock('../electron/main/fullscreen', () => ({
  isFullscreenAppActive: () => false,
  registerFullscreenActiveListener: vi.fn()
}))

type WindowModule = typeof import('../electron/main/window')

const realPlatform = process.platform
const EXTERNAL_PID = 4242

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

let win: WindowModule

async function loadWindowModule(): Promise<WindowModule> {
  vi.resetModules()
  return import('../electron/main/window')
}

describe('macOS paste target (window.ts)', () => {
  let weFront: boolean

  beforeEach(async () => {
    vi.useFakeTimers()
    setPlatform('darwin')
    mocks.windows.length = 0
    mocks.calls.length = 0
    weFront = false
    mocks.frontmostPid.mockReset()
    mocks.frontmostPid.mockReturnValue(0)
    mocks.weAreFrontmost.mockReset()
    mocks.weAreFrontmost.mockImplementation(() => weFront)
    mocks.activatePid.mockReset()
    mocks.activatePid.mockImplementation((pid: number) => {
      mocks.calls.push(`activatePid(${pid})`)
      weFront = false
      return true
    })
    win = await loadWindowModule()
  })

  afterEach(() => {
    win.stopHeartbeat()
    vi.useRealTimers()
    setPlatform(realPlatform)
  })

  afterAll(() => {
    setPlatform(realPlatform)
  })

  function openWindowWithExternalApp(pid = EXTERNAL_PID): Record<string, any> {
    win.createWindow()
    mocks.frontmostPid.mockReturnValue(pid)
    win.captureExternalForeground()
    return mocks.windows[0]
  }

  describe('captureExternalForeground', () => {
    it('remembers the frontmost app and hands focus back to it', async () => {
      mocks.frontmostPid.mockReturnValue(EXTERNAL_PID)
      win.captureExternalForeground()
      await expect(win.restoreExternalFocusAwaited()).resolves.toBe(true)
      expect(mocks.activatePid).toHaveBeenCalledWith(EXTERNAL_PID)
    })

    it('is last-wins across captures', async () => {
      mocks.frontmostPid.mockReturnValue(111)
      win.captureExternalForeground()
      mocks.frontmostPid.mockReturnValue(222)
      win.captureExternalForeground()
      await win.restoreExternalFocusAwaited()
      expect(mocks.activatePid).toHaveBeenCalledWith(222)
    })

    it('never records our own pid', async () => {
      mocks.frontmostPid.mockReturnValue(process.pid)
      win.captureExternalForeground()
      await win.restoreExternalFocusAwaited()
      expect(mocks.activatePid).toHaveBeenCalledWith(0)
    })

    it('keeps the previous app when the frontmost pid is unknown', async () => {
      mocks.frontmostPid.mockReturnValue(EXTERNAL_PID)
      win.captureExternalForeground()
      mocks.frontmostPid.mockReturnValue(0)
      win.captureExternalForeground()
      await win.restoreExternalFocusAwaited()
      expect(mocks.activatePid).toHaveBeenCalledWith(EXTERNAL_PID)
    })

    it('passes the activation failure through to restoreExternalFocusAwaited', async () => {
      mocks.frontmostPid.mockReturnValue(EXTERNAL_PID)
      win.captureExternalForeground()
      mocks.activatePid.mockReturnValue(false)
      await expect(win.restoreExternalFocusAwaited()).resolves.toBe(false)
    })
  })

  describe('holdsOwnForeground', () => {
    it('mirrors weAreFrontmost', () => {
      weFront = true
      expect(win.holdsOwnForeground()).toBe(true)
      weFront = false
      expect(win.holdsOwnForeground()).toBe(false)
    })
  })

  describe('resolvePasteTarget', () => {
    it('returns the normal delay straight away when another app is frontmost', async () => {
      const win0 = openWindowWithExternalApp()
      weFront = false

      await expect(win.resolvePasteTarget(40)).resolves.toBe(40)

      expect(win0.setFocusable).not.toHaveBeenCalled()
      expect(mocks.activatePid).not.toHaveBeenCalled()
    })

    it('drops focusability, activates the captured app and returns 80 after the 150ms settle', async () => {
      const win0 = openWindowWithExternalApp()
      weFront = true

      let settled: number | null = null
      const pending = win.resolvePasteTarget(40).then((v) => {
        settled = v
      })

      await vi.advanceTimersByTimeAsync(149)
      expect(settled).toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      await pending

      expect(settled).toBe(80)
      expect(win0.setFocusable).toHaveBeenCalledTimes(1)
      expect(win0.setFocusable).toHaveBeenCalledWith(false)
      expect(mocks.activatePid).toHaveBeenCalledTimes(1)
      expect(mocks.calls).toEqual(['setFocusable(false)', `activatePid(${EXTERNAL_PID})`])
    })

    it('returns -1 when we are still frontmost after the handoff', async () => {
      openWindowWithExternalApp()
      weFront = true
      mocks.activatePid.mockImplementation((pid: number) => {
        mocks.calls.push(`activatePid(${pid})`)
        return false
      })

      const pending = win.resolvePasteTarget(40)
      await vi.advanceTimersByTimeAsync(150)

      await expect(pending).resolves.toBe(-1)
      expect(mocks.activatePid).toHaveBeenCalledWith(EXTERNAL_PID)
    })

    it('returns -1 without activating anything when no external app was ever captured', async () => {
      const win0 = openWindowWithExternalApp(0)
      weFront = true

      const pending = win.resolvePasteTarget(40)
      await vi.advanceTimersByTimeAsync(150)

      await expect(pending).resolves.toBe(-1)
      expect(win0.setFocusable).toHaveBeenCalledWith(false)
      expect(mocks.activatePid).not.toHaveBeenCalled()
    })

    it('falls back to the normal delay when weAreFrontmost throws on the first check', async () => {
      const win0 = openWindowWithExternalApp()
      mocks.weAreFrontmost.mockImplementation(() => {
        throw new Error('objc failure')
      })

      await expect(win.resolvePasteTarget(40)).resolves.toBe(40)
      expect(win0.setFocusable).not.toHaveBeenCalled()
    })

    it('falls back to the normal delay when the final check throws', async () => {
      openWindowWithExternalApp()
      let calls = 0
      mocks.weAreFrontmost.mockImplementation(() => {
        calls++
        if (calls >= 3) throw new Error('objc failure')
        return true
      })

      const pending = win.resolvePasteTarget(40)
      await vi.advanceTimersByTimeAsync(150)

      await expect(pending).resolves.toBe(40)
    })

    it('is not used on linux: the normal delay is returned without touching macNative', async () => {
      setPlatform('linux')
      win = await loadWindowModule()

      await expect(win.resolvePasteTarget(40)).resolves.toBe(40)

      expect(mocks.weAreFrontmost).not.toHaveBeenCalled()
      expect(mocks.frontmostPid).not.toHaveBeenCalled()
      expect(mocks.activatePid).not.toHaveBeenCalled()
    })
  })
})
