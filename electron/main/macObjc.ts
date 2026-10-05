import koffi, { type LibraryHandle, type TypeObject } from 'koffi'

export type Ptr = unknown

export const NS_BITMAP_PNG = 4

type ObjcType = string | TypeObject

let lib: LibraryHandle | null = null
let getClass: ((n: string) => Ptr) | null = null
let registerSel: ((n: string) => Ptr) | null = null
const sends = new Map<string, unknown>()
const typeIds = new Map<TypeObject, string>()

export function objcLib(): LibraryHandle {
  if (lib) return lib
  if (process.platform !== 'darwin') throw new Error('ObjC runtime is only available on macOS')
  lib = koffi.load('/usr/lib/libobjc.A.dylib')
  return lib
}

export function objcClass(name: string): Ptr {
  getClass ??= objcLib().func('void *objc_getClass(const char *name)') as (n: string) => Ptr
  return getClass(name)
}

export function objcSel(name: string): Ptr {
  registerSel ??= objcLib().func('void *sel_registerName(const char *name)') as (n: string) => Ptr
  return registerSel(name)
}

function typeKey(type: ObjcType): string {
  if (typeof type === 'string') return type
  let id = typeIds.get(type)
  if (!id) {
    id = `#${typeIds.size}`
    typeIds.set(type, id)
  }
  return id
}

export function objcMsgSend<F>(result: ObjcType, args: ObjcType[]): F {
  const key = `${typeKey(result)}(${args.map(typeKey).join(',')})`
  let send = sends.get(key)
  if (!send) {
    send = objcLib().func('objc_msgSend', result, args)
    sends.set(key, send)
  }
  return send as F
}

interface PoolBridge {
  msgPtr: (a: Ptr, b: Ptr) => Ptr
  msgVoid: (a: Ptr, b: Ptr) => void
  cls: Ptr
  selNew: Ptr
  selDrain: Ptr
}

let poolBridge: PoolBridge | null = null

function autoreleasePool(): PoolBridge {
  poolBridge ??= {
    msgPtr: objcMsgSend('void *', ['void *', 'void *']),
    msgVoid: objcMsgSend('void', ['void *', 'void *']),
    cls: objcClass('NSAutoreleasePool'),
    selNew: objcSel('new'),
    selDrain: objcSel('drain')
  }
  return poolBridge
}

export function autoreleasePoolRunner(tag: string): <T>(fn: () => T, fallback: T) => T {
  return <T>(fn: () => T, fallback: T): T => {
    let pool: Ptr = null
    try {
      const bridge = autoreleasePool()
      pool = bridge.msgPtr(bridge.cls, bridge.selNew)
      return fn()
    } catch (err) {
      console.error(`${tag} ObjC call failed:`, err)
      return fallback
    } finally {
      if (pool) {
        try {
          const bridge = autoreleasePool()
          bridge.msgVoid(pool, bridge.selDrain)
        } catch (err) {
          console.error(`${tag} autorelease pool drain failed:`, err)
        }
      }
    }
  }
}

interface StringBridge {
  msgFromUtf8: (a: Ptr, b: Ptr, c: string) => Ptr
  cls: Ptr
  sel: Ptr
}

let stringBridge: StringBridge | null = null

export function nsString(value: string): Ptr {
  stringBridge ??= {
    msgFromUtf8: objcMsgSend('void *', ['void *', 'void *', 'str']),
    cls: objcClass('NSString'),
    sel: objcSel('stringWithUTF8String:')
  }
  return stringBridge.msgFromUtf8(stringBridge.cls, stringBridge.sel, value)
}
