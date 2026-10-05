import { BrowserWindow, screen, app } from 'electron'
import { runtime } from './config'
import { en, getMainLocale } from './language'
import { computeStickBounds, stickWindowWidth, windowFillsWorkArea } from './geometry'
import { clampPanelWidth } from '../../shared/panelWidth'
import { applyClickThroughMode, enforceClickThrough, getClickThroughState } from './clickThrough'
import { WorkAreaCache } from './workAreaCache'
import { loadSettings, saveSettings } from '../store/settings'
import { pickInitialStickPosition, readDockOrientation, type PanelPlacement } from './macScreen'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { createPanelDrag } from './macPanelDrag'
import { isHorizontalEdge, type DragPlacement } from '../../shared/panelPlacement'
import type { Settings } from '../../shared/types'
import { mainWindow, interactive, getMainWindow, sendToMainWindow } from './windowState'

export let previewActive = false

export let currentHotZoneWidth = 3
export let currentStickDisplayId: number | undefined

let staleIdConsecutiveCount = 0
export let lastPanelPlacement: PanelPlacement | null = null
export let geometryPanelWidth: number | null = null

/**
 * Stick-display work area cache (versioned, last-known-good).
 * Rebuilds automatically when the stick display id changes - this is the fix
 * for "switched monitors in Settings but edge detection kept listening to
 * the old screen". See workAreaCache.ts for the full contract.
 */
export const workAreaCache = new WorkAreaCache((displayId) => {
  const all = screen.getAllDisplays()
  const stick = all.find(d => d.id === displayId) ?? screen.getPrimaryDisplay()
  return stick?.workArea ? { displayId: stick.id, workArea: stick.workArea, bounds: stick.bounds } : null
})

/** Force a cache re-read (display topology events). */
export function updateCachedWorkArea(): void {
  workAreaCache.refresh(currentStickDisplayId)
}

export function setHotZoneWidth(width: number): void {
  currentHotZoneWidth = width
}

export function setStickDisplayId(id: number | undefined): void {
  currentStickDisplayId = id
  workAreaCache.refresh(id)
}

export function setPreviewMode(active: boolean): void {
  if (previewActive === active) return
  previewActive = active
  if (process.platform !== 'darwin') repositionWindow()
}

function commitPanelPlacement(target: DragPlacement): Settings {
  const next = saveSettings({
    stickPosition: target.edge,
    stickDisplayId: target.displayId,
    stickDisplayWorkArea: target.workArea,
    stickDisplayScaleFactor: target.scaleFactor,
    ...(isHorizontalEdge(target.edge) ? { horizontalOffset: target.offset } : { verticalOffset: target.offset })
  })
  sendSettingsToAllWindows(next)
  repositionWindow()
  return next
}

export const panelDrag = createPanelDrag({
  getWindow: () => mainWindow,
  getDisplayId: () => currentStickDisplayId,
  commit: commitPanelPlacement,
  restore: () => repositionWindow()
})

export const registerPanelDragIpc = panelDrag.registerIpc

export function reassertClickThrough(): void {
  if (process.platform !== 'darwin' || !mainWindow || mainWindow.isDestroyed()) return
  if (!interactive) {
    enforceClickThrough(mainWindow)
    return
  }
  const mode = getClickThroughState().mode
  if (mode) applyClickThroughMode(mainWindow, mode, true)
}

