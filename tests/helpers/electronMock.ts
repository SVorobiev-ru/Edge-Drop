import { join } from 'node:path'
import { vi } from 'vitest'

type AnyRecord = Record<string, any>
type Handler = (...args: any[]) => any

export interface FakeAppOptions {
  userData?: string
  appPath?: string
  version?: string
  isPackaged?: boolean
  languages?: string[]
}

export function fakeApp(o: FakeAppOptions = {}, overrides: AnyRecord = {}): AnyRecord {
  const languages = o.languages ?? ['en-US']
  return {
    name: 'Edge-Drop',
    isPackaged: o.isPackaged ?? false,
    getVersion: () => o.version ?? '0.0.0',
    getAppPath: () => o.appPath ?? '/mock/app',
    getPath: () => o.userData ?? '/mock/userData',
    getLocale: () => languages[0] ?? 'en-US',
    getPreferredSystemLanguages: () => languages,
    focus: vi.fn(),
    quit: vi.fn(),
    ...overrides
  }
}

export function userDataApp(root: () => string, overrides: AnyRecord = {}): AnyRecord {
  return {
    isPackaged: false,
    getAppPath: () => join(root(), 'app'),
    getPath: (name: string) => (name === 'userData' ? root() : join(root(), name)),
    ...overrides
  }
}

export interface FakeWindowState {
  windows: AnyRecord[]
  extraWindows?: AnyRecord[]
  sent?: Array<{ channel: string; payload: any }>
  bounds?: { x: number; y: number; width: number; height: number }
  trackBounds?: boolean
  init?: (win: AnyRecord) => void
}

export function fakeBrowserWindowClass(state: FakeWindowState): any {
  class FakeBrowserWindow {
    options: AnyRecord
    bounds = { ...(state.bounds ?? { x: 0, y: 25, width: 384, height: 957 }) }
    openHandler: ((details: { url: string }) => { action: string }) | null = null
    contentsHandlers: Record<string, Handler> = {}
    setFocusable = vi.fn()
    focus = vi.fn()
    isDestroyed = vi.fn(() => false)
    isVisible = vi.fn(() => true)
    isMinimized = vi.fn(() => false)
    showInactive = vi.fn()
    setSkipTaskbar = vi.fn()
    setBounds = vi.fn((b: { x: number; y: number; width: number; height: number }) => {
      if (state.trackBounds) this.bounds = { ...b }
    })
    getBounds = vi.fn(() => ({ ...this.bounds }))
    getContentBounds = vi.fn(() => ({ ...this.bounds }))
    getNativeWindowHandle = vi.fn(() => Buffer.alloc(8))
    hookWindowMessage = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    setAlwaysOnTop = vi.fn()
    setContentProtection = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
    on = vi.fn()
    once = vi.fn()
    webContents = {
      setWindowOpenHandler: vi.fn((fn: (details: { url: string }) => { action: string }) => {
        this.openHandler = fn
      }),
      on: vi.fn((event: string, fn: Handler) => {
        this.contentsHandlers[event] = fn
      }),
      getURL: () => 'file:///mock/app/out/renderer/index.html',
      isDestroyed: () => false,
      isLoadingMainFrame: () => false,
      send: (channel: string, payload: unknown) => {
        state.sent?.push({ channel, payload })
      }
    }

    constructor(options: AnyRecord = {}) {
      this.options = options
      if (state.trackBounds && options.width !== undefined) {
        this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }
      }
      state.windows.push(this as unknown as AnyRecord)
      state.init?.(this as unknown as AnyRecord)
    }

    static getAllWindows(): AnyRecord[] {
      return [...state.windows, ...(state.extraWindows ?? [])]
    }
  }
  return FakeBrowserWindow
}

export function fakeIpcMain(handlers: Map<string, Handler>, listeners?: Map<string, Handler>): AnyRecord {
  return {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: listeners ? (channel: string, fn: Handler) => listeners.set(channel, fn) : vi.fn()
  }
}

