import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ItemData } from '../shared/types'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (...args: any[]) => any>(),
  handlers: new Map<string, (...args: any[]) => any>(),
  pressed: 0,
  postCommandV: vi.fn(() => true),
  trusted: true,
  isTrusted: vi.fn(),
  execFile: vi.fn(),
  psRun: vi.fn(),
  toasts: [] as Array<{ message: string; tone: string }>,
  startDragOut: vi.fn(() => true),
  resolveDragData: vi.fn(),
  stageDragFile: vi.fn(),
  setHeartbeatPaused: vi.fn(),
  cursor: { x: 5000, y: 5000 },
  touch: vi.fn(),
  pushItems: vi.fn(),
  writeImage: vi.fn(),
  openExternal: vi.fn(() => Promise.resolve()),
  bridgeReady: true,
  showMessageBox: vi.fn(),
  language: 'en',
  systemLanguages: ['en-US'],
  localPath: vi.fn(),
  addFiles: vi.fn(),
  canPost: true,
  requestPostEvents: vi.fn(() => true),
  frontPids: [] as number[],
  activatePid: vi.fn(() => true),
  appFocus: vi.fn(),
  refreshScreenshotWatcher: vi.fn(),
  saveSettings: vi.fn(),
  writeFileUrls: vi.fn(),
  addFileUrl: vi.fn(),
  addImageData: vi.fn(),
  changeCount: 41,
  imageEmpty: false,
  items: new Map<string, unknown>(),
  watcher: { setPaused: vi.fn(), resyncSignature: vi.fn(), invalidateSignature: vi.fn(), noteSelfWrite: vi.fn() },
  clipboardClear: vi.fn(),
  clipboardWriteText: vi.fn(),
  clipboardSignature: vi.fn(),
  signatureMatchesItem: vi.fn(),
  storeDelete: vi.fn(),
  notificationSupported: true,
  notificationThrows: false,
  notifications: [] as Array<{ options: { title: string; body: string; icon?: string }; show: ReturnType<typeof vi.fn>; click: () => void }>
}))

vi.mock('electron', async () => {
  const { electronMock, fakeIpcMain } = await import('./helpers/electronMock')
  return electronMock({
    app: { getPreferredSystemLanguages: () => mocks.systemLanguages, focus: mocks.appFocus },
    dialog: { showMessageBox: mocks.showMessageBox },
    ipcMain: fakeIpcMain(mocks.handlers, mocks.listeners),
    clipboard: { clear: mocks.clipboardClear, writeText: mocks.clipboardWriteText, writeImage: mocks.writeImage },
    nativeImage: { createFromPath: (p: string) => ({ isEmpty: () => mocks.imageEmpty, toPNG: () => Buffer.from(`png:${p}`) }) },
    shell: { openExternal: mocks.openExternal },
    screen: { getCursorScreenPoint: () => mocks.cursor },
    BrowserWindow: {
      fromWebContents: () => ({
        isDestroyed: () => false,
        getBounds: () => ({ x: 0, y: 0, width: 400, height: 900 })
      })
    },
    systemPreferences: { isTrustedAccessibilityClient: mocks.isTrusted },
    Notification: class {
      static isSupported = () => mocks.notificationSupported
      private handlers = new Map<string, () => void>()
      show = vi.fn()
      constructor(public options: { title: string; body: string; icon?: string }) {
        if (mocks.notificationThrows) throw new Error('no notification center')
        mocks.notifications.push({ options, show: this.show, click: () => this.handlers.get('click')?.() })
      }
      on(event: string, fn: () => void) {
        this.handlers.set(event, fn)
        return this
      }
    }
  })
})

vi.mock('node:fs', () => ({ existsSync: () => true }))
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }))

vi.mock('../electron/main/powershell', async () => (await import('./helpers/ipcMocks')).powershellMock({ psHost: { run: mocks.psRun } }))
vi.mock('../electron/main/pathValidation', async () => (await import('./helpers/ipcMocks')).pathValidationMock())

vi.mock('../electron/main/state', async () =>
  (await import('./helpers/stateMock')).stateModuleMock({
    store: {
      get: (id: string) => mocks.items.get(id) ?? { id },
      touch: mocks.touch,
      delete: mocks.storeDelete,
      toDto: () => [],
      resolveStoredImagePath: (imageId: string, ext = 'png') => `/store/${imageId}.${ext}`
    },
    settings: () => ({ movePastedToTop: true, incognito: false, language: mocks.language }),
    saveSettings: mocks.saveSettings,
    pushState: { items: mocks.pushItems },
    addFiles: mocks.addFiles,
    watcher: mocks.watcher
  })
)

vi.mock('../electron/main/window', async () =>
  (await import('./helpers/ipcMocks')).windowMock({
    sendToMainWindow: (channel: string, payload: { message: string; tone: string }) => {
      if (channel === 'ui:toast') mocks.toasts.push({ message: payload.message, tone: payload.tone })
    },
    setHeartbeatPaused: mocks.setHeartbeatPaused,
    resolvePasteTarget: vi.fn()
  })
)

vi.mock('../electron/main/index', async () => (await import('./helpers/ipcMocks')).indexMock())
vi.mock('../electron/main/onboardingWindow', async () => (await import('./helpers/ipcMocks')).onboardingWindowMock())
vi.mock('../electron/main/tray', async () => (await import('./helpers/ipcMocks')).trayMock())

vi.mock('../electron/main/drag', async () =>
  (await import('./helpers/ipcMocks')).dragMock({
    startDragOut: mocks.startDragOut,
    resolveDragData: mocks.resolveDragData,
    stageDragFile: mocks.stageDragFile
  })
)

vi.mock('../electron/clipboard/formats', async () =>
  (await import('./helpers/ipcMocks')).formatsMock({
    clipboardSignature: mocks.clipboardSignature,
    signatureMatchesItem: mocks.signatureMatchesItem,
    localPathFromFileUrl: mocks.localPath
  })
)

