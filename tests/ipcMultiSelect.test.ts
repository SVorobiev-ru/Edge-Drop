import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
  items: new Map<string, any>(),
  order: [] as string[],
  fullText: new Map<string, string>(),
  rich: new Map<string, { text: string; html?: string }>(),
  settings: {} as Record<string, unknown>,
  clipboardClear: vi.fn(),
  clipboardWrite: vi.fn(),
  clipboardWriteText: vi.fn(),
  writeFileUrls: vi.fn((_paths: string[]) => true),
  postCommandV: vi.fn(() => true),
  pushItems: vi.fn(),
  togglePanel: vi.fn(),
  interactive: false,
  touch: vi.fn(),
  setPinned: vi.fn(),
  deleteBatch: vi.fn(),
  merge: vi.fn(),
  sent: [] as Array<{ channel: string; payload: any }>,
  stage: vi.fn(),
  startMulti: vi.fn(() => true),
  menuTemplates: [] as any[],
  netFetch: vi.fn(),
  createFromBuffer: vi.fn(),
  storeAdd: vi.fn(),
  watcher: { setPaused: vi.fn(), resyncSignature: vi.fn(), invalidateSignature: vi.fn(), noteSelfWrite: vi.fn() }
}))

vi.mock('electron', async () => {
  const { electronMock, fakeIpcMain } = await import('./helpers/electronMock')
  return electronMock({
    userData: '/mock',
    ipcMain: fakeIpcMain(mocks.handlers, mocks.listeners),
    clipboard: { clear: mocks.clipboardClear, write: mocks.clipboardWrite, writeText: mocks.clipboardWriteText },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true }),
      createFromDataURL: () => ({ isEmpty: () => true }),
      createFromBuffer: (buf: Buffer) => mocks.createFromBuffer(buf)
    },
    net: { fetch: (...args: any[]) => mocks.netFetch(...args) },
    screen: { getCursorScreenPoint: () => ({ x: 900, y: 900 }) },
    BrowserWindow: { fromWebContents: () => ({ isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 300, height: 600 }) }) },
    Menu: {
      buildFromTemplate: (template: any[]) => {
        mocks.menuTemplates.push(template)
        return { popup: (opts: { callback?: () => void }) => opts.callback?.() }
      }
    }
  })
})

vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:fs')>()), existsSync: () => true }))
vi.mock('../electron/main/powershell', async () => (await import('./helpers/ipcMocks')).powershellMock())
vi.mock('../electron/main/pathValidation', async () => (await import('./helpers/ipcMocks')).pathValidationMock())
vi.mock('../electron/main/state', async () =>
  (await import('./helpers/stateMock')).stateModuleMock({
    store: {
      get: (id: string) => mocks.items.get(id),
      touch: mocks.touch,
      setPinned: mocks.setPinned,
      deleteBatch: mocks.deleteBatch,
      merge: mocks.merge,
      add: mocks.storeAdd,
      stageImageBytes: vi.fn(),
      toDto: () => mocks.order.map((id) => mocks.items.get(id)).filter(Boolean),
      getFullText: (id: string) => mocks.fullText.get(id) ?? '',
      getRichText: (id: string) => mocks.rich.get(id) ?? null,
      resolveStoredImagePath: () => null,
      hasRecoverableCollectionImage: () => true
    },
    settings: () => mocks.settings,
    pushState: { items: mocks.pushItems, togglePanel: mocks.togglePanel },
    watcher: mocks.watcher
  })
)
vi.mock('../electron/main/window', async () => (await import('./helpers/ipcMocks')).windowMock({ sendToMainWindow: (channel: string, payload: any) => mocks.sent.push({ channel, payload }), isInteractive: () => mocks.interactive }))
vi.mock('../electron/main/index', async () => (await import('./helpers/ipcMocks')).indexMock())
vi.mock('../electron/main/onboardingWindow', async () => (await import('./helpers/ipcMocks')).onboardingWindowMock())
vi.mock('../electron/main/tray', async () => (await import('./helpers/ipcMocks')).trayMock())
vi.mock('../electron/main/drag', async () =>
  (await import('./helpers/ipcMocks')).dragMock({
    stageSelectionFiles: (items: any[]) => mocks.stage(items),
    startMultiDragOut: (...args: any[]) => mocks.startMulti(...args)
  })
)
vi.mock('../electron/clipboard/formats', async () => (await import('./helpers/ipcMocks')).formatsMock())
vi.mock('../electron/main/updater', async () => (await import('./helpers/ipcMocks')).updaterMock())
vi.mock('../electron/main/config', async () => (await import('./helpers/ipcMocks')).configMock())
vi.mock('../electron/main/loginItems', async () => (await import('./helpers/ipcMocks')).loginItemsMock())
vi.mock('../electron/store/paths', async () => (await import('./helpers/pathsMock')).pathsModuleMock())
vi.mock('../electron/main/macNative', async () => (await import('./helpers/ipcMocks')).macNativeMock({ postCommandV: () => mocks.postCommandV() }))
vi.mock('../electron/main/macPasteboard', async () => (await import('./helpers/ipcMocks')).macPasteboardMock({ writeFileUrls: (paths: string[]) => mocks.writeFileUrls(paths) }))
vi.mock('../electron/main/macScreenshots', async () => (await import('./helpers/ipcMocks')).macScreenshotsMock())
vi.mock('../electron/main/macSourceApp', async () => (await import('./helpers/ipcMocks')).macSourceAppMock())
vi.mock('../electron/main/ocr', async () => (await import('./helpers/ipcMocks')).ocrMock())

let ipc: typeof import('../electron/main/ipc')

function invoke(channel: string, ...args: unknown[]): any {
  const fn = mocks.handlers.get(channel)
  if (!fn) throw new Error(`${channel} is not registered`)
  return fn({}, ...args)
}

function addItem(item: any): void {
  mocks.items.set(item.id, { capturedAt: 1, hitCount: 1, pinned: false, ...item })
  mocks.order.push(item.id)
}

function toasts(): Array<{ message: string; params?: Record<string, unknown> }> {
  return mocks.sent.filter((s) => s.channel === 'ui:toast').map((s) => s.payload)
}

async function settled<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(100)
  return pending
}

function sender() {
  return { send: vi.fn(), isDestroyed: () => false }
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mocks.handlers.clear()
  mocks.listeners.clear()
  mocks.items.clear()
  mocks.order.length = 0
  mocks.fullText.clear()
  mocks.rich.clear()
  mocks.sent.length = 0
  mocks.menuTemplates.length = 0
  mocks.interactive = false
  mocks.settings = { movePastedToTop: true, incognito: false, language: 'en', pasteQueueHotkey: 'Command+Control+V' }
  for (const fn of [mocks.clipboardClear, mocks.clipboardWrite, mocks.clipboardWriteText, mocks.writeFileUrls, mocks.postCommandV, mocks.pushItems, mocks.togglePanel, mocks.touch, mocks.setPinned, mocks.deleteBatch, mocks.merge, mocks.stage, mocks.startMulti, mocks.netFetch, mocks.createFromBuffer, mocks.storeAdd, mocks.watcher.noteSelfWrite]) fn.mockClear()
  mocks.writeFileUrls.mockImplementation(() => true)
  mocks.startMulti.mockImplementation(() => true)
  mocks.stage.mockImplementation((items: any[]) => ({
    ok: true,
    paths: items.flatMap((it) => (it.data.kind === 'files' ? it.data.paths : [`/tmp/staged/${it.id}.${it.data.kind === 'text' ? 'txt' : 'png'}`])),
    iconPaths: items.map(() => 'image.png')
  }))
  addItem({ id: 't1', data: { kind: 'text', text: 'First preview', html: '<b>First</b>', isUrl: false, hasFullPayload: true } })
  mocks.fullText.set('t1', 'First full text')
  mocks.rich.set('t1', { text: 'First full text', html: '<b>First</b>' })
  addItem({ id: 't2', data: { kind: 'text', text: 'https://example.com', isUrl: true } })
  addItem({ id: 't3', data: { kind: 'text', text: '#ff0000', html: '<i>red</i>', isUrl: false, isColor: true } })
  addItem({ id: 'i1', data: { kind: 'image', imageId: 'img1', width: 1, height: 1, bytes: 1, ext: 'png' } })
  addItem({ id: 'f1', data: { kind: 'files', paths: ['/Users/me/a.pdf', '/Users/me/b.pdf'] } })
  ipc = await import('../electron/main/ipc')
  ipc.registerIpc()
  ipc.registerSendListeners()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  restorePlatform()
})

