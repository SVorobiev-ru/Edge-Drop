import { edge } from './edge'
import { useStore } from '../store/appStore'
import type { SolidRect } from '../../shared/types'
import { PANEL_LAYOUT_EVENT } from './panelPosition'

const PANEL_STATE_SETTLE_MS = 450
const PANEL_STATE_RENEW_MS = 1500

function solidRectOf(el: Element | null): SolidRect | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!(r.width > 0 && r.height > 0)) return null
  const x = Math.floor(r.left)
  const y = Math.floor(r.top)
  return { x, y, width: Math.ceil(r.right) - x, height: Math.ceil(r.bottom) - y }
}

function collectSolidRects(root: ParentNode = document): SolidRect[] {
  const rects: SolidRect[] = []
  const blade = root.querySelector('.blade-container.is-morphing') ? null : solidRectOf(root.querySelector('.blade'))
  if (blade) rects.push(blade)
  root.querySelectorAll('[data-preview-flyout]').forEach((el) => {
    const rect = solidRectOf(el)
    if (rect) rects.push(rect)
  })
  return rects
}

export function startPanelStateReporter(): () => void {
  let frame: number | undefined
  let settleUntil = 0
  let lastKey = ''

  const send = (force: boolean) => {
    const { open, settings } = useStore.getState()
    const rects = open ? collectSolidRects() : []
    const key = JSON.stringify([open, rects, settings.stickPosition])
    if (!force && key === lastKey) return
    lastKey = key
    try {
      void edge.setPanelState({ open, rects, edge: settings.stickPosition })?.catch?.(() => {})
    } catch { /* ignore */ }
  }

  const loop = () => {
    frame = undefined
    if (Date.now() < settleUntil) {
      send(false)
      frame = window.requestAnimationFrame(loop)
      return
    }
    send(true)
  }

  const kick = () => {
    settleUntil = Date.now() + PANEL_STATE_SETTLE_MS
    if (frame === undefined) frame = window.requestAnimationFrame(loop)
  }

  const unsubscribe = useStore.subscribe((state, prev) => {
    if (prev.open && !state.open) send(false)
    if (
      state.open !== prev.open ||
      state.previewItemId !== prev.previewItemId ||
      state.styleFlyoutOpen !== prev.styleFlyoutOpen ||
      state.languageFlyoutOpen !== prev.languageFlyoutOpen ||
      state.settingsOpen !== prev.settingsOpen ||
      state.emojiOpen !== prev.emojiOpen ||
      state.settings !== prev.settings ||
      state.toasts !== prev.toasts ||
      state.dragActive !== prev.dragActive ||
      state.sliderActive !== prev.sliderActive ||
      state.edgeTransition !== prev.edgeTransition
    ) {
      kick()
    }
  })
  const renew = window.setInterval(() => {
    if (useStore.getState().open) send(true)
  }, PANEL_STATE_RENEW_MS)
  window.addEventListener('resize', kick)
  window.addEventListener(PANEL_LAYOUT_EVENT, kick)
  kick()

  return () => {
    unsubscribe()
    window.clearInterval(renew)
    window.removeEventListener('resize', kick)
    window.removeEventListener(PANEL_LAYOUT_EVENT, kick)
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    frame = undefined
  }
}
