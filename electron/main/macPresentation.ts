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