afterAll(() => {
  restorePlatform()
})

describe('combining rule', () => {
  it('joins texts, links and colours with a blank line and keeps html only when every item has it', async () => {
    setPlatform('darwin')
    await expect(invoke('items:copy-multi', { ids: ['t1', 't2'] })).resolves.toBe(true)
    expect(mocks.clipboardWrite).toHaveBeenLastCalledWith({ text: 'First full text\n\nhttps://example.com' })

    await invoke('items:copy-multi', { ids: ['t1', 't3'] })
    expect(mocks.clipboardWrite).toHaveBeenLastCalledWith({ text: 'First full text\n\n#ff0000', html: '<b>First</b><br><br><i>red</i>' })
    expect(mocks.stage).not.toHaveBeenCalled()
    expect(mocks.writeFileUrls).not.toHaveBeenCalled()
  })

  it('plain writes text only', async () => {
    setPlatform('darwin')
    await invoke('items:copy-multi', { ids: ['t1', 't3'], plain: true })
    expect(mocks.clipboardWrite).toHaveBeenLastCalledWith({ text: 'First full text\n\n#ff0000' })
  })

  it('keeps the order the renderer sent', async () => {
    setPlatform('darwin')
    await invoke('items:copy-multi', { ids: ['t3', 't1'] })
    expect(mocks.clipboardWrite).toHaveBeenLastCalledWith({ text: '#ff0000\n\nFirst full text', html: '<i>red</i><br><br><b>First</b>' })
  })

  it('turns a mixed selection into one file list in the given order and ignores plain', async () => {
    setPlatform('darwin')
    await expect(invoke('items:copy-multi', { ids: ['f1', 't2', 'i1'], plain: true })).resolves.toBe(true)
    expect(mocks.stage.mock.calls[0][0].map((it: any) => it.id)).toEqual(['f1', 't2', 'i1'])
    expect(mocks.writeFileUrls).toHaveBeenCalledWith(['/Users/me/a.pdf', '/Users/me/b.pdf', '/tmp/staged/t2.txt', '/tmp/staged/i1.png'])
    expect(mocks.clipboardWrite).not.toHaveBeenCalled()
  })

  it('writes nothing and shows the staging error when an item cannot be staged', async () => {
    setPlatform('darwin')
    mocks.stage.mockImplementation(() => ({ ok: false, error: 'toast.imageUnavailable' }))
    await expect(invoke('items:copy-multi', { ids: ['f1', 'i1'] })).resolves.toBe(false)
    expect(mocks.writeFileUrls).not.toHaveBeenCalled()
    expect(mocks.clipboardClear).not.toHaveBeenCalled()
    expect(toasts().map((t) => t.message)).toEqual(['toast.imageUnavailable'])
  })

  it('drops unknown ids and duplicates', async () => {
    setPlatform('darwin')
    await invoke('items:copy-multi', { ids: ['t2', 'gone', 't2', 't3'] })
    expect(mocks.clipboardWrite).toHaveBeenLastCalledWith({ text: 'https://example.com\n\n#ff0000' })
    await expect(invoke('items:copy-multi', { ids: ['gone'] })).resolves.toBe(false)
  })
})

