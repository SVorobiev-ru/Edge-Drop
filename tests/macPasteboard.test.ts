import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

type NSStr = { str: string }
type NSUrl = { url: string; types?: NSStr[] }
type NSData = { bytes: Buffer }
type Board = { name: string; items: NSUrl[]; types: NSStr[]; strings: Record<string, string>; data: Record<string, Buffer>; changeCount: number }

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  bridgeBroken: false,
  missingClass: '',
  calls: [] as string[],
  boards: new Map<string, { name: string; items: Array<{ url: string; types?: Array<{ str: string }> }>; types: Array<{ str: string }>; strings: Record<string, string>; data: Record<string, Buffer>; changeCount: number }>(),
  writeObjectsOk: true,
  keepItems: null as number | null,
  setStringOk: true,
  setDataOk: true,
  addTypesWorks: true,
  addTypesResult: null as number | null,
  dropItemOnSetData: false,
  throwOn: ''
}))

function board(name: string): Board {
  let found = mocks.boards.get(name)
  if (!found) {
    found = { name, items: [], types: [], strings: {}, data: {}, changeCount: 1 }
    mocks.boards.set(name, found)
  }
  return found
}

function itemTypes(item: NSUrl): NSStr[] {
  if (!item.types) item.types = [{ str: 'public.file-url' }]
  return item.types
}

function send(obj: any, sel: string, a?: any, b?: any): unknown {
  mocks.calls.push(sel)
  if (sel === mocks.throwOn) throw new Error('objc call failed')
  switch (sel) {
    case 'new':
      return 'pool'
    case 'drain':
      return undefined
    case 'generalPasteboard':
      return board('general')
    case 'pasteboardWithName:':
      return board((a as NSStr).str)
    case 'stringWithUTF8String:':
      return { str: a as string }
    case 'fileURLWithPath:':
      return { url: `file://${encodeURI((a as NSStr).str)}` }
    case 'absoluteString':
      return { str: (obj as NSUrl).url }
    case 'array':
      return []
    case 'arrayWithObject:':
      return [a]
    case 'addObject:':
      ;(obj as unknown[]).push(a)
      return undefined
    case 'clearContents':
      ;(obj as Board).items = []
      ;(obj as Board).types = []
      ;(obj as Board).strings = {}
      ;(obj as Board).data = {}
      return ++(obj as Board).changeCount
    case 'writeObjects:':
      if (!mocks.writeObjectsOk) return false
      ;(obj as Board).items = (a as NSUrl[]).slice(0, mocks.keepItems ?? (a as NSUrl[]).length)
      ;(obj as Board).types = [{ str: 'public.file-url' }]
      return true
    case 'changeCount':
      return (obj as Board).changeCount
    case 'objectAtIndex:':
      return (obj as unknown[])[a as number]
    case 'dataWithBytes:length:':
      return { bytes: Buffer.from((a as Buffer).subarray(0, b as number)) }
    case 'setData:forType:':
      if (!mocks.setDataOk) return false
      ;(obj as Board).data[(b as NSStr).str] = (a as NSData).bytes
      if ((obj as Board).items[0] && mocks.addTypesWorks) itemTypes((obj as Board).items[0]).push(b as NSStr)
      if (mocks.dropItemOnSetData) (obj as Board).items.pop()
      return true
    case 'pasteboardItems':
      return (obj as Board).items
    case 'count':
      return (obj as unknown[]).length
    case 'addTypes:owner:':
      if (mocks.addTypesWorks) (obj as Board).types.push(...(a as NSStr[]))
      return mocks.addTypesResult ?? (obj as Board).changeCount
    case 'setString:forType:':
      if (!mocks.setStringOk) return false
      ;(obj as Board).strings[(b as NSStr).str] = (a as NSStr).str
      return true
    case 'types':
      return Array.isArray((obj as Board).items) ? (obj as Board).types : itemTypes(obj as NSUrl)
    case 'containsObject:':
      return (obj as NSStr[]).some((t) => t.str === (a as NSStr).str)
  }
  return null
}

