import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ItemData } from '../shared/types'

const mocks = vi.hoisted(() => ({
  text: '',
  html: '',
  image: null as { width: number; height: number } | null,
  formats: {} as Record<string, string>,
  existing: new Set<string>(),
  nativeTypes: null as string[] | null,
  changeCount: 0 as number | null,
  bridgeBroken: false,
  readImage: vi.fn()
}))

vi.mock('electron', () => ({
  clipboard: {
    availableFormats: () => [],
    readBuffer: () => Buffer.alloc(0),
    has: () => false,
    read: (format: string) => mocks.formats[format] ?? '',
    readText: () => mocks.text,
    readHTML: () => mocks.html,
    readImage: () => {
      mocks.readImage()
      const image = mocks.image
      return {
        isEmpty: () => !image,
        getSize: () => image ?? { width: 0, height: 0 },
        toBitmap: () => Buffer.from([1, 2, 3, 4]),
        toPNG: () => Buffer.from('png')
      }
    }
  },
  app: { isPackaged: false, getAppPath: () => '/mock/app', getPath: () => '/mock/userData' }
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: (p: string) => mocks.existing.has(p) }
})

vi.mock('koffi', () => ({
  default: {
    load: () => {
      if (mocks.bridgeBroken) throw new Error('no objc runtime')
      return {
        func: (decl: string, ret?: string, args?: string[]) => {
          if (decl.includes('objc_getClass')) return () => 'NSPasteboard'
          if (decl.includes('sel_registerName')) return (name: string) => name
          if (decl.includes('GetClipboardSequenceNumber')) return () => 0
          if (ret === 'long') return (_obj: unknown, sel: string) => (sel === 'count' ? (mocks.nativeTypes ?? []).length : mocks.changeCount)
          if (ret === 'str') return (item: { name: string }) => item.name
          if (args && args.length === 3) return (_arr: unknown, _sel: string, i: number) => ({ name: (mocks.nativeTypes ?? [])[i] })
          return (_obj: unknown, sel: string) => {
            if (sel === 'generalPasteboard') return mocks.changeCount === null ? null : 'pb'
            if (sel === 'types') return mocks.nativeTypes ? 'types' : null
            return null
          }
        }
      }
    }
  }
}))

const realPlatform = process.platform

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

async function loadFormats(platform: string): Promise<typeof import('../electron/clipboard/formats')> {
  setPlatform(platform)
  vi.resetModules()
  return import('../electron/clipboard/formats')
}

function plist(...paths: string[]): string {
  return `<plist version="1.0"><array>${paths.map((p) => `<string>${p}</string>`).join('')}</array></plist>`
}

beforeEach(() => {
  mocks.text = ''
  mocks.html = ''
  mocks.image = null
  mocks.formats = {}
  mocks.existing = new Set()
  mocks.nativeTypes = null
  mocks.changeCount = 0
  mocks.bridgeBroken = false
  mocks.readImage.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  setPlatform(realPlatform)
})

afterAll(() => {
  setPlatform(realPlatform)
})

