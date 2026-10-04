import koffi from 'koffi'

type Ptr = unknown

const FILE_URL_TYPE = 'public.file-url'
const PNG_TYPE = 'public.png'
const IMAGE_ANCHOR_TYPES = [PNG_TYPE, 'public.tiff']

let ready = false
let msgPtr: ((a: Ptr, b: Ptr) => Ptr) | null = null
let msgVoid: ((a: Ptr, b: Ptr) => void) | null = null
let msgLong: ((a: Ptr, b: Ptr) => number | bigint) | null = null
let msgObj: ((a: Ptr, b: Ptr, c: Ptr) => Ptr) | null = null
let msgFromUtf8: ((a: Ptr, b: Ptr, c: string) => Ptr) | null = null
let msgVoidObj: ((a: Ptr, b: Ptr, c: Ptr) => void) | null = null
let msgBoolObj: ((a: Ptr, b: Ptr, c: Ptr) => boolean) | null = null
let msgLongObjObj: ((a: Ptr, b: Ptr, c: Ptr, d: Ptr) => number | bigint) | null = null
let msgBoolObjObj: ((a: Ptr, b: Ptr, c: Ptr, d: Ptr) => boolean) | null = null
let msgAt: ((a: Ptr, b: Ptr, c: number) => Ptr) | null = null
let msgBytes: ((a: Ptr, b: Ptr, c: Buffer, d: number) => Ptr) | null = null
let NSPasteboard: Ptr = null
let NSString: Ptr = null
let NSURL: Ptr = null
let NSArray: Ptr = null
let NSMutableArray: Ptr = null
let NSData: Ptr = null
let NSAutoreleasePool: Ptr = null
const sels: Record<string, Ptr> = {}

