import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  items: new Map<string, any>(),
  fullText: new Map<string, string>(),
  rich: new Map<string, { text: string; html?: string; rtf?: string }>(),
  settings: {} as Record<string, unknown>,
  clipboardClear: vi.fn(),
  clipboardWrite: vi.fn(),
  clipboardWriteText: vi.fn(),
  writeRich: vi.fn(),
  postCommandV: vi.fn(() => true),
  saveSettings: vi.fn(),
  pushSettings: vi.fn(),
  pushItems: vi.fn(),
  togglePanel: vi.fn(),
  interactive: false,
  psRun: vi.fn(() => Promise.resolve()),
  registerGlobalHotkey: vi.fn(() => true),
  shortcuts: new Map<string, () => void>(),
  refuse: new Set<string>(),
  setTitle: vi.fn(() => true),
  touch: vi.fn(),
  sent: vi.fn(),
  writeFileUrls: vi.fn(() => true),
  watcher: { setPaused: vi.fn(), resyncSignature: vi.fn(), invalidateSignature: vi.fn(), noteSelfWrite: vi.fn() }
}))

vi.mock('electron', async () => {
  const { electronMock, fakeGlobalShortcut, fakeIpcMain } = await import('./helpers/electronMock')
  return electronMock({
    userData: '/mock',
    ipcMain: fakeIpcMain(mocks.handlers),
    clipboard: { clear: mocks.clipboardClear, write: mocks.clipboardWrite, writeText: mocks.clipboardWriteText },
    globalShortcut: fakeGlobalShortcut(mocks.shortcuts, mocks.refuse)
  })
})

vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:fs')>()), existsSync: () => true }))
vi.mock('../electron/main/powershell', async () => (await import('./helpers/ipcMocks')).powershellMock({ psHost: { run: (...args: unknown[]) => mocks.psRun(...args) } }))
vi.mock('../electron/main/pathValidation', async () => (await import('./helpers/ipcMocks')).pathValidationMock())
vi.mock('../electron/main/state', async () =>
  (await import('./helpers/stateMock')).stateModuleMock({
    store: {
      get: (id: string) => mocks.items.get(id),
      touch: mocks.touch,
      toDto: () => [...mocks.items.values()],
      getFullText: (id: string) => mocks.fullText.get(id) ?? '',
      getRichText: (id: string) => mocks.rich.get(id) ?? null,
      setTitle: mocks.setTitle,
      resolveStoredImagePath: () => null,
      hasRecoverableCollectionImage: () => true
    },
    settings: () => mocks.settings,
    saveSettings: mocks.saveSettings,
    pushState: { items: mocks.pushItems, settings: mocks.pushSettings, togglePanel: mocks.togglePanel },
    watcher: mocks.watcher
  })
)
vi.mock('../electron/main/window', async () => (await import('./helpers/ipcMocks')).windowMock({ sendToMainWindow: (...args: unknown[]) => mocks.sent(...args), isInteractive: () => mocks.interactive }))
vi.mock('../electron/main/index', async () => (await import('./helpers/ipcMocks')).indexMock({ registerGlobalHotkey: mocks.registerGlobalHotkey }))
vi.mock('../electron/main/onboardingWindow', async () => (await import('./helpers/ipcMocks')).onboardingWindowMock())
vi.mock('../electron/main/tray', async () => (await import('./helpers/ipcMocks')).trayMock())
vi.mock('../electron/main/drag', async () => (await import('./helpers/ipcMocks')).dragMock())
vi.mock('../electron/clipboard/formats', async () => (await import('./helpers/ipcMocks')).formatsMock({ writeRichTextToClipboard: mocks.writeRich }))
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

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.handlers.clear()
  mocks.items.clear()
  mocks.fullText.clear()
  mocks.rich.clear()
  mocks.shortcuts.clear()
  mocks.refuse.clear()
  mocks.interactive = false
  mocks.settings = { movePastedToTop: true, incognito: false, language: 'en', toggleHotkey: 'Command+Shift+V', pasteQueueHotkey: 'Command+Control+V' }
  for (const fn of [mocks.clipboardClear, mocks.clipboardWrite, mocks.clipboardWriteText, mocks.writeRich, mocks.saveSettings, mocks.pushSettings, mocks.pushItems, mocks.registerGlobalHotkey, mocks.setTitle, mocks.touch, mocks.sent, mocks.writeFileUrls, mocks.togglePanel, mocks.psRun, mocks.watcher.noteSelfWrite]) fn.mockClear()
  mocks.registerGlobalHotkey.mockImplementation(() => true)
  mocks.postCommandV.mockClear()
  mocks.saveSettings.mockImplementation((patch: Record<string, unknown>) => {
    mocks.settings = { ...mocks.settings, ...patch }
    return mocks.settings
  })
  mocks.items.set('t1', { id: 't1', data: { kind: 'text', text: 'Short preview', html: '<b>Short</b>', isUrl: false, hasFullPayload: true }, capturedAt: 1, hitCount: 1, pinned: false })
  mocks.fullText.set('t1', 'Full plain text of the item')
  mocks.rich.set('t1', { text: 'Full plain text of the item', html: '<b>Full</b>', rtf: '{\\rtf1 Full}' })
  ipc = await import('../electron/main/ipc')
  ipc.registerIpc()
})

