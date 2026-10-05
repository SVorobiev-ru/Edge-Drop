import type { ClipboardItemDto } from '../../../shared/types'
import type { DragRequest, ItemMenuRequest } from '../../../shared/types'
import { useStore } from '../../store/appStore'
import { fileStreamUrl as localFileStreamUrl } from '../../lib/format'
import { edge, IS_DARWIN } from '../../lib/edge'
import { SELECTION_LIMIT, allTextLike, joinTextParts, orderSelection } from '../../../shared/selection'

export function releaseFocus(e: React.MouseEvent<HTMLElement>): void {
  if (!IS_DARWIN) e.currentTarget.blur()
}

export function openItemMenu(e: React.MouseEvent, id: string, sub?: DragRequest): void {
  if (!IS_DARWIN) return
  e.preventDefault()
  e.stopPropagation()
  const state = useStore.getState()
  if (!sub && state.selection.ids.length > 1 && state.selectedMap[id]) {
    const request: ItemMenuRequest = { id, selection: state.selectedIdsInOrder() }
    state.showItemMenu(id, request)
    return
  }
  state.showItemMenu(id, sub)
}

export function startSelectionDrag(e: React.DragEvent): void {
  const state = useStore.getState()
  const ids = state.selectedIdsInOrder()
  if (ids.length > SELECTION_LIMIT) {
    e.preventDefault()
    state.pushToast({ id: `selection-limit-${Date.now()}`, message: 'toast.selectionTooLarge', tone: 'error', params: { max: SELECTION_LIMIT } })
    return
  }
  const items = orderSelection(state.items, ids)
  if (IS_DARWIN && e.dataTransfer && allTextLike(items)) {
    const joined = joinTextParts(
      items.map((it) => {
        const data = it.data as Extract<ClipboardItemDto['data'], { kind: 'text' }>
        return { text: state.selectionTexts[it.id] ?? data.text, html: data.html }
      }),
      false
    )
    e.dataTransfer.setData('text/plain', joined.text)
    if (joined.html) e.dataTransfer.setData('text/html', joined.html)
    e.dataTransfer.effectAllowed = 'copy'
    state.setTextDragActive(true)
    return
  }
  e.preventDefault()
  state.setInternalDragReq({ id: ids[0] })
  useStore.setState({ selectionDragActive: true })
  edge.startDragMulti(ids)
}

/**
 * Full-resolution streaming URL for a local file. Used as the load-failure
 * fallback for bounded thumbnails: Electron's nativeImage decodes only
 * PNG/JPEG, so formats like GIF answer 415 from edgelocal://thumb and the
 * tile swaps to this URL — Chromium then renders (and animates) natively.
 */
export function fileStreamUrl(filePath: string): string {
  return localFileStreamUrl(filePath)
}