vi.mock('koffi', () => ({
  default: {
    load: (path: string) => {
      mocks.load(path)
      if (mocks.bridgeBroken) throw new Error('no objc runtime')
      return {
        func: (decl: string) => {
          if (decl.includes('objc_getClass')) return (name: string) => (name === mocks.missingClass ? null : name)
          if (decl.includes('sel_registerName')) return (name: string) => name
          return send
        }
      }
    }
  }
}))

type Mod = typeof import('../electron/main/macPasteboard')

async function loadModule(platform = 'darwin'): Promise<Mod> {
  setPlatform(platform)
  vi.resetModules()
  const mod = await import('../electron/main/macPasteboard')
  mocks.calls = []
  return mod
}

const paths = ['/a/One file.txt', '/a/R&D.txt', "/a/it's.txt", '/a/Привет.txt', '/a/what?.txt']

beforeEach(() => {
  mocks.load.mockReset()
  mocks.bridgeBroken = false
  mocks.missingClass = ''
  mocks.calls = []
  mocks.boards.clear()
  mocks.writeObjectsOk = true
  mocks.keepItems = null
  mocks.setStringOk = true
  mocks.setDataOk = true
  mocks.addTypesWorks = true
  mocks.addTypesResult = null
  mocks.dropItemOnSetData = false
  mocks.throwOn = ''
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  restorePlatform()
})

afterAll(() => {
  restorePlatform()
})

describe('writeFileUrls', () => {
  it('clears the general pasteboard and writes one file url per path inside an autorelease pool', async () => {
    const { writeFileUrls } = await loadModule()

    expect(writeFileUrls(paths)).toBe(true)

    expect(mocks.load).toHaveBeenCalledWith('/usr/lib/libobjc.A.dylib')
    expect(mocks.calls).toEqual([
      'new',
      'generalPasteboard',
      'array',
      ...paths.flatMap(() => ['stringWithUTF8String:', 'fileURLWithPath:', 'addObject:']),
      'clearContents',
      'writeObjects:',
      'pasteboardItems',
      'count',
      'drain'
    ])
    expect(board('general').items).toEqual(paths.map((p) => ({ url: `file://${encodeURI(p)}` })))
  })

  it('returns false when writeObjects: reports failure and still drains the pool', async () => {
    const { writeFileUrls } = await loadModule()
    mocks.writeObjectsOk = false

    expect(writeFileUrls(paths)).toBe(false)
    expect(mocks.calls.at(-1)).toBe('drain')
    expect(mocks.calls).not.toContain('pasteboardItems')
  })

  it('returns false when the pasteboard holds fewer items than paths', async () => {
    const { writeFileUrls } = await loadModule()
    mocks.keepItems = 2

    expect(writeFileUrls(paths)).toBe(false)
    expect(board('general').items).toHaveLength(2)
    expect(mocks.calls.at(-1)).toBe('drain')
  })

  it('writes to a named pasteboard and leaves the general one alone', async () => {
    const { writeFileUrls } = await loadModule()

    expect(writeFileUrls(paths.slice(0, 2), 'edge-drop-test')).toBe(true)

    expect(mocks.calls).toContain('pasteboardWithName:')
    expect(mocks.calls).not.toContain('generalPasteboard')
    expect(board('edge-drop-test').items).toHaveLength(2)
    expect(mocks.boards.has('general')).toBe(false)
  })

  it('does nothing for an empty list', async () => {
    const { writeFileUrls } = await loadModule()

    expect(writeFileUrls([])).toBe(false)
    expect(mocks.calls).toEqual([])
  })

  it.each([
    ['a relative path', ['relative/a.png']],
    ['a Windows path', ['C:\\Users\\a.png']],
    ['a path with a NUL byte', ['/tmp/a\0b.png']],
    ['an empty string', ['']]
  ])('refuses %s without clearing the pasteboard', async (_label, bad) => {
    const { writeFileUrls } = await loadModule()
    board('general').strings['public.utf8-plain-text'] = 'keep me'

    expect(writeFileUrls(bad)).toBe(false)

    expect(mocks.calls).toEqual([])
    expect(board('general').strings).toEqual({ 'public.utf8-plain-text': 'keep me' })
  })

  it('drops unsafe paths and writes only the absolute ones', async () => {
    const { writeFileUrls } = await loadModule()

    expect(writeFileUrls(['relative.png', '/a/ok.png', '/a/nul\0.png', '/a/also ok.png'])).toBe(true)

    expect(board('general').items).toEqual([{ url: 'file:///a/ok.png' }, { url: 'file:///a/also%20ok.png' }])
    expect(mocks.calls.filter((c) => c === 'fileURLWithPath:')).toHaveLength(2)
  })

  it('returns false and drains the pool when an ObjC call throws', async () => {
    const { writeFileUrls } = await loadModule()
    mocks.throwOn = 'writeObjects:'

    expect(writeFileUrls(paths)).toBe(false)
    expect(mocks.calls.at(-1)).toBe('drain')
    expect(console.error).toHaveBeenCalled()
  })
})

