/**
 * Moving the panel by dragging an empty part of its header (macOS).
 *
 * After a small threshold the main process takes over: it keeps the panel
 * attached to the edge nearest to the cursor, on the display under it, and
 * streams that placement here while the button is held. Release saves the
 * placement; nothing about the window changes when the drag starts.
 */
import type React from 'react'
import { edge, IS_DARWIN } from '../lib/edge'
import { useStore } from '../store/appStore'
import { playEdgeExpandSound } from '../lib/soundEffects'
import { applyPanelPosition, currentLivePlacement, noteEdgeChange, setLivePlacement } from '../lib/panelPosition'
import { startPointerSession } from '../lib/pointerSession'
import { createSignal, useSignalValue } from '../lib/signal'
import type { PanelDragPlacement, SolidRect, StickPosition } from '../../shared/types'

const DRAG_THRESHOLD_PX = 4

export const PANEL_DRAG_EXCLUDE_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'a',
  'label',
  '[role="button"]',
  '[role="radio"]',
  '[role="radiogroup"]',
  '[role="tab"]',
  '[role="tablist"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[contenteditable="true"]',
  '[draggable="true"]',
  '.rubber-segment',
  '.header-search',
  '.footer-capsule'
].join(', ')

interface ClosestTarget {
  closest(selector: string): unknown
}

interface DragHandle {
  contains(node: unknown): boolean
}

/**
 * True for a press on empty space of the handle itself. Portal menus bubble
 * through the React tree, so presses outside the handle's DOM are ignored.
 */
export function isPanelDragTarget(target: unknown, handle?: DragHandle): boolean {
  if (!target || typeof (target as ClosestTarget).closest !== 'function') return false
  if (handle && !handle.contains(target)) return false
  return !(target as ClosestTarget).closest(PANEL_DRAG_EXCLUDE_SELECTOR)
}

let snapping = false
let ending = false
const snapSignal = createSignal()

function setSnapping(value: boolean): void {
  if (snapping === value) return
  snapping = value
  snapSignal.emit()
}

/** True between the drop and the reveal: the panel re-lays out without transitions. */
export function usePanelSnapping(): boolean {
  return useSignalValue(snapSignal, () => snapping, () => false)
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

function bladeRect(el: Element): SolidRect | null {
  const blade = el.closest('.blade')
  if (!blade) return null
  const r = blade.getBoundingClientRect()
  if (!(r.width > 0 && r.height > 0)) return null
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
}

let unsubscribePlacement: (() => void) | null = null
const REVEAL_WAIT_FRAMES = 30

function stopPlacementUpdates(): void {
  unsubscribePlacement?.()
  unsubscribePlacement = null
}

/** Redraws the panel for a new edge or offset; an edge change re-renders the panel, which applies the position itself. */
function redraw(from: StickPosition, to: StickPosition, sameDisplay: boolean): void {
  if (from === to) {
    applyPanelPosition()
    return
  }
  noteEdgeChange(from, to, sameDisplay)
}

function viewportMatches(area: PanelDragPlacement['area']): boolean {
  return window.innerWidth === area.width && window.innerHeight === area.height
}

/** The window moved to another display and is hidden until the panel is drawn there. */
async function revealOnNewDisplay(placement: PanelDragPlacement): Promise<void> {
  const onDisplay = () => currentLivePlacement()?.displayId === placement.displayId
  for (let i = 0; i < REVEAL_WAIT_FRAMES && !viewportMatches(placement.area); i++) await nextFrame()
  if (!onDisplay()) return
  applyPanelPosition()
  await nextFrame()
  await nextFrame()
  if (!onDisplay()) return
  try {
    await edge.panelDragReveal()
  } catch { /* ignore */ }
}

export function onPanelDragPlacement(placement: PanelDragPlacement): void {
  const prev = currentLivePlacement()
  const from = prev?.edge ?? useStore.getState().settings.stickPosition
  const sameDisplay = prev ? prev.displayId === placement.displayId : viewportMatches(placement.area)
  setLivePlacement(placement)
  redraw(from, placement.edge, sameDisplay)
  useStore.getState().setLiveEdge(placement.edge)
  if (!sameDisplay) void revealOnNewDisplay(placement)
}

async function finishDrag(started: Promise<boolean>, commit: boolean): Promise<void> {
  let ok = false
  try { ok = await started } catch { ok = false }
  if (!ok) {
    stopPlacementUpdates()
    ending = false
    useStore.getState().setSliderActive(false)
    return
  }
  setSnapping(true)
  let result: Awaited<ReturnType<typeof edge.panelDragEnd>> = null
  try {
    result = await edge.panelDragEnd(commit)
  } catch { /* ignore */ }
  stopPlacementUpdates()
  const store = useStore.getState()
  const drawn = currentLivePlacement()?.edge ?? store.settings.stickPosition
  setLivePlacement(null)
  store.setLiveEdge(null)
  if (result?.settings) store.setSettings(result.settings)
  redraw(drawn, useStore.getState().settings.stickPosition, true)
  await nextFrame()
  await nextFrame()
  try {
    await edge.panelDragReveal()
  } catch { /* ignore */ }
  setSnapping(false)
  ending = false
  useStore.getState().setSliderActive(false)
  if (result?.moved) playEdgeExpandSound()
}

/** Starts tracking a header press; the drag itself begins past the threshold. */
export function onPanelDragPointerDown(e: React.PointerEvent<HTMLElement>): void {
  if (e.button !== 0 || !isPanelDragTarget(e.target, e.currentTarget)) return
  const state = useStore.getState()
  if (!state.open || state.edgeTransition?.active || snapping || ending) return
  const el = e.currentTarget
  const pointerId = e.pointerId
  const startX = e.screenX
  const startY = e.screenY
  let started: Promise<boolean> | null = null

  const onMove = (ev: PointerEvent) => {
    if (started) return
    if (Math.abs(ev.screenX - startX) + Math.abs(ev.screenY - startY) < DRAG_THRESHOLD_PX) return
    const rect = bladeRect(el)
    if (!rect) return
    const s = useStore.getState()
    s.setSliderActive(true)
    if (s.previewItemId) s.setPreviewItemId(null)
    if (s.styleFlyoutOpen) s.setStyleFlyoutOpen(false)
    if (s.languageFlyoutOpen) s.setLanguageFlyoutOpen(false)
    stopPlacementUpdates()
    const off = edge.onPanelDragPlacement(onPanelDragPlacement)
    unsubscribePlacement = typeof off === 'function' ? off : null
    try {
      started = Promise.resolve(edge.panelDragStart(rect)).then((ok) => ok === true)
    } catch {
      started = Promise.resolve(false)
    }
  }
  const onEnd = (commit: boolean) => {
    if (!started) return
    ending = true
    void finishDrag(started, commit)
  }

  startPointerSession(el, pointerId, { onMove, onEnd })
}

/** Pointer-down handler for the header; undefined where the panel cannot be moved. */
export function usePanelDragHandle(): ((e: React.PointerEvent<HTMLElement>) => void) | undefined {
  return IS_DARWIN ? onPanelDragPointerDown : undefined
}
