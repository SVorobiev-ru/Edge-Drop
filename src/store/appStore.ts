/**
 * Renderer state store (Zustand).
 *
 * Holds the item list + settings and exposes thin actions that call the bridge
 * and update local state optimistically where it's safe. The main process is
 * always the source of truth; it pushes a fresh DTO list after every mutation,
 * so we mostly just *apply* what it sends us.
 */
import { create } from 'zustand'
import { edge } from '../lib/edge'
import { takeSearchEngaged } from '../lib/searchFocus'
import { t } from '../i18n'
import { loadRecents } from '../lib/emoji/prefs'
import type { ClipboardItemDto, Settings, DragRequest, ItemMenuRequest, PasteOptions, StickPosition } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { playEdgeRetractSound, playEdgeBeaconAppearSound, playEdgeExpandSound, playButtonClickSound } from '../lib/soundEffects'
import { EMPTY_SELECTION, SELECTION_LIMIT, allTextLike, extendSelection, orderSelection, pruneSelection, selectAll, selectRange, toggleSelection, type Selection } from '../../shared/selection'
import { getNavOrder } from '../lib/keyboardNav'
import { isHorizontalEdge } from '../../shared/panelPlacement'

let flareTimer: ReturnType<typeof setTimeout> | null = null

const HYDRATE_RETRY_DELAYS_MS = [200, 500, 1200, 2500]
const HYDRATE_BACKGROUND_RETRY_MS = 10_000
const KEYBOARD_REFOCUS_DELAY_MS = 250
let hydrateRetryTimer: ReturnType<typeof setTimeout> | null = null

const appIconRequests = new Set<string>()

function sameItemMeta(a: ClipboardItemDto, b: ClipboardItemDto | undefined): boolean {
  return (
    !!b &&
    a.title === b.title &&
    a.ocrText === b.ocrText &&
    a.sourceApp?.bundleId === b.sourceApp?.bundleId &&
    a.sourceApp?.name === b.sourceApp?.name
  )
}

export const selectReduceMotion = (s: { settings: Settings; systemReduceMotion: boolean }): boolean =>
  !!s.settings.reduceMotion || s.systemReduceMotion

/**
 * Version dismissed this run. Session-only (never persisted): quitting and
 * relaunching clears it, so a skipped update prompts again next launch —
 * the "remind me next restart" contract. Manual checks bypass it entirely.
 */
let sessionSkippedVersion: string | null = null

export type EdgeTransitionStage =
  | 'retracting'
  | 'bar_fade_out'
  | 'bar_fade_in'
  | 'expanding'

export interface EdgeTransitionState {
  active: boolean
  from: 'left' | 'right' | 'top'
  to: 'left' | 'right' | 'top'
  stage: EdgeTransitionStage
}

/** A transient user-facing notice shown as a toast. */
export interface ToastMsg {
  id: string
  message: string
  tone: 'info' | 'error'
  params?: Record<string, string | number>
}

export interface UpdateProgress {
  percent: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
}

interface AppState {
  items: ClipboardItemDto[]
  /** The last item push only reordered or updated known items for usage (paste, drag-out). */
  itemsUsageOnly: boolean
  settings: Settings
  /** True until the first `state:load` resolves. */
  hydrated: boolean
  systemReduceMotion: boolean
  setSystemReduceMotion: (reduce: boolean) => void
  /** Free-text search filter (UI-only state). */
  query: string
  typeFilter: import('../../shared/types').TypeFilter
  setTypeFilter: (filter: import('../../shared/types').TypeFilter) => void
  /** Whether the panel blade is expanded. */
  open: boolean
  keyboardMode: boolean
  activeItemId: string | null
  enterKeyboardMode: () => void
  setActiveItemId: (id: string | null) => void
  queueIds: string[]
  queueIndex: Record<string, number>
  setQueueIds: (ids: string[]) => void
  selection: Selection
  selectedMap: Record<string, true>
  selectionTexts: Record<string, string>
  selectionDragActive: boolean
  toggleSelected: (id: string) => void
  selectRangeTo: (id: string, order: readonly string[]) => void
  extendSelectionTo: (from: string, to: string, order: readonly string[]) => void
  selectAllVisible: (order: readonly string[]) => void
  keepSelectionWithin: (order: readonly string[]) => void
  clearSelection: () => void
  selectedIdsInOrder: () => string[]
  pasteSelection: (plain?: boolean, fromKeyboard?: boolean) => Promise<void>
  copySelection: (plain?: boolean) => Promise<void>
  stackSelection: () => Promise<void>
  pinSelection: (pinned: boolean) => Promise<void>
  deleteSelection: () => Promise<void>
  appIcons: Record<string, string | null>
  requestAppIcon: (bundleId: string) => void
  itemMenuOpen: boolean
  showItemMenu: (id: string, sub?: ItemMenuRequest) => void
  textDragActive: boolean
  setTextDragActive: (active: boolean) => void
  renamingId: string | null
  setRenamingId: (id: string | null) => void
  renameItem: (id: string, title: string) => Promise<void>
  /** Settings sheet visibility. */
  settingsOpen: boolean
  /** Emoji library view (replaces the clipboard list). */
  emojiOpen: boolean
  setEmojiOpen: (open: boolean) => void
  emojiCategory: import('../lib/emoji/catalog').EmojiCategoryId
  setEmojiCategory: (cat: import('../lib/emoji/catalog').EmojiCategoryId) => void
  /** True while an OS file drag is hovering the panel (prevents premature close). */
  dragActive: boolean
  /**
   * The one stack/bundle whose expanded sub-item list is open (accordion).
   * Single source of truth so expanding one stack collapses the previous,
   * and so Escape / outside-click / view switches can coordinate closure.
   */
  expandedStackId: string | null
  setExpandedStackId: (id: string | null) => void
  /** True if the active drag originated from within the app itself. Stores the drag request (which item/sub-item). */
  internalDragReq: import('../../shared/types').DragRequest | null
  /** Active toasts (auto-dismissed after a short delay). */
  toasts: ToastMsg[]
  tutorialStep: number
  currentVersion: string
  isStoreBuild: boolean
  updateInfo: {
    hasUpdate: boolean
    latestVersion: string
    downloaded: boolean
    downloadProgress?: UpdateProgress
  } | null
  /** Item ID currently being previewed in the flyout. */
  previewItemId: string | null
  previewItemRect: { x?: number; y?: number; width?: number; height?: number } | null

