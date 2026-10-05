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
import { SELECTION_LIMIT, allTextLike, orderSelection, pruneSelection } from '../../shared/selection'
import type { AppState } from './types'
import { isUsageOnlyUpdate, selectReduceMotion, withSelection } from './storeHelpers'
import { createItemsSlice } from './itemsSlice'
import { createEmojiSlice } from './emojiSlice'
import { createEdgeTransitionSlice } from './edgeTransitionSlice'
import { createSelectionSlice } from './selectionSlice'
import { createViewSlice } from './viewSlice'
import { createSettingsSlice } from './settingsSlice'
import { createUpdaterSlice } from './updaterSlice'

export type { EdgeTransitionStage, EdgeTransitionState, ToastMsg, UpdateProgress } from './types'
export { isUsageOnlyUpdate, selectReduceMotion }

export const useStore = create<AppState>((set, get) => ({
  ...createItemsSlice(set, get),
  ...createSettingsSlice(set, get),
  ...createViewSlice(set, get),
  ...createSelectionSlice(set, get),
  ...createUpdaterSlice(set, get),
  ...createEmojiSlice(set),
  ...createEdgeTransitionSlice(set, get)
}))

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