vi.mock('../electron/main/updater', async () => (await import('./helpers/ipcMocks')).updaterMock())
vi.mock('../electron/main/config', async () => (await import('./helpers/ipcMocks')).configMock())
vi.mock('../electron/main/loginItems', async () => (await import('./helpers/ipcMocks')).loginItemsMock())
vi.mock('../electron/store/paths', async () => (await import('./helpers/pathsMock')).pathsModuleMock())

vi.mock('../electron/main/macNative', async () =>
  (await import('./helpers/ipcMocks')).macNativeMock({
    pressedMouseButtons: () => mocks.pressed,
    postCommandV: () => mocks.postCommandV(),
    mouseButtonsAvailable: () => mocks.bridgeReady,
    canPostEvents: () => mocks.canPost,
    requestPostEvents: () => mocks.requestPostEvents(),
    frontmostPid: () => (mocks.frontPids.length > 1 ? mocks.frontPids.shift()! : mocks.frontPids[0] ?? 0),
    weAreFrontmost: () => (mocks.frontPids[0] ?? 0) === process.pid,
    activatePid: (pid: number) => mocks.activatePid(pid)
  })
)

vi.mock('../electron/main/macPasteboard', async () =>
  (await import('./helpers/ipcMocks')).macPasteboardMock({
    writeFileUrls: (paths: string[]) => mocks.writeFileUrls(paths),
    addFileUrlToCurrentItem: (path: string, expected: number) => mocks.addFileUrl(path, expected),
    addImageDataToFirstItem: (png: Buffer, expected: number) => mocks.addImageData(png.toString(), expected),
    pasteboardChangeCount: () => mocks.changeCount
  })
)

vi.mock('../electron/main/macScreenshots', async () => (await import('./helpers/ipcMocks')).macScreenshotsMock({ refreshScreenshotWatcher: () => mocks.refreshScreenshotWatcher() }))

import { MOUSE_RELEASE_MAX_WAIT_MS, MOUSE_RELEASE_POLL_MS } from '../electron/main/macDrag'

type IpcModule = typeof import('../electron/main/ipc')

let registerIpc: IpcModule['registerIpc']
let registerSendListeners: IpcModule['registerSendListeners']
let simulatePaste: IpcModule['simulatePaste']
let writeItemToClipboard: IpcModule['writeItemToClipboard']

function makeSender(): { send: ReturnType<typeof vi.fn>; isDestroyed: ReturnType<typeof vi.fn>; channels: () => string[] } {
  const send = vi.fn()
  return { send, isDestroyed: vi.fn(() => false), channels: () => send.mock.calls.map((c) => c[0] as string) }
}

function startDrag(sender: unknown, req: Record<string, unknown> = { id: 'item-1' }): void {
  const listener = mocks.listeners.get('item:start-drag')
  if (!listener) throw new Error('item:start-drag listener was not registered')
  listener({ sender }, req)
}

beforeEach(async () => {
  vi.resetModules()
  ;({ registerIpc, registerSendListeners, simulatePaste, writeItemToClipboard } = await import('../electron/main/ipc'))
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mocks.bridgeReady = true
  mocks.language = 'en'
  mocks.systemLanguages = ['en-US']
  mocks.showMessageBox.mockReset()
  mocks.showMessageBox.mockResolvedValue({ response: 1 })
  mocks.localPath.mockReset()
  mocks.addFiles.mockReset()
  mocks.addFiles.mockReturnValue({ stacksCreated: 1 })
  mocks.listeners.clear()
  mocks.handlers.clear()
  mocks.pressed = 0
  mocks.trusted = true
  mocks.cursor = { x: 5000, y: 5000 }
  mocks.toasts.length = 0
  mocks.postCommandV.mockReset()
  mocks.postCommandV.mockReturnValue(true)
  mocks.isTrusted.mockReset()
  mocks.isTrusted.mockImplementation(() => mocks.trusted)
  mocks.execFile.mockReset()
  mocks.psRun.mockReset()
  mocks.psRun.mockResolvedValue(undefined)
  mocks.startDragOut.mockReset()
  mocks.startDragOut.mockReturnValue(true)
  mocks.resolveDragData.mockReset()
  mocks.resolveDragData.mockReturnValue({ data: { kind: 'files', paths: ['/a.txt'] }, capturedAt: 1 })
  mocks.stageDragFile.mockReset()
  mocks.setHeartbeatPaused.mockReset()
  mocks.touch.mockReset()
  mocks.pushItems.mockReset()
  mocks.writeImage.mockReset()
  mocks.openExternal.mockClear()
  mocks.canPost = true
  mocks.requestPostEvents.mockReset()
  mocks.requestPostEvents.mockReturnValue(true)
  mocks.frontPids = []
  mocks.activatePid.mockReset()
  mocks.activatePid.mockReturnValue(true)
  mocks.appFocus.mockReset()
  mocks.refreshScreenshotWatcher.mockReset()
  mocks.saveSettings.mockReset()
  mocks.saveSettings.mockImplementation((patch: Record<string, unknown>) => ({ ...patch }))
  mocks.writeFileUrls.mockReset()
  mocks.writeFileUrls.mockReturnValue(true)
  mocks.addFileUrl.mockReset()
  mocks.addFileUrl.mockReturnValue(true)
  mocks.addImageData.mockReset()
  mocks.addImageData.mockReturnValue(true)
  mocks.changeCount = 41
  mocks.imageEmpty = false
  mocks.items.clear()
  mocks.watcher.setPaused.mockReset()
  mocks.watcher.resyncSignature.mockReset()
  mocks.watcher.invalidateSignature.mockReset()
  mocks.watcher.noteSelfWrite.mockReset()
  mocks.clipboardClear.mockReset()
  mocks.clipboardWriteText.mockReset()
  mocks.clipboardSignature.mockReset()
  mocks.signatureMatchesItem.mockReset()
  mocks.storeDelete.mockReset()
  mocks.notificationSupported = true
  mocks.notificationThrows = false
  mocks.notifications.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  restorePlatform()
})

