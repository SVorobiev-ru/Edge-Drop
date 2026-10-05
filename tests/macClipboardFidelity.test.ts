import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  text: '',
  html: '',
  rtf: '',
  image: null as null | { width: number; height: number },
  buffers: {} as Record<string, Buffer>,
  formats: [] as string[],
  has: [] as string[],
  nativeTypes: null as string[] | null,
  bridgeBroken: false,
  readText: vi.fn(),
  readHTML: vi.fn(),
  readRTF: vi.fn(),
  readImage: vi.fn(),
  readBuffer: vi.fn(),
  write: vi.fn(),
  clear: vi.fn()
}))

vi.mock('electron', () => ({
  clipboard: {
    readText: mocks.readText,
    readHTML: mocks.readHTML,
    readRTF: mocks.readRTF,
    readImage: mocks.readImage,
    readBuffer: mocks.readBuffer,
    read: () => '',
    has: (type: string) => mocks.has.includes(type),
    availableFormats: () => mocks.formats,
    write: mocks.write,
    clear: mocks.clear
  },
  app: { isPackaged: false, getAppPath: () => '/mock/app', getPath: () => '/mock/userData' }
}))

vi.mock('koffi', async () => ({ default: (await import('./helpers/koffiMock')).pasteboardTypesKoffi(mocks) }))

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('original-png-with-dpi')])
const TIFF = Buffer.concat([Buffer.from([0x4d, 0x4d, 0x00, 0x2a]), Buffer.from('original-tiff')])

async function loadFormats(platform = 'darwin'): Promise<typeof import('../electron/clipboard/formats')> {
  setPlatform(platform)
  vi.resetModules()
  return import('../electron/clipboard/formats')
}

beforeEach(() => {
  mocks.text = ''
  mocks.html = ''
  mocks.rtf = ''
  mocks.image = null
  mocks.buffers = {}
  mocks.formats = []
  mocks.has = []
  mocks.nativeTypes = null
  mocks.bridgeBroken = false
  mocks.readText.mockReset().mockImplementation(() => mocks.text)
  mocks.readHTML.mockReset().mockImplementation(() => mocks.html)
  mocks.readRTF.mockReset().mockImplementation(() => mocks.rtf)
  mocks.readImage.mockReset().mockImplementation(() => ({
    isEmpty: () => !mocks.image,
    getSize: () => mocks.image ?? { width: 0, height: 0 },
    toBitmap: () => Buffer.from([1, 2, 3, 4]),
    toPNG: () => Buffer.from('re-encoded')
  }))
  mocks.readBuffer.mockReset().mockImplementation((type: string) => mocks.buffers[type] ?? Buffer.alloc(0))
  mocks.write.mockReset()
  mocks.clear.mockReset()
})

afterEach(() => {
  restorePlatform()
})

afterAll(() => {
  restorePlatform()
})

