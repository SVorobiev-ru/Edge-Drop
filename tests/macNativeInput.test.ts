import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  loaded: [] as string[],
  declared: [] as Array<{ lib: string; name: string; result: string; args: string[] }>,
  calls: [] as Array<{ name: string; args: unknown[] }>,
  pressed: 0 as number | bigint,
  createEvent: (() => ({ event: true })) as () => unknown,
  failCoreGraphics: false,
  failObjc: false,
  failPostOn: null as unknown,
  missingSymbols: [] as string[],
  postAccess: true as boolean | Error,
  requestAccess: true as boolean | Error
}))

vi.mock('koffi', () => ({
  default: {
    load: (lib: string) => {
      if (mocks.failCoreGraphics && lib.includes('CoreGraphics')) throw new Error('no CoreGraphics')
      if (mocks.failObjc && lib.includes('libobjc')) throw new Error('no objc runtime')
      mocks.loaded.push(lib)
      return {
        func: (nameOrProto: string, result?: string, args?: string[]) => {
          if (result === undefined) {
            if (nameOrProto.includes('objc_getClass')) return (n: string) => ({ cls: n })
            return (n: string) => `sel:${n}`
          }
          if (mocks.missingSymbols.includes(nameOrProto)) throw new Error(`Cannot find function '${nameOrProto}'`)
          mocks.declared.push({ lib, name: nameOrProto, result, args: args ?? [] })
          return (...callArgs: unknown[]) => {
            mocks.calls.push({ name: nameOrProto, args: callArgs })
            if (nameOrProto === 'CGPreflightPostEventAccess' || nameOrProto === 'CGRequestPostEventAccess') {
              const answer = nameOrProto === 'CGPreflightPostEventAccess' ? mocks.postAccess : mocks.requestAccess
              if (answer instanceof Error) throw answer
              return answer
            }
            if (nameOrProto === 'objc_msgSend' && callArgs[1] === 'sel:pressedMouseButtons') return mocks.pressed
            if (nameOrProto === 'CGEventCreateKeyboardEvent') return mocks.createEvent()
            if (nameOrProto === 'CGEventPost' && mocks.failPostOn !== null && callArgs[1] === mocks.failPostOn) throw new Error('post failed')
            return null
          }
        }
      }
    }
  }
}))

async function loadNative(platform: string): Promise<typeof import('../electron/main/macNative')> {
  setPlatform(platform)
  vi.resetModules()
  return import('../electron/main/macNative')
}

