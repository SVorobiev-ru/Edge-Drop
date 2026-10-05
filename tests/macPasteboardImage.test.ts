import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

type NSStr = { str: string }
type NSData = { bytes: Buffer }
type Board = { types: string[]; data: Record<string, Buffer>; strings: Record<string, string>; changeCount: number }

const mocks = vi.hoisted(() => ({
  bridgeBroken: false,
  missingClass: '',
  throwOn: '',
  calls: [] as string[],
  boards: new Map<string, { types: string[]; data: Record<string, Buffer>; strings: Record<string, string>; changeCount: number }>(),
  failDataFor: '',
  decodable: true,
  autoreleased: 0,
  pngType: null as number | null
}))

function board(name: string): Board {
  let found = mocks.boards.get(name)
  if (!found) {
    found = { types: ['stale.type'], data: { 'stale.type': Buffer.from('stale') }, strings: {}, changeCount: 1 }
    mocks.boards.set(name, found)
  }
  return found
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
      return { str: (obj as { url: string }).url }
    case 'array':
      return []
    case 'addObject:':
      ;(obj as unknown[]).push(a)
      return undefined
    case 'dataWithBytes:length:':
      return { bytes: Buffer.from((a as Buffer).subarray(0, b as number)) }
    case 'alloc':
      return { allocated: obj }
    case 'initWithData:':
      return mocks.decodable ? { image: (a as NSData).bytes } : null
    case 'autorelease':
      mocks.autoreleased++
      return obj
    case 'TIFFRepresentation':
      return { bytes: Buffer.concat([Buffer.from('tiff-of:'), (obj as { image: Buffer }).image]) }
    case 'imageRepWithData:':
      return mocks.decodable ? { rep: (a as NSData).bytes } : null
    case 'dictionary':
      return {}
    case 'representationUsingType:properties:':
      mocks.pngType = a as number
      return { bytes: Buffer.concat([Buffer.from('png-of:'), (obj as { rep: Buffer }).rep]) }
    case 'clearContents':
      ;(obj as Board).types = []
      ;(obj as Board).data = {}
      ;(obj as Board).strings = {}
      return ++(obj as Board).changeCount
    case 'addTypes:owner:':
      ;(obj as Board).types.push(...(a as NSStr[]).map((t) => t.str))
      return (obj as Board).changeCount
    case 'setData:forType:':
      if ((b as NSStr).str === mocks.failDataFor) return false
      ;(obj as Board).data[(b as NSStr).str] = (a as NSData).bytes
      return true
    case 'setString:forType:':
      ;(obj as Board).strings[(b as NSStr).str] = (a as NSStr).str
      return true
    case 'types':
      return (obj as Board).types.map((str) => ({ str }))
    case 'containsObject:':
      return (obj as NSStr[]).some((t) => t.str === (a as NSStr).str)
  }
  return null
}

