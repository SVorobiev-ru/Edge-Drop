import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ItemData } from '../shared/types'
import { restorePlatform, setPlatform } from './helpers/platform'

type CaptureHandler = (data: ItemData, png?: Buffer) => void

const mocks = vi.hoisted(() => ({
  userData: '',
  imageSize: { width: 1440, height: 900 },
  send: vi.fn(),
  watcherArgs: [] as unknown[][],
  onNew: null as ((data: any, png?: Buffer) => void) | null,
  clipboardClear: vi.fn(),
  clipboardWriteImage: vi.fn(),
  nativeChangeCount: false
}))

vi.mock('electron', async () => ({
  app: (await import('./helpers/electronMock')).userDataApp(() => mocks.userData),
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...args: unknown[]) => mocks.send(...args) } }
    ]
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromBuffer: () => ({ getSize: () => mocks.imageSize })
  },
  clipboard: {
    clear: () => mocks.clipboardClear(),
    writeImage: (img: unknown) => mocks.clipboardWriteImage(img)
  },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock('koffi', () => ({
  default: { load: () => ({ func: () => () => (mocks.nativeChangeCount ? 1 : null) }) }
}))

vi.mock('../electron/main/drag', () => ({ prefetchFileIcons: vi.fn() }))

vi.mock('../electron/main/powershell', () => ({
  getSystemPowerShellPath: () => 'powershell.exe',
  getWritableCwd: () => mocks.userData
}))

vi.mock('../electron/main/window', () => ({
  getMainWindow: () => null,
  registerClipboardUpdateListener: vi.fn(),
  requestPollBoost: vi.fn()
}))

vi.mock('../electron/clipboard/ClipboardWatcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/clipboard/ClipboardWatcher')>()
  class RecordingWatcher extends actual.ClipboardWatcher {
    constructor(...args: [number?, number?]) {
      super(...args)
      mocks.watcherArgs.push(args)
    }
    start(onNew: CaptureHandler): void {
      mocks.onNew = onNew
    }
    setPaused(): void {}
    resyncSignature(): void {}
  }
  return { ...actual, ClipboardWatcher: RecordingWatcher }
})

async function loadState(platform: string): Promise<typeof import('../electron/main/state')> {
  setPlatform(platform)
  vi.resetModules()
  return import('../electron/main/state')
}

function sentItems(): any[] {
  const calls = mocks.send.mock.calls.filter((c) => c[0] === 'state:items')
  return calls.length ? (calls[calls.length - 1][1] as any[]) : []
}

