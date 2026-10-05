/**
 * Type definition for the preload bridge API surface.
 *
 * Both the preload (implements) and renderer (consumes) import this so the
 * contract lives in one place. The actual implementation lives in the preload;
 * the renderer only ever sees `window.edge` typed as this interface.
 */
import type { Settings } from './types'
import type { DragRequest, ItemMenuRequest } from './types'

export interface EdgeApi {
  /* Renderer -> Main */
  loadState: () => Promise<{
    items: import('./types').ClipboardItemDto[]
    settings: Settings
    version: string
    isStoreBuild?: boolean
    updateInfo?: {
      hasUpdate: boolean
      latestVersion: string
      downloaded: boolean
      downloadProgress?: { percent: number; bytesPerSecond?: number; transferred?: number; total?: number }
    } | null
  }>
  setPinned: (id: string, pinned: boolean) => Promise<import('./types').ClipboardItemDto[]>
  deleteItem: (id: string) => Promise<import('./types').ClipboardItemDto[]>
  deleteBatchItems: (ids: string[]) => Promise<import('./types').ClipboardItemDto[]>
  clearItems: () => Promise<import('./types').ClipboardItemDto[]>
  getFullText: (id: string) => Promise<string>
  removeSubitem: (req: DragRequest) => Promise<boolean>
  copyItem: (id: string) => Promise<boolean>
  copySubitem: (req: DragRequest) => Promise<boolean>
  pasteItem: (id: string, opts?: import('./types').PasteOptions) => Promise<boolean>
  pasteSubitem: (req: DragRequest) => Promise<boolean>
  pasteEmoji: (text: string) => Promise<boolean>
  installUpdate: () => Promise<void>
  checkForUpdatesManual: () => Promise<{ status: string; version?: string; error?: string }>
  startUpdateDownload: () => Promise<void>
  getUpdateState: () => Promise<{
    hasUpdate: boolean
    latestVersion: string
    downloaded: boolean
    downloadProgress?: { percent: number; bytesPerSecond?: number; transferred?: number; total?: number }
  } | null>
  quitApp: () => Promise<void>
  /**
   * Begin a native OS drag-out. Fire-and-forget: must be called synchronously
   * from the DOM `dragstart` event, and main calls `event.sender.startDrag`.
   */
  startDrag: (req: DragRequest) => void
  /**
   * Pre-stage a drag request in the background (e.g. on hover or pointerdown)
   * so drag initiation is 0ms.
   */
  prestageDrag: (req: DragRequest) => void
  addFiles: (paths: string[]) => Promise<import('./types').ClipboardItemDto[]>
  addItemData: (data: import('./types').ItemData) => Promise<import('./types').ClipboardItemDto[]>
  mergeItems: (sourceId: string, targetId: string) => Promise<import('./types').MergeResult>
  splitItem: (req: import('./types').DragRequest) => Promise<boolean>
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>
  refreshLaunchAtLogin: () => Promise<Settings>
  setInteractive: (value: boolean) => Promise<void>
  setPreviewMode: (active: boolean) => Promise<void>
  pauseHotkey: (paused: boolean) => Promise<void>
  revealFile: (path: string) => Promise<boolean>
  minimizeWindow: () => Promise<void>
  focusWindow: (focusable?: boolean) => Promise<void>
  getDisplays: () => Promise<import('./types').DisplayInfo[]>
  getAccessibilityStatus: () => Promise<boolean | null>
  requestAccessibility: () => Promise<boolean | null>
  openAccessibilitySettings: () => Promise<void>
  setHotkey: (accelerator: string) => Promise<import('./types').HotkeyResult>
  showItemMenu: (id: string, sub?: ItemMenuRequest) => Promise<void>
  quickLook: (id: string, path?: string) => Promise<boolean>
  setItemTitle: (id: string, title: string) => Promise<import('./types').ClipboardItemDto[]>
  listRunningApps: () => Promise<import('./types').AppInfo[]>
  pickApp: () => Promise<import('./types').AppInfo | null>
  getAppIcon: (bundleId: string) => Promise<string | null>
  exportHistory: () => Promise<{ ok: boolean; path?: string; count?: number }>
  importHistory: () => Promise<{ ok: boolean; count?: number }>
  queueAdd: (id: string) => Promise<string[]>
  queueClear: () => Promise<void>
  platform: string
  setPanelState: (state: { open: boolean; rects: import('./types').SolidRect[]; edge?: import('./types').StickPosition }) => Promise<void>
  panelDragStart: (blade: import('./types').SolidRect) => Promise<boolean>
  panelDragEnd: (commit: boolean) => Promise<import('./types').PanelDragResult | null>
  panelDragReveal: () => Promise<void>
  setPanelCursor: (cursor: import('./types').PanelCursor) => Promise<void>
  copyMulti: (req: import('./types').MultiRequest) => Promise<boolean>
  pasteMulti: (req: import('./types').MultiRequest) => Promise<boolean>
  stackMulti: (ids: string[]) => Promise<import('./types').MergeResult>
  pinMulti: (ids: string[], pinned: boolean) => Promise<import('./types').ClipboardItemDto[]>
  startDragMulti: (ids: string[]) => void
  setInternalDrag: (active: boolean) => void
  broadcastTutorialStep: (step: number) => void

  /* Main -> Renderer */
  onItems: (cb: (items: import('./types').ClipboardItemDto[], meta?: { reason?: 'usage' | 'capture' }) => void) => () => void
  onSettings: (cb: (settings: Settings) => void) => () => void
  onToggle: (cb: (open?: boolean, meta?: { source?: import('./types').ToggleSource }) => void) => () => void
  onOpenSettings: (cb: () => void) => () => void
  onSearch: (cb: (query: string) => void) => () => void
  onItemMenuAction: (cb: (req: { id: string; action: import('./types').ItemMenuAction }) => void) => () => void
  onQueueState: (cb: (state: { ids: string[] }) => void) => () => void
  onDragEnd: (cb: () => void) => () => void
  onInternalDrop: (cb: (pos: { x: number; y: number }) => void) => () => void
  onCursorEdge: (cb: (data: {
    x: number
    y: number
    inEdge: boolean
    inZone: boolean
    stickPosition: import('./types').StickPosition
    displayWidth: number
    displayHeight: number
  }) => void) => () => void
  onPanelDragPlacement: (cb: (placement: import('./types').PanelDragPlacement) => void) => () => void
  onToast: (cb: (toast: { id: string; message: string; tone: 'info' | 'error'; params?: Record<string, string | number> }) => void) => () => void
  onCopyFlare: (cb: () => void) => () => void
  onTutorialStep: (cb: (step: number) => void) => () => void
  onUpdateAvailable: (cb: (info: { version: string }) => void) => () => void
  onUpdateProgress: (cb: (progress: { percent: number; bytesPerSecond?: number; transferred?: number; total?: number }) => void) => () => void
  onUpdateDownloaded: (cb: (info: { version: string }) => void) => () => void
}