describe('addFileUrlToCurrentItem', () => {
  const named = '/tmp/Screenshot 2026-01-01 10.00.00.png'

  function withImage(name = 'general', type = 'public.png'): Board {
    const pb = board(name)
    pb.types.push({ str: type })
    pb.changeCount = 7
    return pb
  }

  it('adds public.file-url to the image already on the pasteboard without clearing it', async () => {
    const { addFileUrlToCurrentItem } = await loadModule()
    withImage()

    expect(addFileUrlToCurrentItem(named, 7)).toBe(true)

    expect(mocks.calls).not.toContain('clearContents')
    expect(mocks.calls.indexOf('changeCount')).toBeLessThan(mocks.calls.indexOf('addTypes:owner:'))
    expect(mocks.calls.indexOf('addTypes:owner:')).toBeLessThan(mocks.calls.indexOf('setString:forType:'))
    expect(mocks.calls.at(-1)).toBe('drain')
    expect(board('general').types.map((t) => t.str)).toEqual(['public.png', 'public.file-url'])
    expect(board('general').strings).toEqual({ 'public.file-url': `file://${encodeURI(named)}` })
    expect(board('general').changeCount).toBe(7)
  })

  it('accepts a TIFF image as the anchor', async () => {
    const { addFileUrlToCurrentItem } = await loadModule()
    withImage('general', 'public.tiff')

    expect(addFileUrlToCurrentItem(named, 7)).toBe(true)
    expect(board('general').types.map((t) => t.str)).toEqual(['public.tiff', 'public.file-url'])
  })

  it('adds nothing to an empty pasteboard', async () => {
    const { addFileUrlToCurrentItem } = await loadModule()
    board('general').changeCount = 7

    expect(addFileUrlToCurrentItem(named, 7)).toBe(false)

    expect(mocks.calls).not.toContain('addTypes:owner:')
    expect(mocks.calls).not.toContain('setString:forType:')
    expect(board('general').types).toEqual([])
  })

  it('adds nothing to content that is not an image', async () => {
    const { addFileUrlToCurrentItem } = await loadModule()
    withImage('general', 'public.utf8-plain-text')

    expect(addFileUrlToCurrentItem(named, 7)).toBe(false)

    expect(mocks.calls).not.toContain('addTypes:owner:')
    expect(board('general').types.map((t) => t.str)).toEqual(['public.utf8-plain-text'])
    expect(board('general').strings).toEqual({})
  })

  it('adds nothing when the pasteboard changed since the image was written', async () => {
    const { addFileUrlToCurrentItem } = await loadModule()
    withImage().changeCount = 8

    expect(addFileUrlToCurrentItem(named, 7)).toBe(false)

    expect(mocks.calls).not.toContain('types')
    expect(mocks.calls).not.toContain('addTypes:owner:')
    expect(board('general').types.map((t) => t.str)).toEqual(['public.png'])
  })

  it.each([0, 8])('returns false without writing the url when addTypes:owner: answers %i', async (result) => {
    const { addFileUrlToCurrentItem } = await loadModule()
    withImage()
    mocks.addTypesResult = result

    expect(addFileUrlToCurrentItem(named, 7)).toBe(false)

    expect(mocks.calls).not.toContain('setString:forType:')
    expect(board('general').strings).toEqual({})
  })

  it.each(['relative.png', '/tmp/a\0b.png', ''])('refuses the unsafe path %j before touching the pasteboard', async (bad) => {
    const { addFileUrlToCurrentItem } = await loadModule()
    withImage()

    expect(addFileUrlToCurrentItem(bad, 7)).toBe(false)
    expect(mocks.calls).toEqual([])
  })

  it('returns false when setString:forType: reports failure', async () => {
    const { addFileUrlToCurrentItem } = await loadModule()
    withImage()
    mocks.setStringOk = false

    expect(addFileUrlToCurrentItem(named, 7)).toBe(false)
    expect(mocks.calls.at(-1)).toBe('drain')
  })

  it('returns false when the type did not appear on the pasteboard', async () => {
    const { addFileUrlToCurrentItem } = await loadModule()
    withImage()
    mocks.addTypesWorks = false

    expect(addFileUrlToCurrentItem(named, 7)).toBe(false)
  })

  it('targets a named pasteboard when asked', async () => {
    const { addFileUrlToCurrentItem } = await loadModule()
    withImage('edge-drop-test')

    expect(addFileUrlToCurrentItem(named, 7, 'edge-drop-test')).toBe(true)
    expect(board('edge-drop-test').types.map((t) => t.str)).toEqual(['public.png', 'public.file-url'])
    expect(mocks.boards.has('general')).toBe(false)
  })
})

