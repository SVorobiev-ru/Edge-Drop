import koffi from 'koffi'

type Ptr = unknown

export const NS_PRESENTATION_FULLSCREEN = 1 << 10

let msgPtr: ((a: Ptr, b: Ptr) => Ptr) | null = null
let msgULong: ((a: Ptr, b: Ptr) => number | bigint) | null = null
let NSApplication: Ptr = null
let selSharedApplication: Ptr = null
let selPresentationOptions: Ptr = null

if (process.platform === 'darwin') {
  try {
    const objc = koffi.load('/usr/lib/libobjc.A.dylib')
    const getClass = objc.func('void *objc_getClass(const char *name)') as (n: string) => Ptr
    const sel = objc.func('void *sel_registerName(const char *name)') as (n: string) => Ptr
    msgPtr = objc.func('objc_msgSend', 'void *', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => Ptr
    msgULong = objc.func('objc_msgSend', 'unsigned long', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => number | bigint
    NSApplication = getClass('NSApplication')
    selSharedApplication = sel('sharedApplication')
    selPresentationOptions = sel('currentSystemPresentationOptions')
  } catch (err) {
    console.error('[macPresentation] ObjC runtime unavailable:', err)
  }
}

export function systemPresentationOptions(): number | null {
  if (!msgPtr || !msgULong || !NSApplication || !selSharedApplication || !selPresentationOptions) return null
  try {
    const nsApp = msgPtr(NSApplication, selSharedApplication)
    if (!nsApp) return null
    const options = Number(msgULong(nsApp, selPresentationOptions))
    return Number.isFinite(options) ? options : null
  } catch {
    return null
  }
}

export function isFullscreenPresentation(options: number): boolean {
  return (options & NS_PRESENTATION_FULLSCREEN) !== 0
}

export interface PresentationRect {
  x: number
  y: number
  width: number
  height: number
}

export interface OnScreenWindow {
  pid: number
  layer: number
  bounds: PresentationRect
}

const CG_WINDOW_LIST_ON_SCREEN_ONLY = 1 << 0
const CG_WINDOW_LIST_EXCLUDE_DESKTOP = 1 << 4
const CF_STRING_ENCODING_UTF8 = 0x08000100
const FULLSCREEN_EDGE_TOLERANCE_PX = 2
const FULLSCREEN_MIN_COVERAGE = 0.9

let cgWindowList: ((option: number, relativeTo: number) => Ptr) | null = null
let cfReleaseRef: ((ref: Ptr) => void) | null = null
let msgCount: ((a: Ptr, b: Ptr) => number | bigint) | null = null
let msgObjectAtIndex: ((a: Ptr, b: Ptr, c: number) => Ptr) | null = null
let msgObjectForKey: ((a: Ptr, b: Ptr, c: Ptr) => Ptr) | null = null
let msgIntValue: ((a: Ptr, b: Ptr) => number) | null = null
let msgDoubleValue: ((a: Ptr, b: Ptr) => number) | null = null
let selCount: Ptr = null
let selObjectAtIndex: Ptr = null
let selObjectForKey: Ptr = null
let selIntValue: Ptr = null
let selDoubleValue: Ptr = null
const windowKeys: Record<string, Ptr> = {}

if (process.platform === 'darwin') {
  try {
    const objc = koffi.load('/usr/lib/libobjc.A.dylib')
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    const sel = objc.func('void *sel_registerName(const char *name)') as (n: string) => Ptr
    const cfString = cf.func('CFStringCreateWithCString', 'void *', ['void *', 'str', 'uint32']) as unknown as (alloc: Ptr, text: string, encoding: number) => Ptr
    msgCount = objc.func('objc_msgSend', 'unsigned long', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => number | bigint
    msgObjectAtIndex = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'unsigned long']) as unknown as (a: Ptr, b: Ptr, c: number) => Ptr
    msgObjectForKey = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr) => Ptr
    msgIntValue = objc.func('objc_msgSend', 'int', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => number
    msgDoubleValue = objc.func('objc_msgSend', 'double', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => number
    selCount = sel('count')
    selObjectAtIndex = sel('objectAtIndex:')
    selObjectForKey = sel('objectForKey:')
    selIntValue = sel('intValue')
    selDoubleValue = sel('doubleValue')
    for (const key of ['kCGWindowOwnerPID', 'kCGWindowLayer', 'kCGWindowBounds', 'X', 'Y', 'Width', 'Height']) {
      windowKeys[key] = cfString(null, key, CF_STRING_ENCODING_UTF8)
    }
    cfReleaseRef = cf.func('CFRelease', 'void', ['void *']) as unknown as (ref: Ptr) => void
    cgWindowList = cg.func('CGWindowListCopyWindowInfo', 'void *', ['uint32', 'uint32']) as unknown as (option: number, relativeTo: number) => Ptr
  } catch (err) {
    cgWindowList = null
    console.error('[macPresentation] window list unavailable:', err)
  }
}

export function onScreenWindows(): OnScreenWindow[] | null {
  if (!cgWindowList || !cfReleaseRef || !msgCount || !msgObjectAtIndex || !msgObjectForKey || !msgIntValue || !msgDoubleValue) return null
  let list: Ptr = null
  try {
    list = cgWindowList(CG_WINDOW_LIST_ON_SCREEN_ONLY | CG_WINDOW_LIST_EXCLUDE_DESKTOP, 0)
    if (!list) return null
    const count = Number(msgCount(list, selCount))
    const windows: OnScreenWindow[] = []
    for (let i = 0; i < count; i++) {
      const info = msgObjectAtIndex(list, selObjectAtIndex, i)
      if (!info) continue
      const pidRef = msgObjectForKey(info, selObjectForKey, windowKeys.kCGWindowOwnerPID)
      const layerRef = msgObjectForKey(info, selObjectForKey, windowKeys.kCGWindowLayer)
      const boundsRef = msgObjectForKey(info, selObjectForKey, windowKeys.kCGWindowBounds)
      if (!pidRef || !layerRef || !boundsRef) continue
      const side = (key: string): number => {
        const ref = msgObjectForKey!(boundsRef, selObjectForKey, windowKeys[key])
        return ref ? msgDoubleValue!(ref, selDoubleValue) : NaN
      }
      const bounds = { x: side('X'), y: side('Y'), width: side('Width'), height: side('Height') }
      if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) continue
      windows.push({ pid: msgIntValue(pidRef, selIntValue), layer: msgIntValue(layerRef, selIntValue), bounds })
    }
    return windows
  } catch {
    return null
  } finally {
    if (list) {
      try { cfReleaseRef(list) } catch { /* ignore */ }
    }
  }
}

function coversDisplay(win: PresentationRect, display: PresentationRect, exact: boolean): boolean {
  const t = FULLSCREEN_EDGE_TOLERANCE_PX
  if (Math.abs(win.x - display.x) > t) return false
  if (Math.abs(win.width - display.width) > t) return false
  if (Math.abs(win.y + win.height - (display.y + display.height)) > t) return false
  if (exact) return Math.abs(win.y - display.y) <= t
  if (win.y < display.y - t) return false
  return win.height >= display.height * FULLSCREEN_MIN_COVERAGE
}

export function fullscreenDisplayId(
  windows: readonly OnScreenWindow[],
  pid: number,
  displays: ReadonlyArray<{ id: number; bounds: PresentationRect }>
): number | null {
  if (!pid) return null
  const exact = new Set<number>()
  const loose = new Set<number>()
  for (const win of windows) {
    if (win.pid !== pid || win.layer !== 0) continue
    for (const display of displays) {
      if (coversDisplay(win.bounds, display.bounds, true)) exact.add(display.id)
      else if (coversDisplay(win.bounds, display.bounds, false)) loose.add(display.id)
    }
  }
  if (exact.size > 0) return exact.size === 1 ? [...exact][0] : null
  return loose.size === 1 ? [...loose][0] : null
}