async function settled<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(100)
  return pending
}

function toasts(): string[] {
  return mocks.sent.mock.calls.filter((c) => c[0] === 'ui:toast').map((c) => (c[1] as { message: string }).message)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  restorePlatform()
})

afterAll(() => {
  restorePlatform()
})

describe('item:paste plain', () => {
  it('on darwin writes only the full plain text and pastes', async () => {
    setPlatform('darwin')
    await expect(settled(invoke('item:paste', 't1', { plain: true }))).resolves.toBe(true)

    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('Full plain text of the item')
    expect(mocks.clipboardWrite).not.toHaveBeenCalled()
    expect(mocks.writeRich).not.toHaveBeenCalled()
    expect(mocks.postCommandV).toHaveBeenCalledTimes(1)
  })

  it('on darwin writes the stored rich text when plain is off', async () => {
    setPlatform('darwin')
    await expect(settled(invoke('item:paste', 't1', { plain: false }))).resolves.toBe(true)

    expect(mocks.writeRich).toHaveBeenCalledWith({ text: 'Full plain text of the item', html: '<b>Full</b>', rtf: '{\\rtf1 Full}' })
    expect(mocks.clipboardWriteText).not.toHaveBeenCalled()
  })

  it('on win32 ignores plain and keeps the formatted write', async () => {
    setPlatform('win32')
    await invoke('item:paste', 't1', { plain: true })

    expect(mocks.clipboardWrite).toHaveBeenCalledWith({ text: 'Full plain text of the item', html: '<b>Short</b>' })
    expect(mocks.clipboardWriteText).not.toHaveBeenCalled()
    expect(mocks.writeRich).not.toHaveBeenCalled()
  })

  it('pasteItemById shares the double-paste guard with item:paste', async () => {
    setPlatform('darwin')
    await expect(settled(ipc.pasteItemById('t1'))).resolves.toBe(true)
    await expect(invoke('item:paste', 't1')).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(700)
    await expect(settled(invoke('item:paste', 't1'))).resolves.toBe(true)
  })

  it('returns false for an unknown item', async () => {
    setPlatform('darwin')
    await expect(ipc.pasteItemById('missing')).resolves.toBe(false)
  })

  it('says there is nothing to paste when plain text is empty', async () => {
    setPlatform('darwin')
    mocks.fullText.delete('t1')
    await expect(invoke('item:paste', 't1', { plain: true })).resolves.toBe(false)
    expect(toasts()).toEqual(['toast.nothingToPaste'])
  })
})

