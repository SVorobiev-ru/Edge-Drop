/**
 * Tiny macOS native helpers via the Objective-C runtime (koffi).
 * Used to remember which app the user was working in and hand focus back to
 * it after the shelf took keyboard focus (search typing) — the macOS
 * equivalent of GetForegroundWindow / SetForegroundWindow on Windows.
 */
import koffi from 'koffi'

type Ptr = unknown
let ready = false
let msgPtr: ((a: Ptr, b: Ptr) => Ptr) | null = null
let msgInt: ((a: Ptr, b: Ptr) => number) | null = null
let msgPtrInt: ((a: Ptr, b: Ptr, c: number) => Ptr) | null = null
let msgBoolULong: ((a: Ptr, b: Ptr, c: number) => boolean) | null = null
let msgULong: ((a: Ptr, b: Ptr) => number | bigint) | null = null
let cgKeyEvent: ((source: Ptr, keyCode: number, keyDown: boolean) => Ptr) | null = null
let cgSetFlags: ((event: Ptr, flags: number) => void) | null = null
let cgPost: ((tap: number, event: Ptr) => void) | null = null
let cfRelease: ((ref: Ptr) => void) | null = null
let cgPreflightPost: (() => boolean) | null = null
let cgRequestPost: (() => boolean) | null = null
let NSWorkspace: Ptr = null
let NSRunningApplication: Ptr = null
let NSEvent: Ptr = null
const sels: Record<string, Ptr> = {}

if (process.platform === 'darwin') {
  try {
    const objc = koffi.load('/usr/lib/libobjc.A.dylib')
    const getClass = objc.func('void *objc_getClass(const char *name)') as (n: string) => Ptr
    const sel = objc.func('void *sel_registerName(const char *name)') as (n: string) => Ptr
    msgPtr = objc.func('objc_msgSend', 'void *', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => Ptr
    msgInt = objc.func('objc_msgSend', 'int', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => number
    msgPtrInt = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'int']) as unknown as (a: Ptr, b: Ptr, c: number) => Ptr
    msgBoolULong = objc.func('objc_msgSend', 'bool', ['void *', 'void *', 'unsigned long']) as unknown as (a: Ptr, b: Ptr, c: number) => boolean
    NSWorkspace = getClass('NSWorkspace')
    NSRunningApplication = getClass('NSRunningApplication')
    msgULong = objc.func('objc_msgSend', 'unsigned long', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => number | bigint
    NSEvent = getClass('NSEvent')
    for (const n of ['sharedWorkspace', 'frontmostApplication', 'processIdentifier', 'runningApplicationWithProcessIdentifier:', 'activateWithOptions:', 'pressedMouseButtons']) {
      sels[n] = sel(n)
    }
    ready = !!(NSWorkspace && NSRunningApplication)
  } catch (err) {
    console.error('[macNative] ObjC runtime unavailable:', err)
  }
  try {
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    cgKeyEvent = cg.func('CGEventCreateKeyboardEvent', 'void *', ['void *', 'uint16', 'bool']) as unknown as (source: Ptr, keyCode: number, keyDown: boolean) => Ptr
    cgSetFlags = cg.func('CGEventSetFlags', 'void', ['void *', 'uint64']) as unknown as (event: Ptr, flags: number) => void
    cgPost = cg.func('CGEventPost', 'void', ['uint32', 'void *']) as unknown as (tap: number, event: Ptr) => void
    cfRelease = cg.func('CFRelease', 'void', ['void *']) as unknown as (ref: Ptr) => void
    try {
      cgPreflightPost = cg.func('CGPreflightPostEventAccess', 'bool', []) as unknown as () => boolean
      cgRequestPost = cg.func('CGRequestPostEventAccess', 'bool', []) as unknown as () => boolean
    } catch (err) {
      cgPreflightPost = null
      cgRequestPost = null
      console.error('[macNative] post-event access checks unavailable:', err)
    }
  } catch (err) {
    console.error('[macNative] CoreGraphics unavailable:', err)
  }
}

/** PID of the app currently in front (0 when unknown). */
export function frontmostPid(): number {
  if (!ready || !msgPtr || !msgInt) return 0
  try {
    const ws = msgPtr(NSWorkspace, sels.sharedWorkspace)
    if (!ws) return 0
    const app = msgPtr(ws, sels.frontmostApplication)
    if (!app) return 0
    return msgInt(app, sels.processIdentifier) || 0
  } catch {
    return 0
  }
}

/** Bring the app with this PID to the front. */
export function activatePid(pid: number): boolean {
  if (!ready || !pid || !msgPtrInt || !msgBoolULong) return false
  try {
    const app = msgPtrInt(NSRunningApplication, sels['runningApplicationWithProcessIdentifier:'], pid)
    if (!app) return false
    // NSApplicationActivateIgnoringOtherApps = 1 << 1
    return !!msgBoolULong(app, sels['activateWithOptions:'], 2)
  } catch {
    return false
  }
}

export function weAreFrontmost(): boolean {
  const pid = frontmostPid()
  return pid !== 0 && pid === process.pid
}

export function mouseButtonsAvailable(): boolean {
  return !!(msgULong && NSEvent && sels.pressedMouseButtons)
}

export function pressedMouseButtons(): number {
  if (!msgULong || !NSEvent) return 0
  try {
    return Number(msgULong(NSEvent, sels.pressedMouseButtons)) || 0
  } catch {
    return 0
  }
}

export function canPostEvents(): boolean {
  if (!cgPreflightPost) return true
  try {
    return !!cgPreflightPost()
  } catch (err) {
    console.error('[macNative] CGPreflightPostEventAccess failed:', err)
    return true
  }
}

export function requestPostEvents(): boolean {
  if (!cgRequestPost) return true
  try {
    return !!cgRequestPost()
  } catch (err) {
    console.error('[macNative] CGRequestPostEventAccess failed:', err)
    return true
  }
}

export function postCommandV(): boolean {
  if (!cgKeyEvent || !cgSetFlags || !cgPost || !cfRelease) return false
  const events: Ptr[] = []
  const releaseAll = (): void => {
    for (const event of events) {
      try {
        cfRelease?.(event)
      } catch (err) {
        console.error('[macNative] CFRelease failed:', err)
      }
    }
  }
  try {
    for (const keyDown of [true, false]) {
      const event = cgKeyEvent(null, 9, keyDown)
      if (!event) {
        releaseAll()
        return false
      }
      events.push(event)
    }
    for (const event of events) cgSetFlags(event, 0x100000)
    cgPost(0, events[0])
  } catch {
    releaseAll()
    return false
  }
  try {
    cgPost(0, events[1])
  } catch (err) {
    console.error('[macNative] Cmd+V key-up post failed:', err)
  }
  releaseAll()
  return true
}