afterAll(() => {
  restorePlatform()
})

describe('item:start-drag completion', () => {
  it('on win32 sends item:drag-end synchronously, exactly as before', () => {
    setPlatform('win32')
    registerSendListeners()
    const sender = makeSender()
    mocks.pressed = 1

    startDrag(sender)

    expect(sender.channels()).toEqual(['item:drag-end'])
    expect(mocks.setHeartbeatPaused.mock.calls).toEqual([[true], [false]])
    expect(mocks.touch).toHaveBeenCalledWith('item-1')
    expect(mocks.pushItems).toHaveBeenCalledWith({ reason: 'usage' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('on win32 sends item:internal-drop right away when the cursor is over the window', () => {
    setPlatform('win32')
    registerSendListeners()
    const sender = makeSender()
    mocks.cursor = { x: 120, y: 300 }

    startDrag(sender)

    expect(sender.send.mock.calls).toEqual([['item:drag-end'], ['item:internal-drop', { x: 120, y: 300 }]])
    expect(mocks.touch).not.toHaveBeenCalled()
  })

  it('on darwin holds item:drag-end and item:internal-drop until the mouse button is released', async () => {
    setPlatform('darwin')
    registerSendListeners()
    const sender = makeSender()
    mocks.pressed = 1
    mocks.cursor = { x: 120, y: 300 }

    startDrag(sender)

    expect(mocks.startDragOut).toHaveBeenCalledTimes(1)
    expect(sender.send).not.toHaveBeenCalled()
    expect(mocks.setHeartbeatPaused).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2000)
    expect(sender.send).not.toHaveBeenCalled()
    expect(mocks.touch).not.toHaveBeenCalled()

    mocks.pressed = 0
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_POLL_MS)

    expect(sender.send.mock.calls).toEqual([['item:drag-end'], ['item:internal-drop', { x: 120, y: 300 }]])
    expect(mocks.setHeartbeatPaused).not.toHaveBeenCalled()
    expect(mocks.touch).not.toHaveBeenCalled()
    expect(mocks.pushItems).not.toHaveBeenCalled()
  })

  it('on darwin evaluates the drop point at release time and promotes an item dropped outside', async () => {
    setPlatform('darwin')
    registerSendListeners()
    const sender = makeSender()
    mocks.pressed = 1
    mocks.cursor = { x: 120, y: 300 }

    startDrag(sender)
    await vi.advanceTimersByTimeAsync(500)
    mocks.cursor = { x: 2000, y: 300 }
    mocks.pressed = 0
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_POLL_MS)

    expect(sender.channels()).toEqual(['item:drag-end'])
    expect(mocks.touch).toHaveBeenCalledWith('item-1')
    expect(mocks.pushItems).toHaveBeenCalledWith({ reason: 'usage' })
  })

  it('on darwin does not promote a sub-item dragged outside', async () => {
    setPlatform('darwin')
    registerSendListeners()
    const sender = makeSender()
    mocks.pressed = 1

    startDrag(sender, { id: 'item-1', imageId: 'img-2' })
    mocks.pressed = 0
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_POLL_MS)

    expect(sender.channels()).toEqual(['item:drag-end'])
    expect(mocks.touch).not.toHaveBeenCalled()
    expect(mocks.pushItems).not.toHaveBeenCalled()
  })

  it('on darwin finishes immediately when the drag did not start', () => {
    setPlatform('darwin')
    registerSendListeners()
    const sender = makeSender()
    mocks.pressed = 1
    mocks.startDragOut.mockReturnValue(false)

    startDrag(sender)

    expect(sender.channels()).toEqual(['item:drag-end'])
    expect(mocks.setHeartbeatPaused).not.toHaveBeenCalled()
    expect(mocks.touch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('on darwin sends nothing when the window went away during the drag', async () => {
    setPlatform('darwin')
    registerSendListeners()
    const sender = makeSender()
    mocks.pressed = 1

    startDrag(sender)
    sender.isDestroyed.mockReturnValue(true)
    mocks.pressed = 0
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_POLL_MS)

    expect(sender.send).not.toHaveBeenCalled()
    expect(mocks.setHeartbeatPaused).not.toHaveBeenCalled()
    expect(mocks.touch).not.toHaveBeenCalled()
  })

  it('on darwin a new drag makes the previous unfinished wait stale', async () => {
    setPlatform('darwin')
    registerSendListeners()
    const first = makeSender()
    const second = makeSender()
    mocks.pressed = 1

    startDrag(first, { id: 'item-1' })
    await vi.advanceTimersByTimeAsync(200)
    startDrag(second, { id: 'item-2' })
    mocks.cursor = { x: 2000, y: 300 }
    mocks.pressed = 0
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_POLL_MS * 2)

    expect(first.send).not.toHaveBeenCalled()
    expect(second.channels()).toEqual(['item:drag-end'])
    expect(mocks.touch.mock.calls).toEqual([['item-2']])
    expect(mocks.pushItems).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('on darwin a timed out wait only sends item:drag-end', async () => {
    setPlatform('darwin')
    registerSendListeners()
    const sender = makeSender()
    mocks.pressed = 1
    mocks.cursor = { x: 120, y: 300 }

    startDrag(sender)
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_MAX_WAIT_MS)

    expect(sender.channels()).toEqual(['item:drag-end'])
    expect(mocks.touch).not.toHaveBeenCalled()
    expect(mocks.pushItems).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('on darwin a timed out wait sends nothing to a destroyed window', async () => {
    setPlatform('darwin')
    registerSendListeners()
    const sender = makeSender()
    mocks.pressed = 1

    startDrag(sender)
    sender.isDestroyed.mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_MAX_WAIT_MS)

    expect(sender.send).not.toHaveBeenCalled()
  })

  it('on darwin logs a failure in the completion and still releases the renderer drag state', async () => {
    setPlatform('darwin')
    registerSendListeners()
    const sender = makeSender()
    mocks.pressed = 1
    mocks.touch.mockImplementation(() => {
      throw new Error('store failure')
    })

    startDrag(sender)
    mocks.pressed = 0
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_POLL_MS)

    expect(console.error).toHaveBeenCalledWith('[IPC] start-drag: drag completion failed:', expect.any(Error))
    expect(sender.channels()).toEqual(['item:drag-end', 'item:drag-end'])
    expect(vi.getTimerCount()).toBe(0)

    mocks.touch.mockReset()
    const next = makeSender()
    mocks.pressed = 1
    startDrag(next)
    mocks.pressed = 0
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_POLL_MS)
    expect(next.channels()).toEqual(['item:drag-end'])
    expect(mocks.touch).toHaveBeenCalledWith('item-1')
  })

  it('on darwin survives a sender that throws while reporting the failure', async () => {
    setPlatform('darwin')
    registerSendListeners()
    const sender = makeSender()
    mocks.pressed = 1
    sender.send.mockImplementation(() => {
      throw new Error('Object has been destroyed')
    })

    startDrag(sender)
    mocks.pressed = 0
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_POLL_MS)

    expect(console.error).toHaveBeenCalledWith('[IPC] start-drag: drag completion failed:', expect.any(Error))
    expect(mocks.touch).not.toHaveBeenCalled()
  })

  it('on darwin only sends item:drag-end, without waiting, when the mouse button bridge is unavailable', async () => {
    setPlatform('darwin')
    registerSendListeners()
    mocks.bridgeReady = false
    mocks.pressed = 0
    mocks.cursor = { x: 120, y: 300 }
    const sender = makeSender()

    startDrag(sender)

    expect(sender.channels()).toEqual(['item:drag-end'])
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_POLL_MS * 5)
    expect(sender.channels()).toEqual(['item:drag-end'])
    expect(mocks.touch).not.toHaveBeenCalled()
    expect(mocks.pushItems).not.toHaveBeenCalled()
  })

  it('on darwin does not count a drag as a use when the bridge is unavailable and the cursor is outside', () => {
    setPlatform('darwin')
    registerSendListeners()
    mocks.bridgeReady = false
    mocks.cursor = { x: 2000, y: 300 }
    const sender = makeSender()

    startDrag(sender)

    expect(sender.channels()).toEqual(['item:drag-end'])
    expect(mocks.touch).not.toHaveBeenCalled()
    expect(mocks.pushItems).not.toHaveBeenCalled()
  })

  it('on darwin warns once when the ObjC bridge is unavailable', () => {
    setPlatform('darwin')
    registerSendListeners()
    mocks.bridgeReady = false
    mocks.pressed = 0

    startDrag(makeSender())
    startDrag(makeSender())

    expect(console.warn).toHaveBeenCalledTimes(1)
    expect((console.warn as any).mock.calls[0][0]).toContain('mouse button state is unavailable')
  })

  it('on darwin does not warn when the button is simply released already', async () => {
    setPlatform('darwin')
    registerSendListeners()
    mocks.pressed = 0

    startDrag(makeSender())
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_POLL_MS)

    expect(console.warn).not.toHaveBeenCalled()
  })

  it('logs the drag end with wording that fits each platform', async () => {
    setPlatform('win32')
    registerSendListeners()
    startDrag(makeSender())
    expect(console.log).toHaveBeenCalledWith('[IPC] start-drag returned, sending drag-end')

    ;(console.log as any).mockClear()
    setPlatform('darwin')
    mocks.pressed = 0
    startDrag(makeSender())
    await vi.advanceTimersByTimeAsync(MOUSE_RELEASE_POLL_MS)
    expect(console.log).not.toHaveBeenCalledWith('[IPC] start-drag returned, sending drag-end')
    expect(console.log).toHaveBeenCalledWith('[IPC] drag finished, sending drag-end')
  })
})