describe('panel after a paste', () => {
  it('on darwin keeps the panel open after a click paste and still sends ⌘V', async () => {
    setPlatform('darwin')
    await expect(settled(invoke('item:paste', 't1'))).resolves.toBe(true)
    expect(mocks.togglePanel).not.toHaveBeenCalled()
    expect(mocks.watcher.noteSelfWrite).toHaveBeenCalledTimes(1)
    expect(mocks.postCommandV).toHaveBeenCalledTimes(1)
  })

  it('on darwin pastes two items in a row with the panel open', async () => {
    setPlatform('darwin')
    mocks.items.set('t2', { id: 't2', data: { kind: 'text', text: 'Second', isUrl: false }, capturedAt: 2, hitCount: 1, pinned: false })
    await settled(invoke('item:paste', 't1'))
    await vi.advanceTimersByTimeAsync(700)
    await expect(settled(invoke('item:paste', 't2'))).resolves.toBe(true)
    expect(mocks.postCommandV).toHaveBeenCalledTimes(2)
    expect(mocks.togglePanel).not.toHaveBeenCalled()
  })

  it('on darwin keeps the panel open after a sub-item paste', async () => {
    setPlatform('darwin')
    mocks.items.set('f1', { id: 'f1', data: { kind: 'files', paths: ['/Users/me/a.txt', '/Users/me/b.txt'] }, capturedAt: 3, hitCount: 1, pinned: false })
    await expect(settled(invoke('item:paste-subitem', { id: 'f1', paths: ['/Users/me/a.txt'] }))).resolves.toBe(true)
    expect(mocks.togglePanel).not.toHaveBeenCalled()
    expect(mocks.watcher.noteSelfWrite).toHaveBeenCalledTimes(1)
  })

  it('on darwin moves pasted items up only when the panel closes, in paste order', async () => {
    setPlatform('darwin')
    mocks.interactive = true
    mocks.items.set('t2', { id: 't2', data: { kind: 'text', text: 'Second', isUrl: false }, capturedAt: 2, hitCount: 1, pinned: false })
    await settled(invoke('item:paste', 't1'))
    await vi.advanceTimersByTimeAsync(700)
    await settled(invoke('item:paste', 't2'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.touch).not.toHaveBeenCalled()
    expect(mocks.pushItems).not.toHaveBeenCalled()

    mocks.interactive = false
    await invoke('window:set-interactive', false)
    expect(mocks.touch.mock.calls.map((c) => c[0])).toEqual(['t1', 't2'])
    expect(mocks.pushItems).toHaveBeenCalledTimes(1)
    expect(mocks.pushItems).toHaveBeenCalledWith({ reason: 'usage' })

    await invoke('window:set-interactive', false)
    expect(mocks.touch).toHaveBeenCalledTimes(2)
  })

  it('on darwin promotes at once when the paste comes with the panel closed', async () => {
    setPlatform('darwin')
    await settled(invoke('item:paste', 't1'))
    expect(mocks.touch).toHaveBeenCalledWith('t1')
    await vi.advanceTimersByTimeAsync(300)
    expect(mocks.pushItems).toHaveBeenCalledTimes(1)
  })

  it('on win32 promotes right away and pushes after the panel slid shut', async () => {
    setPlatform('win32')
    mocks.interactive = true
    await invoke('item:paste', 't1')
    expect(mocks.touch).toHaveBeenCalledWith('t1')
    await vi.advanceTimersByTimeAsync(300)
    expect(mocks.pushItems).toHaveBeenCalledTimes(1)
  })

  it('on win32 closes the panel before pasting, as upstream', async () => {
    setPlatform('win32')
    await invoke('item:paste', 't1')
    expect(mocks.togglePanel).toHaveBeenCalledWith(false)
    expect(mocks.watcher.noteSelfWrite).not.toHaveBeenCalled()
  })
})

describe('item:copy', () => {
  it('on darwin leaves the item in place and marks the own write', async () => {
    setPlatform('darwin')
    await expect(invoke('item:copy', 't1')).resolves.toBe(true)
    expect(mocks.writeRich).toHaveBeenCalledTimes(1)
    expect(mocks.touch).not.toHaveBeenCalled()
    expect(mocks.pushItems).not.toHaveBeenCalled()
    expect(mocks.watcher.noteSelfWrite).toHaveBeenCalledTimes(1)
    expect(mocks.togglePanel).not.toHaveBeenCalled()
  })

  it('pauses the watcher before writing a sub-item to the clipboard', async () => {
    setPlatform('darwin')
    mocks.items.set('f1', { id: 'f1', data: { kind: 'files', paths: ['/Users/me/a.txt', '/Users/me/b.txt'] }, capturedAt: 3, hitCount: 1, pinned: false })
    const order: string[] = []
    mocks.watcher.setPaused.mockImplementation((paused: boolean) => order.push(paused ? 'pause' : 'resume'))
    mocks.writeFileUrls.mockImplementation(() => {
      order.push('write')
      return true
    })
    await expect(invoke('item:copy-subitem', { id: 'f1', paths: ['/Users/me/a.txt'] })).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(order).toEqual(['pause', 'write', 'resume'])
    mocks.watcher.setPaused.mockReset()
    mocks.writeFileUrls.mockReset()
    mocks.writeFileUrls.mockImplementation(() => true)
  })

  it('on darwin leaves the bundle in place after copying one of its files', async () => {
    setPlatform('darwin')
    mocks.items.set('f1', { id: 'f1', data: { kind: 'files', paths: ['/Users/me/a.txt', '/Users/me/b.txt'] }, capturedAt: 3, hitCount: 1, pinned: false })
    await expect(invoke('item:copy-subitem', { id: 'f1', paths: ['/Users/me/a.txt'] })).resolves.toBe(true)
    expect(mocks.touch).not.toHaveBeenCalled()
    expect(mocks.watcher.noteSelfWrite).toHaveBeenCalledTimes(1)
  })

  it('on win32 promotes the copied item, as upstream', async () => {
    setPlatform('win32')
    await expect(invoke('item:copy', 't1')).resolves.toBe(true)
    expect(mocks.touch).toHaveBeenCalledWith('t1')
    expect(mocks.pushItems).toHaveBeenCalledWith({ reason: 'usage' })
  })
})

describe('emoji:paste', () => {
  it('on darwin writes the emoji, sends ⌘V and keeps the panel open without touching history', async () => {
    setPlatform('darwin')
    const pasted = invoke('emoji:paste', ' 😀 ')
    await vi.advanceTimersByTimeAsync(60)
    await expect(pasted).resolves.toBe(true)
    expect(mocks.clipboardClear).toHaveBeenCalled()
    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('😀')
    expect(mocks.watcher.noteSelfWrite).toHaveBeenCalledTimes(1)
    expect(mocks.postCommandV).toHaveBeenCalledTimes(1)
    expect(mocks.togglePanel).not.toHaveBeenCalled()
    expect(mocks.touch).not.toHaveBeenCalled()
    expect(mocks.pushItems).not.toHaveBeenCalled()
  })

  it('on darwin does not overwrite the clipboard before the previous emoji was pasted', async () => {
    setPlatform('darwin')
    const order: string[] = []
    mocks.clipboardWriteText.mockImplementation((text: string) => order.push(`write ${text}`))
    mocks.postCommandV.mockImplementation(() => {
      order.push('⌘V')
      return true
    })
    const win = await import('../electron/main/window')
    vi.mocked(win.resolvePasteTarget).mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(80), 300)))
    const first = invoke('emoji:paste', '😀')
    await vi.advanceTimersByTimeAsync(200)
    const second = invoke('emoji:paste', '🎉')
    await vi.advanceTimersByTimeAsync(400)
    await Promise.all([first, second])
    expect(order).toEqual(['write 😀', '⌘V', 'write 🎉', '⌘V'])
    mocks.clipboardWriteText.mockReset()
    mocks.postCommandV.mockReset()
    mocks.postCommandV.mockImplementation(() => true)
  })

  it('on darwin runs overlapping item and emoji pastes one at a time, each write followed by its own ⌘V', async () => {
    setPlatform('darwin')
    mocks.items.set('t2', { id: 't2', data: { kind: 'text', text: 'Second', isUrl: false }, capturedAt: 2, hitCount: 1, pinned: false })
    const order: string[] = []
    mocks.writeRich.mockImplementation((payload: { text: string }) => order.push(`write ${payload.text}`))
    mocks.clipboardWriteText.mockImplementation((text: string) => order.push(`write ${text}`))
    mocks.postCommandV.mockImplementation(() => {
      order.push('⌘V')
      return true
    })
    const win = await import('../electron/main/window')
    vi.mocked(win.resolvePasteTarget).mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(80), 800)))
    const first = invoke('item:paste', 't1')
    await vi.advanceTimersByTimeAsync(300)
    const emoji = invoke('emoji:paste', '😀')
    await vi.advanceTimersByTimeAsync(350)
    const second = invoke('item:paste', 't2')
    await vi.advanceTimersByTimeAsync(1500)
    await expect(Promise.all([first, emoji, second])).resolves.toEqual([true, true, true])
    expect(order).toEqual(['write Full plain text of the item', '⌘V', 'write 😀', '⌘V', 'write Second', '⌘V'])
    mocks.writeRich.mockReset()
    mocks.clipboardWriteText.mockReset()
    mocks.postCommandV.mockReset()
    mocks.postCommandV.mockImplementation(() => true)
  })

  it('rejects text that is not an emoji payload', async () => {
    setPlatform('darwin')
    await expect(invoke('emoji:paste', 'a\nb')).resolves.toBe(false)
    expect(mocks.clipboardWriteText).not.toHaveBeenCalled()
  })

  it('on win32 keeps the upstream write and Ctrl+V path', async () => {
    setPlatform('win32')
    await expect(invoke('emoji:paste', '😀')).resolves.toBe(true)
    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('😀')
    expect(mocks.clipboardClear).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60)
    expect(mocks.psRun).toHaveBeenCalledTimes(1)
    expect(mocks.togglePanel).not.toHaveBeenCalled()
  })
})

