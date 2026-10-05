import { NS_BITMAP_PNG, autoreleasePoolRunner, nsString, objcClass, objcMsgSend, objcSel, type Ptr } from './macObjc'

const FILE_URL_TYPE = 'public.file-url'
const PNG_TYPE = 'public.png'
const TIFF_TYPE = 'public.tiff'
const IMAGE_ANCHOR_TYPES = [PNG_TYPE, TIFF_TYPE]

let ready = false
let msgPtr: ((a: Ptr, b: Ptr) => Ptr) | null = null
let msgLong: ((a: Ptr, b: Ptr) => number | bigint) | null = null
let msgObj: ((a: Ptr, b: Ptr, c: Ptr) => Ptr) | null = null
let msgVoidObj: ((a: Ptr, b: Ptr, c: Ptr) => void) | null = null
let msgBoolObj: ((a: Ptr, b: Ptr, c: Ptr) => boolean) | null = null
let msgLongObjObj: ((a: Ptr, b: Ptr, c: Ptr, d: Ptr) => number | bigint) | null = null
let msgBoolObjObj: ((a: Ptr, b: Ptr, c: Ptr, d: Ptr) => boolean) | null = null
let msgAt: ((a: Ptr, b: Ptr, c: number) => Ptr) | null = null
let msgBytes: ((a: Ptr, b: Ptr, c: Buffer, d: number) => Ptr) | null = null
let msgAtObj: ((a: Ptr, b: Ptr, c: number, d: Ptr) => Ptr) | null = null
let NSPasteboard: Ptr = null
let NSString: Ptr = null
let NSURL: Ptr = null
let NSArray: Ptr = null
let NSMutableArray: Ptr = null
let NSData: Ptr = null
let NSAutoreleasePool: Ptr = null
let NSImage: Ptr = null
let NSBitmapImageRep: Ptr = null
let NSDictionary: Ptr = null
const sels: Record<string, Ptr> = {}

if (process.platform === 'darwin') {
  try {
    msgPtr = objcMsgSend('void *', ['void *', 'void *'])
    msgLong = objcMsgSend('long', ['void *', 'void *'])
    msgObj = objcMsgSend('void *', ['void *', 'void *', 'void *'])
    msgVoidObj = objcMsgSend('void', ['void *', 'void *', 'void *'])
    msgBoolObj = objcMsgSend('bool', ['void *', 'void *', 'void *'])
    msgLongObjObj = objcMsgSend('long', ['void *', 'void *', 'void *', 'void *'])
    msgBoolObjObj = objcMsgSend('bool', ['void *', 'void *', 'void *', 'void *'])
    msgAt = objcMsgSend('void *', ['void *', 'void *', 'ulong'])
    msgBytes = objcMsgSend('void *', ['void *', 'void *', 'void *', 'ulong'])
    msgAtObj = objcMsgSend('void *', ['void *', 'void *', 'ulong', 'void *'])
    NSPasteboard = objcClass('NSPasteboard')
    NSString = objcClass('NSString')
    NSURL = objcClass('NSURL')
    NSArray = objcClass('NSArray')
    NSMutableArray = objcClass('NSMutableArray')
    NSData = objcClass('NSData')
    NSAutoreleasePool = objcClass('NSAutoreleasePool')
    NSImage = objcClass('NSImage')
    NSBitmapImageRep = objcClass('NSBitmapImageRep')
    NSDictionary = objcClass('NSDictionary')
    for (const n of [
      'generalPasteboard', 'pasteboardWithName:', 'clearContents', 'writeObjects:', 'pasteboardItems',
      'count', 'array', 'addObject:', 'arrayWithObject:', 'fileURLWithPath:', 'absoluteString',
      'addTypes:owner:', 'setString:forType:', 'types', 'containsObject:', 'changeCount', 'objectAtIndex:',
      'setData:forType:', 'dataWithBytes:length:', 'alloc', 'autorelease', 'initWithData:', 'TIFFRepresentation',
      'imageRepWithData:', 'representationUsingType:properties:', 'dictionary'
    ]) {
      sels[n] = objcSel(n)
    }
    ready = !!(NSPasteboard && NSString && NSURL && NSArray && NSMutableArray && NSData && NSAutoreleasePool)
  } catch (err) {
    console.error('[macPasteboard] ObjC runtime unavailable:', err)
  }
}