describe('items:copy-multi', () => {
  it('on darwin leaves the items in place, marks the own write and reports the count', async () => {
    setPlatform('darwin')
    await invoke('items:copy-multi', { ids: ['t1', 't2'] })
    expect(mocks.touch).not.toHaveBeenCalled()
    expect(mocks.pushItems).not.toHaveBeenCalled()
    expect(mocks.watcher.noteSelfWrite).toHaveBeenCalledTimes(1)
    expect(toasts()).toEqual([expect.objectContaining({ message: 'toast.selectionCopied', params: { count: 2 } })])
    expect(mocks.togglePanel).not.toHaveBeenCalled()
  })

  it('on win32 promotes the items keeping their order', async () => {
    setPlatform('win32')
    await invoke('items:copy-multi', { ids: ['t1', 't2'] })
    expect(mocks.touch.mock.calls.map((c) => c[0])).toEqual(['t2', 't1'])
    expect(mocks.watcher.noteSelfWrite).not.toHaveBeenCalled()
  })
})

describe('items:paste-multi', () => {
  it('on darwin keeps the panel open, writes once and sends one paste', async () => {
    setPlatform('darwin')
    await expect(settled(invoke('items:paste-multi', { ids: ['t1', 't2'] }))).resolves.toBe(true)
    expect(mocks.togglePanel).not.toHaveBeenCalled()
    expect(mocks.clipboardWrite).toHaveBeenCalledTimes(1)
    expect(mocks.touch.mock.calls.map((c) => c[0])).toEqual(['t2', 't1'])
    expect(mocks.postCommandV).toHaveBeenCalledTimes(1)
  })

  it('on darwin with the panel open moves the items up only when it closes, keeping their order', async () => {
    setPlatform('darwin')
    mocks.interactive = true
    await settled(invoke('items:paste-multi', { ids: ['t1', 't2'] }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.touch).not.toHaveBeenCalled()
    expect(mocks.pushItems).not.toHaveBeenCalled()
    await invoke('window:set-interactive', false)
    expect(mocks.touch.mock.calls.map((c) => c[0])).toEqual(['t2', 't1'])
    expect(mocks.pushItems).toHaveBeenCalledWith({ reason: 'usage' })
  })

  it('on darwin does not let a selection paste overwrite the clipboard of a pending item paste', async () => {
    setPlatform('darwin')
    const order: string[] = []
    mocks.clipboardWrite.mockImplementation((payload: { text: string }) => order.push(`write ${payload.text}`))
    mocks.postCommandV.mockImplementation(() => {
      order.push('⌘V')
      return true
    })
    const win = await import('../electron/main/window')
    vi.mocked(win.resolvePasteTarget).mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(80), 800)))
    const single = ipc.pasteItemById('t3')
    await vi.advanceTimersByTimeAsync(650)
    const multi = invoke('items:paste-multi', { ids: ['t1', 't2'] })
    await vi.advanceTimersByTimeAsync(1500)
    await expect(Promise.all([single, multi])).resolves.toEqual([true, true])
    expect(order).toEqual(['⌘V', 'write First full text\n\nhttps://example.com', '⌘V'])
    mocks.clipboardWrite.mockReset()
    mocks.postCommandV.mockReset()
    mocks.postCommandV.mockImplementation(() => true)
  })

  it('on win32 still closes the panel before pasting', async () => {
    setPlatform('win32')
    await expect(invoke('items:paste-multi', { ids: ['t1', 't2'] })).resolves.toBe(true)
    expect(mocks.togglePanel).toHaveBeenCalledWith(false)
  })

  it('does not reorder history when movePastedToTop is off', async () => {
    setPlatform('darwin')
    mocks.settings.movePastedToTop = false
    await settled(invoke('items:paste-multi', { ids: ['t1', 't2'] }))
    expect(mocks.touch).not.toHaveBeenCalled()
  })

  it('shares the double-paste guard with single paste', async () => {
    setPlatform('darwin')
    await expect(settled(ipc.pasteItemById('t2'))).resolves.toBe(true)
    await expect(invoke('items:paste-multi', { ids: ['t1', 't2'] })).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(700)
    await expect(settled(invoke('items:paste-multi', { ids: ['t1', 't2'] }))).resolves.toBe(true)
  })

  it('keeps the panel open and the clipboard untouched when staging fails', async () => {
    setPlatform('darwin')
    mocks.stage.mockImplementation(() => ({ ok: false, error: 'toast.fileUnavailable' }))
    await expect(invoke('items:paste-multi', { ids: ['f1', 'i1'] })).resolves.toBe(false)
    expect(mocks.togglePanel).not.toHaveBeenCalled()
    expect(mocks.writeFileUrls).not.toHaveBeenCalled()
    expect(mocks.postCommandV).not.toHaveBeenCalled()
  })
})

