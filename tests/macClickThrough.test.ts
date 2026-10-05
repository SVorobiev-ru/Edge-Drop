import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS } from '../shared/types'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  windows: [] as Array<Record<string, any>>,
  sent: [] as Array<{ channel: string; payload: any }>,
  screenHandlers: {} as Record<string, () => void>,
  powerHandlers: {} as Record<string, () => void>,
  ipcHandlers: {} as Record<string, (...args: any[]) => unknown>,
  cursor: { x: 900, y: 500 },
  buttons: 0,
  display: {
    id: 1,
    bounds: { x: 0, y: 0, width: 1512, height: 982 },
    workArea: { x: 0, y: 25, width: 1512, height: 957 },
    scaleFactor: 2
  },
  settings: {} as Record<string, any>,
  showVibrancy: vi.fn(() => true),
  hideVibrancy: vi.fn(),
  dir: ''
}))

vi.mock('../electron/main/macNative', () => ({
  frontmostPid: () => 0,
  activatePid: () => true,
  weAreFrontmost: () => false,
  activateSelf: () => true,
  pressedMouseButtons: () => mocks.buttons,
  mouseButtonsAvailable: () => true,
  showPanelVibrancy: mocks.showVibrancy,
  hidePanelVibrancy: mocks.hideVibrancy
}))

vi.mock('koffi', () => import('./helpers/koffiMock'))

vi.mock('electron', async () => {
  const { electronMock, fakeBrowserWindowClass, fakeEmitter } = await import('./helpers/electronMock')
  return electronMock({
    BrowserWindow: fakeBrowserWindowClass({ windows: mocks.windows, sent: mocks.sent, bounds: { x: 0, y: 25, width: 310, height: 957 }, trackBounds: true }),
    screen: {
      ...fakeEmitter(() => mocks.screenHandlers),
      getPrimaryDisplay: () => mocks.display,
      getAllDisplays: () => [mocks.display],
      getCursorScreenPoint: () => ({ ...mocks.cursor })
    },
    ipcMain: {
      handle: (channel: string, fn: (...args: any[]) => unknown) => {
        mocks.ipcHandlers[channel] = fn
      }
    },
    powerMonitor: fakeEmitter(() => mocks.powerHandlers)
  })
})

vi.mock('../electron/main/config', () => ({
  APP_CONFIG: { is: { dev: false } },
  runtime: { quitting: false }
}))

vi.mock('../electron/store/paths', async () => (await import('./helpers/pathsMock')).pathsModuleMock({ root: () => mocks.dir, PATHS: { icon: () => '/mock/icon.png' } }))

vi.mock('../electron/main/fullscreen', () => ({
  isFullscreenAppActive: () => false,
  registerFullscreenActiveListener: () => {},
  pauseFullscreenMonitor: () => {},
  resumeFullscreenMonitor: () => {}
}))

vi.mock('../electron/main/macScreen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/main/macScreen')>()
  return { ...actual, readDockOrientation: () => Promise.resolve(null) }
})

type WindowModule = typeof import('../electron/main/window')
type ClickThroughModule = typeof import('../electron/main/clickThrough')

let win: WindowModule
let ct: ClickThroughModule

async function load(platform: string, settings: Record<string, unknown> = {}): Promise<Record<string, any>> {
  setPlatform(platform)
  vi.resetModules()
  const store = await import('../electron/store/settings')
  store.resetSettingsCache()
  store.saveSettings({ ...DEFAULT_SETTINGS, ...settings })
  win = await import('../electron/main/window')
  ct = await import('../electron/main/clickThrough')
  ct.resetClickThroughState()
  win.createWindow()
  win.startCursorPoll()
  return mocks.windows[0]
}

async function setSettings(patch: Record<string, unknown>): Promise<void> {
  const store = await import('../electron/store/settings')
  store.saveSettings(patch)
}

function ignoreCalls(w: Record<string, any>): unknown[][] {
  return w.setIgnoreMouseEvents.mock.calls
}

function lastIgnore(w: Record<string, any>): unknown[] {
  return ignoreCalls(w).at(-1) ?? []
}

const BLADE = { x: 0, y: 240, width: 270, height: 480 }

function report(open: boolean, rects = open ? [BLADE] : []): void {
  win.handlePanelState({ open, rects }, mocks.windows[0].webContents)
}

