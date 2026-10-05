import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

type RunningApp = { bundleId: string | null; name: string | null; pid: number; policy: number }

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  bridgeBroken: false,
  missingClass: '',
  throwOn: '',
  calls: [] as string[],
  frontmost: null as null | { bundleId: string | null; name: string | null; pid: number; policy: number },
  running: [] as Array<{ bundleId: string | null; name: string | null; pid: number; policy: number }>,
  installed: {} as Record<string, string>,
  bundles: {} as Record<string, { bundleId: string | null; displayName: string }>,
  mainBundleId: 'com.edgedrop.app' as string | null,
  iconRects: [] as unknown[]
}))

function send(obj: any, sel: string, a?: any, b?: any): unknown {
  mocks.calls.push(sel)
  if (sel === mocks.throwOn) throw new Error('objc call failed')
  switch (sel) {
    case 'new':
      return 'pool'
    case 'drain':
      return undefined
    case 'sharedWorkspace':
      return 'workspace'
    case 'defaultManager':
      return 'fileManager'
    case 'frontmostApplication':
      return mocks.frontmost
    case 'runningApplications':
      return mocks.running
    case 'count':
      return (obj as unknown[]).length
    case 'objectAtIndex:':
      return (obj as unknown[])[a as number]
    case 'activationPolicy':
      return (obj as RunningApp).policy
    case 'processIdentifier':
      return (obj as RunningApp).pid
    case 'bundleIdentifier':
      return (obj as { bundleId: string | null }).bundleId === null ? null : { str: (obj as { bundleId: string }).bundleId }
    case 'localizedName':
      return (obj as RunningApp).name === null ? null : { str: (obj as RunningApp).name }
    case 'UTF8String':
      return (obj as { str: string }).str
    case 'stringWithUTF8String:':
      return { str: a as string }
    case 'URLForApplicationWithBundleIdentifier:': {
      const path = mocks.installed[(a as { str: string }).str]
      return path ? { path } : null
    }
    case 'path':
      return { str: (obj as { path: string }).path }
    case 'bundleWithPath:':
      return mocks.bundles[(a as { str: string }).str] ?? null
    case 'mainBundle':
      return { bundleId: mocks.mainBundleId }
    case 'displayNameAtPath:':
      return { str: mocks.bundles[(a as { str: string }).str]?.displayName ?? '' }
    case 'iconForFile:':
      return { icon: (a as { str: string }).str }
    case 'CGImageForProposedRect:context:hints:':
      mocks.iconRects.push(a)
      return { cg: (obj as { icon: string }).icon }
    case 'alloc':
      return { alloc: obj }
    case 'initWithCGImage:':
      return { rep: (a as { cg: string }).cg }
    case 'autorelease':
      return obj
    case 'dictionary':
      return {}
    case 'representationUsingType:properties:':
      return { png: Buffer.from(`png:${(obj as { rep: string }).rep}:${a}`) }
    case 'length':
      return (obj as { png: Buffer }).png.length
    case 'getBytes:length:':
      ;(obj as { png: Buffer }).png.copy(a as Buffer, 0, 0, b as number)
      return undefined
  }
  return null
}

vi.mock('koffi', () => ({
  default: {
    struct: () => 'rect',
    pointer: () => 'rect *',
    load: (path: string) => {
      mocks.load(path)
      if (mocks.bridgeBroken) throw new Error('no objc runtime')
      return {
        func: (decl: string) => {
          if (decl.includes('objc_getClass')) return (name: string) => (name === mocks.missingClass ? null : name)
          if (decl.includes('sel_registerName')) return (name: string) => name
          return send
        }
      }
    }
  }
}))

type Mod = typeof import('../electron/main/macSourceApp')

async function loadModule(platform = 'darwin'): Promise<Mod> {
  setPlatform(platform)
  vi.resetModules()
  const mod = await import('../electron/main/macSourceApp')
  mocks.calls = []
  return mod
}

function expectAllEmpty(mod: Mod): void {
  expect(mod.frontmostApp()).toBeNull()
  expect(mod.listRunningApps()).toEqual([])
  expect(mod.appPathForBundleId('com.apple.Safari')).toBeNull()
  expect(mod.appInfoForPath('/Applications/Safari.app')).toBeNull()
  expect(mod.ownBundleId()).toBeNull()
  expect(mod.appIconPng('com.apple.Safari', 32)).toBeNull()
}

beforeEach(() => {
  mocks.load.mockReset()
  mocks.bridgeBroken = false
  mocks.missingClass = ''
  mocks.throwOn = ''
  mocks.calls = []
  mocks.frontmost = { bundleId: 'com.apple.Safari', name: 'Safari', pid: 4242, policy: 0 }
  mocks.running = [
    { bundleId: 'com.apple.Terminal', name: 'Terminal', pid: 1, policy: 0 },
    { bundleId: 'com.apple.Safari', name: 'Safari', pid: 2, policy: 0 },
    { bundleId: 'com.apple.dock', name: 'Dock', pid: 3, policy: 1 },
    { bundleId: 'com.apple.Safari', name: 'Safari', pid: 4, policy: 0 },
    { bundleId: null, name: 'Nameless helper', pid: 5, policy: 0 },
    { bundleId: 'com.example.agent', name: 'Agent', pid: 6, policy: 2 },
    { bundleId: 'com.apple.finder', name: 'Finder', pid: 7, policy: 0 }
  ]
  mocks.installed = { 'com.apple.Safari': '/Applications/Safari.app' }
  mocks.bundles = { '/Applications/Safari.app': { bundleId: 'com.apple.Safari', displayName: 'Safari.app' } }
  mocks.mainBundleId = 'com.edgedrop.app'
  mocks.iconRects = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  restorePlatform()
})

