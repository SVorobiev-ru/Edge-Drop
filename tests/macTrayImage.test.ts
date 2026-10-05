import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

interface FakeImage {
  label: string
  empty: boolean
  isEmpty: () => boolean
  resize: ReturnType<typeof vi.fn>
  toPNG: () => Buffer
  addRepresentation: ReturnType<typeof vi.fn>
  setTemplateImage: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  shouldUseDarkColors: true,
  sourceEmpty: false,
  calls: [] as string[]
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mocks.existsSync(...args)
  }
})

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFileSync: () => {
      throw new Error('reg unavailable')
    }
  }
})

vi.mock('electron', () => {
  function makeImage(label: string, empty: boolean): FakeImage {
    const img: FakeImage = {
      label,
      empty,
      isEmpty: () => empty,
      resize: vi.fn((size: { width: number; height: number; quality?: string }) =>
        makeImage(`${label}@${size.width}x${size.height}`, empty)
      ),
      toPNG: () => Buffer.from(`png:${label}`),
      addRepresentation: vi.fn(() => {
        mocks.calls.push('addRepresentation')
      }),
      setTemplateImage: vi.fn(() => {
        mocks.calls.push('setTemplateImage')
      })
    }
    return img
  }
  return {
    app: { getPath: () => '/mock/userData' },
    nativeTheme: {
      get shouldUseDarkColors() {
        return mocks.shouldUseDarkColors
      },
      on: vi.fn()
    },
    nativeImage: {
      createFromPath: vi.fn((p: string) => makeImage(`path:${p}`, mocks.sourceEmpty)),
      createFromBuffer: vi.fn(() => makeImage('buffer', false)),
      createEmpty: vi.fn(() => makeImage('created', true))
    },
    Tray: vi.fn(),
    Menu: { buildFromTemplate: vi.fn() },
    Notification: { isSupported: vi.fn(() => false) },
    screen: { on: vi.fn() }
  }
})

vi.mock('../electron/store/paths', () => ({
  PATHS: {
    trayIcon: () => '/res/tray.png',
    trayDarkIcon: () => '/res/tray-dark.png',
    indexFile: () => '/mock/userData/items.json'
  }
}))

vi.mock('../electron/store/settings', () => ({
  loadSettings: () => ({ language: 'en' }),
  saveSettings: vi.fn()
}))

vi.mock('../electron/main/window', () => ({
  getMainWindow: vi.fn(),
  setVisible: vi.fn(),
  repositionWindow: vi.fn(),
  getDisplayListOptions: vi.fn(() => []),
  registerWindowRepositionListener: vi.fn(),
  popUpAndRetract: vi.fn(),
  markExplicitOpen: vi.fn()
}))

vi.mock('../electron/main/state', () => ({
  pushState: { items: vi.fn(), settings: vi.fn(), togglePanel: vi.fn() }
}))

import { nativeImage } from 'electron'
import { getTrayImage } from '../electron/main/tray'

function createdImage(): FakeImage {
  const results = vi.mocked(nativeImage.createEmpty).mock.results
  return results[results.length - 1].value as FakeImage
}

describe('getTrayImage on macOS', () => {
  beforeEach(() => {
    setPlatform('darwin')
    mocks.existsSync.mockReset()
    mocks.existsSync.mockReturnValue(true)
    mocks.shouldUseDarkColors = true
    mocks.sourceEmpty = false
    mocks.calls.length = 0
    vi.mocked(nativeImage.createFromPath).mockClear()
    vi.mocked(nativeImage.createFromBuffer).mockClear()
    vi.mocked(nativeImage.createEmpty).mockClear()
  })

  afterEach(() => {
    restorePlatform()
  })

  afterAll(() => {
    restorePlatform()
  })

  it('builds a template image from an empty image with 1x and 2x representations', () => {
    const img = getTrayImage() as unknown as FakeImage

    expect(nativeImage.createEmpty).toHaveBeenCalledTimes(1)
    expect(img).toBe(createdImage())
    expect(img.addRepresentation).toHaveBeenCalledTimes(2)
    expect(img.addRepresentation).toHaveBeenNthCalledWith(1, {
      scaleFactor: 1,
      buffer: Buffer.from('png:path:/res/tray-dark.png@18x18')
    })
    expect(img.addRepresentation).toHaveBeenNthCalledWith(2, {
      scaleFactor: 2,
      buffer: Buffer.from('png:path:/res/tray-dark.png@36x36')
    })
  })

  it('resizes the source to 18x18 and 36x36 with best quality', () => {
    getTrayImage()
    const src = vi.mocked(nativeImage.createFromPath).mock.results[0].value as FakeImage
    expect(src.resize).toHaveBeenCalledTimes(2)
    expect(src.resize).toHaveBeenNthCalledWith(1, { width: 18, height: 18, quality: 'best' })
    expect(src.resize).toHaveBeenNthCalledWith(2, { width: 36, height: 36, quality: 'best' })
  })

  it('marks the image as a template after both representations are added', () => {
    const img = getTrayImage() as unknown as FakeImage
    expect(img.setTemplateImage).toHaveBeenCalledTimes(1)
    expect(img.setTemplateImage).toHaveBeenCalledWith(true)
    expect(mocks.calls).toEqual(['addRepresentation', 'addRepresentation', 'setTemplateImage'])
  })

  it('loads the dark glyph when it exists, regardless of the system theme', () => {
    mocks.shouldUseDarkColors = false
    getTrayImage()
    expect(nativeImage.createFromPath).toHaveBeenCalledTimes(1)
    expect(nativeImage.createFromPath).toHaveBeenCalledWith('/res/tray-dark.png')

    vi.mocked(nativeImage.createFromPath).mockClear()
    mocks.shouldUseDarkColors = true
    getTrayImage()
    expect(nativeImage.createFromPath).toHaveBeenCalledWith('/res/tray-dark.png')
  })

  it('uses the regular tray icon when the dark one is missing', () => {
    mocks.existsSync.mockImplementation((p: string) => p !== '/res/tray-dark.png')
    getTrayImage()
    expect(nativeImage.createFromPath).toHaveBeenCalledTimes(1)
    expect(nativeImage.createFromPath).toHaveBeenCalledWith('/res/tray.png')
  })

  describe('when the source image is empty', () => {
    beforeEach(() => {
      mocks.sourceEmpty = true
    })

    it('skips the template path and returns the generic 32x32 image', () => {
      const img = getTrayImage() as unknown as FakeImage

      expect(nativeImage.createEmpty).not.toHaveBeenCalled()
      expect(mocks.calls).toEqual([])
      expect(img.label).toBe('path:/res/tray.png@32x32')
      const src = vi.mocked(nativeImage.createFromPath).mock.results[1].value as FakeImage
      expect(src.resize).toHaveBeenCalledWith({ width: 32, height: 32, quality: 'best' })
    })

    it('falls back to the built-in 16x16 icon when no icon file exists', () => {
      mocks.existsSync.mockReturnValue(false)
      const img = getTrayImage() as unknown as FakeImage

      expect(nativeImage.createEmpty).not.toHaveBeenCalled()
      expect(nativeImage.createFromBuffer).toHaveBeenCalledTimes(1)
      expect(img.label).toBe('buffer@16x16')
    })
  })

  it('does not build a template image on Windows', () => {
    setPlatform('win32')
    const img = getTrayImage() as unknown as FakeImage

    expect(nativeImage.createEmpty).not.toHaveBeenCalled()
    expect(mocks.calls).toEqual([])
    expect(img.label).toMatch(/@32x32$/)
  })
})