describe('addImageDataToFirstItem', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
  const files = ['/a/one.png', '/a/two.png', '/a/three.png']

  async function loadWithFiles(name?: string): Promise<{ mod: Mod; count: number }> {
    const mod = await loadModule()
    expect(mod.writeFileUrls(files, name)).toBe(true)
    const count = mod.pasteboardChangeCount(name)
    mocks.calls = []
    return { mod, count }
  }

  it('adds public.png data to the first file item and keeps every item', async () => {
    const { mod, count } = await loadWithFiles()

    expect(mod.addImageDataToFirstItem(png, count)).toBe(true)

    const pb = board('general')
    expect(mocks.calls).not.toContain('clearContents')
    expect(mocks.calls).not.toContain('writeObjects:')
    expect(pb.items).toHaveLength(3)
    expect(pb.items[0].types!.map((t) => t.str)).toEqual(['public.file-url', 'public.png'])
    expect(pb.items[1].types).toBeUndefined()
    expect(pb.data['public.png'].equals(png)).toBe(true)
    expect(pb.changeCount).toBe(count)
    expect(mocks.calls.at(-1)).toBe('drain')
  })

  it('adds nothing when the pasteboard changed since the file list was written', async () => {
    const { mod, count } = await loadWithFiles()
    board('general').changeCount = count + 1

    expect(mod.addImageDataToFirstItem(png, count)).toBe(false)

    expect(mocks.calls).not.toContain('addTypes:owner:')
    expect(board('general').data).toEqual({})
  })

  it('adds nothing to an empty pasteboard', async () => {
    const mod = await loadModule()

    expect(mod.addImageDataToFirstItem(png, mod.pasteboardChangeCount())).toBe(false)

    expect(mocks.calls).not.toContain('addTypes:owner:')
    expect(mocks.calls).not.toContain('setData:forType:')
  })

  it('adds nothing when the first item is not a file reference', async () => {
    const { mod, count } = await loadWithFiles()
    board('general').items[0].types = [{ str: 'public.utf8-plain-text' }]

    expect(mod.addImageDataToFirstItem(png, count)).toBe(false)
    expect(mocks.calls).not.toContain('addTypes:owner:')
  })

  it('does nothing for empty image data', async () => {
    const { mod, count } = await loadWithFiles()

    expect(mod.addImageDataToFirstItem(Buffer.alloc(0), count)).toBe(false)
    expect(mocks.calls).toEqual([])
  })

  it.each([0, 99])('returns false without writing data when addTypes:owner: answers %i', async (result) => {
    const { mod, count } = await loadWithFiles()
    mocks.addTypesResult = result

    expect(mod.addImageDataToFirstItem(png, count)).toBe(false)
    expect(mocks.calls).not.toContain('setData:forType:')
  })

  it('returns false when setData:forType: reports failure', async () => {
    const { mod, count } = await loadWithFiles()
    mocks.setDataOk = false

    expect(mod.addImageDataToFirstItem(png, count)).toBe(false)
    expect(mocks.calls.at(-1)).toBe('drain')
  })

  it('returns false when the number of items changed', async () => {
    const { mod, count } = await loadWithFiles()
    mocks.dropItemOnSetData = true

    expect(mod.addImageDataToFirstItem(png, count)).toBe(false)
  })

  it('returns false when the first item did not get the PNG type', async () => {
    const { mod, count } = await loadWithFiles()
    mocks.addTypesWorks = false

    expect(mod.addImageDataToFirstItem(png, count)).toBe(false)
  })

  it('targets a named pasteboard when asked', async () => {
    const { mod, count } = await loadWithFiles('edge-drop-test')

    expect(mod.addImageDataToFirstItem(png, count, 'edge-drop-test')).toBe(true)
    expect(board('edge-drop-test').data['public.png'].equals(png)).toBe(true)
    expect(mocks.boards.has('general')).toBe(false)
  })
})

