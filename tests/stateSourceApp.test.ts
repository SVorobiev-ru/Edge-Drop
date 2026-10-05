import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ItemData, SourceApp } from '../shared/types'
import type { CapturePolicy } from '../electron/clipboard/ClipboardWatcher'
import { restorePlatform, setPlatform } from './helpers/platform'

type CaptureHandler = (data: ItemData, png?: Buffer, image?: unknown, sourceApp?: SourceApp) => void

const mocks = vi.hoisted(() => ({
  userData: '',
  onNew: null as ((data: any, png?: Buffer, image?: unknown, sourceApp?: any) => void) | null,
  policy: null as any,
  frontmostApp: vi.fn(),
  ownBundleId: vi.fn(),
  writeImageData: vi.fn(),
  original: null as null | { type: string; bytes: Buffer },
  rtf: undefined as string | undefined
}))

vi.mock('electron', async () => ({
  app: (await import('./helpers/electronMock')).userDataApp(() => mocks.userData),
  BrowserWindow: { getAllWindows: () => [] },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromBuffer: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) })
  },
  clipboard: {},
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock('koffi', () => import('./helpers/koffiMock'))

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

vi.mock('../electron/main/macSourceApp', () => ({
  frontmostApp: mocks.frontmostApp,
  ownBundleId: mocks.ownBundleId
}))

vi.mock('../electron/main/macPasteboard', () => ({ writeImageData: mocks.writeImageData }))

vi.mock('../electron/clipboard/formats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/clipboard/formats')>()
  return {
    ...actual,
    takeCapturedOriginalImage: () => {
      const original = mocks.original
      mocks.original = null
      return original ?? undefined
    },
    takeCapturedRtf: () => {
      const rtf = mocks.rtf
      mocks.rtf = undefined
      return rtf
    }
  }
})

vi.mock('../electron/clipboard/ClipboardWatcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/clipboard/ClipboardWatcher')>()
  class RecordingWatcher extends actual.ClipboardWatcher {
    start(onNew: CaptureHandler): void {
      mocks.onNew = onNew
    }
    setCapturePolicy(policy: CapturePolicy | null): void {
      mocks.policy = policy
    }
    setPaused(): void {}
    resyncSignature(): void {}
  }
  return { ...actual, ClipboardWatcher: RecordingWatcher }
})

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('original-with-dpi')])
const TIFF = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.from('original-tiff')])
const REENCODED = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('re-encoded')])

