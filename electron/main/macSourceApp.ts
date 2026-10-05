import koffi from 'koffi'
import { basename } from 'node:path'
import type { AppInfo } from '../../shared/types'

type Ptr = unknown
type Rect = { x: number; y: number; width: number; height: number }

export interface FrontmostApp {
  bundleId: string
  name: string
  pid: number
}

const REGULAR_ACTIVATION_POLICY = 0
const NS_BITMAP_PNG = 4

let ready = false
let msgPtr: ((a: Ptr, b: Ptr) => Ptr) | null = null
let msgVoid: ((a: Ptr, b: Ptr) => void) | null = null
let msgInt: ((a: Ptr, b: Ptr) => number) | null = null
let msgLong: ((a: Ptr, b: Ptr) => number | bigint) | null = null
let msgStr: ((a: Ptr, b: Ptr) => string | null) | null = null
let msgObj: ((a: Ptr, b: Ptr, c: Ptr) => Ptr) | null = null
let msgFromUtf8: ((a: Ptr, b: Ptr, c: string) => Ptr) | null = null
let msgAt: ((a: Ptr, b: Ptr, c: number) => Ptr) | null = null
let msgRectImage: ((a: Ptr, b: Ptr, c: Rect, d: Ptr, e: Ptr) => Ptr) | null = null
let msgAtObj: ((a: Ptr, b: Ptr, c: number, d: Ptr) => Ptr) | null = null
let msgGetBytes: ((a: Ptr, b: Ptr, c: Buffer, d: number) => void) | null = null
let NSWorkspace: Ptr = null
let NSBundle: Ptr = null
let NSString: Ptr = null
let NSFileManager: Ptr = null
let NSAutoreleasePool: Ptr = null
let NSBitmapImageRep: Ptr = null
let NSDictionary: Ptr = null
const sels: Record<string, Ptr> = {}

if (process.platform === 'darwin') {
  try {
    const objc = koffi.load('/usr/lib/libobjc.A.dylib')
    const getClass = objc.func('void *objc_getClass(const char *name)') as (n: string) => Ptr
    const sel = objc.func('void *sel_registerName(const char *name)') as (n: string) => Ptr
    msgPtr = objc.func('objc_msgSend', 'void *', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => Ptr
    msgVoid = objc.func('objc_msgSend', 'void', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => void
    msgInt = objc.func('objc_msgSend', 'int', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => number
    msgLong = objc.func('objc_msgSend', 'long', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => number | bigint
    msgStr = objc.func('objc_msgSend', 'str', ['void *', 'void *']) as unknown as (a: Ptr, b: Ptr) => string | null
    msgObj = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Ptr) => Ptr
    msgFromUtf8 = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'str']) as unknown as (a: Ptr, b: Ptr, c: string) => Ptr
    msgAt = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'ulong']) as unknown as (a: Ptr, b: Ptr, c: number) => Ptr
    const rect = koffi.struct({ x: 'double', y: 'double', width: 'double', height: 'double' })
    msgRectImage = objc.func('objc_msgSend', 'void *', ['void *', 'void *', koffi.pointer(rect), 'void *', 'void *']) as unknown as (a: Ptr, b: Ptr, c: Rect, d: Ptr, e: Ptr) => Ptr
    msgAtObj = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'ulong', 'void *']) as unknown as (a: Ptr, b: Ptr, c: number, d: Ptr) => Ptr
    msgGetBytes = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'void *', 'ulong']) as unknown as (a: Ptr, b: Ptr, c: Buffer, d: number) => void
    NSWorkspace = getClass('NSWorkspace')
    NSBundle = getClass('NSBundle')
    NSString = getClass('NSString')
    NSFileManager = getClass('NSFileManager')
    NSAutoreleasePool = getClass('NSAutoreleasePool')
    NSBitmapImageRep = getClass('NSBitmapImageRep')
    NSDictionary = getClass('NSDictionary')
    for (const n of [
      'new', 'drain', 'sharedWorkspace', 'frontmostApplication', 'runningApplications', 'bundleIdentifier',
      'localizedName', 'processIdentifier', 'activationPolicy', 'count', 'objectAtIndex:', 'UTF8String',
      'stringWithUTF8String:', 'URLForApplicationWithBundleIdentifier:', 'path', 'bundleWithPath:', 'mainBundle',
      'defaultManager', 'displayNameAtPath:', 'iconForFile:', 'CGImageForProposedRect:context:hints:', 'alloc',
      'initWithCGImage:', 'autorelease', 'representationUsingType:properties:', 'dictionary', 'length', 'getBytes:length:'
    ]) {
      sels[n] = sel(n)
    }
    ready = !!(NSWorkspace && NSBundle && NSString && NSFileManager && NSAutoreleasePool)
  } catch (err) {
    console.error('[macSourceApp] ObjC runtime unavailable:', err)
  }
}

function withPool<T>(fn: () => T, fallback: T): T {
  let pool: Ptr = null
  try {
    pool = msgPtr!(NSAutoreleasePool, sels.new)
    return fn()
  } catch (err) {
    console.error('[macSourceApp] ObjC call failed:', err)
    return fallback
  } finally {
    if (pool) {
      try {
        msgVoid!(pool, sels.drain)
      } catch (err) {
        console.error('[macSourceApp] autorelease pool drain failed:', err)
      }
    }
  }
}

