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
let NSWorkspace: Ptr = null
let NSRunningApplication: Ptr = null
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
    for (const n of ['sharedWorkspace', 'frontmostApplication', 'processIdentifier', 'runningApplicationWithProcessIdentifier:', 'activateWithOptions:']) {
      sels[n] = sel(n)
    }
    ready = !!(NSWorkspace && NSRunningApplication)
  } catch (err) {
    console.error('[macNative] ObjC runtime unavailable:', err)
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
