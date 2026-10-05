/**
 * System tray icon + context menu.
 *
 * The panel has no taskbar button and no window chrome, so the tray is the
 * user's handle on the app: show/hide, toggle incognito, and quit. Menu item
 * state (checkmarks) is rebuilt every time the menu opens so it always reflects
 * current settings.
 */
import { Menu, Tray, app, nativeImage, Notification, screen, nativeTheme } from 'electron'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { PATHS } from '../store/paths'
import { loadSettings, saveSettings } from '../store/settings'
import { getMainWindow, setVisible, repositionWindow, getDisplayListOptions, registerWindowRepositionListener, popUpAndRetract, markExplicitOpen, isInteractive } from './window'
import type { StickPosition, ToggleSource } from '../../shared/types'
import { DEFAULT_TOGGLE_HOTKEY } from '../../shared/types'
import { pushState, getStore } from './state'
import type { ClipboardItem } from '../../shared/types'
import { en } from '../../src/i18n/translations'
import { mainText } from './language'

let tray: Tray | null = null
let themeListenerRegistered = false

/** Build a tiny monochrome tray icon if no on-disk icon exists (first run). */
function fallbackIcon(): Electron.NativeImage {
  // 16x16 transparent PNG with a centered accent dot.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAW0lEQVR4AcXOMQ4AIQhF4eD9' +
      '/yWhVSChGAyMKlmJUqCYjCDxgi+gnqEVREe0g1FXuATdQI/CBXQMvABjgn0wAbJBHzPmJ2gB' +
      '1mYAAAAASUVORK5CYII=',
    'base64'
  )
  return nativeImage.createFromBuffer(png).resize({ width: 16, height: 16 })
}

/**
 * Detects whether the Windows taskbar/system tray is using light mode.
 *
 * Windows 10/11 allows a "Custom" theme where the taskbar (Windows mode)
 * can be Light while apps are Dark (or vice versa).
 * The authoritative source is the registry key `SystemUsesLightTheme`:
 *   1 = Light taskbar (requires dark tray icon)
 *   0 = Dark taskbar (requires white tray icon)
 *
 * Falls back to `!nativeTheme.shouldUseDarkColors` on non-Windows or when unreadable.
 */
export function isTaskbarLightTheme(): boolean {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync(
        'reg',
        ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'SystemUsesLightTheme'],
        { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      )
      const text = String(out ?? '')
      const m = text.match(/SystemUsesLightTheme\s+REG_DWORD\s+(0x[0-9a-fA-F]+|\d+)/i)
      if (m && m[1]) {
        const val = parseInt(m[1], 16)
        return val === 1
      }
    } catch {
      // Best-effort registry check; fall back to nativeTheme below.
    }
  }
  return !nativeTheme.shouldUseDarkColors
}

/** Resolves the appropriate 32x32 tray icon based on the current taskbar theme. */
export function getTrayImage(): Electron.NativeImage {
  if (process.platform === 'darwin') {
    // macOS menu bar: 18pt template image (black glyph, auto-tinted by the OS).
    const p = existsSync(PATHS.trayDarkIcon()) ? PATHS.trayDarkIcon() : PATHS.trayIcon()
    const src = nativeImage.createFromPath(p)
    if (!src.isEmpty()) {
      const img = nativeImage.createEmpty()
      img.addRepresentation({ scaleFactor: 1, buffer: src.resize({ width: 18, height: 18, quality: 'best' }).toPNG() })
      img.addRepresentation({ scaleFactor: 2, buffer: src.resize({ width: 36, height: 36, quality: 'best' }).toPNG() })
      img.setTemplateImage(true)
      return img
    }
  }
  const isLight = isTaskbarLightTheme()
  const preferredPath = isLight ? PATHS.trayDarkIcon() : PATHS.trayIcon()
  const fallbackPath = PATHS.trayIcon()

  const resolvedPath = existsSync(preferredPath)
    ? preferredPath
    : (existsSync(fallbackPath) ? fallbackPath : null)

  if (resolvedPath) {
    // Load and resize to exactly 32x32. Windows system tray renders icons at 16x16
    // logical pixels but uses 32x32 physical pixels on 2x DPI displays.
    // Using a single 32x32 image with no scaleFactor trickery is the most reliable
    // approach — the OS scales it automatically.
    return nativeImage.createFromPath(resolvedPath).resize({ width: 32, height: 32, quality: 'best' })
  }

  return fallbackIcon()
}

/** Dynamically switches tray icon image when system/taskbar theme updates. */
export function updateTrayIcon(): void {
  if (!tray || tray.isDestroyed()) return
  try {
    const image = getTrayImage()
    tray.setImage(image)
  } catch (err) {
    console.error('[Tray] Failed to update tray icon image:', err)
  }
}