function nsString(value: string): Ptr {
  return msgFromUtf8!(NSString, sels['stringWithUTF8String:'], value)
}

function jsString(ns: Ptr): string {
  if (!ns) return ''
  const value = msgStr!(ns, sels.UTF8String)
  return typeof value === 'string' ? value : ''
}

function isUsableString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
}

function describeRunningApp(app: Ptr): FrontmostApp | null {
  if (!app) return null
  const bundleId = jsString(msgPtr!(app, sels.bundleIdentifier))
  if (!bundleId) return null
  return {
    bundleId,
    name: jsString(msgPtr!(app, sels.localizedName)) || bundleId,
    pid: Number(msgInt!(app, sels.processIdentifier)) || 0
  }
}

export function frontmostApp(): FrontmostApp | null {
  if (!ready) return null
  return withPool(() => {
    const ws = msgPtr!(NSWorkspace, sels.sharedWorkspace)
    return ws ? describeRunningApp(msgPtr!(ws, sels.frontmostApplication)) : null
  }, null)
}

export function listRunningApps(): AppInfo[] {
  if (!ready) return []
  return withPool(() => {
    const ws = msgPtr!(NSWorkspace, sels.sharedWorkspace)
    const apps = ws ? msgPtr!(ws, sels.runningApplications) : null
    if (!apps) return []
    const count = Number(msgLong!(apps, sels.count))
    const byId = new Map<string, AppInfo>()
    for (let i = 0; i < count; i++) {
      const app = msgAt!(apps, sels['objectAtIndex:'], i)
      if (!app || Number(msgLong!(app, sels.activationPolicy)) !== REGULAR_ACTIVATION_POLICY) continue
      const info = describeRunningApp(app)
      if (info && !byId.has(info.bundleId)) byId.set(info.bundleId, { bundleId: info.bundleId, name: info.name })
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [])
}

export function appPathForBundleId(bundleId: string): string | null {
  if (!ready || !isUsableString(bundleId)) return null
  return withPool(() => {
    const ws = msgPtr!(NSWorkspace, sels.sharedWorkspace)
    const id = nsString(bundleId)
    const url = ws && id ? msgObj!(ws, sels['URLForApplicationWithBundleIdentifier:'], id) : null
    const path = url ? jsString(msgPtr!(url, sels.path)) : ''
    return path.startsWith('/') ? path : null
  }, null)
}

export function appIconPng(bundleId: string, points: number): Buffer | null {
  if (!ready || !NSBitmapImageRep || !NSDictionary || !isUsableString(bundleId)) return null
  return withPool(() => {
    const ws = msgPtr!(NSWorkspace, sels.sharedWorkspace)
    const id = nsString(bundleId)
    const url = ws && id ? msgObj!(ws, sels['URLForApplicationWithBundleIdentifier:'], id) : null
    const path = url ? msgPtr!(url, sels.path) : null
    const icon = path ? msgObj!(ws, sels['iconForFile:'], path) : null
    if (!icon) return null
    const image = msgRectImage!(icon, sels['CGImageForProposedRect:context:hints:'], { x: 0, y: 0, width: points, height: points }, null, null)
    if (!image) return null
    const allocated = msgPtr!(NSBitmapImageRep, sels.alloc)
    const rep = allocated ? msgObj!(allocated, sels['initWithCGImage:'], image) : null
    if (!rep) return null
    msgPtr!(rep, sels.autorelease)
    const props = msgPtr!(NSDictionary, sels.dictionary)
    const data = props ? msgAtObj!(rep, sels['representationUsingType:properties:'], NS_BITMAP_PNG, props) : null
    const length = data ? Number(msgLong!(data, sels.length)) : 0
    if (!length) return null
    const png = Buffer.alloc(length)
    msgGetBytes!(data, sels['getBytes:length:'], png, length)
    return png
  }, null)
}

export function appInfoForPath(appPath: string): AppInfo | null {
  if (!ready || !isUsableString(appPath) || !appPath.startsWith('/')) return null
  return withPool(() => {
    const nsPath = nsString(appPath)
    const bundle = nsPath ? msgObj!(NSBundle, sels['bundleWithPath:'], nsPath) : null
    const bundleId = bundle ? jsString(msgPtr!(bundle, sels.bundleIdentifier)) : ''
    if (!bundleId) return null
    const fm = msgPtr!(NSFileManager, sels.defaultManager)
    const display = fm ? jsString(msgObj!(fm, sels['displayNameAtPath:'], nsPath)) : ''
    const name = (display || basename(appPath)).replace(/\.app$/i, '') || bundleId
    return { bundleId, name }
  }, null)
}

export function ownBundleId(): string | null {
  if (!ready) return null
  return withPool(() => {
    const bundle = msgPtr!(NSBundle, sels.mainBundle)
    return (bundle ? jsString(msgPtr!(bundle, sels.bundleIdentifier)) : '') || null
  }, null)
}