describe('writeItemToClipboard image', () => {
  const image: ItemData = { kind: 'image', imageId: 'a', width: 10, height: 10, bytes: 1, ext: 'png' } as ItemData
  const named = '/tmp/Screenshot 2026-01-01 10.00.00.png'

  beforeEach(() => {
    mocks.stageDragFile.mockReturnValue({ file: named, files: [named] })
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => cb(null))
  })

  it('on darwin writes the bitmap first and then adds a file-url for the named file natively', async () => {
    setPlatform('darwin')
    const order: string[] = []
    mocks.writeImage.mockImplementation(() => order.push('image'))
    mocks.addFileUrl.mockImplementation(() => {
      order.push('file-url')
      return true
    })

    await expect(writeItemToClipboard(image, 1)).resolves.toBe(true)

    expect(order).toEqual(['image', 'file-url'])
    expect(mocks.writeImage).toHaveBeenCalledTimes(1)
    expect(mocks.addFileUrl.mock.calls).toEqual([[named, 41]])
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.writeFileUrls).not.toHaveBeenCalled()
    expect(mocks.psRun).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('on darwin keeps the bitmap and writes it once when the file-url step fails', async () => {
    setPlatform('darwin')
    mocks.addFileUrl.mockReturnValue(false)

    await expect(writeItemToClipboard(image, 1)).resolves.toBe(true)

    expect(mocks.writeImage).toHaveBeenCalledTimes(1)
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })

  it('on darwin writes only the bitmap when nothing could be staged', async () => {
    setPlatform('darwin')
    mocks.stageDragFile.mockReturnValue(null)

    await expect(writeItemToClipboard(image, 1)).resolves.toBe(true)

    expect(mocks.writeImage).toHaveBeenCalledTimes(1)
    expect(mocks.addFileUrl).not.toHaveBeenCalled()
  })

  it('on darwin gives a single-image collection the same bitmap plus file-url', async () => {
    setPlatform('darwin')
    const single = { kind: 'image-collection', images: [{ imageId: 'a', width: 1, height: 1, bytes: 1 }] } as ItemData

    await expect(writeItemToClipboard(single, 1)).resolves.toBe(true)

    expect(mocks.writeImage).toHaveBeenCalledTimes(1)
    expect(mocks.addFileUrl.mock.calls).toEqual([[named, 41]])
  })

  it('on win32 still writes bitmap and file drop through the PowerShell host', async () => {
    setPlatform('win32')

    await expect(writeItemToClipboard(image, 1)).resolves.toBe(true)

    expect(mocks.psRun).toHaveBeenCalledTimes(1)
    expect(mocks.psRun.mock.calls[0][0]).toContain('SetImage')
    expect(mocks.psRun.mock.calls[0][0]).toContain('SetFileDropList')
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.writeImage).not.toHaveBeenCalled()
    expect(mocks.addFileUrl).not.toHaveBeenCalled()
  })
})