if (process.platform === 'darwin') {
  try {
    const objc = koffi.load('/usr/lib/libobjc.A.dylib')
    const getClass = objc.func('void *objc_getClass(const char *name)') as (n: string) => Ptr
    const sel = objc.func('void *sel_registerName(const char *name)') as (n: string) => Ptr
    msgPtr = objc.func('objc_msgSend', 'void *', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => Ptr
    msgVoid = objc.func('objc_msgSend', 'void', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => void
    msgLong = objc.func('objc_msgSend', 'long', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => number | bigint
    msgObj = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr) => Ptr
    msgFromUtf8 = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'str']) as unknown as (a: Ptr, b: Ptr, c: string) => Ptr
    msgVoidObj = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr) => void
    msgBoolObj = objc.func('objc_msgSend', 'bool', ['void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr) => boolean
    msgLongObjObj = objc.func('objc_msgSend', 'long', ['void *', 'void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr, d: Ptr) => number | bigint
    msgBoolObjObj = objc.func('objc_msgSend', 'bool', ['void *', 'void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr, d: Ptr) => boolean
    msgAt = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'ulong']) as unknown as (a: Ptr, b: Ptr, c: number) => Ptr
    msgBytes = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *', 'ulong']) as unknown as (a: Ptr, b: Ptr, c: Buffer, d: number) => Ptr
    NSPasteboard = getClass('NSPasteboard')
    NSString = getClass('NSString')
    NSURL = getClass('NSURL')
    NSArray = getClass('NSArray')
    NSMutableArray = getClass('NSMutableArray')
    NSData = getClass('NSData')
    NSAutoreleasePool = getClass('NSAutoreleasePool')
    for (const n of [
      'new', 'drain', 'generalPasteboard', 'pasteboardWithName:', 'clearContents', 'writeObjects:', 'pasteboardItems',
      'count', 'array', 'addObject:', 'arrayWithObject:', 'stringWithUTF8String:', 'fileURLWithPath:', 'absoluteString',
      'addTypes:owner:', 'setString:forType:', 'types', 'containsObject:', 'changeCount', 'objectAtIndex:',
      'setData:forType:', 'dataWithBytes:length:'
    ]) {
      sels[n] = sel(n)
    }
    ready = !!(NSPasteboard && NSString && NSURL && NSArray && NSMutableArray && NSData && NSAutoreleasePool)
  } catch (err) {
    console.error('[macPasteboard] ObjC runtime unavailable:', err)
  }
}

function nsString(value: string): Ptr {
  return msgFromUtf8!(NSString, sels['stringWithUTF8String:'], value)
}

function pasteboard(name?: string): Ptr {
  if (!name) return msgPtr!(NSPasteboard, sels.generalPasteboard)
  const nsName = nsString(name)
  return nsName ? msgObj!(NSPasteboard, sels['pasteboardWithName:'], nsName) : null
}

function fileUrl(path: string): Ptr {
  const nsPath = nsString(path)
  return nsPath ? msgObj!(NSURL, sels['fileURLWithPath:'], nsPath) : null
}

function withPool<T>(fn: () => T, fallback: T): T {
  let pool: Ptr = null
  try {
    pool = msgPtr!(NSAutoreleasePool, sels.new)
    return fn()
  } catch (err) {
    console.error('[macPasteboard] ObjC call failed:', err)
    return fallback
  } finally {
    if (pool) {
      try {
        msgVoid!(pool, sels.drain)
      } catch (err) {
        console.error('[macPasteboard] autorelease pool drain failed:', err)
      }
    }
  }
}

function isWritablePath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.includes('\0')
}

function hasType(types: Ptr, name: string): boolean {
  const type = nsString(name)
  return !!types && !!type && !!msgBoolObj!(types, sels['containsObject:'], type)
}

export function pasteboardChangeCount(pasteboardName?: string): number {
  if (!ready) return -1
  return withPool(() => {
    const pb = pasteboard(pasteboardName)
    return pb ? Number(msgLong!(pb, sels.changeCount)) : -1
  }, -1)
}

export function writeFileUrls(paths: string[], pasteboardName?: string): boolean {
  if (!ready) return false
  const safePaths = paths.filter(isWritablePath)
  if (safePaths.length === 0) return false
  return withPool(() => {
    const pb = pasteboard(pasteboardName)
    if (!pb) return false
    const urls = msgPtr!(NSMutableArray, sels.array)
    if (!urls) return false
    for (const path of safePaths) {
      const url = fileUrl(path)
      if (!url) return false
      msgVoidObj!(urls, sels['addObject:'], url)
    }
    msgLong!(pb, sels.clearContents)
    if (!msgBoolObj!(pb, sels['writeObjects:'], urls)) return false
    const items = msgPtr!(pb, sels.pasteboardItems)
    return !!items && Number(msgLong!(items, sels.count)) === safePaths.length
  }, false)
}

export function addFileUrlToCurrentItem(path: string, expectedChangeCount: number, pasteboardName?: string): boolean {
  if (!ready || !isWritablePath(path)) return false
  return withPool(() => {
    const pb = pasteboard(pasteboardName)
    if (!pb) return false
    if (Number(msgLong!(pb, sels.changeCount)) !== expectedChangeCount) return false
    const current = msgPtr!(pb, sels.types)
    if (!IMAGE_ANCHOR_TYPES.some((name) => hasType(current, name))) return false
    const type = nsString(FILE_URL_TYPE)
    const url = fileUrl(path)
    const urlString = url ? msgPtr!(url, sels.absoluteString) : null
    if (!type || !urlString) return false
    const typeList = msgObj!(NSArray, sels['arrayWithObject:'], type)
    if (!typeList) return false
    if (Number(msgLongObjObj!(pb, sels['addTypes:owner:'], typeList, null)) !== expectedChangeCount) return false
    if (!msgBoolObjObj!(pb, sels['setString:forType:'], urlString, type)) return false
    return hasType(msgPtr!(pb, sels.types), FILE_URL_TYPE)
  }, false)
}

export function addImageDataToFirstItem(png: Buffer, expectedChangeCount: number, pasteboardName?: string): boolean {
  if (!ready || png.length === 0) return false
  return withPool(() => {
    const pb = pasteboard(pasteboardName)
    if (!pb) return false
    if (Number(msgLong!(pb, sels.changeCount)) !== expectedChangeCount) return false
    const items = msgPtr!(pb, sels.pasteboardItems)
    const count = items ? Number(msgLong!(items, sels.count)) : 0
    if (count === 0) return false
    const first = msgAt!(items, sels['objectAtIndex:'], 0)
    if (!first || !hasType(msgPtr!(first, sels.types), FILE_URL_TYPE)) return false
    const type = nsString(PNG_TYPE)
    const data = msgBytes!(NSData, sels['dataWithBytes:length:'], png, png.length)
    if (!type || !data) return false
    const typeList = msgObj!(NSArray, sels['arrayWithObject:'], type)
    if (!typeList) return false
    if (Number(msgLongObjObj!(pb, sels['addTypes:owner:'], typeList, null)) !== expectedChangeCount) return false
    if (!msgBoolObjObj!(pb, sels['setData:forType:'], data, type)) return false
    const after = msgPtr!(pb, sels.pasteboardItems)
    if (!after || Number(msgLong!(after, sels.count)) !== count) return false
    const firstTypes = msgPtr!(msgAt!(after, sels['objectAtIndex:'], 0), sels.types)
    return hasType(firstTypes, PNG_TYPE) && hasType(firstTypes, FILE_URL_TYPE)
  }, false)
}
