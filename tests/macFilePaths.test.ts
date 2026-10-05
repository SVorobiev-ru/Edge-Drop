import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  nativeItems: null as Array<Record<string, string>> | null,
  fileRefs: {} as Record<string, string>,
  bridgeBroken: false,
  bridgeThrows: false,
  nativeCalls: [] as string[]
}))

vi.mock('electron', () => ({
  clipboard: {
    read: (...args: unknown[]) => mocks.read(...args)
  }
}))

type NSStr = { utf8: string }
type NSUrl = { url: string }

function nsUrlPath(url: string): NSStr | null {
  if (url in mocks.fileRefs) return { utf8: mocks.fileRefs[url] }
  try {
    return { utf8: decodeURIComponent(new URL(url).pathname) }
  } catch {
    return null
  }
}

vi.mock('koffi', () => ({
  default: {
    load: () => {
      if (mocks.bridgeBroken) throw new Error('no objc runtime')
      return {
        func: (decl: string, ret?: string, args?: string[]) => {
          if (decl.includes('objc_getClass')) return (name: string) => name
          if (decl.includes('sel_registerName')) return (name: string) => name
          if (ret === 'long') return (obj: unknown[], sel: string) => (sel === 'count' ? obj.length : 7)
          if (ret === 'str') return (obj: NSStr) => obj.utf8
          if (args && args[2] === 'ulong') return (arr: unknown[], _sel: string, i: number) => arr[i]
          if (args && args[2] === 'str') return (_cls: string, _sel: string, value: string): NSStr => ({ utf8: value })
          if (args && args[2] === 'void *') {
            return (obj: Record<string, string>, sel: string, arg: NSStr): NSStr | NSUrl | null => {
              mocks.nativeCalls.push(sel)
              if (sel === 'stringForType:') return arg.utf8 in obj ? { utf8: obj[arg.utf8] } : null
              if (sel === 'URLWithString:') return { url: arg.utf8 }
              return null
            }
          }
          return (obj: NSUrl, sel: string) => {
            if (sel === 'generalPasteboard') return 'pb'
            if (sel === 'pasteboardItems') {
              if (mocks.bridgeThrows) throw new Error('objc call failed')
              return mocks.nativeItems
            }
            if (sel === 'path') return nsUrlPath(obj.url)
            return null
          }
        }
      }
    }
  }
}))

import { macFilePaths } from '../electron/clipboard/formats'

type Formats = typeof import('../electron/clipboard/formats')

function plist(...paths: string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n<array>\n' +
    paths.map((p) => `\t<string>${p}</string>\n`).join('') +
    '</array>\n</plist>\n'
  )
}

function pasteboard(formats: Record<string, string>): void {
  mocks.read.mockImplementation((format: string) => formats[format] ?? '')
}

function fileItems(...urls: string[]): void {
  mocks.nativeItems = urls.map((url) => ({ 'public.file-url': url }))
}

async function loadFormats(platform: string): Promise<Formats> {
  setPlatform(platform)
  vi.resetModules()
  return import('../electron/clipboard/formats')
}