describe('paste queue hotkey', () => {
  beforeEach(() => {
    mocks.items.set('t2', { id: 't2', data: { kind: 'text', text: 'Second', isUrl: false }, capturedAt: 2, hitCount: 1, pinned: false })
  })

  it('pastes right after a click paste instead of dropping the press', async () => {
    setPlatform('darwin')
    invoke('queue:add', 't2')
    const pasted = invoke('item:paste', 't1')
    mocks.shortcuts.get('Command+Control+V')!()

    await vi.advanceTimersByTimeAsync(40)
    expect(mocks.writeRich).toHaveBeenCalledTimes(1)
    expect(mocks.postCommandV).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    await expect(pasted).resolves.toBe(true)
    expect(mocks.writeRich).toHaveBeenLastCalledWith({ text: 'Second', html: undefined })
    expect(mocks.postCommandV).toHaveBeenCalledTimes(2)
    expect(toasts()).not.toContain('toast.queuePasteBusy')
  })

  it('pastes queued items one after another on fast presses', async () => {
    setPlatform('darwin')
    invoke('queue:add', 't1')
    invoke('queue:add', 't2')
    const press = mocks.shortcuts.get('Command+Control+V')!
    press()
    press()
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.postCommandV).toHaveBeenCalledTimes(2)
    expect(mocks.writeRich.mock.calls.map((c) => (c[0] as { text: string }).text)).toEqual(['Full plain text of the item', 'Second'])
    expect(mocks.shortcuts.has('Command+Control+V')).toBe(false)
  })
})