describe('selection limit', () => {
  it('refuses more than 200 items with a toast and writes nothing', async () => {
    setPlatform('darwin')
    const ids = Array.from({ length: 201 }, (_, i) => `x${i}`)
    for (const id of ids) addItem({ id, data: { kind: 'text', text: id, isUrl: false } })
    await expect(invoke('items:copy-multi', { ids })).resolves.toBe(false)
    await expect(invoke('items:paste-multi', { ids })).resolves.toBe(false)
    expect(invoke('items:stack-multi', ids)).toMatchObject({ ok: false })
    expect(mocks.clipboardWrite).not.toHaveBeenCalled()
    expect(mocks.togglePanel).not.toHaveBeenCalled()
    expect(toasts()[0]).toMatchObject({ message: 'toast.selectionTooLarge', params: { max: 200 } })
  })

  it('accepts exactly 200 items', async () => {
    setPlatform('darwin')
    const ids = Array.from({ length: 200 }, (_, i) => `x${i}`)
    for (const id of ids) addItem({ id, data: { kind: 'text', text: id, isUrl: false } })
    await expect(invoke('items:copy-multi', { ids })).resolves.toBe(true)
  })
})

describe('items:stack-multi and items:pin-multi', () => {
  it('merges every item into the first one in order', () => {
    mocks.merge.mockReturnValue({ ok: true })
    addItem({ id: 'i2', data: { kind: 'image', imageId: 'img2', width: 1, height: 1, bytes: 1 } })
    expect(invoke('items:stack-multi', ['i1', 'i2', 'f1'])).toEqual({ ok: true })
    expect(mocks.merge.mock.calls).toEqual([['i2', 'i1'], ['f1', 'i1']])
    expect(mocks.pushItems).toHaveBeenCalled()
  })

  it('stops at the stack limit with the merge toast', () => {
    addItem({ id: 'i2', data: { kind: 'image', imageId: 'img2', width: 1, height: 1, bytes: 1 } })
    mocks.merge.mockReturnValueOnce({ ok: true }).mockReturnValueOnce({ ok: false, reason: 'full', message: 'toast.mergeFilesFull' })
    addItem({ id: 'f2', data: { kind: 'files', paths: ['/x'] } })
    expect(invoke('items:stack-multi', ['i1', 'i2', 'f1', 'f2'])).toMatchObject({ ok: false, reason: 'full' })
    expect(mocks.merge).toHaveBeenCalledTimes(2)
    expect(toasts().map((t) => t.message)).toEqual(['toast.mergeFilesFull'])
    expect(mocks.pushItems).toHaveBeenCalled()
  })

  it('pins every selected item and returns the list', () => {
    const list = invoke('items:pin-multi', ['t1', 'f1', 'gone'], true)
    expect(mocks.setPinned.mock.calls).toEqual([['t1', true], ['f1', true]])
    expect(list).toHaveLength(5)
    expect(mocks.pushItems).toHaveBeenCalled()
  })
})