function at(x: number, y: number, ms = 100): void {
  mocks.cursor = { x, y }
  vi.advanceTimersByTime(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.dir = mkdtempSync(join(tmpdir(), 'edge-drop-clickthrough-'))
  mocks.windows.length = 0
  mocks.sent.length = 0
  mocks.screenHandlers = {}
  mocks.powerHandlers = {}
  mocks.ipcHandlers = {}
  mocks.cursor = { x: 900, y: 500 }
  mocks.buttons = 0
  mocks.showVibrancy.mockClear()
  mocks.hideVibrancy.mockClear()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  win?.stopCursorPoll()
  win?.stopHeartbeat()
  vi.useRealTimers()
  vi.restoreAllMocks()
  restorePlatform()
  rmSync(mocks.dir, { recursive: true, force: true })
})

afterAll(() => {
  restorePlatform()
})

describe('click-through state on macOS', () => {
  it('starts click-through without forwarding', async () => {
    const w = await load('darwin')
    expect(lastIgnore(w)).toEqual([true, { forward: false }])
    expect(ct.getClickThroughState().mode).toBe('closed')
  })

  it('re-applies click-through on every close, even when already closed', async () => {
    const w = await load('darwin')
    w.setIgnoreMouseEvents.mockClear()
    win.setInteractive(false)
    win.setInteractive(false)
    expect(ignoreCalls(w)).toEqual([[true, { forward: false }], [true, { forward: false }]])
  })

  it('takes clicks only inside the solid rects and switches only on change', async () => {
    const w = await load('darwin')
    win.setInteractive(true)
    report(true)
    w.setIgnoreMouseEvents.mockClear()

    at(100, 500, 160)
    expect(ignoreCalls(w)).toEqual([])

    at(600, 500, 160)
    expect(ignoreCalls(w)).toEqual([[true, { forward: true }]])

    at(700, 520, 160)
    expect(ignoreCalls(w)).toHaveLength(1)

    at(120, 500, 160)
    expect(ignoreCalls(w)).toEqual([[true, { forward: true }], [false]])
  })

  it('takes clicks only on a bottom dock and lets them through above it', async () => {
    const w = await load('darwin', { stickPosition: 'bottom' })
    win.setInteractive(true)
    report(true, [{ x: 216, y: 747, width: 1080, height: 210 }])
    w.setIgnoreMouseEvents.mockClear()
    at(700, 25 + 900, 160)
    expect(ignoreCalls(w)).toEqual([])
    at(700, 25 + 600, 160)
    expect(ignoreCalls(w)).toEqual([[true, { forward: true }]])
    at(100, 25 + 900, 160)
    expect(ignoreCalls(w)).toHaveLength(1)
    at(1290, 25 + 745, 160)
    expect(ignoreCalls(w)).toEqual([[true, { forward: true }], [false]])
  })

  it('counts a few pixels around a solid rect as inside', async () => {
    const w = await load('darwin')
    win.setInteractive(true)
    report(true)
    at(274, 500)
    expect(ct.getClickThroughState().mode).toBe('solid')
    at(280, 500)
    expect(ct.getClickThroughState().mode).toBe('forward')
    expect(lastIgnore(w)).toEqual([true, { forward: true }])
  })

  it('uses window coordinates for a panel on the right', async () => {
    const w = await load('darwin', { stickPosition: 'right' })
    const bounds = w.getBounds()
    win.setInteractive(true)
    report(true, [{ x: bounds.width - 270, y: 240, width: 270, height: 480 }])
    at(bounds.x + bounds.width - 100, 500)
    expect(ct.getClickThroughState().mode).toBe('solid')
    at(bounds.x - 50, 500)
    expect(ct.getClickThroughState().mode).toBe('forward')
  })

  it('keeps taking clicks while a mouse button is held after leaving the blade', async () => {
    await load('darwin')
    win.setInteractive(true)
    report(true)
    at(100, 500)
    mocks.buttons = 1
    at(600, 500)
    expect(ct.getClickThroughState().mode).toBe('solid')
    mocks.buttons = 0
    at(600, 500)
    expect(ct.getClickThroughState().mode).toBe('forward')
  })

  it('lets an OS drag with the button held enter the blade', async () => {
    await load('darwin')
    win.setInteractive(true)
    report(true)
    at(600, 500)
    expect(ct.getClickThroughState().mode).toBe('forward')
    mocks.buttons = 1
    at(50, 500)
    expect(ct.getClickThroughState().mode).toBe('solid')
  })

  it('stays solid while the renderer has not reported the open panel yet', async () => {
    await load('darwin')
    report(false)
    vi.advanceTimersByTime(50)
    win.setInteractive(true)
    at(900, 500, 300)
    expect(ct.getClickThroughState().mode).toBe('solid')
    expect(win.isInteractive()).toBe(true)
  })

  it('goes click-through as soon as the renderer reports the panel closing', async () => {
    await load('darwin')
    win.setInteractive(true)
    report(true)
    at(100, 500)
    vi.advanceTimersByTime(20)
    report(false)
    at(100, 500)
    expect(ct.getClickThroughState().mode).toBe('forward')
  })

  it('tolerates an empty report by treating the whole window as solid', async () => {
    await load('darwin')
    win.setInteractive(true)
    report(true, [])
    at(900, 500)
    expect(ct.getClickThroughState().mode).toBe('solid')
  })

  it('rejects malformed reports and reports from other windows', async () => {
    await load('darwin')
    win.handlePanelState({ open: 'yes', rects: [] }, mocks.windows[0].webContents)
    win.handlePanelState({ open: true, rects: [BLADE] }, {} as any)
    expect(ct.getClickThroughState().rendererOpen).toBe(false)
    win.handlePanelState({ open: true, rects: [{ x: Number.NaN, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: -1, height: 5 }, BLADE] }, mocks.windows[0].webContents)
    expect(ct.getClickThroughState().rects).toEqual([BLADE])
  })
})