describe('sub-item paths', () => {
  beforeEach(() => {
    mocks.items.set('f1', { id: 'f1', data: { kind: 'files', paths: ['/Users/me/a.txt', '/Users/me/b.txt'] }, capturedAt: 3, hitCount: 1, pinned: false })
  })

  it('copies only paths that belong to the item', async () => {
    setPlatform('darwin')
    await expect(invoke('item:copy-subitem', { id: 'f1', paths: ['/etc/passwd'] })).resolves.toBe(false)
    expect(mocks.writeFileUrls).not.toHaveBeenCalled()

    await expect(invoke('item:copy-subitem', { id: 'f1', paths: ['/Users/me/b.txt', '/etc/passwd'] })).resolves.toBe(true)
    expect(mocks.writeFileUrls).toHaveBeenCalledWith(['/Users/me/b.txt'])
  })

  it('pastes only paths that belong to the item', async () => {
    setPlatform('darwin')
    await expect(invoke('item:paste-subitem', { id: 'f1', paths: ['/Users/me/.ssh/id_ed25519'] })).resolves.toBe(false)
    expect(mocks.writeFileUrls).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(700)
    await expect(settled(invoke('item:paste-subitem', { id: 'f1', paths: ['/Users/me/a.txt'] }))).resolves.toBe(true)
    expect(mocks.writeFileUrls).toHaveBeenCalledWith(['/Users/me/a.txt'])
  })
})