describe('Handoff detection', () => {
  it('reads the remote marker from the native type list without reading data', async () => {
    const { isRemoteClipboard } = await loadFormats()
    mocks.nativeTypes = ['public.utf8-plain-text', 'com.apple.is-remote-clipboard']

    expect(isRemoteClipboard()).toBe(true)
    expect(mocks.readText).not.toHaveBeenCalled()
    expect(mocks.readImage).not.toHaveBeenCalled()
    expect(mocks.readBuffer).not.toHaveBeenCalled()

    mocks.nativeTypes = ['public.utf8-plain-text']
    expect(isRemoteClipboard()).toBe(false)
  })

  it('falls back to the Electron format list when the native bridge is missing', async () => {
    mocks.bridgeBroken = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { isRemoteClipboard } = await loadFormats()

    expect(isRemoteClipboard()).toBe(false)
    mocks.formats = ['text/plain', 'com.apple.is-remote-clipboard']
    expect(isRemoteClipboard()).toBe(true)
    mocks.formats = ['text/plain']
    mocks.has = ['com.apple.is-remote-clipboard']
    expect(isRemoteClipboard()).toBe(true)
    expect(mocks.readText).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('is always false off darwin', async () => {
    const { isRemoteClipboard } = await loadFormats('win32')
    mocks.formats = ['com.apple.is-remote-clipboard']
    mocks.has = ['com.apple.is-remote-clipboard']

    expect(isRemoteClipboard()).toBe(false)
  })
})

describe('rich text capture on darwin', () => {
  it('keeps html above the inline limit', async () => {
    const { readClipboard, MAX_ITEM_HTML_CHARS } = await loadFormats()
    mocks.text = 'A long article'
    mocks.html = `<p>${'a'.repeat(MAX_ITEM_HTML_CHARS + 100)}</p>`
    mocks.nativeTypes = ['public.utf8-plain-text', 'public.html']

    const data = await readClipboard()
    expect(data).toMatchObject({ kind: 'text', text: 'A long article' })
    expect(data?.kind === 'text' && data.html).toBe(mocks.html)
  })

  it('still drops html above the inline limit on win32', async () => {
    const { readClipboard, MAX_ITEM_HTML_CHARS } = await loadFormats('win32')
    mocks.text = 'A long article'
    mocks.html = `<p>${'a'.repeat(MAX_ITEM_HTML_CHARS + 100)}</p>`

    const data = await readClipboard()
    expect(data?.kind === 'text' && data.html).toBeUndefined()
    expect(mocks.readRTF).not.toHaveBeenCalled()
  })

  it('captures rtf next to the text and hands it over once', async () => {
    const { readClipboard, takeCapturedRtf } = await loadFormats()
    mocks.text = 'Styled'
    mocks.html = '<b>Styled</b>'
    mocks.rtf = '{\\rtf1\\ansi Styled}'
    mocks.nativeTypes = ['public.utf8-plain-text', 'public.html', 'public.rtf']

    const data = await readClipboard()
    expect(data).toEqual({ kind: 'text', text: 'Styled', html: '<b>Styled</b>', isUrl: false, isColor: false })
    expect(takeCapturedRtf(data!)).toBe('{\\rtf1\\ansi Styled}')
    expect(takeCapturedRtf(data!)).toBeUndefined()
  })

  it('does not ask for rtf when the pasteboard does not offer it', async () => {
    const { readClipboard, takeCapturedRtf } = await loadFormats()
    mocks.text = 'Plain'
    mocks.rtf = '{\\rtf1 stale}'
    mocks.nativeTypes = ['public.utf8-plain-text']

    const data = await readClipboard()
    expect(mocks.readRTF).not.toHaveBeenCalled()
    expect(takeCapturedRtf(data!)).toBeUndefined()
  })
})

describe('long text capture', () => {
  it('keeps every character of a 600 000 character copy', async () => {
    const { readClipboard } = await loadFormats()
    mocks.text = 'a'.repeat(599_999) + 'z'
    mocks.nativeTypes = ['public.utf8-plain-text']

    const data = await readClipboard()
    expect(data).toMatchObject({ kind: 'text' })
    expect((data as { text: string }).text).toHaveLength(600_000)
    expect((data as { text: string }).text.endsWith('az')).toBe(true)
  })

  it('drops only the trailing line break of a copied file', async () => {
    const { readClipboard } = await loadFormats()
    mocks.text = 'a'.repeat(599_999) + '\n'
    mocks.nativeTypes = ['public.utf8-plain-text']

    const data = await readClipboard()
    expect((data as { text: string }).text).toHaveLength(599_999)
  })
})

describe('original image bytes on darwin', () => {
  it('keeps the png the pasteboard offers', async () => {
    const { readClipboard, takeCapturedOriginalImage, takeCapturedImage } = await loadFormats()
    mocks.image = { width: 1440, height: 900 }
    mocks.buffers = { 'public.png': PNG, 'public.tiff': TIFF }
    mocks.nativeTypes = ['public.png', 'public.tiff']

    const data = await readClipboard()
    expect(data).toMatchObject({ kind: 'image', width: 1440, height: 900, bytes: 0 })
    expect(takeCapturedImage(data!)).toBeDefined()
    expect(takeCapturedOriginalImage(data!)).toEqual({ type: 'public.png', bytes: PNG })
    expect(takeCapturedOriginalImage(data!)).toBeUndefined()
  })

  it('keeps the tiff when there is no png', async () => {
    const { readClipboard, takeCapturedOriginalImage } = await loadFormats()
    mocks.image = { width: 800, height: 600 }
    mocks.buffers = { 'public.tiff': TIFF }
    mocks.nativeTypes = ['public.tiff']

    const data = await readClipboard()
    expect(takeCapturedOriginalImage(data!)).toEqual({ type: 'public.tiff', bytes: TIFF })
    expect(mocks.readBuffer).not.toHaveBeenCalledWith('public.png')
  })

  it('ignores bytes that are not what the type promises', async () => {
    const { readClipboard, takeCapturedOriginalImage } = await loadFormats()
    mocks.image = { width: 800, height: 600 }
    mocks.buffers = { 'public.png': Buffer.from('definitely not a png'), 'public.tiff': Buffer.from('nor a tiff file') }
    mocks.nativeTypes = ['public.png', 'public.tiff']

    const data = await readClipboard()
    expect(data?.kind).toBe('image')
    expect(takeCapturedOriginalImage(data!)).toBeUndefined()
  })

  it('does not read original bytes off darwin', async () => {
    const { readClipboard, takeCapturedOriginalImage } = await loadFormats('win32')
    mocks.image = { width: 800, height: 600 }
    mocks.buffers = { 'public.png': PNG }

    const data = await readClipboard()
    expect(data?.kind).toBe('image')
    expect(takeCapturedOriginalImage(data!)).toBeUndefined()
    expect(mocks.readBuffer).not.toHaveBeenCalledWith('public.png')
  })
})

describe('writeRichTextToClipboard', () => {
  it('writes text, html and rtf in one clipboard write', async () => {
    const { writeRichTextToClipboard } = await loadFormats()

    writeRichTextToClipboard({ text: 'Styled', html: '<b>Styled</b>', rtf: '{\\rtf1 Styled}' })

    expect(mocks.clear).toHaveBeenCalledTimes(1)
    expect(mocks.write).toHaveBeenCalledWith({ text: 'Styled', html: '<b>Styled</b>', rtf: '{\\rtf1 Styled}' })
  })

  it('writes html above the inline limit back on darwin', async () => {
    const { writeRichTextToClipboard, MAX_ITEM_HTML_CHARS } = await loadFormats()
    const html = `<p>${'a'.repeat(MAX_ITEM_HTML_CHARS + 100)}</p>`

    writeRichTextToClipboard({ text: 'Long', html })

    expect(mocks.write).toHaveBeenCalledWith({ text: 'Long', html })
  })

  it('writes plain text alone when nothing else is stored', async () => {
    const { writeRichTextToClipboard } = await loadFormats()

    writeRichTextToClipboard({ text: 'Plain' })

    expect(mocks.write).toHaveBeenCalledWith({ text: 'Plain' })
  })
})