describe('item:copy of an image on darwin', () => {
  const data = { kind: 'image', imageId: 'a', width: 10, height: 10, bytes: 1, ext: 'png' } as ItemData
  const named = '/tmp/Screenshot 2026-01-01 10.00.00.png'

  beforeEach(() => {
    setPlatform('darwin')
    mocks.items.set('img-1', { id: 'img-1', data, capturedAt: 1 })
    mocks.stageDragFile.mockReturnValue({ file: named, files: [named] })
    registerIpc()
  })

  it('writes the bitmap plus a file-url while the watcher is paused and resumes it afterwards', async () => {
    const order: string[] = []
    mocks.watcher.setPaused.mockImplementation((paused: boolean) => order.push(paused ? 'pause' : 'resume'))
    mocks.writeImage.mockImplementation(() => order.push('image'))
    mocks.addFileUrl.mockImplementation(() => {
      order.push('file-url')
      return true
    })

    await expect(mocks.handlers.get('item:copy')!({}, 'img-1')).resolves.toBe(true)
    expect(order).toEqual(['pause', 'image', 'file-url'])
    expect(mocks.addFileUrl.mock.calls).toEqual([[named, 41]])
    expect(mocks.watcher.noteSelfWrite).toHaveBeenCalledTimes(1)
    expect(mocks.touch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    expect(order).toEqual(['pause', 'image', 'file-url', 'resume'])
  })

  it('recognises its own "image + file-url" write as the same image item when deleting', async () => {
    await mocks.handlers.get('item:copy')!({}, 'img-1')
    mocks.clipboardSignature.mockReturnValue(`seq:7:files:${named}`)
    mocks.signatureMatchesItem.mockReturnValue(false)

    await mocks.handlers.get('item:delete')!({}, 'img-1')

    expect(mocks.clipboardClear).toHaveBeenCalledTimes(2)
    expect(mocks.signatureMatchesItem).not.toHaveBeenCalled()
    expect(mocks.storeDelete).toHaveBeenCalledWith('img-1')
    expect(mocks.watcher.resyncSignature).toHaveBeenCalledTimes(1)
  })

  it('does not treat the own write as another image item', async () => {
    mocks.items.set('img-2', { id: 'img-2', data: { ...data, imageId: 'b' }, capturedAt: 2 })
    await mocks.handlers.get('item:copy')!({}, 'img-1')
    mocks.clipboardSignature.mockReturnValue(`seq:7:files:${named}`)

    await mocks.handlers.get('item:delete')!({}, 'img-2')

    expect(mocks.clipboardClear).toHaveBeenCalledTimes(1)
    expect(mocks.storeDelete).toHaveBeenCalledWith('img-2')
  })

  it('falls back to the plain signature match when the file-url was not added', async () => {
    mocks.addFileUrl.mockReturnValue(false)
    await mocks.handlers.get('item:copy')!({}, 'img-1')
    mocks.clipboardSignature.mockReturnValue(`seq:7:files:${named}`)
    mocks.signatureMatchesItem.mockReturnValue(false)

    await mocks.handlers.get('item:delete')!({}, 'img-1')

    expect(mocks.clipboardClear).toHaveBeenCalledTimes(1)
    expect(mocks.signatureMatchesItem).toHaveBeenCalledWith(`seq:7:files:${named}`, data, undefined)
  })

  it('on win32 keeps the plain signature match', async () => {
    await mocks.handlers.get('item:copy')!({}, 'img-1')
    setPlatform('win32')
    mocks.clipboardSignature.mockReturnValue(`seq:7:files:${named}`)
    mocks.signatureMatchesItem.mockReturnValue(false)

    await mocks.handlers.get('item:delete')!({}, 'img-1')

    expect(mocks.clipboardClear).toHaveBeenCalledTimes(1)
    expect(mocks.signatureMatchesItem).toHaveBeenCalledTimes(1)
  })
})

describe('writeItemToClipboard files', () => {
  const files: ItemData = { kind: 'files', paths: ['/a/One file.txt', '/a/R&D.txt', "/a/it's.txt", '/a/Привет.txt'] }

  it('on darwin writes the file list natively without a child process', async () => {
    setPlatform('darwin')

    await expect(writeItemToClipboard(files, 1)).resolves.toBe(true)

    expect(mocks.writeFileUrls.mock.calls).toEqual([[files.paths]])
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.clipboardWriteText).not.toHaveBeenCalled()
  })

  it('on darwin falls back to JXA when the native write fails and checks its result', async () => {
    setPlatform('darwin')
    mocks.writeFileUrls.mockReturnValue(false)
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => cb(null, 'true\n'))

    await expect(writeItemToClipboard(files, 1)).resolves.toBe(true)

    expect(mocks.execFile).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = mocks.execFile.mock.calls[0]
    expect(cmd).toBe('osascript')
    expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e'])
    expect(args[3]).toContain('pasteboardItems.count==argv.length')
    expect(args.slice(4)).toEqual(files.paths)
    expect(opts).toEqual({ timeout: 3000 })
    expect(mocks.clipboardWriteText).not.toHaveBeenCalled()
  })

  it('on darwin falls back to plain text paths when JXA lost files too', async () => {
    setPlatform('darwin')
    mocks.writeFileUrls.mockReturnValue(false)
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => cb(null, 'false\n'))

    await expect(writeItemToClipboard(files, 1)).resolves.toBe(true)

    expect(console.error).toHaveBeenCalled()
    expect(mocks.clipboardWriteText).toHaveBeenCalledWith(files.paths.join('\r\n'))
  })

  it('on darwin falls back to plain text paths when osascript fails', async () => {
    setPlatform('darwin')
    mocks.writeFileUrls.mockReturnValue(false)
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => cb(new Error('osascript timeout'), ''))

    await expect(writeItemToClipboard(files, 1)).resolves.toBe(true)

    expect(mocks.clipboardWriteText).toHaveBeenCalledTimes(1)
  })

  it('on win32 never touches the mac pasteboard bridge', async () => {
    setPlatform('win32')

    await expect(writeItemToClipboard(files, 1)).resolves.toBe(true)

    expect(mocks.psRun).toHaveBeenCalledTimes(1)
    expect(mocks.writeFileUrls).not.toHaveBeenCalled()
    expect(mocks.execFile).not.toHaveBeenCalled()
  })
})