export function fakeGlobalShortcut(shortcuts: Map<string, () => void>, refuse: Set<string> = new Set()): AnyRecord {
  return {
    register: (accelerator: string, fn: () => void) => {
      if (refuse.has(accelerator)) return false
      shortcuts.set(accelerator, fn)
      return true
    },
    unregister: (accelerator: string) => {
      shortcuts.delete(accelerator)
    },
    isRegistered: (accelerator: string) => shortcuts.has(accelerator),
    unregisterAll: () => shortcuts.clear()
  }
}

export function fakeEmitter(handlers: Record<string, Handler> | (() => Record<string, Handler>)): AnyRecord {
  const current = typeof handlers === 'function' ? handlers : () => handlers
  return {
    on: (event: string, fn: Handler) => {
      current()[event] = fn
    },
    removeListener: (event: string, fn: Handler) => {
      if (current()[event] === fn) delete current()[event]
    }
  }
}

export function blankImage(): AnyRecord {
  const image: AnyRecord = { isEmpty: () => true, toPNG: () => Buffer.from('png') }
  image.resize = () => image
  return image
}

export function fakeTrayConstructor(trays: AnyRecord[]): any {
  return vi.fn().mockImplementation(function () {
    const tray: AnyRecord = {
      handlers: {} as Record<string, Handler>,
      setToolTip: vi.fn(),
      setIgnoreDoubleClickEvents: vi.fn(),
      setImage: vi.fn(),
      setContextMenu: vi.fn(),
      popUpContextMenu: vi.fn(),
      destroy: vi.fn(),
      isDestroyed: () => false,
      on: (event: string, fn: Handler) => {
        tray.handlers[event] = fn
      }
    }
    trays.push(tray)
    return tray
  })
}

export function recordingMenu(menus: Array<{ template: any[] }>): AnyRecord {
  return {
    buildFromTemplate: (template: any[]) => {
      const menu = { template }
      menus.push(menu)
      return menu
    },
    setApplicationMenu: vi.fn()
  }
}

export interface ElectronMockOptions extends FakeAppOptions {
  app?: AnyRecord
  [piece: string]: unknown
}

const APP_OPTION_KEYS = new Set(['userData', 'appPath', 'version', 'isPackaged', 'languages'])

function isPlainObject(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
}

function mergeKeepingGetters(base: AnyRecord, override: AnyRecord): AnyRecord {
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(base), ...Object.getOwnPropertyDescriptors(override) })
}

export function electronMock(o: ElectronMockOptions = {}): AnyRecord {
  const base: AnyRecord = {
    app: fakeApp(o),
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    screen: {
      on: vi.fn(),
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 }, scaleFactor: 2 }),
      getAllDisplays: () => []
    },
    powerMonitor: { on: vi.fn(), removeListener: vi.fn(), isOnBatteryPower: () => false, getSystemIdleTime: () => 0 },
    globalShortcut: { register: () => true, unregister: vi.fn(), isRegistered: () => false, unregisterAll: vi.fn() },
    Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })), setApplicationMenu: vi.fn() },
    nativeImage: { createEmpty: () => ({ isEmpty: () => true }), createFromPath: () => ({ isEmpty: () => true }) },
    nativeTheme: { themeSource: 'system', shouldUseDarkColors: true, on: vi.fn() },
    shell: { openExternal: vi.fn(() => Promise.resolve()), showItemInFolder: vi.fn() },
    clipboard: { clear: vi.fn(), write: vi.fn(), writeText: vi.fn(), writeImage: vi.fn() },
    ipcMain: { on: vi.fn(), handle: vi.fn() },
    dialog: {},
    net: { fetch: vi.fn() },
    systemPreferences: { isTrustedAccessibilityClient: () => true },
    Notification: class {
      static isSupported = () => false
    }
  }
  for (const [key, value] of Object.entries(o)) {
    if (APP_OPTION_KEYS.has(key)) continue
    base[key] = isPlainObject(base[key]) && isPlainObject(value) ? mergeKeepingGetters(base[key], value) : value
  }
  return base
}