const withPool = autoreleasePoolRunner('[macPasteboard]')

function pasteboard(name?: string): Ptr {
  if (!name) return msgPtr!(NSPasteboard, sels.generalPasteboard)
  const nsName = nsString(name)
  return nsName ? msgObj!(NSPasteboard, sels['pasteboardWithName:'], nsName) : null
}

function fileUrl(path: string): Ptr {
  const nsPath = nsString(path)
  return nsPath ? msgObj!(NSURL, sels['fileURLWithPath:'], nsPath) : null
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

export interface ImageData {
  type: string
  bytes: Buffer
}

function tiffFromImageData(data: Ptr): Ptr {
  if (!NSImage) return null
  const allocated = msgPtr!(NSImage, sels.alloc)
  const image = allocated ? msgObj!(allocated, sels['initWithData:'], data) : null
  if (!image) return null
  msgPtr!(image, sels.autorelease)
  return msgPtr!(image, sels.TIFFRepresentation)
}

function pngFromImageData(data: Ptr): Ptr {
  if (!NSBitmapImageRep || !NSDictionary) return null
  const rep = msgObj!(NSBitmapImageRep, sels['imageRepWithData:'], data)
  const props = msgPtr!(NSDictionary, sels.dictionary)
  return rep && props ? msgAtObj!(rep, sels['representationUsingType:properties:'], NS_BITMAP_PNG, props) : null
}

export function writeImageData(
  original: ImageData,
  options: { png?: Buffer; fileUrlPath?: string } = {},
  pasteboardName?: string
): boolean {
  if (!ready || original.bytes.length === 0) return false
  if (original.type !== PNG_TYPE && original.type !== TIFF_TYPE) return false
  return withPool(() => {
    const pb = pasteboard(pasteboardName)
    const source = msgBytes!(NSData, sels['dataWithBytes:length:'], original.bytes, original.bytes.length)
    if (!pb || !source) return false

    const reps: Array<{ name: string; type: Ptr; data: Ptr }> = []
    const addRep = (name: string, data: Ptr): void => {
      const type = data ? nsString(name) : null
      if (type) reps.push({ name, type, data })
    }
    addRep(original.type, source)
    if (reps.length === 0) return false
    if (original.type === PNG_TYPE) {
      addRep(TIFF_TYPE, tiffFromImageData(source))
    } else {
      const fallback = options.png && options.png.length > 0
        ? msgBytes!(NSData, sels['dataWithBytes:length:'], options.png, options.png.length)
        : null
      addRep(PNG_TYPE, pngFromImageData(source) || fallback)
    }

    const url = isWritablePath(options.fileUrlPath) ? fileUrl(options.fileUrlPath) : null
    const urlString = url ? msgPtr!(url, sels.absoluteString) : null
    const urlType = urlString ? nsString(FILE_URL_TYPE) : null

    const typeList = msgPtr!(NSMutableArray, sels.array)
    if (!typeList) return false
    for (const rep of reps) msgVoidObj!(typeList, sels['addObject:'], rep.type)
    if (urlType) msgVoidObj!(typeList, sels['addObject:'], urlType)

    msgLong!(pb, sels.clearContents)
    msgLongObjObj!(pb, sels['addTypes:owner:'], typeList, null)
    for (const rep of reps) {
      if (!msgBoolObjObj!(pb, sels['setData:forType:'], rep.data, rep.type) && rep.name === original.type) return false
    }
    if (urlType) msgBoolObjObj!(pb, sels['setString:forType:'], urlString, urlType)
    return hasType(msgPtr!(pb, sels.types), original.type)
  }, false)
}
