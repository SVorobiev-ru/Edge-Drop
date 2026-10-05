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
let msgBoolPtr: ((a: Ptr, b: Ptr, c: Ptr) => boolean) | null = null
let msgVoidPtr: ((a: Ptr, b: Ptr, c: Ptr) => void) | null = null
let msgBoolPtrULong: ((a: Ptr, b: Ptr, c: Ptr, d: number) => boolean) | null = null
let msgVoid: ((a: Ptr, b: Ptr) => void) | null = null
let cgKeyEvent: ((source: Ptr, keyCode: number, keyDown: boolean) => Ptr) | null = null
let cgSetFlags: ((event: Ptr, flags: number) => void) | null = null
let cgPost: ((tap: number, event: Ptr) => void) | null = null
let cfRelease: ((ref: Ptr) => void) | null = null
let cgPreflightPost: (() => boolean) | null = null
let cgRequestPost: (() => boolean) | null = null
let NSWorkspace: Ptr = null
let NSRunningApplication: Ptr = null
let NSEvent: Ptr = null
let NSApplication: Ptr = null
let NSVisualEffectView: Ptr = null
let msgPtrRect: ((a: Ptr, b: Ptr, r: NativeRect) => Ptr) | null = null
let msgVoidRect: ((a: Ptr, b: Ptr, r: NativeRect) => void) | null = null
let msgVoidLong: ((a: Ptr, b: Ptr, c: number) => void) | null = null
let msgVoidBool: ((a: Ptr, b: Ptr, c: boolean) => void) | null = null
let msgVoidDouble: ((a: Ptr, b: Ptr, c: number) => void) | null = null
let msgVoidULong: ((a: Ptr, b: Ptr, c: number) => void) | null = null
let msgBool: ((a: Ptr, b: Ptr) => boolean) | null = null
let msgAddSubview: ((a: Ptr, b: Ptr, view: Ptr, place: number, relative: Ptr) => void) | null = null
let msgPtrBool: ((a: Ptr, b: Ptr, c: boolean) => Ptr) | null = null
let msgPtrStr: ((a: Ptr, b: Ptr, c: string) => Ptr) | null = null
let NSCursor: Ptr = null
let NSNumber: Ptr = null
let NSString: Ptr = null
let cgsMainConnection: (() => number) | null = null
let cgsSetConnectionProperty: ((cid: number, target: number, key: Ptr, value: Ptr) => number) | null = null
const sels: Record<string, Ptr> = {}