describe('macNative input helpers', () => {
  beforeEach(() => {
    mocks.loaded.length = 0
    mocks.declared.length = 0
    mocks.calls.length = 0
    mocks.pressed = 0
    mocks.createEvent = () => ({ event: true })
    mocks.failCoreGraphics = false
    mocks.failObjc = false
    mocks.failPostOn = null
    mocks.missingSymbols = []
    mocks.postAccess = true
    mocks.requestAccess = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restorePlatform()
  })

  afterAll(() => {
    restorePlatform()
  })

  it('does not load any native library and reports nothing off macOS', async () => {
    const native = await loadNative('win32')
    expect(mocks.loaded).toEqual([])
    expect(native.pressedMouseButtons()).toBe(0)
    expect(native.postCommandV()).toBe(false)
    expect(mocks.calls).toEqual([])
  })

  it('reads [NSEvent pressedMouseButtons] as a number', async () => {
    const native = await loadNative('darwin')
    mocks.pressed = 1
    expect(native.pressedMouseButtons()).toBe(1)
    mocks.pressed = 5n
    expect(native.pressedMouseButtons()).toBe(5)
    mocks.pressed = 0
    expect(native.pressedMouseButtons()).toBe(0)

    const call = mocks.calls.find((c) => c.args[1] === 'sel:pressedMouseButtons')
    expect(call?.args[0]).toEqual({ cls: 'NSEvent' })
    expect(mocks.declared).toContainEqual({
      lib: '/usr/lib/libobjc.A.dylib',
      name: 'objc_msgSend',
      result: 'unsigned long',
      args: ['void *', 'void *']
    })
  })

  it('declares the CoreGraphics calls with layout-safe types', async () => {
    await loadNative('darwin')
    const lib = '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics'
    expect(mocks.declared).toContainEqual({ lib, name: 'CGEventCreateKeyboardEvent', result: 'void *', args: ['void *', 'uint16', 'bool'] })
    expect(mocks.declared).toContainEqual({ lib, name: 'CGEventSetFlags', result: 'void', args: ['void *', 'uint64'] })
    expect(mocks.declared).toContainEqual({ lib, name: 'CGEventPost', result: 'void', args: ['uint32', 'void *'] })
    expect(mocks.declared).toContainEqual({ lib, name: 'CFRelease', result: 'void', args: ['void *'] })
  })

  it('creates both events before posting key down then key up for virtual key 9 with the Command flag and releases both', async () => {
    const native = await loadNative('darwin')
    const down = { id: 'down' }
    const up = { id: 'up' }
    const events = [down, up]
    mocks.createEvent = () => events.shift()
    mocks.calls.length = 0

    expect(native.postCommandV()).toBe(true)

    expect(mocks.calls).toEqual([
      { name: 'CGEventCreateKeyboardEvent', args: [null, 9, true] },
      { name: 'CGEventCreateKeyboardEvent', args: [null, 9, false] },
      { name: 'CGEventSetFlags', args: [down, 0x100000] },
      { name: 'CGEventSetFlags', args: [up, 0x100000] },
      { name: 'CGEventPost', args: [0, down] },
      { name: 'CGEventPost', args: [0, up] },
      { name: 'CFRelease', args: [down] },
      { name: 'CFRelease', args: [up] }
    ])
  })

  it('posts nothing, releases the key-down event and returns false when the key-up event cannot be created', async () => {
    const native = await loadNative('darwin')
    const down = { id: 'down' }
    const events: unknown[] = [down, null]
    mocks.createEvent = () => events.shift()
    mocks.calls.length = 0

    expect(native.postCommandV()).toBe(false)

    expect(mocks.calls).toEqual([
      { name: 'CGEventCreateKeyboardEvent', args: [null, 9, true] },
      { name: 'CGEventCreateKeyboardEvent', args: [null, 9, false] },
      { name: 'CFRelease', args: [down] }
    ])
  })

  it('returns false and releases both events when the key-down post throws', async () => {
    const native = await loadNative('darwin')
    const down = { id: 'down' }
    const up = { id: 'up' }
    const events = [down, up]
    mocks.createEvent = () => events.shift()
    mocks.failPostOn = down
    mocks.calls.length = 0

    expect(native.postCommandV()).toBe(false)

    expect(mocks.calls.filter((c) => c.name === 'CGEventPost')).toEqual([{ name: 'CGEventPost', args: [0, down] }])
    expect(mocks.calls.filter((c) => c.name === 'CFRelease').map((c) => c.args[0])).toEqual([down, up])
  })

  it('still returns true once key down was posted even if the key-up post throws', async () => {
    const native = await loadNative('darwin')
    const down = { id: 'down' }
    const up = { id: 'up' }
    const events = [down, up]
    mocks.createEvent = () => events.shift()
    mocks.failPostOn = up
    mocks.calls.length = 0

    expect(native.postCommandV()).toBe(true)

    expect(console.error).toHaveBeenCalled()
    expect(mocks.calls.filter((c) => c.name === 'CFRelease').map((c) => c.args[0])).toEqual([down, up])
  })

  it('reports whether the mouse button bridge is usable', async () => {
    expect((await loadNative('darwin')).mouseButtonsAvailable()).toBe(true)
    expect((await loadNative('win32')).mouseButtonsAvailable()).toBe(false)
    mocks.failObjc = true
    const broken = await loadNative('darwin')
    expect(broken.mouseButtonsAvailable()).toBe(false)
    expect(broken.pressedMouseButtons()).toBe(0)
  })

  it('returns false without posting when the event cannot be created', async () => {
    const native = await loadNative('darwin')
    mocks.createEvent = () => null
    mocks.calls.length = 0

    expect(native.postCommandV()).toBe(false)
    expect(mocks.calls.some((c) => c.name === 'CGEventPost')).toBe(false)
  })

  it('returns false when CoreGraphics cannot be loaded, leaving the ObjC bridge usable', async () => {
    mocks.failCoreGraphics = true
    const native = await loadNative('darwin')
    mocks.pressed = 1

    expect(native.postCommandV()).toBe(false)
    expect(native.pressedMouseButtons()).toBe(1)
  })

  it('reads post-event access through CGPreflightPostEventAccess without arguments', async () => {
    const native = await loadNative('darwin')
    const lib = '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics'
    expect(mocks.declared).toContainEqual({ lib, name: 'CGPreflightPostEventAccess', result: 'bool', args: [] })
    expect(mocks.declared).toContainEqual({ lib, name: 'CGRequestPostEventAccess', result: 'bool', args: [] })
    mocks.calls.length = 0

    expect(native.canPostEvents()).toBe(true)
    mocks.postAccess = false
    expect(native.canPostEvents()).toBe(false)

    expect(mocks.calls).toEqual([
      { name: 'CGPreflightPostEventAccess', args: [] },
      { name: 'CGPreflightPostEventAccess', args: [] }
    ])
  })

  it('asks for post-event access through CGRequestPostEventAccess', async () => {
    const native = await loadNative('darwin')
    mocks.calls.length = 0
    mocks.requestAccess = false

    expect(native.requestPostEvents()).toBe(false)
    mocks.requestAccess = true
    expect(native.requestPostEvents()).toBe(true)
    expect(mocks.calls.map((c) => c.name)).toEqual(['CGRequestPostEventAccess', 'CGRequestPostEventAccess'])
  })

  it('does not block pasting when the access symbols are missing, and keeps Cmd+V working', async () => {
    mocks.missingSymbols = ['CGPreflightPostEventAccess']
    const native = await loadNative('darwin')
    mocks.postAccess = false
    mocks.requestAccess = false
    mocks.calls.length = 0

    expect(native.canPostEvents()).toBe(true)
    expect(native.requestPostEvents()).toBe(true)
    expect(mocks.calls).toEqual([])
    expect(native.postCommandV()).toBe(true)
  })

  it('does not block pasting when the access check throws or CoreGraphics is unavailable', async () => {
    const native = await loadNative('darwin')
    mocks.postAccess = new Error('boom')
    mocks.requestAccess = new Error('boom')
    expect(native.canPostEvents()).toBe(true)
    expect(native.requestPostEvents()).toBe(true)

    mocks.failCoreGraphics = true
    const broken = await loadNative('darwin')
    expect(broken.canPostEvents()).toBe(true)
    expect(broken.requestPostEvents()).toBe(true)
  })

  it('reports post-event access as granted off macOS without any native call', async () => {
    const native = await loadNative('win32')
    expect(native.canPostEvents()).toBe(true)
    expect(native.requestPostEvents()).toBe(true)
    expect(mocks.calls).toEqual([])
  })
})