export function getTrayText(settingsLang: string | undefined, key: keyof typeof en['tray']): string {
  return mainText(settingsLang, `tray.${key}`, undefined, { hotkey: loadSettings().toggleHotkey || DEFAULT_TOGGLE_HOTKEY, missing: key })
}

export function openPanelFromShell(source: ToggleSource = 'activate'): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  setVisible(true)
  if (isInteractive()) return
  markExplicitOpen()
  pushState.togglePanel(true, { source })
}

export function openSettingsFromShell(): void {
  setVisible(true)
  if (process.platform === 'darwin') {
    markExplicitOpen()
    pushState.togglePanel(true, { source: 'menu' })
  } else {
    getMainWindow()?.focus()
  }
  pushState.openSettings()
}

export const TRAY_RECENT_LIMIT = 8
const TRAY_RECENT_LABEL_MAX = 48

export function trayRecentLabel(text: string, max = TRAY_RECENT_LABEL_MAX): string {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(singleLine)
  if (chars.length <= max) return singleLine
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

export function pickRecentTextItems(items: readonly ClipboardItem[], limit = TRAY_RECENT_LIMIT): ClipboardItem[] {
  return items
    .filter((item) => item.data.kind === 'text' && trayRecentLabel(item.data.previewText || item.data.text) !== '')
    .sort((a, b) => b.capturedAt - a.capturedAt)
    .slice(0, limit)
}

export function buildRecentItemsTemplate(
  items: readonly ClipboardItem[],
  onPick: (id: string) => void
): Electron.MenuItemConstructorOptions[] {
  const recent = pickRecentTextItems(items)
  if (recent.length === 0) return []
  const entries: Electron.MenuItemConstructorOptions[] = recent.map((item) => ({
    label: trayRecentLabel(item.data.kind === 'text' ? item.data.previewText || item.data.text : '').replace(/&/g, '&&'),
    click: () => onPick(item.id)
  }))
  return [...entries, { type: 'separator' }]
}

export async function pasteRecentItem(id: string): Promise<boolean> {
  const item = getStore().get(id)
  if (!item || item.data.kind !== 'text') return false
  try {
    const { pasteItemById } = await import('./ipc')
    return await pasteItemById(id, { plain: loadSettings().pastePlainText === true })
  } catch (err) {
    console.error('[Tray] Failed to paste a recent item:', err)
    return false
  }
}

const TRAY_REBUILD_DEBOUNCE_MS = 300
let trayRebuildTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleTrayMenuRebuild(): void {
  if (trayRebuildTimer !== null) clearTimeout(trayRebuildTimer)
  trayRebuildTimer = setTimeout(() => {
    trayRebuildTimer = null
    trayMenuRebuilder?.()
  }, TRAY_REBUILD_DEBOUNCE_MS)
}

export function createTray(): Tray {
  const image = getTrayImage()
  tray = new Tray(image)
  tray.setToolTip('Edge-Drop')
  if (process.platform === 'darwin') tray.setIgnoreDoubleClickEvents(true)

  // Register system theme change listener once
  if (!themeListenerRegistered) {
    themeListenerRegistered = true
    nativeTheme.on('updated', () => {
      updateTrayIcon()
    })
  }

  // Show welcome notification on first run
  if (!existsSync(PATHS.indexFile())) {
    try {
      if (Notification.isSupported()) {
        const initialSettings = loadSettings()
        new Notification({
          title: getTrayText(initialSettings.language, 'welcomeTitle'),
          body: getTrayText(initialSettings.language, 'welcomeBody'),
          icon: PATHS.icon()
        }).show()
      }
    } catch { /* ignore */ }
  }

  function buildDisplaySubmenu(): Electron.MenuItemConstructorOptions[] {
    const options = getDisplayListOptions()
    return options.map((d) => ({
      label: d.label,
      type: 'radio' as const,
      checked: d.isCurrent,
      click: () => {
        // Persist workArea (not bounds) — geometry.ts Tier-2 fuzzy match compares
        // d.workArea against savedWorkArea. Storing bounds (which includes the taskbar)
        // causes a ~40px mismatch that exceeds BOUNDS_TOLERANCE, breaking cross-reboot recovery.
        const next = saveSettings({
          stickDisplayId: d.id,
          stickDisplayWorkArea: d.workArea,
          stickDisplayScaleFactor: d.scaleFactor
        })
        pushState.settings(next)
        repositionWindow()
        popUpAndRetract(1500)
        rebuild()
      }
    }))
  }

  function buildStickSubmenu(current: StickPosition): Electron.MenuItemConstructorOptions[] {
    const settings = loadSettings()
    return ([
      { pos: 'left' as const, labelKey: 'left' as const },
      { pos: 'right' as const, labelKey: 'right' as const },
      { pos: 'top' as const, labelKey: 'top' as const },
      ...(process.platform === 'darwin' ? [{ pos: 'bottom' as const, labelKey: 'bottom' as const }] : [])
    ]).map(({ pos, labelKey }) => ({
      label: getTrayText(settings.language, labelKey as any) || (pos === 'top' ? 'Top' : pos),
      type: 'radio' as const,
      checked: current === pos,
      click: () => {
        const next = saveSettings({ stickPosition: pos })
        pushState.settings(next)
        repositionWindow()
        popUpAndRetract(1500)
        rebuild()
      }
    }))
  }

  let macMenu: Electron.Menu | null = null

  const rebuild = () => {
    const settings = loadSettings()
    const t = (k: keyof typeof en['tray']) => getTrayText(settings.language, k)

    let recentItems: Electron.MenuItemConstructorOptions[] = []
    if (process.platform === 'darwin') {
      try {
        recentItems = buildRecentItemsTemplate(getStore().list(), (id) => {
          void pasteRecentItem(id)
        })
      } catch (err) {
        console.error('[Tray] Failed to build recent items:', err)
      }
    }

    const menu = Menu.buildFromTemplate([
      ...recentItems,
      {
        label: t('showClipboard'),
        click: () => {
          console.log('[Main] Context menu "Show Clipboard" clicked')
          setVisible(true)
          getMainWindow()?.focus()
          markExplicitOpen()
          pushState.togglePanel(undefined, { source: 'menu' })
        }
      },
      {
        label: t('settings'),
        click: () => {
          console.log('[Main] Context menu "Settings" clicked')
          openSettingsFromShell()
        }
      },
      { type: 'separator' },
      {
        label: t('incognito'),
        type: 'checkbox',
        checked: settings.incognito,
        click: (item) => {
          const next = saveSettings({ incognito: item.checked })
          pushState.settings(next)
          applyIncognito(next.incognito)
          rebuild()
        }
      },
      {
        label: t('hoverTrigger'),
        type: 'checkbox',
        checked: settings.hoverActivation ?? true,
        click: (item) => {
          const next = saveSettings({
            hoverActivation: item.checked,
            suppressInFullscreen: item.checked ? true : false
          })
          pushState.settings(next)
          rebuild()
        }
      },
      { type: 'separator' },
      {
        label: t('stickTo'),
        submenu: buildStickSubmenu(settings.stickPosition)
      },
      {
        label: t('display'),
        submenu: buildDisplaySubmenu()
      },
      { type: 'separator' },
      {
        label: t('quit'),
        click: () => {
          app.quit()
        }
      }
    ])
    if (process.platform === 'darwin') {
      macMenu = menu
    } else {
      tray?.setContextMenu(menu)
    }
  }

  tray.on('click', (event) => {
    updateTrayIcon()
    if (process.platform === 'darwin' && event?.ctrlKey) {
      rebuild()
      if (macMenu) tray?.popUpContextMenu(macMenu)
      return
    }
    console.log('[Main] Tray icon left-clicked')
    const win = getMainWindow()
    if (!win) return
    setVisible(true)
    markExplicitOpen()
    pushState.togglePanel(undefined, { source: 'tray' })
  })

  // Rebuild menu dynamically right before showing to ensure displays & checkmarks are 100% current.
  tray.on('right-click', () => {
    updateTrayIcon()
    rebuild()
    if (process.platform === 'darwin') {
      if (macMenu) tray?.popUpContextMenu(macMenu)
      return
    }
    tray?.popUpContextMenu()
  })

  // Listen for display changes to keep tray context menu updated in real-time (register once).
  if (!screenListenersRegistered) {
    screenListenersRegistered = true
    screen.on('display-added', () => trayMenuRebuilder?.())
    screen.on('display-removed', () => trayMenuRebuilder?.())
    screen.on('display-metrics-changed', () => trayMenuRebuilder?.())
    registerWindowRepositionListener(() => trayMenuRebuilder?.())
  }

  trayMenuRebuilder = rebuild
  rebuild()
  return tray
}

let screenListenersRegistered = false
let trayMenuRebuilder: (() => void) | null = null

export function rebuildTrayMenu(): void {
  trayMenuRebuilder?.()
}

/**
 * Destroys and safely recreates the tray icon.
 * Used when Windows Explorer restarts/crashes (TaskbarCreated event).
 */
export function refreshTray(): void {
  try {
    if (tray && !tray.isDestroyed()) {
      tray.destroy()
      tray = null
    }
  } catch (err) {
    console.error('[Tray] Error destroying old tray on refresh:', err)
  }
  createTray()
}

/** Reflect incognito toggle into the watcher without the renderer round-trip. */
let incognitoApply: ((v: boolean) => void) | null = null
export function registerIncognitoApplier(fn: (v: boolean) => void): void {
  incognitoApply = fn
}
function applyIncognito(v: boolean): void {
  incognitoApply?.(v)
}