describe('selection context menu', () => {
  it('builds the selection variant when the request carries a selection', async () => {
    setPlatform('darwin')
    await invoke('item:context-menu', 't1', { id: 't1', selection: ['t1', 't2'] })
    const labels = mocks.menuTemplates[0].map((i: any) => i.label ?? i.type)
    expect(labels).toEqual(['Paste', 'Paste without formatting', 'Copy', 'separator', 'Pin', 'separator', 'Delete'])
  })

  it('offers Stack and Unpin for pinned images and files and deletes them together', async () => {
    setPlatform('darwin')
    mocks.items.get('i1').pinned = true
    mocks.items.get('f1').pinned = true
    await invoke('item:context-menu', 'i1', { id: 'i1', selection: ['i1', 'f1'] })
    const template = mocks.menuTemplates[0]
    expect(template.map((i: any) => i.label ?? i.type)).toEqual(['Paste', 'Copy', 'separator', 'Stack', 'Unpin', 'separator', 'Delete'])
    template.find((i: any) => i.label === 'Delete').click()
    expect(mocks.deleteBatch).toHaveBeenCalledWith(['i1', 'f1'])
    template.find((i: any) => i.label === 'Unpin').click()
    expect(mocks.setPinned.mock.calls).toEqual([['i1', false], ['f1', false]])
  })

  it('keeps the single-item menu without a selection', async () => {
    setPlatform('darwin')
    await invoke('item:context-menu', 't1')
    expect(mocks.menuTemplates[0].map((i: any) => i.label ?? i.type)).toContain('Rename…')
  })
})

describe('items:start-drag-multi', () => {
  it('drags the combined file list and marks the items used after a drop outside', async () => {
    setPlatform('darwin')
    const s = sender()
    mocks.listeners.get('items:start-drag-multi')!({ sender: s }, ['f1', 't2'])
    expect(mocks.startMulti).toHaveBeenCalledWith(s, ['/Users/me/a.pdf', '/Users/me/b.pdf', '/tmp/staged/t2.txt'], ['image.png', 'image.png'])
    await vi.advanceTimersByTimeAsync(50)
    expect(s.send).toHaveBeenCalledWith('item:drag-end')
    expect(s.send).not.toHaveBeenCalledWith('item:internal-drop', expect.anything())
    expect(mocks.touch.mock.calls.map((c) => c[0])).toEqual(['t2', 'f1'])
  })

  it('ends the drag with a toast when staging fails', () => {
    setPlatform('darwin')
    mocks.stage.mockImplementation(() => ({ ok: false, error: 'toast.imageUnavailable' }))
    const s = sender()
    mocks.listeners.get('items:start-drag-multi')!({ sender: s }, ['f1', 'i1'])
    expect(mocks.startMulti).not.toHaveBeenCalled()
    expect(s.send).toHaveBeenCalledWith('item:drag-end')
    expect(toasts().map((t) => t.message)).toEqual(['toast.imageUnavailable'])
  })

  it('refuses a selection over the limit', () => {
    setPlatform('win32')
    const ids = Array.from({ length: 201 }, (_, i) => `x${i}`)
    const s = sender()
    mocks.listeners.get('items:start-drag-multi')!({ sender: s }, ids)
    expect(mocks.startMulti).not.toHaveBeenCalled()
    expect(s.send).toHaveBeenCalledWith('item:drag-end')
  })
})

function imageResponse(body: Uint8Array[], headers: Record<string, string> = { 'content-type': 'image/png' }): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of body) controller.enqueue(chunk)
      controller.close()
    }
  })
  return new Response(stream, { status: 200, headers })
}