describe('readClipboard item kind on darwin', () => {
  it('captures a Chrome "Copy Image" (image + meta-prefixed img html) as an image', async () => {
    const { readClipboard } = await loadFormats('darwin')
    mocks.image = { width: 640, height: 480 }
    mocks.html = '<meta charset=\'utf-8\'><img src="https://example.com/cat.png" alt="A cat"/>'

    expect(await readClipboard()).toMatchObject({ kind: 'image', width: 640, height: 480, source: 'image' })
  })

  it('captures a Safari "Copy Image" (image + url text) as an image, even for a very long url', async () => {
    const { readClipboard } = await loadFormats('darwin')
    mocks.image = { width: 640, height: 480 }
    mocks.text = `https://cdn.example.com/${'a'.repeat(700)}.png`
    mocks.html = '<html><body><img src="x"></body></html>'

    expect(await readClipboard()).toMatchObject({ kind: 'image', source: 'image' })
  })

  it('captures a Preview copy (image only) as an image', async () => {
    const { readClipboard } = await loadFormats('darwin')
    mocks.image = { width: 100, height: 50 }
    mocks.nativeTypes = ['public.tiff']

    expect(await readClipboard()).toMatchObject({ kind: 'image', width: 100, height: 50 })
  })

  it('captures Finder files as files and ignores the icon and the name text', async () => {
    const { readClipboard } = await loadFormats('darwin')
    mocks.existing = new Set(['/Users/a/One.pdf', '/Users/a/Two.pdf'])
    mocks.formats = { NSFilenamesPboardType: plist('/Users/a/One.pdf', '/Users/a/Two.pdf') }
    mocks.text = 'One.pdf\rTwo.pdf'
    mocks.image = { width: 512, height: 512 }

    expect(await readClipboard()).toEqual({ kind: 'files', paths: ['/Users/a/One.pdf', '/Users/a/Two.pdf'] })
    expect(mocks.readImage).not.toHaveBeenCalled()
  })

  it('does not record the Finder icon as a screenshot while the file list is not readable', async () => {
    const { readClipboard } = await loadFormats('darwin')
    mocks.nativeTypes = ['public.file-url', 'public.tiff', 'public.utf8-plain-text']
    mocks.text = 'One.pdf'
    mocks.image = { width: 512, height: 512 }

    expect(await readClipboard()).toBeNull()
    expect(mocks.readImage).not.toHaveBeenCalled()
  })

  it('does not record the Finder icon when the copied file no longer exists', async () => {
    const { readClipboard } = await loadFormats('darwin')
    mocks.formats = { 'public.file-url': 'file:///Users/a/Gone.pdf' }
    mocks.text = 'Gone.pdf'
    mocks.image = { width: 512, height: 512 }

    expect(await readClipboard()).toBeNull()
  })

  it('captures editor text as text', async () => {
    const { readClipboard } = await loadFormats('darwin')
    mocks.text = 'const a = 1'
    mocks.html = '<meta charset=\'utf-8\'><div style="color: #d4d4d4"><span>const a = 1</span></div>'

    expect(await readClipboard()).toMatchObject({ kind: 'text', text: 'const a = 1' })
  })

  it('captures Numbers/Excel cells (tabbed text + preview image) as text without decoding the image', async () => {
    const { readClipboard } = await loadFormats('darwin')
    mocks.text = 'Name\tQty\nApple\t3\n'
    mocks.image = { width: 300, height: 60 }

    expect(await readClipboard()).toMatchObject({ kind: 'text', text: 'Name\tQty\nApple\t3' })
    expect(mocks.readImage).not.toHaveBeenCalled()
  })

  it('captures a single spreadsheet cell or a short styled phrase with a preview image as text', async () => {
    const { readClipboard } = await loadFormats('darwin')
    mocks.image = { width: 120, height: 24 }
    mocks.text = '42'

    expect(await readClipboard()).toMatchObject({ kind: 'text', text: '42' })

    mocks.text = 'Quarterly report'
    mocks.html = '<span style="font-weight: bold">Quarterly report</span>'
    expect(await readClipboard()).toMatchObject({ kind: 'text', text: 'Quarterly report' })
  })

  it('keeps clipboardSignature in step with the captured kind', async () => {
    const { clipboardSignature } = await loadFormats('darwin')
    mocks.image = { width: 120, height: 24 }
    mocks.text = '42'
    expect(clipboardSignature()).toBe('seq:1:text:42')

    mocks.text = ''
    expect(clipboardSignature()).toMatch(/^seq:1:image:120x24:/)
  })
})

describe('isScreenshotOrImageIntent', () => {
  it('on darwin only treats image + text as an image for browser image copies', async () => {
    const { isScreenshotOrImageIntent } = await loadFormats('darwin')
    expect(isScreenshotOrImageIntent(false, '', '')).toBe(false)
    expect(isScreenshotOrImageIntent(true, '', '')).toBe(true)
    expect(isScreenshotOrImageIntent(true, 'https://example.com/a.png', '')).toBe(true)
    expect(isScreenshotOrImageIntent(true, 'A cat', '<img src="https://example.com/a.png">')).toBe(true)
    expect(isScreenshotOrImageIntent(true, 'A cat', '<meta charset="utf-8"><img src="a.png" alt="A cat">')).toBe(true)
    expect(isScreenshotOrImageIntent(true, 'Untitled - Notepad', '')).toBe(false)
    expect(isScreenshotOrImageIntent(true, 'A cat', '<p>A cat <img src="a.png"></p>')).toBe(false)
  })

  it('on win32 keeps the Snipping Tool window-title heuristic', async () => {
    const { isScreenshotOrImageIntent } = await loadFormats('win32')
    expect(isScreenshotOrImageIntent(true, 'Untitled - Notepad', '')).toBe(true)
    expect(isScreenshotOrImageIntent(true, 'a\tb', '')).toBe(false)
    expect(isScreenshotOrImageIntent(true, 'x', '<table><tr><td>x</td></tr></table>')).toBe(false)
    expect(isScreenshotOrImageIntent(true, 'A cat', '<meta charset="utf-8"><img src="a.png" alt="A cat">')).toBe(true)
  })
})

