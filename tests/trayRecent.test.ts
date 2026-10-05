import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipboardItem } from '../shared/types'
import { restorePlatform, setPlatform } from './helpers/platform'

type Handler = (...args: unknown[]) => void
type MenuEntry = Record<string, any>

const mocks = vi.hoisted(() => ({
  trays: [] as Array<{ handlers: Record<string, Handler>; popUpContextMenu: ReturnType<typeof vi.fn> }>,
  menus: [] as Array<{ template: Array<Record<string, any>> }>,
  items: [] as any[],
  fullText: {} as Record<string, string>,
  settings: { language: 'en', toggleHotkey: 'Alt+C', incognito: false, hoverActivation: true, stickPosition: 'left' } as Record<string, unknown>,
  interactive: false,
  calls: [] as string[],
  written: [] as any[],
  pasted: [] as Array<{ id: string; opts: unknown }>,
  pasteResult: true,
  installMacAppMenu: vi.fn()
}))

vi.mock('electron', async () => {
  const { blankImage, electronMock, fakeTrayConstructor, recordingMenu } = await import('./helpers/electronMock')
  const image = blankImage()
  return electronMock({
    app: { focus: () => mocks.calls.push('app.focus') },
    Tray: fakeTrayConstructor(mocks.trays),
    Menu: recordingMenu(mocks.menus),
    Notification: Object.assign(vi.fn(), { isSupported: () => false }),
    nativeImage: { createFromPath: () => image, createFromBuffer: () => image, createEmpty: () => image }
  })
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: (p: string) => p === '/mock/index.json' }
})

vi.mock('../electron/store/paths', async () => (await import('./helpers/pathsMock')).pathsModuleMock({ PATHS: { indexFile: () => '/mock/index.json' } }))

vi.mock('../electron/store/settings', async () => (await import('./helpers/settingsMock')).settingsModuleMock(mocks))

vi.mock('../electron/main/window', () => ({
  getMainWindow: () => ({ focus: () => mocks.calls.push('win.focus'), isDestroyed: () => false }),
  setVisible: (v: boolean) => mocks.calls.push(`setVisible(${v})`),
  repositionWindow: vi.fn(),
  getDisplayListOptions: () => [],
  registerWindowRepositionListener: vi.fn(),
  popUpAndRetract: vi.fn(),
  markExplicitOpen: () => mocks.calls.push('markExplicitOpen'),
  isInteractive: () => mocks.interactive,
  resolvePasteTarget: async (delay: number) => {
    mocks.calls.push(`resolvePasteTarget(${delay})`)
    return delay
  }
}))

vi.mock('../electron/main/state', () => ({
  pushState: {
    togglePanel: (open?: boolean, meta?: { source?: string }) => mocks.calls.push(meta ? `togglePanel(${open}, ${meta.source})` : `togglePanel(${open})`),
    openSettings: () => mocks.calls.push('openSettings'),
    settings: vi.fn(),
    items: () => mocks.calls.push('pushItems')
  },
  getStore: () => ({
    list: () => mocks.items,
    get: (id: string) => mocks.items.find((item) => item.id === id),
    getFullText: (id: string) => mocks.fullText[id] ?? '',
    touch: (id: string) => mocks.calls.push(`touch(${id})`)
  }),
  getWatcher: () => ({
    setPaused: (v: boolean) => mocks.calls.push(`watcher.setPaused(${v})`),
    resyncSignature: () => mocks.calls.push('watcher.resync'),
    noteSelfWrite: () => {}
  })
}))

vi.mock('../electron/main/macAppMenu', () => ({
  installMacAppMenu: () => mocks.installMacAppMenu()
}))

vi.mock('../electron/main/ipc', () => ({
  pasteItemById: async (id: string, opts: unknown) => {
    mocks.pasted.push({ id, opts })
    mocks.calls.push(`pasteItemById(${id})`)
    return mocks.pasteResult
  }
}))

import {
  TRAY_RECENT_LIMIT,
  buildRecentItemsTemplate,
  createTray,
  openPanelFromShell,
  openSettingsFromShell,
  pasteRecentItem,
  pickRecentTextItems,
  scheduleTrayMenuRebuild,
  trayRecentLabel
} from '../electron/main/tray'

let testClock = Date.parse('2026-10-05T08:00:00Z')

function text(id: string, value: string, capturedAt: number, extra: Record<string, unknown> = {}): ClipboardItem {
  return { id, capturedAt, hitCount: 1, pinned: false, data: { kind: 'text', text: value, isUrl: /^https?:/.test(value), ...extra } } as ClipboardItem
}

function lastMenu(): MenuEntry[] {
  return mocks.menus[mocks.menus.length - 1].template
}