describe('click-through watchdog on macOS', () => {
  it('forces click-through when the renderer reported closed for more than 600 ms', async () => {
    const w = await load('darwin')
    win.setInteractive(true)
    report(true)
    at(100, 500)
    vi.advanceTimersByTime(10)
    report(false)
    at(100, 500, 500)
    expect(win.isInteractive()).toBe(true)
    at(100, 500, 200)
    expect(win.isInteractive()).toBe(false)
    expect(lastIgnore(w)).toEqual([true, { forward: false }])
    expect(ct.getClickThroughState().lastForced).toBe('renderer-closed')
  })

  it('waits 1500 ms for the first report, then forces click-through and closes the renderer', async () => {
    await load('darwin')
    mocks.sent.length = 0
    win.setInteractive(true)
    at(900, 500, 700)
    expect(win.isInteractive()).toBe(true)
    at(900, 500, 700)
    expect(win.isInteractive()).toBe(true)
    expect(mocks.sent).not.toContainEqual({ channel: 'window:toggle', payload: false })
    at(900, 500, 200)
    expect(win.isInteractive()).toBe(false)
    expect(ct.getClickThroughState().lastForced).toBe('open-not-committed')
    expect(mocks.sent).toContainEqual({ channel: 'window:toggle', payload: false })
  })

  it('keeps the open when the first report arrives within 1500 ms', async () => {
    await load('darwin')
    win.setInteractive(true)
    at(900, 500, 1200)
    report(true)
    at(100, 500, 600)
    expect(win.isInteractive()).toBe(true)
    expect(ct.getClickThroughState().mode).toBe('solid')
  })

  it('does not toggle the renderer when it already reported the panel closed', async () => {
    await load('darwin')
    win.setInteractive(true)
    report(true)
    at(100, 500)
    vi.advanceTimersByTime(10)
    report(false)
    mocks.sent.length = 0
    at(100, 500, 700)
    expect(win.isInteractive()).toBe(false)
    expect(ct.getClickThroughState().lastForced).toBe('renderer-closed')
    expect(mocks.sent).not.toContainEqual({ channel: 'window:toggle', payload: false })
  })

  it('forces click-through and closes the panel when the renderer stops renewing while the cursor is away', async () => {
    await load('darwin')
    win.setInteractive(true)
    report(true)
    at(600, 500, 4900)
    expect(win.isInteractive()).toBe(true)
    mocks.sent.length = 0
    at(600, 500, 200)
    expect(win.isInteractive()).toBe(false)
    expect(ct.getClickThroughState().lastForced).toBe('renewal-timeout')
    expect(mocks.sent).toContainEqual({ channel: 'window:toggle', payload: false })
  })

  it('does not force while the cursor stays on the blade', async () => {
    await load('darwin')
    win.setInteractive(true)
    report(true)
    at(100, 500, 6000)
    expect(win.isInteractive()).toBe(true)
  })

  it('keeps an open panel interactive while the renderer renews', async () => {
    await load('darwin')
    win.setInteractive(true)
    for (let i = 0; i < 6; i++) {
      report(true)
      at(600, 500, 1500)
    }
    expect(win.isInteractive()).toBe(true)
  })

  it('resets on a renderer reload or crash', async () => {
    const w = await load('darwin')
    win.setInteractive(true)
    report(true)
    w.contentsHandlers['render-process-gone']()
    expect(win.isInteractive()).toBe(false)
    expect(ct.getClickThroughState().rendererOpen).toBe(false)
    expect(lastIgnore(w)).toEqual([true, { forward: false }])

    win.setInteractive(true)
    w.setIgnoreMouseEvents.mockClear()
    w.contentsHandlers['did-finish-load']()
    expect(win.isInteractive()).toBe(false)
    expect(ignoreCalls(w)).toEqual([[true, { forward: false }]])
  })

  it('re-asserts click-through after a reposition, unlock and resume', async () => {
    const w = await load('darwin')
    win.registerMacLockScreenHooks()
    w.setIgnoreMouseEvents.mockClear()
    win.repositionWindow()
    mocks.powerHandlers['unlock-screen']()
    mocks.powerHandlers.resume()
    expect(ignoreCalls(w)).toEqual([[true, { forward: false }], [true, { forward: false }], [true, { forward: false }]])
  })

  it('registers the panel-state handler and accepts reports through it', async () => {
    await load('darwin')
    win.registerPanelStateIpc()
    await mocks.ipcHandlers['window:panel-state']({ sender: mocks.windows[0].webContents }, { open: true, rects: [BLADE] })
    expect(ct.getClickThroughState().rendererOpen).toBe(true)
  })
})