export interface NativeRect {
  x: number
  y: number
  width: number
  height: number
}

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
    try {
      msgBoolPtr = objc.func('objc_msgSend', 'bool', ['void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr) => boolean
      msgVoidPtr = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr) => void
      msgBoolPtrULong = objc.func('objc_msgSend', 'bool', ['void *', 'void *', 'void *', 'unsigned long']) as unknown as (a: Ptr, b: Ptr, c: Ptr, d: number) => boolean
      msgVoid = objc.func('objc_msgSend', 'void', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => void
      NSApplication = getClass('NSApplication')
      for (const n of ['sharedApplication', 'currentApplication', 'respondsToSelector:', 'yieldActivationToApplication:', 'activateFromApplication:options:', 'activate']) {
        sels[n] = sel(n)
      }
    } catch (err) {
      msgBoolPtr = null
      console.error('[macNative] cooperative activation unavailable:', err)
    }
    try {
      koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit')
      const rect = koffi.struct('EdgeDropNSRect', { x: 'double', y: 'double', width: 'double', height: 'double' })
      msgPtrRect = objc.func('objc_msgSend', 'void *', ['void *', 'void *', rect]) as unknown as (a: Ptr, b: Ptr, r: NativeRect) => Ptr
      msgVoidRect = objc.func('objc_msgSend', 'void', ['void *', 'void *', rect]) as unknown as (a: Ptr, b: Ptr, r: NativeRect) => void
      msgVoidLong = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'long']) as unknown as (a: Ptr, b: Ptr, c: number) => void
      msgVoidBool = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'bool']) as unknown as (a: Ptr, b: Ptr, c: boolean) => void
      msgVoidDouble = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'double']) as unknown as (a: Ptr, b: Ptr, c: number) => void
      msgVoidULong = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'unsigned long']) as unknown as (a: Ptr, b: Ptr, c: number) => void
      msgBool = objc.func('objc_msgSend', 'bool', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => boolean
      msgAddSubview = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'void *', 'long', 'void *']) as unknown as (a: Ptr, b: Ptr, view: Ptr, place: number, relative: Ptr) => void
      NSVisualEffectView = getClass('NSVisualEffectView')
      for (const n of ['alloc', 'initWithFrame:', 'window', 'contentView', 'isFlipped', 'setFrame:', 'setMaterial:', 'setBlendingMode:', 'setState:', 'setWantsLayer:', 'layer', 'setCornerRadius:', 'setMasksToBounds:', 'setMaskedCorners:', 'setHidden:', 'setAlphaValue:', 'animator', 'addSubview:positioned:relativeTo:', 'removeFromSuperview', 'release']) {
        sels[n] = sel(n)
      }
    } catch (err) {
      NSVisualEffectView = null
      console.error('[macNative] visual effect view unavailable:', err)
    }
    try {
      msgPtrBool = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'bool']) as unknown as (a: Ptr, b: Ptr, c: boolean) => Ptr
      msgPtrStr = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'const char *']) as unknown as (a: Ptr, b: Ptr, c: string) => Ptr
      NSCursor = getClass('NSCursor')
      NSNumber = getClass('NSNumber')
      NSString = getClass('NSString')
      for (const n of ['resizeLeftRightCursor', 'resizeUpDownCursor', 'arrowCursor', 'set', 'numberWithBool:', 'stringWithUTF8String:']) {
        sels[n] = sel(n)
      }
    } catch (err) {
      NSCursor = null
      console.error('[macNative] cursor unavailable:', err)
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
      cgsMainConnection = cg.func('CGSMainConnectionID', 'int', []) as unknown as () => number
      cgsSetConnectionProperty = cg.func('CGSSetConnectionProperty', 'int', ['int', 'int', 'void *', 'void *']) as unknown as (cid: number, target: number, key: Ptr, value: Ptr) => number
    } catch (err) {
      cgsMainConnection = null
      cgsSetConnectionProperty = null
      console.error('[macNative] background cursor unavailable:', err)
    }
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

function activateCooperatively(target: Ptr): boolean {
  if (!msgPtr || !msgBoolPtr || !msgVoidPtr || !msgBoolPtrULong || !NSApplication) return false
  try {
    const nsApp = msgPtr(NSApplication, sels.sharedApplication)
    const self = msgPtr(NSRunningApplication, sels.currentApplication)
    if (!nsApp || !self) return false
    if (!msgBoolPtr(nsApp, sels['respondsToSelector:'], sels['yieldActivationToApplication:'])) return false
    if (!msgBoolPtr(target, sels['respondsToSelector:'], sels['activateFromApplication:options:'])) return false
    msgVoidPtr(nsApp, sels['yieldActivationToApplication:'], target)
    return !!msgBoolPtrULong(target, sels['activateFromApplication:options:'], self, 0)
  } catch {
    return false
  }
}

/** Bring the app with this PID to the front. */
export function activatePid(pid: number): boolean {
  if (!ready || !pid || !msgPtrInt || !msgBoolULong) return false
  try {
    const app = msgPtrInt(NSRunningApplication, sels['runningApplicationWithProcessIdentifier:'], pid)
    if (!app) return false
    if (activateCooperatively(app)) return true
    // NSApplicationActivateIgnoringOtherApps = 1 << 1
    return !!msgBoolULong(app, sels['activateWithOptions:'], 2)
  } catch {
    return false
  }
}

