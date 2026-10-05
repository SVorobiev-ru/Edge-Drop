import type React from 'react'
import { edge } from '../lib/edge'
import { useStore } from '../store/appStore'
import { currentSizePatch, setSizePatch, type PanelSizePatch } from '../lib/panelPosition'
import { startPointerSession } from '../lib/pointerSession'
import { createSignal, useSignalValue } from '../lib/signal'
import { isHorizontalEdge, lengthPatch, panelSizes, resizeCursor, thicknessPatch, type ResizeSide } from '../../shared/panelPlacement'
import type { PanelCursor } from '../../shared/types'

const liveSignal = createSignal()
let resizing = false
let shownCursor: PanelCursor = null

function setLivePatch(patch: PanelSizePatch | null): void {
  if (currentSizePatch() === patch) return
  setSizePatch(patch)
  liveSignal.emit()
}

/**
 * Width shown while the inner edge of a side panel is dragged, null otherwise.
 * The live sizes live outside the settings, so a settings push mid-drag cannot reset them.
 */
export function currentPanelLiveWidth(): number | null {
  return currentSizePatch()?.panelWidth ?? null
}

export function usePanelSizePatch(): PanelSizePatch | null {
  return useSignalValue(liveSignal, currentSizePatch, () => null)
}

function showCursor(cursor: PanelCursor): void {
  shownCursor = cursor
  try {
    void edge.setPanelCursor(cursor)?.catch?.(() => {})
  } catch { /* ignore */ }
}

function changed(patch: PanelSizePatch, settings: PanelSizePatch): boolean {
  return (Object.keys(patch) as Array<keyof PanelSizePatch>).some((key) => patch[key] !== settings[key])
}

function startResize(e: React.PointerEvent<HTMLElement>, side: ResizeSide): void {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const el = e.currentTarget
  const pointerId = e.pointerId
  const state = useStore.getState()
  const settings = state.settings
  const stick = settings.stickPosition
  const sizes = panelSizes(settings)
  const offset = (isHorizontalEdge(stick) ? settings.horizontalOffset : settings.verticalOffset) ?? 0.5
  const startX = e.clientX
  const startY = e.clientY
  let patch: PanelSizePatch | null = null
  let last = { x: startX, y: startY }

  const onMove = (ev: PointerEvent) => {
    last = { x: ev.clientX, y: ev.clientY }
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    patch = side === 'inner'
      ? thicknessPatch({ edge: stick, sizes, dx, dy })
      : lengthPatch({ edge: stick, side, area: { width: window.innerWidth, height: window.innerHeight }, sizes, offset, delta: isHorizontalEdge(stick) ? dx : dy })
    setLivePatch(patch)
  }
  const onEnd = (commit: boolean) => {
    resizing = false
    const r = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null
    if (!r || last.x < r.left || last.x > r.right || last.y < r.top || last.y > r.bottom) showCursor(null)
    const s = useStore.getState()
    s.setSliderActive(false)
    const final = patch
    if (!commit || !final || !changed(final, s.settings)) {
      setLivePatch(null)
      return
    }
    void s.patchSettings(final).catch(() => {}).finally(() => {
      if (currentSizePatch() === final) setLivePatch(null)
    })
  }

  startPointerSession(el, pointerId, { onMove, onEnd })
  resizing = true
  state.setSliderActive(true)
  showCursor(resizeCursor(stick, side))
}

/** Puts the normal pointer back when the grips go away under it, e.g. when the panel closes. */
export function releasePanelCursor(): void {
  if (!resizing && shownCursor) showCursor(null)
}

/** Pointer-down handler for the inner-edge resize grip of the panel. */
export function onPanelResizePointerDown(e: React.PointerEvent<HTMLElement>): void {
  startResize(e, 'inner')
}

/** Props for a resize grip: pointer handling and the cursor shown over it. */
export function panelResizeGripProps(side: ResizeSide, stick: Parameters<typeof resizeCursor>[0]) {
  const cursor = resizeCursor(stick, side)
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => startResize(e, side),
    onPointerEnter: () => showCursor(cursor),
    onPointerLeave: () => {
      if (!resizing) showCursor(null)
    },
    cursor
  }
}