describe('item:add-data with a dropped file:// image', () => {
  const url = 'file:///Users/a/My%20Pics/x.png'

  it('on darwin keeps the POSIX path', async () => {
    setPlatform('darwin')
    registerIpc()
    mocks.localPath.mockReturnValue('/Users/a/My Pics/x.png')

    await mocks.handlers.get('item:add-data')!({}, { kind: 'image', imageUrl: url })

    expect(mocks.localPath).toHaveBeenCalledWith(url)
    expect(mocks.addFiles.mock.calls).toEqual([[['/Users/a/My Pics/x.png']]])
  })

  it('on win32 still converts to a backslash path', async () => {
    setPlatform('win32')
    registerIpc()

    await mocks.handlers.get('item:add-data')!({}, { kind: 'image', imageUrl: 'file:///C:/Pics/My%20x.png' })

    expect(mocks.localPath).not.toHaveBeenCalled()
    expect(mocks.addFiles.mock.calls).toEqual([[['C:\\Pics\\My x.png']]])
  })
})

describe('writeItemToClipboard image-collection', () => {
  const collection: ItemData = {
    kind: 'image-collection',
    images: [
      { imageId: 'a', width: 1, height: 1, bytes: 1 },
      { imageId: 'b', width: 1, height: 1, bytes: 1 }
    ]
  } as ItemData
  const staged = ['/tmp/Screenshot.png', '/tmp/Screenshot (2).png']

  beforeEach(() => {
    mocks.stageDragFile.mockReturnValue({ file: staged[0], files: staged })
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => cb(null))
  })

  it('on darwin writes every staged file as a file list and never touches the PowerShell host', async () => {
    setPlatform('darwin')

    await expect(writeItemToClipboard(collection, 1)).resolves.toBe(true)

    expect(mocks.psRun).not.toHaveBeenCalled()
    expect(mocks.writeFileUrls.mock.calls).toEqual([[staged]])
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.writeImage).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('on darwin adds the first image as PNG data to the first file item after the file list is written', async () => {
    setPlatform('darwin')
    mocks.changeCount = 77

    await expect(writeItemToClipboard(collection, 1)).resolves.toBe(true)

    expect(mocks.addImageData.mock.calls).toEqual([['png:/store/a.png', 77]])
    expect(mocks.writeFileUrls.mock.invocationCallOrder[0]).toBeLessThan(mocks.addImageData.mock.invocationCallOrder[0])
    expect(mocks.addFileUrl).not.toHaveBeenCalled()
    expect(mocks.clipboardClear).not.toHaveBeenCalled()
  })

  it('on darwin keeps the file list when the image data cannot be added', async () => {
    setPlatform('darwin')
    mocks.addImageData.mockReturnValue(false)

    await expect(writeItemToClipboard(collection, 1)).resolves.toBe(true)

    expect(mocks.writeFileUrls).toHaveBeenCalledTimes(1)
    expect(mocks.writeImage).not.toHaveBeenCalled()
    expect(mocks.clipboardClear).not.toHaveBeenCalled()
  })

  it('on darwin skips the image data when the first image cannot be decoded', async () => {
    setPlatform('darwin')
    mocks.imageEmpty = true

    await expect(writeItemToClipboard(collection, 1)).resolves.toBe(true)

    expect(mocks.writeFileUrls.mock.calls).toEqual([[staged]])
    expect(mocks.addImageData).not.toHaveBeenCalled()
  })

  it('on win32 still goes through the PowerShell host', async () => {
    setPlatform('win32')

    await expect(writeItemToClipboard(collection, 1)).resolves.toBe(true)

    expect(mocks.psRun).toHaveBeenCalledTimes(1)
    expect(mocks.psRun.mock.calls[0][0]).toContain('SetFileDropList')
    expect(mocks.psRun.mock.calls[0][0]).toContain('SetImage')
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.addImageData).not.toHaveBeenCalled()
  })
})