describe('source app, ignore list and original images in state', () => {
  let state: typeof import('../electron/main/state')
  let images: string

  async function boot(settings: Record<string, unknown> = {}): Promise<void> {
    writeFileSync(join(mocks.userData, 'settings.json'), JSON.stringify({ v026UpgradeCleaned: true, ...settings }))
    vi.resetModules()
    state = await import('../electron/main/state')
    state.initState()
  }

  function captureImage(imageId: string, source?: SourceApp): void {
    mocks.onNew!(
      { kind: 'image', imageId, width: 1440, height: 900, bytes: REENCODED.length, ext: 'png', source: 'screenshot' },
      REENCODED,
      undefined,
      source
    )
  }

  beforeEach(() => {
    mocks.userData = join(tmpdir(), `ed-source-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    images = join(mocks.userData, 'images')
    for (const dir of ['images', 'payloads', 'thumbnails']) mkdirSync(join(mocks.userData, dir), { recursive: true })
    mocks.onNew = null
    mocks.policy = null
    mocks.original = null
    mocks.rtf = undefined
    mocks.frontmostApp.mockReset().mockReturnValue({ bundleId: 'com.apple.Safari', name: 'Safari', pid: 4242 })
    mocks.ownBundleId.mockReset().mockReturnValue('com.edgedrop.app')
    mocks.writeImageData.mockReset().mockReturnValue(true)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    setPlatform('darwin')
  })

  afterEach(() => {
    state?.stopStateTimers()
    vi.restoreAllMocks()
    restorePlatform()
    rmSync(mocks.userData, { recursive: true, force: true })
  })

  afterAll(() => {
    restorePlatform()
  })

  it('gives the watcher a policy backed by macSourceApp and the settings', async () => {
    await boot({ ignoredApps: ['com.agilebits.onepassword7'], ignoreRemoteClipboard: true })
    const policy = mocks.policy as CapturePolicy

    expect(policy.frontmostApp()).toEqual({ bundleId: 'com.apple.Safari', name: 'Safari', pid: 4242 })
    expect(policy.ownBundleId?.()).toBe('com.edgedrop.app')
    expect(policy.ignoredApps()).toEqual(['com.agilebits.onepassword7'])
    expect(policy.ignoreRemoteClipboard()).toBe(true)

    state.saveSettings({ ignoredApps: [], ignoreRemoteClipboard: false })
    expect(policy.ignoredApps()).toEqual([])
    expect(policy.ignoreRemoteClipboard()).toBe(false)
  })

  it('stores the source app handed over by the watcher and keeps it on a repeated copy', async () => {
    await boot()
    mocks.onNew!({ kind: 'text', text: 'hello', isUrl: false }, undefined, undefined, { bundleId: 'com.apple.Safari', name: 'Safari' })
    mocks.onNew!({ kind: 'text', text: 'hello', isUrl: false }, undefined, undefined, { bundleId: 'com.apple.Notes', name: 'Notes' })
    mocks.onNew!({ kind: 'text', text: 'no source', isUrl: false })

    const [second, first] = state.getStore().list()
    expect(first.hitCount).toBe(2)
    expect(first.sourceApp).toEqual({ bundleId: 'com.apple.Safari', name: 'Safari' })
    expect('sourceApp' in second).toBe(false)
  })

  it('stores captured rtf with the text item', async () => {
    await boot()
    mocks.rtf = '{\\rtf1 styled}'
    mocks.onNew!({ kind: 'text', text: 'styled', isUrl: false })

    const id = state.getStore().list()[0].id
    expect(state.getStore().getRichText(id)).toEqual({ text: 'styled', rtf: '{\\rtf1 styled}' })
  })

  it('stores the original png bytes instead of the re-encoded ones without changing the signature', async () => {
    await boot()
    mocks.original = { type: 'public.png', bytes: PNG }
    captureImage('retina', { bundleId: 'com.apple.Preview', name: 'Preview' })

    expect(readFileSync(join(images, 'retina.png')).equals(PNG)).toBe(true)
    const item = state.getStore().list()[0]
    expect(item.data).toMatchObject({ kind: 'image', bytes: REENCODED.length, ext: 'png' })
    expect(item.sourceApp).toEqual({ bundleId: 'com.apple.Preview', name: 'Preview' })

    mocks.original = { type: 'public.png', bytes: PNG }
    captureImage('retina-again')
    expect(state.getStore().list()).toHaveLength(1)
    expect(state.getStore().list()[0].hitCount).toBe(2)
    expect(readdirSync(images)).toEqual(['retina.png'])
  })

  it('keeps a tiff original next to the display png', async () => {
    await boot()
    mocks.original = { type: 'public.tiff', bytes: TIFF }
    captureImage('scan')

    expect(readdirSync(images).sort()).toEqual(['scan.orig.tiff', 'scan.png'])
    expect(readFileSync(join(images, 'scan.png')).equals(REENCODED)).toBe(true)
    expect(readFileSync(join(images, 'scan.orig.tiff')).equals(TIFF)).toBe(true)
  })

  it('stores the re-encoded png when the pasteboard had no original', async () => {
    await boot()
    captureImage('legacy')

    expect(readFileSync(join(images, 'legacy.png')).equals(REENCODED)).toBe(true)
    expect(readdirSync(images)).toEqual(['legacy.png'])
  })

  it('writes a stored png back through the native writer with the named file', async () => {
    await boot()
    mocks.original = { type: 'public.png', bytes: PNG }
    captureImage('retina')
    const item = state.getStore().list()[0]

    expect(state.writeStoredImageToPasteboard(item.data, '/tmp/Screenshot 1.png')).toBe(true)
    expect(mocks.writeImageData).toHaveBeenCalledWith({ type: 'public.png', bytes: PNG }, { png: undefined, fileUrlPath: '/tmp/Screenshot 1.png' })
  })

  it('writes a stored tiff back as the original with the display png', async () => {
    await boot()
    mocks.original = { type: 'public.tiff', bytes: TIFF }
    captureImage('scan')

    expect(state.writeStoredImageToPasteboard(state.getStore().list()[0].data)).toBe(true)
    expect(mocks.writeImageData).toHaveBeenCalledWith({ type: 'public.tiff', bytes: TIFF }, { png: REENCODED, fileUrlPath: undefined })
  })

  it('reports false so the caller falls back when the native path cannot be used', async () => {
    await boot()
    captureImage('legacy')
    mocks.onNew!({ kind: 'text', text: 'text item', isUrl: false })
    const [textItem, imageItem] = state.getStore().list()

    expect(state.writeStoredImageToPasteboard(textItem.data)).toBe(false)

    mocks.writeImageData.mockReturnValue(false)
    expect(state.writeStoredImageToPasteboard(imageItem.data)).toBe(false)

    mocks.writeImageData.mockReset().mockReturnValue(true)
    rmSync(join(images, 'legacy.png'))
    expect(state.writeStoredImageToPasteboard(imageItem.data)).toBe(false)
    expect(mocks.writeImageData).not.toHaveBeenCalled()

    setPlatform('win32')
    expect(state.writeStoredImageToPasteboard(imageItem.data)).toBe(false)
  })
})
