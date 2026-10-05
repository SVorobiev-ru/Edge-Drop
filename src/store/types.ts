import type { StateCreator } from 'zustand'
import type { ClipboardItemDto, Settings, DragRequest, ItemMenuRequest, PasteOptions, StickPosition } from '../../shared/types'
import type { Selection } from '../../shared/selection'

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

export interface AppState {
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

export type StoreSet = Parameters<StateCreator<AppState>>[0]
export type StoreGet = Parameters<StateCreator<AppState>>[1]