describe('simulatePaste on darwin', () => {
  beforeEach(() => {
    setPlatform('darwin')
  })

  it('posts Cmd+V natively when the app is a trusted accessibility client', () => {
    simulatePaste()

    expect(mocks.isTrusted.mock.calls).toEqual([[false]])
    expect(mocks.postCommandV).toHaveBeenCalledTimes(1)
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.psRun).not.toHaveBeenCalled()
    expect(mocks.toasts).toEqual([])
  })

  it('treats a trusted client that cannot post events as having no access', () => {
    mocks.canPost = false

    simulatePaste()
    simulatePaste()

    expect(mocks.notifications).toHaveLength(1)
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
    expect(mocks.postCommandV).not.toHaveBeenCalled()
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.toasts).toEqual([
      { message: 'toast.pasteNeedsAccessibility', tone: 'info' },
      { message: 'toast.pasteNeedsAccessibility', tone: 'info' }
    ])
  })

  it('asks the system for access, toasts and shows a notification the first time it is not trusted', async () => {
    mocks.trusted = false

    simulatePaste()
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.isTrusted.mock.calls).toEqual([[false], [true]])
    expect(mocks.requestPostEvents).toHaveBeenCalledTimes(1)
    expect(mocks.notifications).toHaveLength(1)
    const { options, show } = mocks.notifications[0]
    expect(options.title).toContain('⌘V')
    expect(options.body).toContain('Accessibility')
    expect(options.icon).toBe('/mock/app/resources/icon.png')
    expect(show).toHaveBeenCalledTimes(1)
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(mocks.postCommandV).not.toHaveBeenCalled()
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.toasts).toEqual([{ message: 'toast.pasteNeedsAccessibility', tone: 'info' }])
  })

  it('never takes focus from the target app or hands it back', async () => {
    mocks.trusted = false
    mocks.frontPids = [4242, process.pid]

    simulatePaste()
    await vi.advanceTimersByTimeAsync(0)
    simulatePaste()

    expect(mocks.appFocus).not.toHaveBeenCalled()
    expect(mocks.activatePid).not.toHaveBeenCalled()
  })

  it('opens the Accessibility pane when the notification is clicked', () => {
    mocks.trusted = false

    simulatePaste()
    expect(mocks.openExternal).not.toHaveBeenCalled()
    mocks.notifications[0].click()

    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
    expect(mocks.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
  })

  it('only toasts on later untrusted pastes in the same session', async () => {
    mocks.trusted = false

    simulatePaste()
    await vi.advanceTimersByTimeAsync(0)
    simulatePaste()
    simulatePaste()

    expect(mocks.notifications).toHaveLength(1)
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
    expect(mocks.isTrusted.mock.calls).toEqual([[false], [true], [false], [false]])
    expect(mocks.requestPostEvents).toHaveBeenCalledTimes(1)
    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(mocks.toasts).toEqual([
      { message: 'toast.pasteNeedsAccessibility', tone: 'info' },
      { message: 'toast.pasteNeedsAccessibility', tone: 'info' },
      { message: 'toast.pasteNeedsAccessibility', tone: 'info' }
    ])
  })

  it('still toasts when notifications are not supported', () => {
    mocks.trusted = false
    mocks.notificationSupported = false

    simulatePaste()

    expect(mocks.notifications).toEqual([])
    expect(mocks.isTrusted.mock.calls).toEqual([[false], [true]])
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
    expect(mocks.appFocus).not.toHaveBeenCalled()
    expect(mocks.toasts).toEqual([{ message: 'toast.pasteNeedsAccessibility', tone: 'info' }])
  })

  it('uses the Russian notification texts for a Russian setting', () => {
    mocks.trusted = false
    mocks.language = 'ru'

    simulatePaste()

    const { options } = mocks.notifications[0]
    expect(options.title).toBe('Скопировано — нажмите ⌘V')
    expect(options.body).toContain('Универсальный доступ')
  })

  it('follows the system language when the setting is "system" and falls back to English', async () => {
    mocks.trusted = false
    mocks.language = 'system'
    mocks.systemLanguages = ['ru-RU']
    simulatePaste()
    expect(mocks.notifications[0].options.body).toContain('Универсальный доступ')

    vi.resetModules()
    const fresh = await import('../electron/main/ipc')
    mocks.language = 'xx'
    fresh.simulatePaste()
    expect(mocks.notifications[1].options.title).toBe('Copied — press ⌘V')
    expect(mocks.notifications[1].options.body).toContain('Accessibility')
  })

  it('survives the notification failing and still toasts once', () => {
    mocks.trusted = false
    mocks.notificationThrows = true

    simulatePaste()

    expect(console.error).toHaveBeenCalledWith('[Main] accessibility notification failed:', expect.any(Error))
    expect(mocks.toasts).toEqual([{ message: 'toast.pasteNeedsAccessibility', tone: 'info' }])
  })

  it('falls back to osascript with a layout-independent key code when the native post fails', () => {
    mocks.postCommandV.mockReturnValue(false)

    simulatePaste()

    expect(mocks.execFile).toHaveBeenCalledTimes(1)
    const [cmd, args, cb] = mocks.execFile.mock.calls[0]
    expect(cmd).toBe('osascript')
    expect(args).toEqual(['-e', 'tell application "System Events" to key code 9 using command down'])
    expect(args.join(' ')).not.toContain('keystroke')
    cb(null)
    expect(mocks.toasts).toEqual([])
  })

  it('toasts when the osascript fallback fails', () => {
    mocks.postCommandV.mockReturnValue(false)

    simulatePaste()
    const cb = mocks.execFile.mock.calls[0][2]
    cb(new Error('not allowed to send keystrokes'))

    expect(mocks.toasts).toEqual([{ message: 'toast.pasteNeedsAccessibility', tone: 'info' }])
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
  })
})

describe('simulatePaste on win32', () => {
  it('keeps using the PowerShell host and never touches the macOS path', () => {
    setPlatform('win32')

    simulatePaste()

    expect(mocks.psRun).toHaveBeenCalledTimes(1)
    expect(mocks.psRun.mock.calls[0][0]).toContain("SendWait('^v')")
    expect(mocks.isTrusted).not.toHaveBeenCalled()
    expect(mocks.postCommandV).not.toHaveBeenCalled()
  })
})