describe('pasteboardChangeCount', () => {
  it('reads the change count of the general and of a named pasteboard', async () => {
    const { pasteboardChangeCount } = await loadModule()
    board('general').changeCount = 12
    board('edge-drop-test').changeCount = 3

    expect(pasteboardChangeCount()).toBe(12)
    expect(pasteboardChangeCount('edge-drop-test')).toBe(3)
  })

  it('answers -1 when the call throws', async () => {
    const { pasteboardChangeCount } = await loadModule()
    mocks.throwOn = 'changeCount'

    expect(pasteboardChangeCount()).toBe(-1)
  })
})

describe('unavailable bridge', () => {
  it('returns false from both functions when the ObjC runtime cannot be loaded', async () => {
    mocks.bridgeBroken = true
    const { writeFileUrls, addFileUrlToCurrentItem, addImageDataToFirstItem, pasteboardChangeCount } = await loadModule()

    expect(writeFileUrls(paths)).toBe(false)
    expect(addFileUrlToCurrentItem(paths[0], 1)).toBe(false)
    expect(addImageDataToFirstItem(Buffer.from([1]), 1)).toBe(false)
    expect(pasteboardChangeCount()).toBe(-1)
    expect(mocks.calls).toEqual([])
    expect(console.error).toHaveBeenCalled()
  })

  it('returns false when a required class is missing', async () => {
    mocks.missingClass = 'NSPasteboard'
    const { writeFileUrls, addFileUrlToCurrentItem } = await loadModule()

    expect(writeFileUrls(paths)).toBe(false)
    expect(addFileUrlToCurrentItem(paths[0], 1)).toBe(false)
    expect(mocks.calls).toEqual([])
  })

  it('never loads the ObjC runtime off macOS', async () => {
    const { writeFileUrls, addFileUrlToCurrentItem } = await loadModule('win32')

    expect(mocks.load).not.toHaveBeenCalled()
    expect(writeFileUrls(paths)).toBe(false)
    expect(addFileUrlToCurrentItem(paths[0], 1)).toBe(false)
  })
})