describe('dropped image URL limits', () => {
  it('accepts an https image', async () => {
    const fetcher = vi.fn(async () => imageResponse([new Uint8Array([1, 2]), new Uint8Array([3])]))
    const bytes = await ipc.fetchDroppedImage('https://example.com/a.png', fetcher as any)
    expect(bytes && [...bytes]).toEqual([1, 2, 3])
  })

  it('refuses http, file and malformed URLs without fetching on darwin', async () => {
    setPlatform('darwin')
    const fetcher = vi.fn()
    for (const url of ['http://example.com/a.png', 'http://localhost/a.png', 'file:///etc/passwd', 'not a url']) {
      await expect(ipc.fetchDroppedImage(url, fetcher as any)).resolves.toBeNull()
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('accepts http on win32 as before but still refuses other schemes', async () => {
    setPlatform('win32')
    const fetcher = vi.fn(async () => imageResponse([new Uint8Array([7])]))
    const bytes = await ipc.fetchDroppedImage('http://example.com/a.png', fetcher as any)
    expect(bytes && [...bytes]).toEqual([7])
    for (const url of ['file:///C:/Windows/win.ini', 'ftp://example.com/a.png', 'not a url']) {
      await expect(ipc.fetchDroppedImage(url, fetcher as any)).resolves.toBeNull()
    }
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps the image type check on win32', async () => {
    setPlatform('win32')
    const fetcher = vi.fn(async () => imageResponse([new Uint8Array([1])], { 'content-type': 'text/html' }))
    await expect(ipc.fetchDroppedImage('http://example.com/a.png', fetcher as any)).resolves.toBeNull()
  })

  it('refuses a response that is not an image', async () => {
    const fetcher = vi.fn(async () => imageResponse([new Uint8Array([1])], { 'content-type': 'text/html' }))
    await expect(ipc.fetchDroppedImage('https://example.com/a.png', fetcher as any)).resolves.toBeNull()
  })

  it('refuses a declared size over 25 MB', async () => {
    const fetcher = vi.fn(async () => imageResponse([new Uint8Array([1])], { 'content-type': 'image/png', 'content-length': String(26 * 1024 * 1024) }))
    await expect(ipc.fetchDroppedImage('https://example.com/a.png', fetcher as any)).resolves.toBeNull()
  })

  it('stops reading once the streamed body passes 25 MB', async () => {
    const chunk = new Uint8Array(5 * 1024 * 1024)
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(chunk)
      }
    })
    const fetcher = vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'image/jpeg' } }))
    await expect(ipc.fetchDroppedImage('https://example.com/a.jpg', fetcher as any)).resolves.toBeNull()
    expect(pulled).toBeLessThan(10)
  })

  it('gives up after 15 seconds', async () => {
    const fetcher = vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const pending = ipc.fetchDroppedImage('https://example.com/slow.png', fetcher as any)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBeNull()
  })

  it('item:add-data ignores a refused URL with a toast instead of adding an empty image', async () => {
    const result = await invoke('item:add-data', { kind: 'image', imageUrl: 'http://example.com/a.png' })
    expect(mocks.storeAdd).not.toHaveBeenCalled()
    expect(mocks.netFetch).not.toHaveBeenCalled()
    expect(toasts().map((t) => t.message)).toEqual(['toast.imageUnavailable'])
    expect(result).toHaveLength(5)
  })

  it('item:add-data stores an accepted https image', async () => {
    mocks.netFetch.mockImplementation(async () => imageResponse([new Uint8Array([9, 9])]))
    mocks.createFromBuffer.mockImplementation(() => ({ isEmpty: () => false, toPNG: () => Buffer.from([9, 9]), getSize: () => ({ width: 2, height: 1 }) }))
    await invoke('item:add-data', { kind: 'image', imageUrl: 'https://example.com/pic.png' })
    expect(mocks.createFromBuffer).toHaveBeenCalledWith(Buffer.from([9, 9]))
    expect(mocks.storeAdd).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image', fileName: 'pic.png', width: 2 }), undefined)
  })
})
