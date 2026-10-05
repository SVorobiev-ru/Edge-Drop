import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

vi.mock('../src/i18n', () => ({
  t: (key: string) => key,
  getResolvedLanguage: () => 'en'
}))

type FormatModule = typeof import('../src/lib/format')
type FileTypeModule = typeof import('../src/lib/fileType')

async function load(platform: string): Promise<{ format: FormatModule; fileType: FileTypeModule }> {
  setPlatform(platform)
  vi.resetModules()
  const format = await import('../src/lib/format')
  const fileType = await import('../src/lib/fileType')
  return { format, fileType }
}

afterEach(() => {
  restorePlatform()
})

afterAll(() => {
  restorePlatform()
})

describe('toUrlPath', () => {
  it.each([
    ['C:\\Pictures\\image one.png', 'C:/Pictures/image one.png'],
    ['d:\\a\\b.gif', 'd:/a/b.gif'],
    ['C:/Pictures\\mixed.png', 'C:/Pictures/mixed.png'],
    ['\\\\server\\share\\pic.png', '//server/share/pic.png'],
    ['\\\\?\\C:\\long\\pic.png', '//?/C:/long/pic.png']
  ])('turns the Windows path %s into %s', async (input, expected) => {
    const { format } = await load('win32')
    expect(format.toUrlPath(input)).toBe(expected)
  })

  it.each([
    '/Users/a/Pictures/back\\slash.png',
    '/Users/a/we\\ird dir/photo.heic',
    '/Volumes/C:\\not a drive/x.png'
  ])('leaves the POSIX path %s untouched', async (input) => {
    const { format } = await load('darwin')
    expect(format.toUrlPath(input)).toBe(input)
  })

  it('decides by the shape of the path, not by the platform', async () => {
    const win = (await load('win32')).format
    expect(win.toUrlPath('/Users/a/back\\slash.png')).toBe('/Users/a/back\\slash.png')
    const mac = (await load('darwin')).format
    expect(mac.toUrlPath('C:\\Pictures\\a.png')).toBe('C:/Pictures/a.png')
  })
})

describe('fileStreamUrl', () => {
  it('keeps the Windows URL exactly as before', async () => {
    const { format } = await load('win32')
    expect(format.fileStreamUrl('C:\\Pictures\\image one.png')).toBe('edgelocal://file/C%3A%2FPictures%2Fimage%20one.png')
  })

  it('round-trips a macOS name with a backslash', async () => {
    const { format } = await load('darwin')
    const path = '/Users/a/Pictures/back\\slash.png'
    const url = format.fileStreamUrl(path)
    expect(url).toBe('edgelocal://file/%2FUsers%2Fa%2FPictures%2Fback%5Cslash.png')
    expect(decodeURIComponent(url.slice('edgelocal://file/'.length))).toBe(path)
  })
})

describe('HEIC as an image', () => {
  it('counts HEIC and HEIF as images on macOS', async () => {
    const { format, fileType } = await load('darwin')
    expect(format.isImagePath('/Users/a/IMG_1.HEIC')).toBe(true)
    expect(format.isImagePath('/Users/a/IMG_1.heif')).toBe(true)
    expect(fileType.getFileKind('/Users/a/IMG_1.HEIC').kind).toBe('image')
    expect(fileType.getFileKindByExt('heif').kind).toBe('image')
    expect(fileType.getFileKind('/Users/a/album.heic', true).kind).toBe('folder')
  })

  it('keeps HEIC a generic file on Windows', async () => {
    const { format, fileType } = await load('win32')
    expect(format.isImagePath('C:\\Photos\\IMG_1.heic')).toBe(false)
    expect(fileType.getFileKind('C:\\Photos\\IMG_1.heic').kind).toBe('file')
    expect(fileType.getFileKindByExt('HEIF').kind).toBe('file')
  })

  it('leaves the other image formats alone on both platforms', async () => {
    for (const platform of ['darwin', 'win32']) {
      const { format, fileType } = await load(platform)
      expect(format.isImagePath('a/b/shot.PNG')).toBe(true)
      expect(format.isImagePath('a/b/notes.txt')).toBe(false)
      expect(fileType.getFileKind('a/b/shot.jpeg').kind).toBe('image')
      expect(fileType.getFileKind('a/b/doc.pdf').kind).toBe('pdf')
    }
  })
})