afterAll(() => {
  restorePlatform()
})

describe('macSourceApp', () => {
  it('describes the frontmost application inside an autorelease pool', async () => {
    const { frontmostApp } = await loadModule()

    expect(frontmostApp()).toEqual({ bundleId: 'com.apple.Safari', name: 'Safari', pid: 4242 })
    expect(mocks.load).toHaveBeenCalledWith('/usr/lib/libobjc.A.dylib')
    expect(mocks.calls[0]).toBe('new')
    expect(mocks.calls.at(-1)).toBe('drain')
  })

  it('returns null when nothing is in front or the app has no bundle id', async () => {
    const { frontmostApp } = await loadModule()

    mocks.frontmost = null
    expect(frontmostApp()).toBeNull()
    mocks.frontmost = { bundleId: null, name: 'Script', pid: 9, policy: 0 }
    expect(frontmostApp()).toBeNull()
  })

  it('falls back to the bundle id when the app has no localized name', async () => {
    const { frontmostApp } = await loadModule()
    mocks.frontmost = { bundleId: 'com.example.tool', name: null, pid: 9, policy: 0 }

    expect(frontmostApp()).toEqual({ bundleId: 'com.example.tool', name: 'com.example.tool', pid: 9 })
  })

  it('lists regular apps only, deduped and sorted by name', async () => {
    const { listRunningApps } = await loadModule()

    expect(listRunningApps()).toEqual([
      { bundleId: 'com.apple.finder', name: 'Finder' },
      { bundleId: 'com.apple.Safari', name: 'Safari' },
      { bundleId: 'com.apple.Terminal', name: 'Terminal' }
    ])
  })

  it('resolves the application path of a bundle id', async () => {
    const { appPathForBundleId } = await loadModule()

    expect(appPathForBundleId('com.apple.Safari')).toBe('/Applications/Safari.app')
    expect(appPathForBundleId('com.missing.app')).toBeNull()
    expect(appPathForBundleId('')).toBeNull()
    expect(appPathForBundleId('bad\0id')).toBeNull()
  })

  it('reads the bundle id and display name of an application path', async () => {
    const { appInfoForPath } = await loadModule()

    expect(appInfoForPath('/Applications/Safari.app')).toEqual({ bundleId: 'com.apple.Safari', name: 'Safari' })
    expect(appInfoForPath('/Applications/Missing.app')).toBeNull()
    expect(appInfoForPath('relative/Safari.app')).toBeNull()
    expect(appInfoForPath('')).toBeNull()
  })

  it('falls back to the file name when there is no display name', async () => {
    const { appInfoForPath } = await loadModule()
    mocks.bundles['/Apps/My Tool.app'] = { bundleId: 'com.example.tool', displayName: '' }

    expect(appInfoForPath('/Apps/My Tool.app')).toEqual({ bundleId: 'com.example.tool', name: 'My Tool' })
  })

  it('renders the workspace icon of an installed app as png bytes', async () => {
    const { appIconPng } = await loadModule()

    expect(appIconPng('com.apple.Safari', 32)?.toString()).toBe('png:/Applications/Safari.app:4')
    expect(mocks.iconRects).toEqual([{ x: 0, y: 0, width: 32, height: 32 }])
    expect(mocks.calls.at(-1)).toBe('drain')
    expect(appIconPng('com.missing.app', 32)).toBeNull()
    expect(appIconPng('', 32)).toBeNull()
  })

  it('reports the bundle id of the running app', async () => {
    const { ownBundleId } = await loadModule()

    expect(ownBundleId()).toBe('com.edgedrop.app')
    mocks.mainBundleId = null
    expect(ownBundleId()).toBeNull()
  })

  it('returns null or an empty list off darwin without loading koffi', async () => {
    const mod = await loadModule('win32')

    expectAllEmpty(mod)
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('returns null or an empty list when koffi cannot load the runtime', async () => {
    mocks.bridgeBroken = true
    expectAllEmpty(await loadModule())
  })

  it('returns null or an empty list when a class is missing', async () => {
    mocks.missingClass = 'NSWorkspace'
    expectAllEmpty(await loadModule())
  })

  it('survives a failing ObjC call and still drains the pool', async () => {
    const mod = await loadModule()
    mocks.throwOn = 'sharedWorkspace'

    expect(mod.frontmostApp()).toBeNull()
    expect(mod.listRunningApps()).toEqual([])
    expect(mod.appPathForBundleId('com.apple.Safari')).toBeNull()
    expect(mocks.calls.at(-1)).toBe('drain')
  })
})