describe('vibrancy follows the blade on macOS', () => {
  it('shows the effect view under the blade only when vibrancy is on and the panel is open', async () => {
    await load('darwin', { vibrancy: true })
    win.setInteractive(true)
    report(true)
    expect(mocks.showVibrancy).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ frame: BLADE, edge: 'left', dark: true }))
    report(false)
    expect(mocks.hideVibrancy).toHaveBeenCalledTimes(1)
  })

  it('rounds the corners for the edge the panel is drawn at, which may differ from the settings during a drag', async () => {
    await load('darwin', { vibrancy: true, stickPosition: 'left' })
    win.setInteractive(true)
    win.handlePanelState({ open: true, rects: [BLADE], edge: 'bottom' })
    expect(mocks.showVibrancy).toHaveBeenLastCalledWith(expect.any(Buffer), expect.objectContaining({ edge: 'bottom' }))
    win.handlePanelState({ open: true, rects: [BLADE], edge: 'middle' })
    expect(mocks.showVibrancy).toHaveBeenLastCalledWith(expect.any(Buffer), expect.objectContaining({ edge: 'left' }))
  })

  it('never creates the effect view while vibrancy is off', async () => {
    await load('darwin', { vibrancy: false })
    win.setInteractive(true)
    report(true)
    expect(mocks.showVibrancy).not.toHaveBeenCalled()
  })

  it('hides the effect view when the window goes click-through', async () => {
    await load('darwin', { vibrancy: true, stickPosition: 'right' })
    win.setInteractive(true)
    report(true)
    expect(mocks.showVibrancy).toHaveBeenLastCalledWith(expect.any(Buffer), expect.objectContaining({ edge: 'right' }))
    win.setInteractive(false)
    expect(mocks.hideVibrancy).toHaveBeenCalledTimes(1)
  })
})

describe('Windows keeps the old click-through', () => {
  it('ignores panel-state reports and toggles the window as before', async () => {
    const w = await load('win32')
    report(true)
    expect(ct.getClickThroughState().rendererOpen).toBe(false)
    w.setIgnoreMouseEvents.mockClear()
    win.setInteractive(true)
    at(900, 500, 1000)
    win.setInteractive(false)
    expect(ignoreCalls(w)).toEqual([[false], [true, { forward: false }]])
  })
})