describe('clipboardAdvertisesFileList', () => {
  it('on darwin recognises a file copy from the native pasteboard types', async () => {
    const { clipboardAdvertisesFileList } = await loadFormats('darwin')
    expect(clipboardAdvertisesFileList()).toBe(false)
    mocks.nativeTypes = ['public.tiff', 'public.utf8-plain-text']
    expect(clipboardAdvertisesFileList()).toBe(false)
    mocks.nativeTypes = ['public.png', 'com.apple.pasteboard.promised-file-url']
    expect(clipboardAdvertisesFileList()).toBe(false)
    mocks.nativeTypes = ['public.file-url', 'public.tiff']
    expect(clipboardAdvertisesFileList()).toBe(true)
    mocks.nativeTypes = ['NSFilenamesPboardType']
    expect(clipboardAdvertisesFileList()).toBe(true)
  })

  it('on win32 never consults the mac pasteboard', async () => {
    const { clipboardAdvertisesFileList } = await loadFormats('win32')
    mocks.nativeTypes = ['public.file-url']
    expect(clipboardAdvertisesFileList()).toBe(false)
  })
})

describe('clipboardSequenceAvailable', () => {
  it('is true on darwin when changeCount can be read', async () => {
    const { clipboardSequenceAvailable, getClipboardSequenceNumber } = await loadFormats('darwin')
    mocks.changeCount = 41
    expect(getClipboardSequenceNumber()).toBe(42)
    expect(clipboardSequenceAvailable()).toBe(true)
  })

  it('is false on darwin when the ObjC bridge did not load', async () => {
    mocks.bridgeBroken = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { clipboardSequenceAvailable } = await loadFormats('darwin')
    expect(clipboardSequenceAvailable()).toBe(false)
    vi.restoreAllMocks()
  })

  it('is false on darwin when the pasteboard object is missing', async () => {
    const { clipboardSequenceAvailable } = await loadFormats('darwin')
    mocks.changeCount = null
    expect(clipboardSequenceAvailable()).toBe(false)
  })
})

describe('own "image + file-url" write on darwin', () => {
  const staged = '/mock/userData/temp/Screenshot 2026-01-01 10.00.00.png'
  const image: ItemData = { kind: 'image', imageId: 'a', width: 800, height: 600, bytes: 1 }

  async function loadWatcher(): Promise<typeof import('../electron/clipboard/ClipboardWatcher')> {
    setPlatform('darwin')
    vi.resetModules()
    return import('../electron/clipboard/ClipboardWatcher')
  }

  function writeOwnImageWithFileUrl(): void {
    mocks.image = { width: 800, height: 600 }
    mocks.formats = { 'public.file-url': `file://${encodeURI(staged)}` }
    mocks.existing = new Set([staged])
    mocks.nativeTypes = ['public.tiff', 'public.file-url']
    mocks.changeCount = (mocks.changeCount ?? 0) + 2
  }

  it('is not captured again when the write happens while the watcher is paused', async () => {
    vi.useFakeTimers()
    const { ClipboardWatcher } = await loadWatcher()
    const onNew = vi.fn()
    const watcher = new ClipboardWatcher(250, 220)
    watcher.start(onNew)

    watcher.setPaused(true)
    writeOwnImageWithFileUrl()
    await vi.advanceTimersByTimeAsync(300)
    watcher.resyncSignature()
    watcher.setPaused(false)
    await vi.advanceTimersByTimeAsync(2000)

    expect(onNew).not.toHaveBeenCalled()
    watcher.stop()
  })

  it('is not captured again without the native changeCount either', async () => {
    vi.useFakeTimers()
    mocks.bridgeBroken = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ClipboardWatcher } = await loadWatcher()
    const onNew = vi.fn()
    const watcher = new ClipboardWatcher(600, 220)
    watcher.start(onNew)

    watcher.setPaused(true)
    writeOwnImageWithFileUrl()
    watcher.setPaused(false)
    await vi.advanceTimersByTimeAsync(3000)

    expect(onNew).not.toHaveBeenCalled()
    watcher.stop()
    vi.restoreAllMocks()
  })

  it('still captures the next real copy after the own write', async () => {
    vi.useFakeTimers()
    const { ClipboardWatcher } = await loadWatcher()
    const onNew = vi.fn()
    const watcher = new ClipboardWatcher(250, 220)
    watcher.start(onNew)
    watcher.setPaused(true)
    writeOwnImageWithFileUrl()
    watcher.setPaused(false)

    mocks.image = null
    mocks.formats = {}
    mocks.nativeTypes = ['public.utf8-plain-text']
    mocks.text = 'next copy'
    mocks.changeCount = (mocks.changeCount ?? 0) + 1
    await vi.advanceTimersByTimeAsync(1000)

    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onNew.mock.calls[0][0]).toMatchObject({ kind: 'text', text: 'next copy' })
    watcher.stop()
  })

  it('reads as the staged file, so the signature alone does not match the image item it came from', async () => {
    const { clipboardSignature, signatureMatchesItem } = await loadFormats('darwin')
    writeOwnImageWithFileUrl()

    const sig = clipboardSignature()
    expect(sig).toBe(`seq:3:files:${staged}`)
    expect(signatureMatchesItem(sig, image)).toBe(false)
  })
})