export function activateSelf(): boolean {
  if (!msgPtr || !msgBoolPtr || !msgVoid || !NSApplication) return false
  try {
    const nsApp = msgPtr(NSApplication, sels.sharedApplication)
    if (!nsApp || !msgBoolPtr(nsApp, sels['respondsToSelector:'], sels.activate)) return false
    msgVoid(nsApp, sels.activate)
    return true
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

export type PanelCursor = 'ew-resize' | 'ns-resize' | null

let cursorInBackground = false

/**
 * Lets the app change the pointer while another app is in front, which the
 * panel opened by hover needs for its resize cursors. Kept on only while a
 * resize grip is under the pointer.
 */
function setCursorInBackground(enabled: boolean): void {
  if (enabled === cursorInBackground || !cgsMainConnection || !cgsSetConnectionProperty || !msgPtrBool || !msgPtrStr) return
  try {
    const cid = cgsMainConnection()
    const key = msgPtrStr(NSString, sels['stringWithUTF8String:'], 'SetsCursorInBackground')
    const value = msgPtrBool(NSNumber, sels['numberWithBool:'], enabled)
    if (key && value) cgsSetConnectionProperty(cid, cid, key, value)
    cursorInBackground = enabled
  } catch (err) {
    cgsSetConnectionProperty = null
    console.error('[macNative] background cursor failed:', err)
  }
}

export function setPanelCursor(kind: PanelCursor): boolean {
  if (!msgPtr || !msgVoid || !NSCursor) return false
  try {
    if (kind) setCursorInBackground(true)
    const name = kind === 'ew-resize' ? 'resizeLeftRightCursor' : kind === 'ns-resize' ? 'resizeUpDownCursor' : 'arrowCursor'
    const cursor = msgPtr(NSCursor, sels[name])
    if (cursor) msgVoid(cursor, sels.set)
    if (!kind) setCursorInBackground(false)
    return true
  } catch (err) {
    console.error('[macNative] cursor failed:', err)
    return false
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

export type VibrancyEdge = 'left' | 'right' | 'top' | 'bottom'

export interface PanelVibrancyOptions {
  frame: NativeRect
  contentHeight: number
  dark: boolean
  edge: VibrancyEdge
  radius: number
}

const NS_WINDOW_BELOW = -1
const MATERIAL_POPOVER = 6
const MATERIAL_HUD = 13
const BLENDING_BEHIND_WINDOW = 0
const STATE_ACTIVE = 1
const CORNERS: Record<VibrancyEdge, number> = { left: 2 | 8, right: 1 | 4, top: 1 | 2, bottom: 4 | 8 }
const VIBRANCY_FADE_MS = 300

let effectView: Ptr = null
let effectHost = 0
let effectHidden = true
let effectFrame = ''
let effectMaterial = -1
let effectCorners = -1
let effectHideTimer: ReturnType<typeof setTimeout> | null = null

function vibrancyAvailable(): boolean {
  return !!(NSVisualEffectView && msgPtr && msgPtrRect && msgVoidRect && msgVoidLong && msgVoidBool && msgVoidDouble && msgVoidULong && msgBool && msgAddSubview && msgVoid)
}

function hostView(handle: Buffer): Ptr {
  if (!msgPtr) return null
  const view = koffi.decode(handle, 'void *') as Ptr
  if (!view) return null
  const window = msgPtr(view, sels.window)
  const content = window ? msgPtr(window, sels.contentView) : null
  return content || view
}

function animateAlpha(view: Ptr, alpha: number): void {
  const animator = msgPtr!(view, sels.animator)
  msgVoidDouble!(animator || view, sels['setAlphaValue:'], alpha)
}

function clearHideTimer(): void {
  if (effectHideTimer !== null) clearTimeout(effectHideTimer)
  effectHideTimer = null
}

function dropEffectView(): void {
  clearHideTimer()
  if (effectView && msgVoid) {
    try {
      msgVoid(effectView, sels.removeFromSuperview)
      msgVoid(effectView, sels.release)
    } catch { /* ignore */ }
  }
  effectView = null
  effectHost = 0
  effectHidden = true
  effectFrame = ''
  effectMaterial = -1
  effectCorners = -1
}

function createEffectView(host: Ptr, frame: NativeRect, radius: number): Ptr {
  const view = msgPtrRect!(msgPtr!(NSVisualEffectView, sels.alloc), sels['initWithFrame:'], frame)
  if (!view) return null
  msgVoidLong!(view, sels['setBlendingMode:'], BLENDING_BEHIND_WINDOW)
  msgVoidLong!(view, sels['setState:'], STATE_ACTIVE)
  msgVoidBool!(view, sels['setHidden:'], true)
  msgVoidDouble!(view, sels['setAlphaValue:'], 0)
  msgVoidBool!(view, sels['setWantsLayer:'], true)
  const layer = msgPtr!(view, sels.layer)
  if (layer) {
    msgVoidDouble!(layer, sels['setCornerRadius:'], radius)
    msgVoidBool!(layer, sels['setMasksToBounds:'], true)
  }
  msgAddSubview!(host, sels['addSubview:positioned:relativeTo:'], view, NS_WINDOW_BELOW, null)
  return view
}

export function showPanelVibrancy(handle: Buffer, options: PanelVibrancyOptions): boolean {
  if (!vibrancyAvailable()) return false
  try {
    const host = hostView(handle)
    if (!host) return false
    const hostAddress = Number(koffi.address(host))
    const { frame, contentHeight, dark, edge, radius } = options
    const flipped = msgBool!(host, sels.isFlipped)
    const nsFrame = {
      x: frame.x,
      y: flipped ? frame.y : contentHeight - frame.y - frame.height,
      width: frame.width,
      height: frame.height
    }
    if (!effectView || effectHost !== hostAddress) {
      dropEffectView()
      effectView = createEffectView(host, nsFrame, radius)
      if (!effectView) return false
      effectHost = hostAddress
    }
    const frameKey = `${nsFrame.x},${nsFrame.y},${nsFrame.width},${nsFrame.height}`
    if (frameKey !== effectFrame) {
      msgVoidRect!(effectView, sels['setFrame:'], nsFrame)
      effectFrame = frameKey
    }
    const material = dark ? MATERIAL_HUD : MATERIAL_POPOVER
    if (material !== effectMaterial) {
      msgVoidLong!(effectView, sels['setMaterial:'], material)
      effectMaterial = material
    }
    const corners = CORNERS[edge]
    if (corners !== effectCorners) {
      const layer = msgPtr!(effectView, sels.layer)
      if (layer) msgVoidULong!(layer, sels['setMaskedCorners:'], corners)
      effectCorners = corners
    }
    if (effectHidden) {
      clearHideTimer()
      msgVoidBool!(effectView, sels['setHidden:'], false)
      animateAlpha(effectView, 1)
      effectHidden = false
    }
    return true
  } catch (err) {
    console.error('[macNative] panel vibrancy failed:', err)
    dropEffectView()
    return false
  }
}

export function hidePanelVibrancy(): void {
  if (!effectView || effectHidden || !vibrancyAvailable()) return
  effectHidden = true
  const view = effectView
  try {
    animateAlpha(view, 0)
  } catch (err) {
    console.error('[macNative] hiding panel vibrancy failed:', err)
  }
  clearHideTimer()
  effectHideTimer = setTimeout(() => {
    effectHideTimer = null
    if (!effectHidden || effectView !== view) return
    try {
      msgVoidBool!(view, sels['setHidden:'], true)
    } catch (err) {
      console.error('[macNative] hiding panel vibrancy failed:', err)
    }
  }, VIBRANCY_FADE_MS)
}