export function getStickGeometry(): { x: number; y: number; width: number; height: number } {
  let settings = loadSettings()
  const primaryDisplay = screen.getPrimaryDisplay()
  const allDisplays = screen.getAllDisplays().map(d => ({
    id: d.id,
    workArea: { ...d.workArea },
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === primaryDisplay.id
  }))

  geometryPanelWidth = clampPanelWidth(settings.panelWidth)
  const currentWindowWidth = stickWindowWidth({ panelWidth: settings.panelWidth, previewActive })

  const result = computeStickBounds({
    position: settings.stickPosition,
    displays: allDisplays,
    displayId: settings.stickDisplayId,
    savedWorkArea: settings.stickDisplayWorkArea,
    savedScaleFactor: settings.stickDisplayScaleFactor,
    windowWidth: currentWindowWidth,
    horizontalOffset: settings.horizontalOffset,
    currentBounds: getMainWindow()?.getBounds(),
    previewActive,
    fillWorkArea: windowFillsWorkArea(process.platform)
  })

  const resolved = result.resolvedDisplay

  // ── Self-heal: persist fresh geometry whenever the resolved display differs ──
  // This covers two scenarios:
  //   A) Cross-reboot: OS re-assigned a new numeric ID to the same physical monitor.
  //      We matched via Tier-2 fuzzy bounds — now save the new ID so future same-
  //      session lookups hit Tier-1 instantly.
  //   B) Display disconnected: Tier-4 fell back to primary — clear stale persisted
  //      display so the app stays fully usable and the UI shows primary as active.
  const idChanged = settings.stickDisplayId !== undefined && settings.stickDisplayId !== resolved.id
  const idWasStale = settings.stickDisplayId !== undefined && !allDisplays.some(d => d.id === settings.stickDisplayId)

  if (idWasStale) {
    // Fix 3: Consecutive-stale-reads guard.
    //
    // When a TV mirror is active, Windows briefly removes and re-adds display IDs
    // during EDID renegotiation. This makes idWasStale=true for a single call even
    // though the user's chosen monitor is still physically connected.
    //
    // Before this fix: the very first stale read immediately wrote stickDisplayId=undefined
    // to disk, permanently wiping the user's monitor choice.
    //
    // After this fix: we require the ID to be absent in 2 CONSECUTIVE calls before
    // treating it as genuinely gone. With the 600ms debounce on display events, two
    // consecutive stale reads means the display has been absent for >600ms — a real
    // disconnection, not a transient OS reconfiguration.
    staleIdConsecutiveCount++
    const STALE_THRESHOLD = 2
    if (staleIdConsecutiveCount < STALE_THRESHOLD) {
      console.log(`[Main] Display ${settings.stickDisplayId} temporarily absent (count=${staleIdConsecutiveCount}/${STALE_THRESHOLD}) — holding preference, will re-evaluate.`)
      // Don't wipe settings yet — just reposition using what was resolved (likely Tier-2 or Tier-4)
    } else {
      staleIdConsecutiveCount = 0
      // The old ID no longer exists in this session (disconnected or reboot rename).
      // Check whether we recovered via Tier-2 or fell all the way to primary.
      const recoveredViaBounds = settings.stickDisplayWorkArea !== undefined && resolved.id !== primaryDisplay.id
      if (recoveredViaBounds) {
        console.log(`[Main] Display ${settings.stickDisplayId} re-matched via geometry to display ${resolved.id} — updating persisted ID.`)
      } else {
        console.log(`[Main] Display ${settings.stickDisplayId} disconnected or unrecognised after ${STALE_THRESHOLD} checks. Falling back to display ${resolved.id}.`)
      }
      settings = saveSettings({
        stickDisplayId: recoveredViaBounds ? resolved.id : undefined,
        stickDisplayWorkArea: recoveredViaBounds ? resolved.workArea : undefined,
        stickDisplayScaleFactor: recoveredViaBounds ? resolved.scaleFactor : undefined
      })
      sendToMainWindow('state:settings', settings)
      if (!recoveredViaBounds) {
        // Genuinely fell back — briefly show panel on new location.
        popUpAndRetract(1500)
      }
    }
  } else {
    // Reset counter: the saved ID was found this call — monitor is present.
    staleIdConsecutiveCount = 0

    if (idChanged) {
      // Shouldn't happen if Tier-1 matched, but guard it anyway.
      settings = saveSettings({
        stickDisplayId: resolved.id,
        stickDisplayWorkArea: resolved.workArea,
        stickDisplayScaleFactor: resolved.scaleFactor
      })
      sendToMainWindow('state:settings', settings)
    } else if (settings.stickDisplayId !== undefined && (
      settings.stickDisplayWorkArea === undefined ||
      settings.stickDisplayScaleFactor === undefined
    )) {
      // Upgrade: user had a stickDisplayId saved before this feature was added;
      // backfill geometry silently so the next reboot can fuzzy-match.
      saveSettings({
        stickDisplayWorkArea: resolved.workArea,
        stickDisplayScaleFactor: resolved.scaleFactor
      })
    }
  }

  currentStickDisplayId = resolved.id
  // CRITICAL: re-version the poll cache to the freshly resolved display.
  // Without this, Settings/tray display switches moved the WINDOW correctly
  // while edge detection kept measuring against the previous monitor's
  // origin (the "hover secondary does nothing, hover primary opens it on
  // secondary" report).
  workAreaCache.refresh(resolved.id)
  return { x: result.x, y: result.y, width: result.width, height: result.height }
}