describe('macFilePaths', () => {
  beforeEach(() => {
    setPlatform('darwin')
    mocks.read.mockReset()
    mocks.read.mockReturnValue('')
    mocks.nativeItems = null
    mocks.fileRefs = {}
    mocks.bridgeBroken = false
    mocks.bridgeThrows = false
    mocks.nativeCalls = []
  })

  afterEach(() => {
    restorePlatform()
  })

  afterAll(() => {
    restorePlatform()
  })

  describe('NSFilenamesPboardType plist', () => {
    it('returns a single path', () => {
      pasteboard({ NSFilenamesPboardType: plist('/Users/a/file.txt') })
      expect(macFilePaths()).toEqual(['/Users/a/file.txt'])
    })

    it('returns several paths in pasteboard order', () => {
      pasteboard({ NSFilenamesPboardType: plist('/Users/a/one.txt', '/Users/a/two.png', '/Volumes/Disk/three') })
      expect(macFilePaths()).toEqual(['/Users/a/one.txt', '/Users/a/two.png', '/Volumes/Disk/three'])
    })

    it('decodes &amp; in a file name', () => {
      pasteboard({ NSFilenamesPboardType: plist('/Users/a/Tom &amp; Jerry.txt') })
      expect(macFilePaths()).toEqual(['/Users/a/Tom & Jerry.txt'])
    })

    it('decodes &gt;, &quot; and &apos; in a file name', () => {
      pasteboard({ NSFilenamesPboardType: plist('/Users/a/a &gt; b.txt', '/Users/a/&quot;q&quot;.txt', '/Users/a/it&apos;s.txt') })
      expect(macFilePaths()).toEqual(['/Users/a/a > b.txt', '/Users/a/"q".txt', "/Users/a/it's.txt"])
    })

    it('decodes &amp; last so a literal &lt; in a file name survives', () => {
      pasteboard({ NSFilenamesPboardType: plist('/Users/a/a &amp;lt; b.txt', '/Users/a/&amp;amp;.txt', '/Users/a/x &lt; y &amp;gt; z.txt') })
      expect(macFilePaths()).toEqual(['/Users/a/a &lt; b.txt', '/Users/a/&amp;.txt', '/Users/a/x < y &gt; z.txt'])
    })

    it('keeps spaces and non-ASCII characters untouched', () => {
      pasteboard({ NSFilenamesPboardType: plist('/Users/a/My File.txt', '/Users/a/Файл.txt') })
      expect(macFilePaths()).toEqual(['/Users/a/My File.txt', '/Users/a/Файл.txt'])
    })

    it('prefers the plist over public.file-url when both are present', () => {
      pasteboard({
        NSFilenamesPboardType: plist('/Users/a/one.txt', '/Users/a/two.txt'),
        'public.file-url': 'file:///Users/a/one.txt'
      })
      expect(macFilePaths()).toEqual(['/Users/a/one.txt', '/Users/a/two.txt'])
    })
  })

  describe('public.file-url fallback', () => {
    it('falls back to the file url when the plist is empty', () => {
      pasteboard({ NSFilenamesPboardType: '', 'public.file-url': 'file:///Users/a/My%20File.txt' })
      expect(macFilePaths()).toEqual(['/Users/a/My File.txt'])
    })

    it('falls back to the file url when the plist has no <string> entries', () => {
      pasteboard({ NSFilenamesPboardType: plist(), 'public.file-url': 'file:///Users/a/x.txt' })
      expect(macFilePaths()).toEqual(['/Users/a/x.txt'])
    })

    it('strips the localhost host from file://localhost urls', () => {
      pasteboard({ 'public.file-url': 'file://localhost/Users/a/My%20File.txt' })
      expect(macFilePaths()).toEqual(['/Users/a/My File.txt'])
    })

    it('decodes percent-encoded UTF-8 sequences', () => {
      pasteboard({ 'public.file-url': 'file:///Users/a/%D0%A4%D0%B0%D0%B9%D0%BB.txt' })
      expect(macFilePaths()).toEqual(['/Users/a/Файл.txt'])
    })

    it('ignores a public.file-url that is not a file:// url', () => {
      pasteboard({ 'public.file-url': 'https://example.com/a.txt' })
      expect(macFilePaths()).toBeNull()
    })

    it('returns null for a malformed percent-encoding instead of throwing', () => {
      pasteboard({ 'public.file-url': 'file:///Users/a/100%.txt' })
      expect(macFilePaths()).toBeNull()
    })
  })

  it('returns null when neither format is on the pasteboard', () => {
    expect(macFilePaths()).toBeNull()
    expect(mocks.read).toHaveBeenCalledWith('NSFilenamesPboardType')
    expect(mocks.read).toHaveBeenCalledWith('public.file-url')
  })

  it('returns null and never touches the clipboard on non-darwin platforms', () => {
    pasteboard({ NSFilenamesPboardType: plist('/Users/a/file.txt') })
    for (const platform of ['win32', 'linux']) {
      setPlatform(platform)
      expect(macFilePaths()).toBeNull()
    }
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('returns null when clipboard.read throws', () => {
    mocks.read.mockImplementation(() => {
      throw new Error('pasteboard unavailable')
    })
    expect(macFilePaths()).toBeNull()
  })

  it('returns null when only the second read throws', () => {
    mocks.read.mockImplementation((format: string) => {
      if (format === 'public.file-url') throw new Error('boom')
      return ''
    })
    expect(macFilePaths()).toBeNull()
  })

  describe('native pasteboard items', () => {
    it('returns every item path in pasteboard order', async () => {
      const { macFilePaths, macNativeFilePaths } = await loadFormats('darwin')
      fileItems('file:///Users/a/one.txt', 'file:///Users/a/two.png', 'file:///Volumes/Disk/three')
      pasteboard({ NSFilenamesPboardType: plist('/Users/a/one.txt') })
      const expected = ['/Users/a/one.txt', '/Users/a/two.png', '/Volumes/Disk/three']
      expect(macNativeFilePaths()).toEqual(expected)
      expect(macFilePaths()).toEqual(expected)
      expect(mocks.read).not.toHaveBeenCalled()
    })

    it('returns the same list on repeated calls', async () => {
      const { macFilePaths } = await loadFormats('darwin')
      fileItems('file:///Users/a/one.txt', 'file:///Users/a/two.png', 'file:///Users/a/three.pdf')
      const first = macFilePaths()
      for (let i = 0; i < 5; i++) expect(macFilePaths()).toEqual(first)
      expect(first).toHaveLength(3)
    })

    it('resolves Finder file-reference urls through NSURL', async () => {
      const { macFilePaths } = await loadFormats('darwin')
      mocks.fileRefs = {
        'file:///.file/id=6571367.8720802': '/Users/a/Documents/report.pdf',
        'file:///.file/id=6571367.8720803': '/Users/a/Documents/Отчёт 2.pdf'
      }
      fileItems('file:///.file/id=6571367.8720802', 'file:///.file/id=6571367.8720803')
      expect(macFilePaths()).toEqual(['/Users/a/Documents/report.pdf', '/Users/a/Documents/Отчёт 2.pdf'])
      expect(mocks.nativeCalls.filter((sel) => sel === 'URLWithString:')).toHaveLength(2)
    })

    it('keeps spaces, &, <, ?, Cyrillic and apostrophes in a path', async () => {
      const { macFilePaths } = await loadFormats('darwin')
      fileItems(
        'file:///Users/a/My%20File.txt',
        'file:///Users/a/Tom%20&%20Jerry.txt',
        'file:///Users/a/a%20%3C%20b.txt',
        'file:///Users/a/what%3F.txt',
        'file:///Users/a/%D0%A4%D0%B0%D0%B9%D0%BB.txt',
        "file:///Users/a/it's.txt"
      )
      expect(macFilePaths()).toEqual([
        '/Users/a/My File.txt',
        '/Users/a/Tom & Jerry.txt',
        '/Users/a/a < b.txt',
        '/Users/a/what?.txt',
        '/Users/a/Файл.txt',
        "/Users/a/it's.txt"
      ])
    })

    it('skips items without a file url and items that are not file urls', async () => {
      const { macFilePaths } = await loadFormats('darwin')
      mocks.nativeItems = [
        { 'public.file-url': 'file:///Users/a/one.txt' },
        { 'public.utf8-plain-text': 'two.txt' },
        { 'public.file-url': 'https://example.com/three.txt' },
        { 'public.file-url': 'file:///Users/a/four.txt' }
      ]
      expect(macFilePaths()).toEqual(['/Users/a/one.txt', '/Users/a/four.txt'])
    })

    it('falls back to the plist when the bridge returns no paths', async () => {
      const { macFilePaths, macNativeFilePaths } = await loadFormats('darwin')
      mocks.nativeItems = []
      pasteboard({ NSFilenamesPboardType: plist('/Users/a/one.txt', '/Users/a/two.txt') })
      expect(macNativeFilePaths()).toEqual([])
      expect(macFilePaths()).toEqual(['/Users/a/one.txt', '/Users/a/two.txt'])
    })

    it('falls back to the single file url when the bridge returns no paths and the plist is empty', async () => {
      const { macFilePaths } = await loadFormats('darwin')
      mocks.nativeItems = [{ 'public.utf8-plain-text': 'text' }]
      pasteboard({ 'public.file-url': 'file:///Users/a/My%20File.txt' })
      expect(macFilePaths()).toEqual(['/Users/a/My File.txt'])
    })

    it('falls back to the plist when the objc runtime cannot be loaded', async () => {
      mocks.bridgeBroken = true
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { macFilePaths, macNativeFilePaths } = await loadFormats('darwin')
      fileItems('file:///Users/a/native.txt')
      pasteboard({ NSFilenamesPboardType: plist('/Users/a/one.txt') })
      expect(macNativeFilePaths()).toBeNull()
      expect(macFilePaths()).toEqual(['/Users/a/one.txt'])
      vi.restoreAllMocks()
    })

    it('falls back to the plist when a bridge call throws', async () => {
      const { macFilePaths, macNativeFilePaths } = await loadFormats('darwin')
      mocks.bridgeThrows = true
      pasteboard({ NSFilenamesPboardType: plist('/Users/a/one.txt') })
      expect(macNativeFilePaths()).toBeNull()
      expect(macFilePaths()).toEqual(['/Users/a/one.txt'])
    })

    it('returns null without touching the bridge on non-darwin platforms', async () => {
      for (const platform of ['win32', 'linux']) {
        const { macFilePaths, macNativeFilePaths } = await loadFormats(platform)
        fileItems('file:///Users/a/one.txt')
        expect(macNativeFilePaths()).toBeNull()
        expect(macFilePaths()).toBeNull()
      }
      expect(mocks.nativeCalls).toEqual([])
      expect(mocks.read).not.toHaveBeenCalled()
    })
  })
})