describe('hotkey:set', () => {
  it('rejects a reserved shortcut without saving', () => {
    setPlatform('darwin')
    const result = invoke('hotkey:set', 'Command+C')
    expect(result).toMatchObject({ ok: false, reason: 'reserved' })
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('rejects the paste queue shortcut as taken', () => {
    setPlatform('darwin')
    expect(invoke('hotkey:set', 'Control+Command+V')).toMatchObject({ ok: false, reason: 'taken' })
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('restores the previous shortcut when the new one is taken', () => {
    setPlatform('darwin')
    mocks.refuse.add('Command+Alt+V')
    const result = invoke('hotkey:set', 'Command+Alt+V')

    expect(result).toMatchObject({ ok: false, reason: 'taken' })
    expect(mocks.saveSettings).not.toHaveBeenCalled()
    expect(mocks.registerGlobalHotkey).toHaveBeenLastCalledWith('Command+Shift+V')
  })

  it('falls back to the macOS default when no shortcut was saved yet', () => {
    setPlatform('darwin')
    delete mocks.settings.toggleHotkey
    mocks.refuse.add('Command+Alt+V')
    invoke('hotkey:set', 'Command+Alt+V')
    expect(mocks.registerGlobalHotkey).toHaveBeenLastCalledWith('Command+Shift+V')
  })

  it('on win32 saves any shortcut like upstream and reports a failed registration', () => {
    setPlatform('win32')
    mocks.settings.toggleHotkey = 'Alt+C'
    expect(invoke('hotkey:set', 'Control+C')).toMatchObject({ ok: true, settings: { toggleHotkey: 'Control+C' } })
    expect(mocks.registerGlobalHotkey).toHaveBeenLastCalledWith('Control+C')

    expect(invoke('hotkey:set', 'F8')).toMatchObject({ ok: true, settings: { toggleHotkey: 'F8' } })

    mocks.registerGlobalHotkey.mockImplementation(() => false)
    expect(invoke('hotkey:set', 'Alt+X')).toMatchObject({ ok: false, reason: 'taken', settings: { toggleHotkey: 'Alt+X' } })
    expect(mocks.saveSettings).toHaveBeenLastCalledWith({ toggleHotkey: 'Alt+X' })
    expect(mocks.pushSettings).toHaveBeenCalled()
  })

  it('saves and registers a free shortcut', () => {
    setPlatform('darwin')
    const result = invoke('hotkey:set', 'Command+Alt+V')

    expect(result).toMatchObject({ ok: true, settings: { toggleHotkey: 'Command+Alt+V' } })
    expect(mocks.saveSettings).toHaveBeenCalledWith({ toggleHotkey: 'Command+Alt+V' })
    expect(mocks.registerGlobalHotkey).toHaveBeenLastCalledWith('Command+Alt+V')
    expect(mocks.pushSettings).toHaveBeenCalled()
  })
})

describe('settings:update and the paste queue shortcut', () => {
  it.each([
    ['Command+V', 'toast.shortcutReserved'],
    ['V', 'toast.shortcutReserved'],
    ['not a key', 'toast.shortcutReserved'],
    ['Shift+Command+V', 'toast.shortcutTaken']
  ])('keeps the old value for %s', async (accelerator, message) => {
    setPlatform('darwin')
    const next = await invoke('settings:update', { pasteQueueHotkey: accelerator, incognito: true })
    expect(next.pasteQueueHotkey).toBe('Command+Control+V')
    expect(next.incognito).toBe(true)
    expect(mocks.saveSettings).toHaveBeenCalledWith({ incognito: true })
    expect(toasts()).toEqual([message])
  })

  it('checks against a toggle shortcut changed in the same patch', async () => {
    setPlatform('darwin')
    const next = await invoke('settings:update', { toggleHotkey: 'Command+Alt+B', pasteQueueHotkey: 'Command+Alt+B' })
    expect(next.pasteQueueHotkey).toBe('Command+Control+V')
    expect(toasts()).toEqual(['toast.shortcutTaken'])
  })

  it('saves a valid shortcut', async () => {
    setPlatform('darwin')
    const next = await invoke('settings:update', { pasteQueueHotkey: 'Command+Alt+P' })
    expect(next.pasteQueueHotkey).toBe('Command+Alt+P')
    expect(toasts()).toEqual([])
  })
})

describe('other item and app handlers', () => {
  it('item:set-title renames and pushes the list', () => {
    const list = invoke('item:set-title', 't1', 'Greeting')
    expect(mocks.setTitle).toHaveBeenCalledWith('t1', 'Greeting')
    expect(mocks.pushItems).toHaveBeenCalled()
    expect(list).toHaveLength(1)
  })

  it('queue:add is inert off darwin and registers the queue shortcut on darwin', () => {
    setPlatform('win32')
    expect(invoke('queue:add', 't1')).toEqual([])
    expect(mocks.shortcuts.size).toBe(0)

    setPlatform('darwin')
    expect(invoke('queue:add', 't1')).toEqual(['t1'])
    expect(mocks.shortcuts.has('Command+Control+V')).toBe(true)
    invoke('queue:clear')
    expect(mocks.shortcuts.has('Command+Control+V')).toBe(false)
  })

  it('handlers return harmless values off darwin', async () => {
    setPlatform('win32')
    expect(invoke('item:quick-look', 't1')).toBe(false)
    expect(invoke('item:context-menu', 't1')).toBeUndefined()
    expect(invoke('apps:list-running')).toEqual([])
    await expect(invoke('apps:pick')).resolves.toBeNull()
    await expect(invoke('apps:icon', 'com.apple.Safari')).resolves.toBeNull()
    expect(invoke('accessibility:open-settings')).toBeUndefined()
  })
})
