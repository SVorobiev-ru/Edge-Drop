import { useStore } from '../store/appStore'
import { edge, IS_DARWIN } from './edge'
import { findItemElement } from './listAnchor'

const CLOSE_RELEASE_MS = 300

let closing = false
let releaseTimer: number | undefined

export function releaseInteractive(): void {
  try {
    void edge.setInteractive(false)?.catch?.(() => {})
  } catch { /* ignore */ }
}

export function isShelfClosing(): boolean {
  return closing
}

export function watchShelfClose(): () => void {
  const unsubscribe = useStore.subscribe((state, prev) => {
    if (state.open === prev.open) return
    closing = false
    if (state.open) return
    if (releaseTimer !== undefined) window.clearTimeout(releaseTimer)
    releaseTimer = window.setTimeout(() => {
      releaseTimer = undefined
      if (!useStore.getState().open) releaseInteractive()
    }, CLOSE_RELEASE_MS)
  })
  return () => {
    unsubscribe()
    if (releaseTimer !== undefined) window.clearTimeout(releaseTimer)
    releaseTimer = undefined
  }
}

export function closeShelf(): void {
  const state = useStore.getState()
  if (state.open) closing = true
  // If the indicator style flyout is open, let its exit spring play first
  // before collapsing the main panel — same sequencing as useEdgeHover's
  // closePanel(). Without this, both animate simultaneously and it looks broken.
  if (state.styleFlyoutOpen) {
    state.setStyleFlyoutOpen(false)
    window.setTimeout(() => {
      const s = useStore.getState()
      if (s.previewItemId) {
        s.setPreviewItemId(null)
        releaseInteractive()
        window.setTimeout(() => { useStore.getState().setOpen(false) }, 240)
      } else {
        s.setOpen(false)
        releaseInteractive()
      }
    }, 300)
  } else if (state.previewItemId) {
    state.setPreviewItemId(null)
    releaseInteractive()
    window.setTimeout(() => {
      useStore.getState().setOpen(false)
    }, 240)
  } else {
    state.setOpen(false)
    releaseInteractive()
  }
}

/**
 * View reset after the blade has retracted. macOS keeps the view as it was
 * (Settings, emoji, search), so the next open shows the same place.
 */
export function resetViewAfterClose(keepView = IS_DARWIN): void {
  const state = useStore.getState()
  if (state.open || keepView) return
  state.setSettingsOpen(false)
  state.setQuery('')
  state.setEmojiOpen(false)
}

export function openShelf(): void {
  closing = false
  useStore.getState().setOpen(true)
  try {
    void edge.setInteractive(true)?.catch?.(() => {})
  } catch { /* ignore */ }
}

function openPreviewFlyout(id: string): void {
  const rect = findItemElement(document, id)?.getBoundingClientRect()
  useStore.getState().setPreviewItemId(id, rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined)
}

export function openItemPreview(id: string): void {
  const state = useStore.getState()
  const item = state.items.find((it) => it.id === id)
  if (!item) return
  if (state.previewItemId === id) {
    state.setPreviewItemId(null)
    return
  }
  if (item.data.kind === 'text' || edge.platform !== 'darwin') {
    openPreviewFlyout(id)
    return
  }
  let request: Promise<boolean>
  try {
    request = Promise.resolve(edge.quickLook(id))
  } catch {
    request = Promise.resolve(false)
  }
  void request
    .then((ok) => {
      if (ok === false) openPreviewFlyout(id)
    })
    .catch(() => openPreviewFlyout(id))
}