describe('addScreenshotToHistory', () => {
  let state: typeof import('../electron/main/state') | null = null

  beforeEach(() => {
    mocks.userData = join(tmpdir(), `ed-shot-ud-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(join(mocks.userData, 'images'), { recursive: true })
    mocks.imageSize = { width: 1440, height: 900 }
    mocks.send.mockReset()
    mocks.clipboardClear.mockReset()
    mocks.clipboardWriteImage.mockReset()
    mocks.watcherArgs.length = 0
    mocks.onNew = null
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    state?.stopStateTimers()
    state = null
    vi.restoreAllMocks()
    restorePlatform()
    rmSync(mocks.userData, { recursive: true, force: true })
  })

  afterAll(() => {
    restorePlatform()
  })

  it('adds the screenshot to history as a screenshot image and pushes the list', async () => {
    state = await loadState('darwin')
    const png = Buffer.from('screenshot-png-bytes')

    expect(state.addScreenshotToHistory(png, 'Screenshot 2026-10-04 at 12.00.00.png')).toBe(true)

    const items = state.getStore().list()
    expect(items).toHaveLength(1)
    const data = items[0].data
    if (data.kind !== 'image') throw new Error('expected image item')
    expect(data).toMatchObject({
      kind: 'image',
      width: 1440,
      height: 900,
      bytes: png.length,
      ext: 'png',
      source: 'screenshot',
      fileName: 'Screenshot 2026-10-04 at 12.00.00.png'
    })
    expect(data.imageId).not.toBe('')
    expect(readFileSync(state.getStore().getImagePath(data.imageId, 'png'))).toEqual(png)
    expect(sentItems()).toHaveLength(1)
    expect(mocks.clipboardClear).not.toHaveBeenCalled()
    expect(mocks.clipboardWriteImage).not.toHaveBeenCalled()
  })

  it('records nothing in incognito mode', async () => {
    state = await loadState('darwin')
    state.saveSettings({ incognito: true })

    expect(state.addScreenshotToHistory(Buffer.from('secret'), 'Shot.png')).toBe(false)

    expect(state.getStore().list()).toHaveLength(0)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(existsSync(join(mocks.userData, 'images'))).toBe(true)
  })

  it('rejects bytes that do not decode to an image', async () => {
    state = await loadState('darwin')
    mocks.imageSize = { width: 0, height: 0 }
    expect(state.addScreenshotToHistory(Buffer.from('garbage'))).toBe(false)
    expect(state.getStore().list()).toHaveLength(0)
  })

  it('does not duplicate the same screenshot added twice', async () => {
    state = await loadState('darwin')
    const png = Buffer.from('same-screenshot')
    state.addScreenshotToHistory(png, 'Shot.png')
    state.addScreenshotToHistory(png, 'Shot.png')

    const items = state.getStore().list()
    expect(items).toHaveLength(1)
    expect(items[0].hitCount).toBe(2)
  })

  it('does not duplicate a screenshot that also arrives through the clipboard watcher', async () => {
    state = await loadState('darwin')
    state.initState()
    expect(mocks.onNew).toBeTypeOf('function')
    const png = Buffer.from('same-screenshot')

    state.addScreenshotToHistory(png, 'Shot.png')
    mocks.onNew!(
      { kind: 'image', imageId: 'from-clipboard', width: 1440, height: 900, bytes: png.length, ext: 'png', source: 'screenshot' },
      png
    )

    expect(state.getStore().list()).toHaveLength(1)
    expect(state.getStore().list()[0].hitCount).toBe(2)

    mocks.onNew!({ kind: 'image', imageId: 'other', width: 800, height: 600, bytes: 5, ext: 'png', source: 'image' }, Buffer.from('other'))
    expect(state.getStore().list()).toHaveLength(2)
  })

  it('still records clipboard captures through the shared path', async () => {
    state = await loadState('darwin')
    state.initState()
    mocks.onNew!({ kind: 'text', text: 'hello', isUrl: false })
    expect(state.getStore().list().map((i) => i.data.kind)).toEqual(['text'])
    expect(sentItems()).toHaveLength(1)

    state.saveSettings({ incognito: true })
    mocks.onNew!({ kind: 'text', text: 'hidden', isUrl: false })
    expect(state.getStore().list()).toHaveLength(1)
  })
})

describe('clipboard poll interval', () => {
  afterEach(() => {
    restorePlatform()
  })

  beforeEach(() => {
    mocks.userData = join(tmpdir(), `ed-shot-ud-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mocks.watcherArgs.length = 0
    mocks.nativeChangeCount = false
  })

  afterAll(() => {
    mocks.nativeChangeCount = false
  })

  it('polls every 250 ms on darwin when the native changeCount is available', async () => {
    mocks.nativeChangeCount = true
    await loadState('darwin')
    expect(mocks.watcherArgs).toEqual([[250, 220]])
  })

  it('keeps 600 ms on darwin when the native changeCount is unavailable', async () => {
    await loadState('darwin')
    expect(mocks.watcherArgs).toEqual([[600, 220]])
  })

  it('keeps 600 ms on win32 and linux', async () => {
    await loadState('win32')
    await loadState('linux')
    expect(mocks.watcherArgs).toEqual([[600, 220], [600, 220]])
  })
})
