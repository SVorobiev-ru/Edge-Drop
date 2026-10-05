import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ItemData } from '../shared/types'

type CaptureHandler = (data: ItemData, png?: Buffer, image?: unknown) => void

const mocks = vi.hoisted(() => ({
  userData: '',
  onNew: null as ((data: any, png?: Buffer, image?: unknown) => void) | null,
  original: undefined as { type: string; bytes: Buffer } | undefined
}))

function fakeImage(tag: string) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width: 1440, height: 900 }),
    resize: () => ({ toPNG: () => Buffer.from(`thumb-${tag}`) }),
    toPNG: () => Buffer.from(`full-${tag}`)
  }
}

vi.mock('electron', async () => ({
  app: (await import('./helpers/electronMock')).userDataApp(() => mocks.userData),
  BrowserWindow: { getAllWindows: () => [] },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromBuffer: () => fakeImage('screenshot')
  },
  clipboard: {},
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock('koffi', () => import('./helpers/koffiMock'))

vi.mock('../electron/main/drag', () => ({ prefetchFileIcons: vi.fn() }))

vi.mock('../electron/clipboard/formats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/clipboard/formats')>()
  return {
    ...actual,
    takeCapturedOriginalImage: () => {
      const original = mocks.original
      mocks.original = undefined
      return original
    }
  }
})

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
    start(onNew: CaptureHandler): void {
      mocks.onNew = onNew
    }
    setPaused(): void {}
    resyncSignature(): void {}
  }
  return { ...actual, ClipboardWatcher: RecordingWatcher }
})

const realPlatform = process.platform

describe('capture recording', () => {
  let state: typeof import('../electron/main/state')
  let images: string
  let thumbnails: string

  beforeEach(async () => {
    mocks.userData = join(tmpdir(), `ed-state-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    images = join(mocks.userData, 'images')
    thumbnails = join(mocks.userData, 'thumbnails')
    mkdirSync(images, { recursive: true })
    mkdirSync(join(mocks.userData, 'payloads'), { recursive: true })
    mocks.onNew = null
    mocks.original = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    vi.resetModules()
    state = await import('../electron/main/state')
    state.initState()
  })

  afterEach(() => {
    state.stopStateTimers()
    vi.restoreAllMocks()
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    rmSync(mocks.userData, { recursive: true, force: true })
  })

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  })

  function capture(imageId: string, png: Buffer): void {
    mocks.onNew!(
      { kind: 'image', imageId, width: 1440, height: 900, bytes: png.length, ext: 'png', source: 'image' },
      png,
      fakeImage(imageId)
    )
  }

  it('does not write a second PNG when the same image is copied again', () => {
    const png = Buffer.from('same-image-bytes')
    capture('first', png)
    capture('second', png)
    capture('third', png)

    expect(state.getStore().list()).toHaveLength(1)
    expect(state.getStore().list()[0].hitCount).toBe(3)
    expect(readdirSync(images)).toEqual(['first.png'])
    expect(readdirSync(thumbnails)).toEqual(['first.png'])
  })

  it('does not write a second PNG when the same screenshot is reported twice', () => {
    const png = Buffer.from('same-screenshot')
    state.addScreenshotToHistory(png, 'Shot.png')
    state.addScreenshotToHistory(png, 'Shot.png')

    expect(state.getStore().list()).toHaveLength(1)
    expect(readdirSync(images)).toHaveLength(1)
  })

  it('stores a thumbnail next to a new capture from the already decoded image', () => {
    capture('fresh', Buffer.from('fresh-image'))

    expect(readFileSync(join(images, 'fresh.png'), 'utf8')).toBe('fresh-image')
    expect(readFileSync(join(thumbnails, 'fresh.png'), 'utf8')).toBe('thumb-fresh')
  })

  it('still records a capture that arrives without a decoded image', () => {
    const png = Buffer.from('no-image-object')
    mocks.onNew!({ kind: 'image', imageId: 'plain', width: 1, height: 1, bytes: png.length, ext: 'png' }, png)

    expect(readdirSync(images)).toEqual(['plain.png'])
    expect(state.getStore().list()).toHaveLength(1)
  })

  it('reports the size of the stored original png and keeps the dedupe signature on the re-encoded size', () => {
    const encoded = Buffer.from('re-encoded')
    const original = Buffer.from('original-png-with-more-bytes')
    mocks.original = { type: 'public.png', bytes: original }
    capture('orig', encoded)
    mocks.original = { type: 'public.png', bytes: original }
    capture('again', encoded)

    const [item] = state.getStore().list()
    expect(state.getStore().list()).toHaveLength(1)
    expect(item.data).toMatchObject({ bytes: encoded.length, fileBytes: original.length })
    expect(readFileSync(join(images, 'orig.png'), 'utf8')).toBe('original-png-with-more-bytes')
    expect(state.getStore().toDto()[0].data).toMatchObject({ bytes: encoded.length, fileBytes: original.length })
  })

  it('keeps the re-encoded size when the original was a tiff', () => {
    const encoded = Buffer.from('re-encoded')
    mocks.original = { type: 'public.tiff', bytes: Buffer.from('tiff-bytes-that-are-big') }
    capture('tiff', encoded)

    expect(state.getStore().list()[0].data).not.toHaveProperty('fileBytes')
  })

  it('writes the whole text of a 600 000 character copy to its payload', () => {
    const text = 'Ж'.repeat(299_999) + 'a'.repeat(300_000) + 'z'
    mocks.onNew!({ kind: 'text', text, isUrl: false })

    const [item] = state.getStore().list()
    expect(item.data).toMatchObject({ kind: 'text', hasFullPayload: true })
    const payload = readFileSync(join(mocks.userData, 'payloads', `${item.id}.txt`), 'utf8')
    expect(payload).toHaveLength(600_000)
    expect(state.getStore().getFullText(item.id)).toBe(text)
  })
})