describe('panel width and window geometry', () => {
  it.each([240, 270, 420])('covers the work area for a %ipx panel on macOS', async (panelWidth) => {
    const w = await load('darwin', { panelWidth })
    expect(w.options).toMatchObject({ x: 0, y: 25, width: 1512, height: 957 })
  })

  it.each(['right', 'top', 'bottom'])('covers the work area for the %s edge on macOS', async (stickPosition) => {
    const w = await load('darwin', { stickPosition, panelWidth: 420, dockWidth: 2000, dockHeight: 400 })
    expect(w.options).toMatchObject({ x: 0, y: 25, width: 1512, height: 957 })
  })

  it.each([240, 270, 420])('keeps the Windows margin for a %ipx panel (384 at the default)', async (panelWidth) => {
    const w = await load('win32', { panelWidth })
    expect(w.options.width).toBe(panelWidth + 114)
  })

  it('opens and closes the preview without moving or resizing the window on macOS', async () => {
    const w = await load('darwin', { stickPosition: 'right' })
    w.setBounds.mockClear()
    win.setPreviewMode(true)
    await setSettings({ panelWidth: 420 })
    win.setPreviewMode(false)
    vi.advanceTimersByTime(200)
    expect(w.setBounds).not.toHaveBeenCalled()
  })

  it('keeps the bottom edge on macOS only', async () => {
    expect((await load('darwin', { stickPosition: 'bottom' })).options.height).toBe(957)
    const store = await import('../electron/store/settings')
    expect(store.loadSettings().stickPosition).toBe('bottom')
    mocks.windows.length = 0
    win.stopCursorPoll()
    await load('win32', { stickPosition: 'bottom' })
    const winStore = await import('../electron/store/settings')
    expect(winStore.loadSettings().stickPosition).toBe('left')
  })

  it('does not change the top dock with the panel width', async () => {
    const def = await load('darwin', { stickPosition: 'top' })
    const defaults = { ...def.options }
    mocks.windows.length = 0
    win.stopCursorPoll()
    const wide = await load('darwin', { stickPosition: 'top', panelWidth: 420 })
    expect({ x: wide.options.x, y: wide.options.y, width: wide.options.width, height: wide.options.height })
      .toEqual({ x: defaults.x, y: defaults.y, width: defaults.width, height: defaults.height })
  })

  it('resizes the window live when the width setting changes on Windows', async () => {
    const w = await load('win32', { stickPosition: 'right' })
    w.setBounds.mockClear()
    await setSettings({ panelWidth: 380 })
    vi.advanceTimersByTime(200)
    const bounds = w.setBounds.mock.calls.at(-1)[0]
    expect(bounds.width).toBe(494)
    expect(bounds.x + bounds.width).toBe(1512)
    w.setBounds.mockClear()
    vi.advanceTimersByTime(500)
    expect(w.setBounds).not.toHaveBeenCalled()
  })

  it('does not touch the window when the width setting changes on macOS', async () => {
    const w = await load('darwin', { stickPosition: 'right' })
    w.setBounds.mockClear()
    await setSettings({ panelWidth: 380 })
    vi.advanceTimersByTime(200)
    expect(w.setBounds).not.toHaveBeenCalled()
  })
})