function sendSettingsToAllWindows(next: ReturnType<typeof loadSettings>): void {
  if (runtime.quitting) return
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('state:settings', next)
    }
  }
}

export function applyMacInitialStickPosition(): void {
  void readDockOrientation()
    .then((orientation) => {
      if (!orientation) return
      const position = pickInitialStickPosition(orientation)
      if (position === DEFAULT_SETTINGS.stickPosition) return
      if (loadSettings().stickPosition !== DEFAULT_SETTINGS.stickPosition) return
      const next = saveSettings({ stickPosition: position })
      sendSettingsToAllWindows(next)
      if (!mainWindow || mainWindow.isDestroyed()) return
      const g = getStickGeometry()
      mainWindow.setBounds({ ...g })
      lastPanelPlacement = { displayId: currentStickDisplayId, bounds: { ...g } }
      onWindowRepositioned?.()
    })
    .catch((err) => {
      console.error('[Main] Initial stick position from Dock failed:', err)
    })
}

let onWindowRepositioned: (() => void) | null = null
export function registerWindowRepositionListener(fn: () => void): void {
  onWindowRepositioned = fn
}

export function getActiveDisplayId(allDisplays?: Electron.Display[]): number {
  const displays = allDisplays ?? screen.getAllDisplays()
  const settings = loadSettings()
  const primary = screen.getPrimaryDisplay()

  // Tier 1: exact session-local ID match.
  if (settings.stickDisplayId !== undefined && displays.some(d => d.id === settings.stickDisplayId)) {
    return settings.stickDisplayId
  }

  // Tier 2: fuzzy workArea match (cross-reboot).
  if (settings.stickDisplayWorkArea !== undefined) {
    const TOLERANCE = 8
    const sa = settings.stickDisplayWorkArea
    const candidates = displays.filter(d =>
      Math.abs(d.workArea.x - sa.x) <= TOLERANCE &&
      Math.abs(d.workArea.y - sa.y) <= TOLERANCE &&
      Math.abs(d.workArea.width - sa.width) <= TOLERANCE &&
      Math.abs(d.workArea.height - sa.height) <= TOLERANCE
    )
    if (candidates.length === 1) return candidates[0].id
    if (candidates.length > 1 && settings.stickDisplayScaleFactor !== undefined) {
      const byScale = candidates.find(d => d.scaleFactor === settings.stickDisplayScaleFactor)
      if (byScale) return byScale.id
      return candidates[0].id
    }
    if (candidates.length > 1) return candidates[0].id
  }

  // Tier 3: in-memory ID set this session by getStickGeometry.
  if (currentStickDisplayId !== undefined && displays.some(d => d.id === currentStickDisplayId)) {
    return currentStickDisplayId
  }

  // Tier 4: primary fallback.
  return primary.id
}

