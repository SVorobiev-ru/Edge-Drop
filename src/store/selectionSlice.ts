import { edge } from '../lib/edge'
import { EMPTY_SELECTION, SELECTION_LIMIT, extendSelection, orderSelection, pruneSelection, selectAll, selectRange, toggleSelection } from '../../shared/selection'
import { getNavOrder } from '../lib/keyboardNav'
import { handOffKeyboardForPaste, resumeKeyboardAfterPaste, selectionWithinLimit, withSelection } from './storeHelpers'
import type { AppState, StoreGet, StoreSet } from './types'

export const createSelectionSlice = (set: StoreSet, get: StoreGet) => ({
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
  }
}) satisfies Partial<AppState>