describe('moving the panel by its header', () => {
  const DRAG_METHODS = ['setPosition', 'getPosition', 'setOpacity', 'hide', 'destroy'] as const
  let saved: Array<[string, PropertyDescriptor | undefined]> = []

  beforeEach(async () => {
    const { BrowserWindow } = await import('electron')
    const proto = (BrowserWindow as any).prototype
    saved = DRAG_METHODS.map((name) => [name, Object.getOwnPropertyDescriptor(proto, name)])
    Object.assign(proto, {
      setPosition(this: Record<string, any>, x: number, y: number) { this.bounds = { ...this.bounds, x, y } },
      getPosition(this: Record<string, any>) { return [this.bounds.x, this.bounds.y] },
      setOpacity: vi.fn(),
      hide: vi.fn(),
      destroy: vi.fn()
    })
  })

  afterEach(async () => {
    const { BrowserWindow } = await import('electron')
    const proto = (BrowserWindow as any).prototype
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, name, descriptor)
      else delete proto[name]
    }
  })

  async function startDrag(): Promise<Record<string, any>> {
    const w = await load('darwin', { stickPosition: 'left' })
    win.registerPanelDragIpc()
    mocks.buttons = 1
    mocks.cursor = { x: 100, y: 300 }
    expect(mocks.ipcHandlers['window:panel-drag-start']({ sender: w.webContents }, BLADE)).toBe(true)
    return w
  }

  it('holds repositioning during the drag and saves the snapped placement on release', async () => {
    const w = await startDrag()
    mocks.cursor = { x: 1350, y: 340 }
    vi.advanceTimersByTime(16)
    w.setBounds.mockClear()
    win.repositionWindow()
    expect(w.setBounds).not.toHaveBeenCalled()
    const result = mocks.ipcHandlers['window:panel-drag-end']({ sender: w.webContents }, true) as { moved: boolean; settings: Record<string, any> }
    expect(result.moved).toBe(true)
    expect(result.settings).toMatchObject({ stickPosition: 'right', stickDisplayId: 1 })
    const store = await import('../electron/store/settings')
    expect(store.loadSettings().stickPosition).toBe('right')
    for (const [bounds] of w.setBounds.mock.calls) expect(bounds).toMatchObject({ x: 0, y: 25, width: 1512, height: 957 })
    expect(mocks.sent.some((m) => m.channel === 'window:panel-drag-placement' && m.payload.edge === 'right')).toBe(true)
    expect(mocks.sent.some((m) => m.channel === 'state:settings' && m.payload.stickPosition === 'right')).toBe(true)
    expect(w.setOpacity).not.toHaveBeenCalled()
  })

  it('does not force-close the panel on a stale rect report while the drag runs', async () => {
    const w = await load('darwin', { stickPosition: 'right' })
    win.registerPanelDragIpc()
    const blade = { x: 700, y: 240, width: 270, height: 480 }
    win.setInteractive(true)
    report(true, [blade])
    mocks.buttons = 1
    mocks.cursor = { x: 1300, y: 400 }
    expect(mocks.ipcHandlers['window:panel-drag-start']({ sender: w.webContents }, blade)).toBe(true)
    vi.advanceTimersByTime(6000)
    expect(win.isInteractive()).toBe(true)
    expect(ct.getClickThroughState().lastForced).not.toBe('renewal-timeout')
    mocks.ipcHandlers['window:panel-drag-end']({ sender: w.webContents }, false)
  })

  it.each(['render-process-gone', 'did-start-loading'])('cancels the drag on %s', async (event) => {
    const w = await startDrag()
    mocks.cursor = { x: 900, y: 340 }
    vi.advanceTimersByTime(16)
    w.contentsHandlers[event]()
    w.setBounds.mockClear()
    win.repositionWindow()
    expect(w.setBounds).toHaveBeenCalled()
    const store = await import('../electron/store/settings')
    expect(store.loadSettings().stickPosition).toBe('left')
  })
})

describe('panel width clamp', () => {
  it('clamps, snaps to 10 px and defaults invalid values', async () => {
    const { clampPanelWidth } = await import('../shared/panelWidth')
    expect(clampPanelWidth(undefined)).toBe(270)
    expect(clampPanelWidth(Number.NaN)).toBe(270)
    expect(clampPanelWidth('300')).toBe(270)
    expect(clampPanelWidth(100)).toBe(240)
    expect(clampPanelWidth(999)).toBe(420)
    expect(clampPanelWidth(304)).toBe(300)
    expect(clampPanelWidth(306)).toBe(310)
  })

  it('stores the clamped value', async () => {
    setPlatform('darwin')
    vi.resetModules()
    const store = await import('../electron/store/settings')
    store.resetSettingsCache()
    expect(store.saveSettings({ panelWidth: 1000 }).panelWidth).toBe(420)
    expect(store.saveSettings({ panelWidth: 12 }).panelWidth).toBe(240)
    expect(store.saveSettings({ panelWidth: 333 }).panelWidth).toBe(330)
    expect(store.loadSettings().panelWidth).toBe(330)
  })
})