vi.mock('koffi', () => ({
  default: {
    load: () => {
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

const PNG = Buffer.from('original-png-bytes')
const TIFF = Buffer.from('original-tiff-bytes')
const NAMED = '/Users/me/Library/Application Support/edge-drop/temp/Screenshot 1.png'

async function loadModule(platform = 'darwin'): Promise<Mod> {
  setPlatform(platform)
  vi.resetModules()
  const mod = await import('../electron/main/macPasteboard')
  mocks.calls = []
  return mod
}

beforeEach(() => {
  mocks.bridgeBroken = false
  mocks.missingClass = ''
  mocks.throwOn = ''
  mocks.calls = []
  mocks.boards.clear()
  mocks.failDataFor = ''
  mocks.decodable = true
  mocks.autoreleased = 0
  mocks.pngType = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  restorePlatform()
})

afterAll(() => {
  restorePlatform()
})

describe('writeImageData', () => {
  it('puts the original png back untouched with a tiff representation and the file url', async () => {
    const { writeImageData } = await loadModule()

    expect(writeImageData({ type: 'public.png', bytes: PNG }, { fileUrlPath: NAMED })).toBe(true)

    const pb = board('general')
    expect(pb.types).toEqual(['public.png', 'public.tiff', 'public.file-url'])
    expect(pb.data['public.png'].equals(PNG)).toBe(true)
    expect(pb.data['public.tiff'].toString()).toBe(`tiff-of:${PNG}`)
    expect(pb.strings['public.file-url']).toBe(`file://${encodeURI(NAMED)}`)
    expect(pb.data['stale.type']).toBeUndefined()
    expect(mocks.autoreleased).toBe(1)
    expect(mocks.calls[0]).toBe('new')
    expect(mocks.calls.at(-1)).toBe('drain')
  })

  it('puts the original tiff back first with a png derived from it', async () => {
    const { writeImageData } = await loadModule()

    expect(writeImageData({ type: 'public.tiff', bytes: TIFF }, { png: Buffer.from('display-png'), fileUrlPath: NAMED })).toBe(true)

    const pb = board('general')
    expect(pb.types).toEqual(['public.tiff', 'public.png', 'public.file-url'])
    expect(pb.data['public.tiff'].equals(TIFF)).toBe(true)
    expect(pb.data['public.png'].toString()).toBe(`png-of:${TIFF}`)
    expect(mocks.pngType).toBe(4)
  })

  it('uses the stored display png when the tiff cannot be converted', async () => {
    const { writeImageData } = await loadModule()
    mocks.decodable = false

    expect(writeImageData({ type: 'public.tiff', bytes: TIFF }, { png: Buffer.from('display-png') })).toBe(true)

    const pb = board('general')
    expect(pb.types).toEqual(['public.tiff', 'public.png'])
    expect(pb.data['public.png'].toString()).toBe('display-png')
  })

  it('writes the original alone when no second representation can be made', async () => {
    const { writeImageData } = await loadModule()
    mocks.decodable = false

    expect(writeImageData({ type: 'public.png', bytes: PNG })).toBe(true)
    expect(board('general').types).toEqual(['public.png'])

    expect(writeImageData({ type: 'public.tiff', bytes: TIFF })).toBe(true)
    expect(board('general').types).toEqual(['public.tiff'])
  })

  it('writes the image without a file url when the path is not usable', async () => {
    const { writeImageData } = await loadModule()

    expect(writeImageData({ type: 'public.png', bytes: PNG }, { fileUrlPath: 'relative/path.png' })).toBe(true)

    expect(board('general').types).toEqual(['public.png', 'public.tiff'])
    expect(board('general').strings).toEqual({})
  })

  it('writes to a named pasteboard', async () => {
    const { writeImageData } = await loadModule()

    expect(writeImageData({ type: 'public.png', bytes: PNG }, {}, 'edge-drop-test')).toBe(true)

    expect(board('edge-drop-test').data['public.png'].equals(PNG)).toBe(true)
    expect(mocks.boards.has('general')).toBe(false)
  })

  it('returns false when the original bytes cannot be set', async () => {
    const { writeImageData } = await loadModule()
    mocks.failDataFor = 'public.png'

    expect(writeImageData({ type: 'public.png', bytes: PNG }, { fileUrlPath: NAMED })).toBe(false)
    expect(mocks.calls.at(-1)).toBe('drain')
  })

  it('still succeeds when only the derived representation cannot be set', async () => {
    const { writeImageData } = await loadModule()
    mocks.failDataFor = 'public.tiff'

    expect(writeImageData({ type: 'public.png', bytes: PNG })).toBe(true)
    expect(board('general').data['public.png'].equals(PNG)).toBe(true)
  })

  it('rejects empty bytes and unknown types without touching the pasteboard', async () => {
    const { writeImageData } = await loadModule()

    expect(writeImageData({ type: 'public.png', bytes: Buffer.alloc(0) })).toBe(false)
    expect(writeImageData({ type: 'public.jpeg', bytes: PNG })).toBe(false)
    expect(mocks.calls).toEqual([])
  })

  it('returns false off darwin, without the runtime and when an ObjC call throws', async () => {
    const win = await loadModule('win32')
    expect(win.writeImageData({ type: 'public.png', bytes: PNG })).toBe(false)

    mocks.bridgeBroken = true
    const broken = await loadModule()
    expect(broken.writeImageData({ type: 'public.png', bytes: PNG })).toBe(false)

    mocks.bridgeBroken = false
    const mod = await loadModule()
    mocks.throwOn = 'clearContents'
    expect(mod.writeImageData({ type: 'public.png', bytes: PNG })).toBe(false)
    expect(mocks.calls.at(-1)).toBe('drain')
  })
})