  sliderActive: boolean
  sliderReleasedTime: number
  setSliderActive: (active: boolean) => void
  notifyPositionChanged: () => void
  resetPositionChangedTime: () => void
  edgeHintActive: boolean
  setEdgeHintActive: (active: boolean) => void

  /* hydration + sync */
  hydrate: () => Promise<void>
  manualCheckState: {
    status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'error'
    version?: string
    error?: string
  }
  startManualCheck: () => Promise<void>
  startManualDownload: () => Promise<void>
  resetManualCheck: () => void
  /**
   * True while the user is driving an update flow by hand (check/download in
   * progress or a manual result on screen). Decides placement: manual flows
   * render in place where clicked; background finds promote to the top.
   */
  manualUpdateActive: boolean
  setUpdateAvailable: (info: { version: string }) => void
  setUpdateProgress: (progress: UpdateProgress) => void
  setUpdateDownloaded: (info: { version: string }) => void
  dismissUpdate: () => void
  installUpdate: () => Promise<void>
  setItems: (items: ClipboardItemDto[], meta?: { reason?: 'usage' | 'capture' }) => void
  setSettings: (next: Settings) => void
  /** Edge the panel is dragged to; it replaces settings.stickPosition until the drag ends. */
  liveEdge: StickPosition | null
  liveBaseEdge: StickPosition
  setLiveEdge: (edge: StickPosition | null) => void

  /* UI */
  setQuery: (q: string) => void
  setOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  settingsTab: 'behaviour' | 'position' | 'appearance'
  setSettingsTab: (tab: 'behaviour' | 'position' | 'appearance') => void
  setDragActive: (active: boolean) => void
  setInternalDragReq: (req: import('../../shared/types').DragRequest | null) => void
  setPreviewItemId: (id: string | null, rect?: { x?: number; y?: number; width?: number; height?: number }) => void
  styleFlyoutOpen: boolean
  styleFlyoutAnchorRect: { x?: number; y?: number; width?: number; height?: number } | null
  setStyleFlyoutOpen: (open: boolean, rect?: { x?: number; y?: number; width?: number; height?: number } | null) => void
  languageFlyoutOpen: boolean
  languageFlyoutAnchorRect: { x?: number; y?: number; width?: number; height?: number } | null
  setLanguageFlyoutOpen: (open: boolean, rect?: { x?: number; y?: number; width?: number; height?: number } | null) => void
  previewFlyoutRect: { top: number; bottom: number; left?: number; right?: number } | null
  setPreviewFlyoutRect: (rect: { top: number; bottom: number; left?: number; right?: number } | null) => void
  isInternalCopying: boolean
  copyFlareActive: boolean
  flareKey: number
  triggerCopyFlare: () => void

  /* toasts */
  pushToast: (toast: ToastMsg) => void
  dismissToast: (id: string) => void