describe('accessibility IPC', () => {
  it('reports null off macOS so onboarding stays unchanged', async () => {
    setPlatform('win32')
    registerIpc()

    expect(await mocks.handlers.get('accessibility:status')!({})).toBeNull()
    expect(await mocks.handlers.get('accessibility:request')!({})).toBeNull()
    expect(mocks.isTrusted).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('reports the current status on darwin without prompting', async () => {
    setPlatform('darwin')
    registerIpc()
    mocks.trusted = false

    expect(await mocks.handlers.get('accessibility:status')!({})).toBe(false)
    expect(mocks.isTrusted.mock.calls).toEqual([[false]])
  })

  it('reports no access on darwin when the client is trusted but cannot post events', async () => {
    setPlatform('darwin')
    registerIpc()
    mocks.canPost = false

    expect(await mocks.handlers.get('accessibility:status')!({})).toBe(false)
    expect(mocks.requestPostEvents).not.toHaveBeenCalled()
  })

  it('asks for post-event access on every request while access is missing', async () => {
    setPlatform('darwin')
    registerIpc()
    mocks.canPost = false
    mocks.requestPostEvents.mockReturnValue(false)

    expect(await mocks.handlers.get('accessibility:request')!({})).toBe(false)
    expect(mocks.requestPostEvents).toHaveBeenCalledTimes(1)
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)

    expect(await mocks.handlers.get('accessibility:request')!({})).toBe(false)
    expect(mocks.requestPostEvents).toHaveBeenCalledTimes(2)
    expect(mocks.openExternal).toHaveBeenCalledTimes(2)
  })

  it('shows the system prompt and opens the Accessibility pane on the first request of the session', async () => {
    setPlatform('darwin')
    registerIpc()
    mocks.trusted = false

    expect(await mocks.handlers.get('accessibility:request')!({})).toBe(false)
    expect(mocks.isTrusted.mock.calls).toEqual([[true]])
    expect(mocks.requestPostEvents).toHaveBeenCalledTimes(1)
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
    expect(mocks.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
  })

  it('only opens the Accessibility pane on later requests', async () => {
    setPlatform('darwin')
    registerIpc()
    mocks.trusted = false

    await mocks.handlers.get('accessibility:request')!({})
    mocks.isTrusted.mockClear()
    mocks.openExternal.mockClear()
    expect(await mocks.handlers.get('accessibility:request')!({})).toBe(false)

    expect(mocks.isTrusted.mock.calls).toEqual([[false]])
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
    expect(mocks.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
  })

  it('does not open System Settings when already trusted', async () => {
    setPlatform('darwin')
    registerIpc()

    expect(await mocks.handlers.get('accessibility:request')!({})).toBe(true)
    expect(await mocks.handlers.get('accessibility:request')!({})).toBe(true)
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('goes straight to the Accessibility pane after the paste path already prompted', async () => {
    setPlatform('darwin')
    registerIpc()
    mocks.trusted = false
    simulatePaste()
    await vi.advanceTimersByTimeAsync(0)
    mocks.isTrusted.mockClear()
    mocks.openExternal.mockClear()

    await mocks.handlers.get('accessibility:request')!({})

    expect(mocks.isTrusted.mock.calls).toEqual([[false]])
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
  })
})

describe('settings:update and the screenshot watcher', () => {
  it('re-evaluates the watcher only when captureScreenshots is part of the patch', async () => {
    setPlatform('darwin')
    registerIpc()

    await mocks.handlers.get('settings:update')!({}, { reduceMotion: true })
    expect(mocks.refreshScreenshotWatcher).not.toHaveBeenCalled()

    await mocks.handlers.get('settings:update')!({}, { captureScreenshots: false })
    expect(mocks.saveSettings).toHaveBeenLastCalledWith({ captureScreenshots: false })
    expect(mocks.refreshScreenshotWatcher).toHaveBeenCalledTimes(1)

    await mocks.handlers.get('settings:update')!({}, { captureScreenshots: true })
    expect(mocks.refreshScreenshotWatcher).toHaveBeenCalledTimes(2)
  })
})

describe('accessibility translations', () => {
  it('has en and ru texts for the toast and the onboarding block', async () => {
    const { en, ru } = await import('../src/i18n/translations')
    for (const dict of [en, ru]) {
      expect(dict.toast.pasteNeedsAccessibility).toContain('⌘V')
      expect(dict.onboarding.accessibilityTitle).toBeTruthy()
      expect(dict.onboarding.accessibilityDesc).toBeTruthy()
      expect(dict.onboarding.accessibilityGranted).toBeTruthy()
      expect(dict.onboarding.accessibilityMissing).toBeTruthy()
      expect(dict.onboarding.accessibilityButton).toBeTruthy()
    }
    expect(ru.toast.pasteNeedsAccessibility).toContain('Универсальный доступ')
    expect(en.toast.pasteNeedsAccessibility).toContain('Accessibility')
  })

  it('keeps the toast to one short line and the onboarding texts compact', async () => {
    const { en, ru } = await import('../src/i18n/translations')
    for (const dict of [en, ru]) {
      expect(dict.toast.pasteNeedsAccessibility!.length).toBeLessThanOrEqual(70)
      expect(dict.toast.pasteNeedsAccessibility).not.toContain('\n')
      expect(dict.onboarding.accessibilityTitle!.length).toBeLessThanOrEqual(24)
      expect(dict.onboarding.accessibilityDesc!.length).toBeLessThanOrEqual(40)
      expect(dict.onboarding.accessibilityButton!.length).toBeLessThanOrEqual(12)
      expect(dict.accessibilityDialog?.title).toContain('⌘V')
      expect(dict.accessibilityDialog?.body).toBeTruthy()
    }
  })
})
