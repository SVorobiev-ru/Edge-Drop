import { edge } from '../lib/edge'
import { EMPTY_SELECTION } from '../../shared/selection'
import { isHorizontalEdge } from '../../shared/panelPlacement'
import { releaseFocusHold, withSelection } from './storeHelpers'
import type { AppState, StoreGet, StoreSet } from './types'

let flareTimer: ReturnType<typeof setTimeout> | null = null

export const createViewSlice = (set: StoreSet, get: StoreGet) => ({
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

  textDragActive: false,
  setTextDragActive: (textDragActive) => {
    if (get().textDragActive !== textDragActive) set({ textDragActive })
  },

  settingsOpen: false,
  settingsTab: 'behaviour',
  setSettingsTab: (settingsTab) => set({ settingsTab }),

  dragActive: false,
  expandedStackId: null,
  setExpandedStackId: (expandedStackId) => set({ expandedStackId }),
  internalDragReq: null,
  toasts: [],
  tutorialStep: 0,

  previewItemId: null,
  previewItemRect: null,

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

  setTutorialStep: (step) => {
    set({ tutorialStep: step })
  }
}) satisfies Partial<AppState>
