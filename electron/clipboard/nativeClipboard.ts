import koffi from 'koffi'
import { objcClass, objcMsgSend, objcSel, type Ptr } from '../main/macObjc'

let getSeqNum: (() => number) | null = null
let getPasteboardTypes: (() => string[]) | null = null
let getPasteboardFilePaths: (() => string[]) | null = null
if (process.platform === 'win32') {
  try {
    const user32 = koffi.load('user32.dll')
    getSeqNum = user32.func('uint32 GetClipboardSequenceNumber()')
  } catch (err) {
    console.error('[formats] Failed to load GetClipboardSequenceNumber from user32.dll:', err)
  }
}

// macOS: NSPasteboard.generalPasteboard.changeCount via the ObjC runtime.
// Cheap (no clipboard read) and bumps exactly once per copy — the macOS
// equivalent of GetClipboardSequenceNumber.
if (process.platform === 'darwin') {
  try {
    const msgPtr = objcMsgSend<(a: Ptr, b: Ptr) => Ptr>('void *', ['void *', 'void *'])
    const msgLong = objcMsgSend<(a: Ptr, b: Ptr) => number | bigint>('long', ['void *', 'void *'])
    const msgAt = objcMsgSend<(a: Ptr, b: Ptr, c: number) => Ptr>('void *', ['void *', 'void *', 'ulong'])
    const msgStr = objcMsgSend<(a: Ptr, b: Ptr) => string | null>('str', ['void *', 'void *'])
    const msgObj = objcMsgSend<(a: Ptr, b: Ptr, c: Ptr) => Ptr>('void *', ['void *', 'void *', 'void *'])
    const msgFromUtf8 = objcMsgSend<(a: Ptr, b: Ptr, c: string) => Ptr>('void *', ['void *', 'void *', 'str'])
    const cls = objcClass('NSPasteboard')
    const clsString = objcClass('NSString')
    const clsUrl = objcClass('NSURL')
    const selGeneral = objcSel('generalPasteboard')
    const selCount = objcSel('changeCount')
    const selTypes = objcSel('types')
    const selLength = objcSel('count')
    const selAt = objcSel('objectAtIndex:')
    const selUtf8 = objcSel('UTF8String')
    const selItems = objcSel('pasteboardItems')
    const selStringForType = objcSel('stringForType:')
    const selFromUtf8 = objcSel('stringWithUTF8String:')
    const selUrlWithString = objcSel('URLWithString:')
    const selPath = objcSel('path')
    if (cls && selGeneral && selCount) {
      getSeqNum = () => {
        const pb = msgPtr(cls, selGeneral)
        return pb ? Number(msgLong(pb, selCount)) + 1 : 0
      }
    }
    if (cls && selGeneral && selTypes && selLength && selAt && selUtf8) {
      getPasteboardTypes = () => {
        const pb = msgPtr(cls, selGeneral)
        const arr = pb ? msgPtr(pb, selTypes) : null
        if (!arr) return []
        const n = Number(msgLong(arr, selLength))
        const out: string[] = []
        for (let i = 0; i < n; i++) {
          const item = msgAt(arr, selAt, i)
          const name = item ? msgStr(item, selUtf8) : null
          if (typeof name === 'string' && name) out.push(name)
        }
        return out
      }
    }
    if (cls && clsString && clsUrl && selGeneral && selItems && selLength && selAt && selUtf8 && selStringForType && selFromUtf8 && selUrlWithString && selPath) {
      getPasteboardFilePaths = () => {
        const pb = msgPtr(cls, selGeneral)
        const items = pb ? msgPtr(pb, selItems) : null
        const type = items ? msgFromUtf8(clsString, selFromUtf8, 'public.file-url') : null
        if (!items || !type) return []
        const n = Number(msgLong(items, selLength))
        const out: string[] = []
        for (let i = 0; i < n; i++) {
          const item = msgAt(items, selAt, i)
          const raw = item ? msgObj(item, selStringForType, type) : null
          const rawText = raw ? msgStr(raw, selUtf8) : null
          if (typeof rawText !== 'string' || !/^file:/i.test(rawText)) continue
          const url = msgObj(clsUrl, selUrlWithString, raw)
          const nsPath = url ? msgPtr(url, selPath) : null
          const path = nsPath ? msgStr(nsPath, selUtf8) : null
          if (typeof path === 'string' && path.startsWith('/')) out.push(path)
        }
        return out
      }
    }
  } catch (err) {
    console.error('[formats] NSPasteboard changeCount unavailable, falling back to signature polling:', err)
  }
}

export function getClipboardSequenceNumber(): number {
  if (getSeqNum) {
    try {
      return getSeqNum()
    } catch {
      return 0
    }
  }
  return 0
}

export function clipboardSequenceAvailable(): boolean {
  return getClipboardSequenceNumber() > 0
}

export function macPasteboardTypes(): string[] | null {
  if (process.platform !== 'darwin' || !getPasteboardTypes) return null
  try {
    return getPasteboardTypes()
  } catch {
    return null
  }
}

export function macNativeFilePaths(): string[] | null {
  if (process.platform !== 'darwin' || !getPasteboardFilePaths) return null
  try {
    return getPasteboardFilePaths()
  } catch {
    return null
  }
}