  /* mutations (delegate to main) */
  togglePin: (id: string, pinned: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
  clear: (ids?: string[]) => Promise<void>
  copy: (id: string) => Promise<void>
  copySubitem: (req: DragRequest) => Promise<void>
  paste: (id: string, opts?: PasteOptions, fromKeyboard?: boolean) => Promise<void>
  pasteSubitem: (req: DragRequest) => Promise<void>
  pasteEmoji: (text: string) => Promise<void>
  patchSettings: (patch: Partial<Settings>) => Promise<void>
  refreshLaunchAtLogin: () => Promise<void>
  setLaunchAtLogin: (value: boolean) => void
  setTutorialStep: (step: number) => void
  edgeTransition: EdgeTransitionState | null
  startEdgeTransition: (to: 'left' | 'right' | 'top') => Promise<void>
}

export const useStore = create<AppState>((set, get) => ({
  items: [],
  itemsUsageOnly: false,
  settings: { ...DEFAULT_SETTINGS },
  hydrated: false,
  systemReduceMotion: false,
  setSystemReduceMotion: (systemReduceMotion) => {
    if (get().systemReduceMotion !== systemReduceMotion) set({ systemReduceMotion })
  },
  query: '',
  typeFilter: 'all',
  setTypeFilter: (typeFilter) => {
    if (get().typeFilter === typeFilter && !get().emojiOpen) return
    set({ typeFilter, emojiOpen: false, expandedStackId: null })
    // The list remounts on filter change; leave the flyout open and it
    // would float over a tab that no longer contains the source card.
    if (get().previewItemId) get().setPreviewItemId(null)
  },
  open: false,
  keyboardMode: false,
  activeItemId: null,
  enterKeyboardMode: () => {
    if (get().keyboardMode) return
    set({ keyboardMode: true })
    try {
      void edge.focusWindow(true)?.catch?.(() => {})
    } catch { /* ignore */ }
  },
  setActiveItemId: (activeItemId) => {
    if (get().activeItemId !== activeItemId) set({ activeItemId })
  },
  queueIds: [],
  queueIndex: {},
  setQueueIds: (ids) => {
    const prev = get().queueIds
    if (prev.length === ids.length && prev.every((id, i) => id === ids[i])) return
    const queueIndex: Record<string, number> = {}
    ids.forEach((id, i) => {
      if (!(id in queueIndex)) queueIndex[id] = i
    })
    set({ queueIds: ids, queueIndex })
  },
  selection: EMPTY_SELECTION,
  selectedMap: {},
  selectionTexts: {},
  selectionDragActive: false,
  toggleSelected: (id) => set(withSelection(toggleSelection(get().selection, id))),
  selectRangeTo: (id, order) => set(withSelection(selectRange(get().selection, order, id))),
  extendSelectionTo: (from, to, order) => set(withSelection(extendSelection(get().selection, order, from, to))),
  selectAllVisible: (order) => {
    if (order.length > SELECTION_LIMIT) {
      set(withSelection(selectAll(order.slice(0, SELECTION_LIMIT))))
      get().pushToast({ id: `selection-limit-${Date.now()}`, message: 'toast.selectionTooLarge', tone: 'error', params: { max: SELECTION_LIMIT } })
      return
    }
    set(withSelection(selectAll(order)))
  },
  keepSelectionWithin: (order) => {
    const current = get().selection
    if (current.ids.length === 0) return
    const next = pruneSelection(current, new Set(order))
    if (next !== current) set(withSelection(next))
  },
  clearSelection: () => {
    if (get().selection.ids.length > 0 || get().selection.anchor) set(withSelection(EMPTY_SELECTION))
  },
  selectedIdsInOrder: () => {
    const visible = new Set(getNavOrder())
    return orderSelection(get().items, get().selection.ids.filter((id) => visible.has(id))).map((it) => it.id)
  },
  async pasteSelection(plain, fromKeyboard) {
    const ids = selectionWithinLimit(get)
    if (!ids) return
    if (!fromKeyboard) handOffKeyboardForPaste(get, set)
    set({ isInternalCopying: true })
    try {
      const ok = await edge.pasteMulti({ ids, plain: !!plain })
      if (ok) get().clearSelection()
    } finally {
      setTimeout(() => set({ isInternalCopying: false }), 600)
    }
    if (fromKeyboard) resumeKeyboardAfterPaste(get)
  },
  async copySelection(plain) {
    const ids = selectionWithinLimit(get)
    if (!ids) return
    set({ isInternalCopying: true })
    try {
      await edge.copyMulti({ ids, plain: !!plain })
    } finally {
      setTimeout(() => set({ isInternalCopying: false }), 400)
    }
  },
  async stackSelection() {
    const ids = selectionWithinLimit(get)
    if (!ids || ids.length < 2) return
    const result = await edge.stackMulti(ids)
    if (result?.ok) set(withSelection(EMPTY_SELECTION))
  },
  async pinSelection(pinned) {
    const ids = selectionWithinLimit(get)
    if (!ids) return
    const idSet = new Set(ids)
    const previousPinned = new Map(get().items.filter((it) => idSet.has(it.id)).map((it) => [it.id, it.pinned]))
    set({ items: get().items.map((it) => (idSet.has(it.id) ? { ...it, pinned } : it)) })
    try {
      const items = await edge.pinMulti(ids, pinned)
      if (Array.isArray(items)) get().setItems(items)
    } catch {
      set({
        items: get().items.map((it) => {
          const was = previousPinned.get(it.id)
          return was === undefined || it.pinned !== pinned ? it : { ...it, pinned: was }
        })
      })
    }
  },
  async deleteSelection() {
    const ids = selectionWithinLimit(get)
    if (!ids) return
    set(withSelection(EMPTY_SELECTION))
    await get().clear(ids)
  },
  appIcons: {},
  requestAppIcon: (bundleId) => {
    if (!bundleId || bundleId in get().appIcons || appIconRequests.has(bundleId)) return
    appIconRequests.add(bundleId)
    let request: Promise<string | null>
    try {
      request = Promise.resolve(edge.getAppIcon(bundleId))
    } catch {
      request = Promise.resolve(null)
    }
    void request
      .then((icon) => (typeof icon === 'string' && icon ? icon : null))
      .catch(() => null)
      .then((icon) => {
        appIconRequests.delete(bundleId)
        set({ appIcons: { ...get().appIcons, [bundleId]: icon } })
      })
  },
  itemMenuOpen: false,
  showItemMenu: (id, sub) => {
    set({ itemMenuOpen: true })
    let request: Promise<void>
    try {
      request = Promise.resolve(sub ? edge.showItemMenu(id, sub) : edge.showItemMenu(id))
    } catch {
      request = Promise.resolve()
    }
    void request.catch(() => {}).then(() => set({ itemMenuOpen: false }))
  },
  textDragActive: false,
  setTextDragActive: (textDragActive) => {
    if (get().textDragActive !== textDragActive) set({ textDragActive })
  },
  renamingId: null,
  setRenamingId: (renamingId) => set({ renamingId }),
  async renameItem(id, title) {
    set({ renamingId: null })
    try {
      const items = await edge.setItemTitle(id, title.trim())
      if (Array.isArray(items)) get().setItems(items)
    } catch { /* ignore */ }
  },
  settingsOpen: false,
  settingsTab: 'behaviour',
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  emojiOpen: false,
  emojiCategory: 'smileys',
  setEmojiCategory: (emojiCategory) => set({ emojiCategory }),
  setEmojiOpen: (emojiOpen) => {
    if (emojiOpen) {
      // Every open lands on the first page: recents when any exist,
      // otherwise smileys. Scroll/budget reset happens in the picker.
      let landing: import('../lib/emoji/catalog').EmojiCategoryId = 'smileys'
      try {
        if (loadRecents().length > 0) landing = 'recents'
      } catch { /* ignore */ }
      set({
        emojiOpen: true,
        emojiCategory: landing,
        settingsOpen: false,
        previewItemId: null,
        previewItemRect: null,
        previewFlyoutRect: null,
        styleFlyoutOpen: false,
        styleFlyoutAnchorRect: null,
        languageFlyoutOpen: false,
        languageFlyoutAnchorRect: null,
        expandedStackId: null
      })
      edge.setPreviewMode(false)
    } else {
      set({ emojiOpen: false })
    }
  },
  dragActive: false,
  expandedStackId: null,
  setExpandedStackId: (expandedStackId) => set({ expandedStackId }),
  internalDragReq: null,
  toasts: [],
  tutorialStep: 0,
  currentVersion: '',
  isStoreBuild: false,
  updateInfo: null,
  previewItemId: null,
  previewItemRect: null,
  sliderActive: false,
  sliderReleasedTime: 0,
  setSliderActive: (active) => set({
    sliderActive: active,
    sliderReleasedTime: active ? 0 : Date.now()
  }),
  notifyPositionChanged: () => set({ sliderReleasedTime: Date.now() }),
  resetPositionChangedTime: () => {
    if (get().sliderReleasedTime !== 0) set({ sliderReleasedTime: 0 })
  },
  edgeHintActive: false,
  setEdgeHintActive: (active) => {
    if (get().edgeHintActive !== active) set({ edgeHintActive: active })
  },
  styleFlyoutOpen: false,
  styleFlyoutAnchorRect: null,
  setStyleFlyoutOpen: (open, rect) => {
    const isHorizontal = isHorizontalEdge(get().settings.stickPosition)
    if (open && get().languageFlyoutOpen) {
      set({ languageFlyoutOpen: false, languageFlyoutAnchorRect: null })
    }
    set({
      styleFlyoutOpen: open,
      styleFlyoutAnchorRect: open && rect ? rect : null,
      ...(open ? {} : { previewFlyoutRect: null })
    })
    // In horizontal mode (top), the flyout fits natively inside the 480px dock bounds.
    // Resizing the Electron window to 720px across IPC takes ~1s in Windows DWM, which caused
    // the flyout to mount squeezed vertically at 240px and then expand 1s later when the resize event fired.
    if (open && !isHorizontal) {
      edge.setPreviewMode(true)
    }
    // NOTE: Do NOT call edge.setPreviewMode(false) here when closing.
    // If we do, Electron immediately shrinks the window, cutting the flyout exit
    // spring in half (the 25%/75% split the user sees). Instead, IndicatorStyleFlyout's
    // AnimatePresence.onExitComplete callback is the one that calls setPreviewMode(false)
    // after the exit animation has fully settled.
  },
  languageFlyoutOpen: false,
  languageFlyoutAnchorRect: null,
  setLanguageFlyoutOpen: (open, rect) => {
    const isHorizontal = isHorizontalEdge(get().settings.stickPosition)
    if (open && get().styleFlyoutOpen) {
      set({ styleFlyoutOpen: false, styleFlyoutAnchorRect: null })
    }
    set({
      languageFlyoutOpen: open,
      languageFlyoutAnchorRect: open && rect ? rect : null,
      ...(open ? {} : { previewFlyoutRect: null })
    })
    if (open && !isHorizontal) {
      edge.setPreviewMode(true)
    }
  },
  isInternalCopying: false,
  copyFlareActive: false,
  flareKey: 0,

  async hydrate() {
    let lastError: unknown = null
    const load = async (): Promise<boolean> => {
      try {
        const { items, settings, version, isStoreBuild, updateInfo } = await edge.loadState()
        if (!Array.isArray(items) || !settings) throw new Error('state:load returned no state')
        const skipped = settings?.skippedUpdateVersion
        const validUpdateInfo = (updateInfo && (!skipped || updateInfo.latestVersion !== skipped)) ? updateInfo : null
        set({ 
          items, 
          settings, 
          currentVersion: version,
          isStoreBuild: isStoreBuild ?? false,
          updateInfo: validUpdateInfo ?? get().updateInfo,
          hydrated: true
        })
        return true
      } catch (err) {
        lastError = err
        return false
      }
    }
    if (hydrateRetryTimer) {
      clearTimeout(hydrateRetryTimer)
      hydrateRetryTimer = null
    }
    for (let attempt = 0; ; attempt++) {
      if (await load()) return
      const delay = HYDRATE_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    console.error('[hydrate] state:load keeps failing, retrying in the background', lastError)
    set({ hydrated: true })
    get().pushToast({ id: `load-failed-${Date.now()}`, message: 'toast.loadFailed', tone: 'error' })
    const retry = (): void => {
      hydrateRetryTimer = setTimeout(() => {
        hydrateRetryTimer = null
        void load().then((ok) => {
          if (!ok) retry()
        })
      }, HYDRATE_BACKGROUND_RETRY_MS)
    }
    retry()
  },

  manualCheckState: { status: 'idle' },
  manualUpdateActive: false,

  startManualCheck: async () => {
    set({ manualCheckState: { status: 'checking' }, manualUpdateActive: true })
    try {
      const res = await edge.checkForUpdatesManual()
      if (res.status === 'available') {
        set({
          manualCheckState: { status: 'available', version: res.version },
          updateInfo: { hasUpdate: true, latestVersion: res.version || '', downloaded: false },
          manualUpdateActive: true
        })
      } else if (res.status === 'up-to-date') {
        set({
          manualCheckState: { status: 'up-to-date', version: res.version },
          manualUpdateActive: false
        })
      } else {
        set({
          manualCheckState: { status: 'error', error: res.error || 'Check failed' },
          manualUpdateActive: false
        })
      }
    } catch (err: any) {
      set({
        manualCheckState: { status: 'error', error: err?.message || 'Check failed' },
        manualUpdateActive: false
      })
    }
  },

  startManualDownload: async () => {
    set({ manualCheckState: { status: 'downloading' }, manualUpdateActive: true })
    try {
      await edge.startUpdateDownload()
    } catch {
      set({ manualCheckState: { status: 'error', error: 'Download failed' } })
    }
  },

  resetManualCheck: () => set({ manualCheckState: { status: 'idle' } }),

  setUpdateAvailable: (info) => {
    // Session skip: a version dismissed this run is not re-prompted by
    // background pushes, but WILL prompt again after the next launch (the
    // "remind me next restart" contract). A different version clears the
    // session skip and surfaces normally. Manual checks bypass this.
    if (sessionSkippedVersion && info.version === sessionSkippedVersion) {
      console.log(`[Updater] Suppressing prompt for session-skipped v${info.version}`)
      return
    }
    if (sessionSkippedVersion && info.version !== sessionSkippedVersion) {
      sessionSkippedVersion = null
    }
    // A background find arriving while no manual flow owns the UI resets the
    // manual marker, so placement below keys off fresh truth, not stale flags.
    if (get().manualCheckState.status === 'idle') {
      set({ manualUpdateActive: false })
    }
    // A background find for a DIFFERENT version than a settled manual result
    // retires the stale manual result — the top card then shows the newer
    // version instead of two disagreeing prompts.
    const mc = get().manualCheckState
    if ((mc.status === 'available' || mc.status === 'up-to-date' || mc.status === 'error') && mc.version && mc.version !== info.version) {
      set({ manualCheckState: { status: 'idle' }, manualUpdateActive: false })
    }
    set({
      updateInfo: {
        hasUpdate: true,
        latestVersion: info.version,
        downloaded: false
      }
    })
  },

  setUpdateProgress: (progress) => {
    const current = get().updateInfo
    if (!current) {
      set({
        updateInfo: {
          hasUpdate: true,
          latestVersion: '',
          downloaded: false,
          downloadProgress: progress
        }
      })
      return
    }
    set({
      updateInfo: {
        ...current,
        downloadProgress: progress
      }
    })
  },

  setUpdateDownloaded: (info) => {
    set({
      updateInfo: {
        hasUpdate: true,
        latestVersion: info.version,
        downloaded: true,
        downloadProgress: undefined
      },
      manualCheckState: { status: 'idle' }
    })
  },

  dismissUpdate: () => {
    // Skip = "not now": remember for this session only. The next launch
    // re-prompts (nothing persisted), a newer version always surfaces.
    const skipped = get().updateInfo?.latestVersion || get().manualCheckState.version
    sessionSkippedVersion = skipped || null
    set({ updateInfo: null, manualCheckState: { status: 'idle' }, manualUpdateActive: false })
  },

  async installUpdate() {
    await edge.installUpdate()
  },

  setItems: (items, meta) => {
    const prevItems = get().items
    if (
      prevItems.length === items.length &&
      prevItems.every((it, i) => it.id === items[i]?.id && it.pinned === items[i]?.pinned && it.hitCount === items[i]?.hitCount && it.capturedAt === items[i]?.capturedAt && sameItemMeta(it, items[i]))
    ) {
      return
    }
    // Copy confirmation is owned by `ui:copy-flare` (App.tsx). Firing it again
    // here replayed the indicator after a slow capture (large spreadsheet)
    // finished — the hint already showed it ~780ms earlier.
    set({ items, itemsUsageOnly: isUsageOnlyUpdate(prevItems, items, meta?.reason) })
  },
  setSettings: (next) => set((s) => s.liveEdge
    ? { liveBaseEdge: next.stickPosition, settings: { ...next, stickPosition: s.liveEdge } }
    : { settings: next }),
  liveEdge: null,
  liveBaseEdge: DEFAULT_SETTINGS.stickPosition,
  setLiveEdge: (liveEdge) => set((s) => {
    if (liveEdge === s.liveEdge) return {}
    const base = s.liveEdge ? s.liveBaseEdge : s.settings.stickPosition
    const stickPosition = liveEdge ?? base
    return {
      liveEdge,
      liveBaseEdge: base,
      settings: s.settings.stickPosition === stickPosition ? s.settings : { ...s.settings, stickPosition }
    }
  }),

  setQuery: (query) => set({ query }),
  setOpen: (open) => {
    const wasKeyboard = !open && get().keyboardMode
    set(open ? { open } : { open, keyboardMode: false, activeItemId: null, renamingId: null, ...withSelection(EMPTY_SELECTION) })
    if (!open) {
      releaseFocusHold(wasKeyboard)
      // NOTE: Do NOT reset styleFlyoutOpen here — closePanel() handles the
      // sequencing so the flyout exit animation completes before the panel closes.
      // Only reset previewItemId so the normal preview flyout clears correctly.
      set({ previewItemId: null, previewItemRect: null, expandedStackId: null })
      edge.setPreviewMode(false)
    }
  },
  setSettingsOpen: (settingsOpen) => {
    set({
      settingsOpen,
      settingsTab: 'behaviour',
      previewItemId: null,
      previewItemRect: null,
      previewFlyoutRect: null,
      styleFlyoutOpen: false,
      styleFlyoutAnchorRect: null,
      languageFlyoutOpen: false,
      languageFlyoutAnchorRect: null,
      expandedStackId: null,
      emojiOpen: settingsOpen ? false : get().emojiOpen
    })
  },
  setDragActive: (dragActive) => {
    if (get().dragActive !== dragActive) set({ dragActive })
  },
  setInternalDragReq: (internalDragReq) => {
    if (internalDragReq === null) {
      set({ internalDragReq: null, dragActive: false, selectionDragActive: false })
    } else {
      set({ internalDragReq })
    }
    edge.setInternalDrag?.(!!internalDragReq)
  },
  previewFlyoutRect: null,
  setPreviewFlyoutRect: (rect) => set({ previewFlyoutRect: rect }),
  setPreviewItemId: (id, rect) => {
    set({ previewItemId: id, previewItemRect: rect || null, ...(id ? {} : { previewFlyoutRect: null }) })
    if (id) {
      edge.setPreviewMode(true)
    }
  },
  triggerCopyFlare: () => {
    if (get().settings.showCopyIndicator === false) return
    if (flareTimer) clearTimeout(flareTimer)
    // Already showing: only extend the hold. Restarting flareKey mid-flight
    // is what made the indicator look late (hint, then items-push retrigger).
    if (!get().copyFlareActive) {
      set({ copyFlareActive: true, flareKey: Date.now() })
      if (!get().open) {
        edge.setPreviewMode(true)
      }
    }
    flareTimer = setTimeout(() => {
      set({ copyFlareActive: false })
      if (!get().open && !get().previewItemId && !get().styleFlyoutOpen) {
        edge.setPreviewMode(false)
      }
      flareTimer = null
    }, 780)
  },

  pushToast: (toast) => {
    set({ toasts: [...get().toasts, toast] })
    // Auto-dismiss after 2.6s. Errors linger slightly longer for readability.
    const ttl = toast.tone === 'error' ? 3400 : 2600
    setTimeout(() => get().dismissToast(toast.id), ttl)
  },

  dismissToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

  async togglePin(id, pinned) {
    // Optimistic: flip locally, then let the pushed list confirm.
    set({
      items: get().items.map((it) => (it.id === id ? { ...it, pinned } : it))
    })
    const items = await edge.setPinned(id, pinned)
    const current = get().items
    if (items.length !== current.length || items.some((it, i) => it.id !== current[i]?.id || it.pinned !== current[i]?.pinned)) {
      set({ items })
    }
  },

  async remove(id) {
    const previousItems = get().items
    set({ items: previousItems.filter((it) => it.id !== id) })
    try {
      const items = await edge.deleteItem(id)
      const current = get().items
      if (items.length !== current.length || items.some((it, i) => it.id !== current[i]?.id)) {
        set({ items })
      }
    } catch {
      // Do not leave the UI claiming an item was deleted when the main-process
      // persistence request failed (for example during a renderer reload).
      set({ items: previousItems })
      get().pushToast({ id: `delete-${Date.now()}`, message: t('toast.deleteFailed'), tone: 'error' })
    }
  },

  async clear(ids?: string[]) {
    if (!ids || ids.length === 0) {
      const previousItems = get().items
      set({ items: previousItems.filter((it) => it.pinned) })
      try {
        const items = await edge.clearItems()
        const current = get().items
        if (items.length !== current.length || items.some((it, i) => it.id !== current[i]?.id)) {
          set({ items })
        }
      } catch {
        set({ items: previousItems })
        get().pushToast({ id: `clear-${Date.now()}`, message: t('toast.clearFailed'), tone: 'error' })
      }
    } else {
      const previousItems = get().items
      const idSet = new Set(ids)
      set({ items: previousItems.filter((it) => !idSet.has(it.id)) })
      try {
        const items = await edge.deleteBatchItems(ids)
        const current = get().items
        if (items.length !== current.length || items.some((it, i) => it.id !== current[i]?.id)) {
          set({ items })
        }
      } catch {
        set({ items: previousItems })
        get().pushToast({ id: `clear-${Date.now()}`, message: t('toast.clearFailed'), tone: 'error' })
      }
    }
  },

  async copy(id) {
    // Internal copy from the clipboard: write to OS clipboard with internal copy
    // guard active so the external edge copy indicator flare does not appear.
    set({ isInternalCopying: true })
    try {
      await edge.copyItem(id)
    } finally {
      setTimeout(() => set({ isInternalCopying: false }), 400)
    }
  },

  async copySubitem(req) {
    set({ isInternalCopying: true })
    try {
      await edge.copySubitem(req)
    } finally {
      setTimeout(() => set({ isInternalCopying: false }), 400)
    }
  },

  async paste(id, opts, fromKeyboard) {
    if (!fromKeyboard) handOffKeyboardForPaste(get, set)
    set({ isInternalCopying: true })
    try {
      await (opts ? edge.pasteItem(id, opts) : edge.pasteItem(id))
    } finally {
      setTimeout(() => set({ isInternalCopying: false }), 600)
    }
    if (fromKeyboard) resumeKeyboardAfterPaste(get)
  },

  async pasteSubitem(req) {
    handOffKeyboardForPaste(get, set)
    set({ isInternalCopying: true })
    try {
      await edge.pasteSubitem(req)
    } finally {
      setTimeout(() => set({ isInternalCopying: false }), 600)
    }
  },

  async pasteEmoji(text) {
    handOffKeyboardForPaste(get, set)
    set({ isInternalCopying: true })
    try {
      await edge.pasteEmoji(text)
    } finally {
      setTimeout(() => set({ isInternalCopying: false }), 400)
    }
  },

  async patchSettings(patch) {
    const next = await edge.updateSettings(patch)
    set({ settings: next })
  },

  async refreshLaunchAtLogin() {
    try {
      const next = await edge.refreshLaunchAtLogin()
      if (next) set({ settings: next })
    } catch {
      /* ignore */
    }
  },

  setLaunchAtLogin(value) {
    set((s) => ({
      settings: { ...s.settings, launchAtLogin: value }
    }))
    void get().patchSettings({ launchAtLogin: value })
  },

  setTutorialStep: (step) => {
    set({ tutorialStep: step })
    edge.broadcastTutorialStep(step)
  },

  edgeTransition: null,
  async startEdgeTransition(to) {
    if (get().edgeTransition?.active) return
    const current = (get().settings.stickPosition || 'left') as 'left' | 'right' | 'top'
    if (current === to) return

    const reduceMotion = selectReduceMotion(get())

    if (reduceMotion) {
      playButtonClickSound()
      set({ settingsTab: 'position' })
      await get().patchSettings({ stickPosition: to })
      get().notifyPositionChanged()
      return
    }

    // 1. Edge-drop retracts into the bar (260ms)
    playEdgeRetractSound()
    set({
      edgeTransition: {
        active: true,
        from: current,
        to,
        stage: 'retracting'
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 260))

    // 2. Edge bar instantly fades away (100ms)
    set({
      edgeTransition: {
        active: true,
        from: current,
        to,
        stage: 'bar_fade_out'
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    // 3. Reposition window & patch settings to selected edge while invisible
    await get().patchSettings({ stickPosition: to })
    get().notifyPositionChanged()
    await new Promise((resolve) => setTimeout(resolve, 30))

    // 4. In selected edge, edge bar fades in (120ms)
    playEdgeBeaconAppearSound()
    set({
      settingsTab: 'position',
      edgeTransition: {
        active: true,
        from: current,
        to,
        stage: 'bar_fade_in'
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 120))

    // 5. Clipboard expands from the bar (300ms)
    playEdgeExpandSound()
    set({
      edgeTransition: {
        active: true,
        from: current,
        to,
        stage: 'expanding'
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 300))

    // 6. Reset transition state & start stay window from expansion completion
    set({ edgeTransition: null })
    get().notifyPositionChanged()
  }
}))

function withSelection(selection: Selection): { selection: Selection; selectedMap: Record<string, true> } {
  const selectedMap: Record<string, true> = {}
  for (const id of selection.ids) selectedMap[id] = true
  return { selection, selectedMap }
}

export function isUsageOnlyUpdate(prev: readonly ClipboardItemDto[], next: readonly ClipboardItemDto[], reason: 'usage' | 'capture' | undefined): boolean {
  if (reason !== 'usage') return false
  const known = new Set(prev.map((it) => it.id))
  return next.every((it) => known.has(it.id))
}

function releaseFocusHold(wasKeyboard: boolean): void {
  // Release any focused control inside the blade. Without this, a button
  // left focused from a click keeps matching the card's :focus-within
  // rule and its action bar stays lit after the next open.
  // (Accessed via globalThis with structural typing so this module keeps
  // compiling under the DOM-less node tsconfig.)
  const active = (globalThis as { document?: { activeElement?: { blur?: () => void } } }).document?.activeElement
  try { active?.blur?.() } catch { /* ignore */ }
  // If search held temporary OS focusability + paused hotkey through a
  // close path that skipped the input's blur (tray toggle, cursor
  // leave), restore both exactly once. No-op when search was never used.
  try {
    const searchEngaged = takeSearchEngaged()
    if (searchEngaged || wasKeyboard) {
      void edge.focusWindow(false)?.catch?.(() => {})
    }
    if (searchEngaged) {
      void edge.pauseHotkey(false)?.catch?.(() => {})
    }
  } catch { /* ignore */ }
}

function handOffKeyboardForPaste(get: () => AppState, set: (patch: Partial<AppState>) => void): void {
  if (edge.platform !== 'darwin') return
  const wasKeyboard = get().keyboardMode
  if (wasKeyboard) set({ keyboardMode: false })
  releaseFocusHold(wasKeyboard)
}

/**
 * The main process hands focus to the target app for ⌘V; once the keys have
 * landed, a keyboard paste takes it back so navigation goes on in the open panel.
 */
function resumeKeyboardAfterPaste(get: () => AppState): void {
  if (edge.platform !== 'darwin') return
  setTimeout(() => {
    const state = get()
    if (!state.open || !state.keyboardMode) return
    try {
      void edge.focusWindow(true)?.catch?.(() => {})
    } catch { /* ignore */ }
  }, KEYBOARD_REFOCUS_DELAY_MS)
}

function selectionWithinLimit(get: () => AppState): string[] | null {
  const state = get()
  const ids = state.selectedIdsInOrder()
  if (ids.length === 0) return null
  if (ids.length > SELECTION_LIMIT) {
    state.pushToast({ id: `selection-limit-${Date.now()}`, message: 'toast.selectionTooLarge', tone: 'error', params: { max: SELECTION_LIMIT } })
    return null
  }
  return ids
}

const SELECTION_TEXT_DELAY_MS = 300
const textRequests = new Set<string>()
let selectionTextTimer: ReturnType<typeof setTimeout> | null = null

function loadSelectionTexts(): void {
  const state = useStore.getState()
  const ids = state.selection.ids
  if (ids.length < 2 || ids.length > SELECTION_LIMIT) return
  const selected = orderSelection(state.items, ids)
  if (!allTextLike(selected)) return
  for (const item of selected) {
    if (item.data.kind !== 'text' || !item.data.hasFullPayload) continue
    if (item.id in state.selectionTexts || textRequests.has(item.id)) continue
    textRequests.add(item.id)
    let request: Promise<string>
    try {
      request = Promise.resolve(edge.getFullText(item.id))
    } catch {
      request = Promise.resolve('')
    }
    void request
      .catch(() => '')
      .then((full) => {
        textRequests.delete(item.id)
        if (typeof full !== 'string' || !full || !useStore.getState().selectedMap[item.id]) return
        useStore.setState({ selectionTexts: { ...useStore.getState().selectionTexts, [item.id]: full } })
      })
  }
}

useStore.subscribe((state, prev) => {
  if (state.items !== prev.items && state.selection.ids.length > 0) {
    const next = pruneSelection(state.selection, new Set(state.items.map((it) => it.id)))
    if (next !== state.selection) {
      useStore.setState(withSelection(next))
      return
    }
  }
  if (state.selection === prev.selection) return
  if (edge.platform !== 'darwin') return
  const kept: Record<string, string> = {}
  for (const id of Object.keys(state.selectionTexts)) if (state.selectedMap[id]) kept[id] = state.selectionTexts[id]
  if (Object.keys(kept).length !== Object.keys(state.selectionTexts).length) useStore.setState({ selectionTexts: kept })
  if (selectionTextTimer) clearTimeout(selectionTextTimer)
  selectionTextTimer = setTimeout(() => {
    selectionTextTimer = null
    loadSelectionTexts()
  }, SELECTION_TEXT_DELAY_MS)
})