export function getDisplayListOptions(): Array<{
  id: number
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  isPrimary: boolean
  isCurrent: boolean
  label: string
  name: string
  resolution: string
}> {
  const all = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const activeId = getActiveDisplayId(all)

  const settings = loadSettings()
  let langCode = settings.language || 'system'
  if (langCode === 'system') {
    const sysLangs = app.getPreferredSystemLanguages()
    const first = (sysLangs[0] || '').toLowerCase()
    if (first.startsWith('zh-tw') || first.startsWith('zh-hk')) langCode = 'zh-TW'
    else if (first.startsWith('zh')) langCode = 'zh-CN'
    else if (first.startsWith('es')) langCode = 'es'
    else if (first.startsWith('fr')) langCode = 'fr'
    else if (first.startsWith('de')) langCode = 'de'
    else if (first.startsWith('hi')) langCode = 'hi'
    else if (first.startsWith('fa')) langCode = 'fa'
    else if (first.startsWith('ja')) langCode = 'ja'
    else if (first.startsWith('ru')) langCode = 'ru'
    else langCode = 'en'
  }
  const dict = getMainLocale(langCode)
  const primaryText = dict?.position?.primaryDisplay || en.position.primaryDisplay
  // Localized side tags reuse the fully translated tray words; vertical
  // arrangements get no tag rather than inventing untranslated strings.
  const sideWord = (key: 'left' | 'right'): string =>
    (dict?.tray?.[key]) || en.tray[key] || key

  return all.map((d, index) => {
    const isPrimary = d.id === primary.id
    const rawName = (d as any).label || (d as any).name || ''
    const fallbackName = isPrimary ? primaryText : `Display ${index + 1}`
    const baseName = rawName.trim() ? rawName.trim() : fallbackName
    const name = isPrimary
      ? (baseName.toLowerCase().includes('primary') || baseName === primaryText ? baseName : `${baseName} (${primaryText})`)
      : baseName
    const scale = d.scaleFactor || 1
    const physW = Math.round(d.bounds.width * scale)
    const physH = Math.round(d.bounds.height * scale)
    const resolution = `${physW}×${physH}`

    // Positional tag so users can tell which entry is which physical panel:
    // non-primary displays on the same row as the primary are tagged with the
    // localized side they sit on ("Display 2 · Right · 2560×1440").
    let positionTag = ''
    if (!isPrimary) {
      const sameRow =
        Math.abs(d.bounds.y - primary.bounds.y) <= Math.max(primary.bounds.height, d.bounds.height) / 2
      if (sameRow) {
        positionTag = ` · ${sideWord(d.bounds.x > primary.bounds.x ? 'right' : 'left')}`
      }
    }

    return {
      id: d.id,
      bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
      workArea: { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height },
      scaleFactor: scale,
      isPrimary,
      isCurrent: d.id === activeId,
      label: `${name}${positionTag} ${resolution}`,
      name,
      resolution
    }
  })
}

let popUpTimer: ReturnType<typeof setTimeout> | null = null
export function popUpAndRetract(durationMs = 1500): void {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.showInactive()
  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.setSkipTaskbar(true)

  const wasAlreadyOpen = interactive
  console.log(`[Main] Popping up panel briefly to confirm new screen/edge location (wasAlreadyOpen=${wasAlreadyOpen})`)
  sendToMainWindow('window:toggle', true)

  if (popUpTimer !== null) clearTimeout(popUpTimer)
  if (!wasAlreadyOpen) {
    popUpTimer = setTimeout(() => {
      popUpTimer = null
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('[Main] Retracting panel after brief confirmation pop-up')
        sendToMainWindow('window:toggle', false)
      }
    }, durationMs)
  }
}

export function repositionWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed() || panelDrag.isActive()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.showInactive()
  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.setSkipTaskbar(true)
  const g = getStickGeometry()
  mainWindow.setBounds({ ...g })
  lastPanelPlacement = { displayId: currentStickDisplayId, bounds: { ...g } }
  reassertClickThrough()
  onWindowRepositioned?.()
}

export function assignLastPanelPlacement(value: PanelPlacement | null): void {
  lastPanelPlacement = value
}