beforeEach(() => {
  vi.useFakeTimers()
  testClock += 60 * 60 * 1000
  vi.setSystemTime(testClock)
  mocks.trays.length = 0
  mocks.menus.length = 0
  mocks.items = []
  mocks.fullText = {}
  mocks.interactive = false
  mocks.calls.length = 0
  mocks.written.length = 0
  mocks.pasted.length = 0
  mocks.pasteResult = true
  mocks.installMacAppMenu.mockReset()
  mocks.settings = { language: 'en', toggleHotkey: 'Alt+C', incognito: false, hoverActivation: true, stickPosition: 'left' }
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  restorePlatform()
})

afterAll(() => {
  restorePlatform()
})

describe('recent item labels', () => {
  it('collapses whitespace into a single line', () => {
    expect(trayRecentLabel('  first line\n\tsecond   line \r\n')).toBe('first line second line')
  })

  it('truncates long text with an ellipsis', () => {
    const label = trayRecentLabel('x'.repeat(200))
    expect(Array.from(label)).toHaveLength(48)
    expect(label.endsWith('…')).toBe(true)
    expect(trayRecentLabel('x'.repeat(48))).toBe('x'.repeat(48))
  })

  it('does not split a surrogate pair', () => {
    const label = trayRecentLabel('😀'.repeat(60), 10)
    expect(Array.from(label)).toHaveLength(10)
    expect(label).toBe(`${'😀'.repeat(9)}…`)
  })
})

