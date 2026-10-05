import { edge } from '../lib/edge'
import { takeSearchEngaged } from '../lib/searchFocus'
import type { ClipboardItemDto, Settings } from '../../shared/types'
import { SELECTION_LIMIT, type Selection } from '../../shared/selection'
import type { AppState } from './types'

const KEYBOARD_REFOCUS_DELAY_MS = 250

export function sameItemMeta(a: ClipboardItemDto, b: ClipboardItemDto | undefined): boolean {
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

export function withSelection(selection: Selection): { selection: Selection; selectedMap: Record<string, true> } {
  const selectedMap: Record<string, true> = {}
  for (const id of selection.ids) selectedMap[id] = true
  return { selection, selectedMap }
}

export function isUsageOnlyUpdate(prev: readonly ClipboardItemDto[], next: readonly ClipboardItemDto[], reason: 'usage' | 'capture' | undefined): boolean {
  if (reason !== 'usage') return false
  const known = new Set(prev.map((it) => it.id))
  return next.every((it) => known.has(it.id))
}

export function releaseFocusHold(wasKeyboard: boolean): void {
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

export function handOffKeyboardForPaste(get: () => AppState, set: (patch: Partial<AppState>) => void): void {
  if (edge.platform !== 'darwin') return
  const wasKeyboard = get().keyboardMode
  if (wasKeyboard) set({ keyboardMode: false })
  releaseFocusHold(wasKeyboard)
}

/**
 * The main process hands focus to the target app for ⌘V; once the keys have
 * landed, a keyboard paste takes it back so navigation goes on in the open panel.
 */
export function resumeKeyboardAfterPaste(get: () => AppState): void {
  if (edge.platform !== 'darwin') return
  setTimeout(() => {
    const state = get()
    if (!state.open || !state.keyboardMode) return
    try {
      void edge.focusWindow(true)?.catch?.(() => {})
    } catch { /* ignore */ }
  }, KEYBOARD_REFOCUS_DELAY_MS)
}

export function selectionWithinLimit(get: () => AppState): string[] | null {
  const state = get()
  const ids = state.selectedIdsInOrder()
  if (ids.length === 0) return null
  if (ids.length > SELECTION_LIMIT) {
    state.pushToast({ id: `selection-limit-${Date.now()}`, message: 'toast.selectionTooLarge', tone: 'error', params: { max: SELECTION_LIMIT } })
    return null
  }
  return ids
}