describe('recent item selection', () => {
  it('keeps text and link items only, newest first, at most 8', () => {
    const items: ClipboardItem[] = [
      { id: 'img', capturedAt: 999, hitCount: 1, pinned: false, data: { kind: 'image', imageId: 'a', width: 1, height: 1, bytes: 1 } } as ClipboardItem,
      { id: 'files', capturedAt: 998, hitCount: 1, pinned: false, data: { kind: 'files', paths: ['/a'] } },
      ...Array.from({ length: 12 }, (_, i) => text(`t${i}`, `text ${i}`, i)),
      text('link', 'https://example.com', 500),
      text('blank', '  \n ', 600)
    ]
    const picked = pickRecentTextItems(items)
    expect(TRAY_RECENT_LIMIT).toBe(8)
    expect(picked.map((item) => item.id)).toEqual(['link', 't11', 't10', 't9', 't8', 't7', 't6', 't5'])
  })

  it('does not reorder the list it was given', () => {
    const items = [text('a', 'a', 1), text('b', 'b', 2)]
    pickRecentTextItems(items)
    expect(items.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('recent items menu template', () => {
  it('lists the entries without shortcuts and ends with a separator', () => {
    const picked: string[] = []
    const template = buildRecentItemsTemplate(
      Array.from({ length: 10 }, (_, i) => text(`t${i}`, `text ${i}`, i)),
      (id) => picked.push(id)
    )
    expect(template).toHaveLength(9)
    expect(template.some((entry) => entry.accelerator)).toBe(false)
    expect(template[0].label).toBe('text 9')
    expect(template[8]).toEqual({ type: 'separator' })
    ;(template[2].click as () => void)()
    expect(picked).toEqual(['t7'])
  })

  it('prefers the preview of a large payload and keeps ampersands visible', () => {
    const template = buildRecentItemsTemplate([text('a', 'stub', 1, { previewText: 'Tom & Jerry\nsecond', hasFullPayload: true })], () => {})
    expect(template[0].label).toBe('Tom && Jerry second')
  })

  it('is empty without text items', () => {
    expect(buildRecentItemsTemplate([], () => {})).toEqual([])
  })
})

describe('menu bar menu', () => {
  it('starts with the recent items on macOS', () => {
    setPlatform('darwin')
    mocks.items = [text('a', 'older', 1), text('b', 'newer', 2)]
    createTray()
    const tray = mocks.trays[0]
    tray.handlers['right-click']()

    const template = lastMenu()
    expect(template.slice(0, 3).map((entry) => entry.label ?? entry.type)).toEqual(['newer', 'older', 'separator'])
    expect(template[3].label).toContain('Show Clipboard')
    expect(tray.popUpContextMenu).toHaveBeenCalledTimes(1)
  })

  it('reflects the history at the moment the menu opens', () => {
    setPlatform('darwin')
    createTray()
    const tray = mocks.trays[0]
    tray.handlers['right-click']()
    expect(lastMenu()[0].label).toContain('Show Clipboard')

    mocks.items = [text('a', 'copied later', 5)]
    tray.handlers['right-click']()
    expect(lastMenu()[0].label).toBe('copied later')
  })

  it('has no recent items on Windows', () => {
    setPlatform('win32')
    mocks.items = [text('a', 'older', 1)]
    createTray()
    expect(lastMenu()[0].label).toBe('Show Clipboard')
    expect(lastMenu().some((entry) => entry.accelerator)).toBe(false)
    expect(mocks.installMacAppMenu).not.toHaveBeenCalled()
  })

  it('rebuilds once after a burst of history changes', () => {
    setPlatform('darwin')
    createTray()
    const before = mocks.menus.length
    scheduleTrayMenuRebuild()
    scheduleTrayMenuRebuild()
    scheduleTrayMenuRebuild()
    vi.advanceTimersByTime(299)
    expect(mocks.menus.length).toBe(before)
    vi.advanceTimersByTime(1)
    expect(mocks.menus.length).toBe(before + 1)
  })

  it('does not rebuild the app menu with the menu bar menu', () => {
    setPlatform('darwin')
    createTray()
    mocks.trays[0].handlers['right-click']()
    scheduleTrayMenuRebuild()
    vi.advanceTimersByTime(300)
    expect(mocks.installMacAppMenu).not.toHaveBeenCalled()
  })
})

describe('pasting a recent item', () => {
  it('hands the item to the shared paste path with the plain-text setting', async () => {
    setPlatform('darwin')
    mocks.items = [text('a', 'stub', 1, { hasFullPayload: true })]
    await expect(pasteRecentItem('a')).resolves.toBe(true)
    expect(mocks.pasted).toEqual([{ id: 'a', opts: { plain: false } }])

    mocks.settings = { ...mocks.settings, pastePlainText: true }
    await pasteRecentItem('a')
    expect(mocks.pasted[1]).toEqual({ id: 'a', opts: { plain: true } })
  })

  it('reports a paste the shared path refused', async () => {
    mocks.items = [text('a', 'plain', 1)]
    mocks.pasteResult = false
    await expect(pasteRecentItem('a')).resolves.toBe(false)
  })

  it('does nothing for an item that is gone or is not text', async () => {
    mocks.items = [{ id: 'f', capturedAt: 1, hitCount: 1, pinned: false, data: { kind: 'files', paths: ['/a'] } }]
    await expect(pasteRecentItem('missing')).resolves.toBe(false)
    await expect(pasteRecentItem('f')).resolves.toBe(false)
    expect(mocks.calls).toEqual([])
  })

  it('is wired to the menu entries', async () => {
    setPlatform('darwin')
    mocks.items = [text('a', 'from the menu', 1)]
    createTray()
    mocks.trays[0].handlers['right-click']()
    lastMenu()[0].click()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.pasted.map((p) => p.id)).toEqual(['a'])
  })
})

describe('opening from the app menu, Finder or Spotlight', () => {
  it('opens the closed panel as an explicit open', () => {
    setPlatform('darwin')
    openPanelFromShell()
    expect(mocks.calls).toEqual(['setVisible(true)', 'markExplicitOpen', 'togglePanel(true, activate)'])
    mocks.calls.length = 0
    openPanelFromShell('url')
    expect(mocks.calls).toEqual(['setVisible(true)', 'markExplicitOpen', 'togglePanel(true, url)'])
  })

  it('leaves an open panel open', () => {
    setPlatform('darwin')
    mocks.interactive = true
    openPanelFromShell()
    expect(mocks.calls).toEqual(['setVisible(true)'])
  })

  it('opens the settings the way the menu bar entry does', () => {
    setPlatform('darwin')
    openSettingsFromShell()
    expect(mocks.calls).toEqual(['setVisible(true)', 'markExplicitOpen', 'togglePanel(true, menu)', 'openSettings'])
  })

  it('does not steal focus for the settings on Windows', () => {
    setPlatform('win32')
    openSettingsFromShell()
    expect(mocks.calls).toEqual(['setVisible(true)', 'win.focus', 'openSettings'])
  })

  it('opens from the menu bar icon and the menu entry with their sources', () => {
    setPlatform('darwin')
    createTray()
    mocks.trays[0].handlers.click({})
    expect(mocks.calls).toContain('togglePanel(undefined, tray)')
    mocks.trays[0].handlers['right-click']()
    lastMenu().find((entry) => entry.label?.includes('Show Clipboard'))?.click()
    expect(mocks.calls).toContain('togglePanel(undefined, menu)')
  })
})

describe('menu bar texts on macOS', () => {
  it('uses the macOS variant of an aliased tray text', async () => {
    setPlatform('darwin')
    const { getTrayText } = await import('../electron/main/tray')
    const body = getTrayText('en', 'welcomeBody')
    expect(body).toContain('screen edge')
    expect(body).not.toContain('middle-left')
    expect(body).toContain('⌥C')
  })

  it('keeps the Windows text on Windows', async () => {
    setPlatform('win32')
    const { getTrayText } = await import('../electron/main/tray')
    expect(getTrayText('en', 'welcomeBody')).toContain('middle-left')
  })

  it('shows the configured hotkey in the macOS text', async () => {
    setPlatform('darwin')
    mocks.settings = { ...mocks.settings, toggleHotkey: 'Command+Shift+V' }
    const { getTrayText } = await import('../electron/main/tray')
    expect(getTrayText('ru', 'welcomeBody')).toContain('⌘⇧V')
  })
})
