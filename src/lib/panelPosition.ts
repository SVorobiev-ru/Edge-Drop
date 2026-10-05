/**
 * Where the macOS panel is drawn.
 *
 * The window covers the work area of its display, and the panel box is placed
 * inside it through CSS variables on the root element (--panel-x, --panel-y,
 * --panel-w, --panel-h, --panel-radius). While the panel is dragged the main
 * process streams its placement here; sliding along an edge only rewrites the
 * variables, so the panel tree does not re-render on every pointer tick.
 *
 * When the edge changes the panel morphs: a plain shell with the panel
 * background animates from the old box and corners to the new ones while the
 * content, already laid out for the new edge, stays hidden, then fades in.
 */
import { useSyncExternalStore } from 'react'
import { selectReduceMotion, useStore } from '../store/appStore'
import { isHorizontalEdge, panelLayout, panelSizes, type PlacementRect, type ResizeSide } from '../../shared/panelPlacement'
import type { PanelDragPlacement, Settings, StickPosition } from '../../shared/types'

export const PANEL_LAYOUT_EVENT = 'panel:layout'
export const MORPH_SHAPE_MS = 240
export const MORPH_REVEAL_MS = 140

const PANEL_RADIUS = '24px'
const GRIP_PX = 6
const GRIP_CORNER_PX = 24
const OPPOSITE: Record<StickPosition, StickPosition> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }

export type MorphPhase = 'idle' | 'shape' | 'reveal'

export type PanelSizePatch = Partial<Pick<Settings, 'panelWidth' | 'panelHeight' | 'verticalOffset' | 'dockWidth' | 'dockHeight' | 'horizontalOffset'>>

let livePlacement: PanelDragPlacement | null = null
let sizePatch: PanelSizePatch | null = null
let morph: MorphPhase = 'idle'
let morphTimer: ReturnType<typeof setTimeout> | null = null
const morphListeners = new Set<() => void>()

export function panelRadius(edge: StickPosition): string {
  const r = PANEL_RADIUS
  switch (edge) {
    case 'left': return `0 ${r} ${r} 0`
    case 'right': return `${r} 0 0 ${r}`
    case 'top': return `0 0 ${r} ${r}`
    case 'bottom': return `${r} ${r} 0 0`
  }
}

/**
 * Box of a resize grip relative to the panel: a strip GRIP_PX wide centred on
 * the inner edge or on one end, clear of the rounded inner corners.
 */
export function resizeGripStyle(side: ResizeSide, stick: StickPosition): Record<string, number | string> {
  const horizontal = isHorizontalEdge(stick)
  const [alongStart, alongEnd] = horizontal ? ['left', 'right'] : ['top', 'bottom']
  if (side === 'inner') {
    return {
      [stick]: `calc(100% - ${GRIP_PX / 2}px)`,
      [horizontal ? 'height' : 'width']: GRIP_PX,
      [alongStart]: GRIP_CORNER_PX,
      [alongEnd]: GRIP_CORNER_PX
    }
  }
  return {
    [side === 'start' ? alongStart : alongEnd]: -GRIP_PX / 2,
    [horizontal ? 'width' : 'height']: GRIP_PX,
    [stick]: 0,
    [OPPOSITE[stick]]: GRIP_CORNER_PX
  }
}

/** The panel box for the settings, a running drag and a running resize, in window coordinates. */
export function panelRect(
  settings: Settings,
  viewport: { width: number; height: number },
  live: Pick<PanelDragPlacement, 'edge' | 'offset'> | null = livePlacement,
  patch: PanelSizePatch | null = sizePatch
): PlacementRect & { edge: StickPosition } {
  const s = patch ? { ...settings, ...patch } : settings
  const edge = live?.edge ?? s.stickPosition
  const offset = live ? live.offset : ((isHorizontalEdge(edge) ? s.horizontalOffset : s.verticalOffset) ?? 0.5)
  return { ...panelLayout({ edge, area: viewport, offset, sizes: panelSizes(s) }), edge }
}

export function applyPanelPosition(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const rect = panelRect(useStore.getState().settings, { width: window.innerWidth, height: window.innerHeight })
  const style = document.documentElement.style
  style.setProperty('--panel-x', `${rect.x}px`)
  style.setProperty('--panel-y', `${rect.y}px`)
  style.setProperty('--panel-w', `${rect.width}px`)
  style.setProperty('--panel-h', `${rect.height}px`)
  style.setProperty('--panel-radius', panelRadius(rect.edge))
  window.dispatchEvent(new Event(PANEL_LAYOUT_EVENT))
}

export function currentLivePlacement(): PanelDragPlacement | null {
  return livePlacement
}

export function setLivePlacement(next: PanelDragPlacement | null): void {
  livePlacement = next
}

export function currentSizePatch(): PanelSizePatch | null {
  return sizePatch
}

export function setSizePatch(next: PanelSizePatch | null): void {
  sizePatch = next
}

/** Next morph phase when the drawn edge changes. A move to another display is not animated. */
export function morphOnEdgeChange(input: { from: StickPosition; to: StickPosition; sameDisplay: boolean; reduceMotion: boolean }, phase: MorphPhase): MorphPhase {
  if (input.from === input.to) return phase
  if (!input.sameDisplay || input.reduceMotion) return 'idle'
  return 'shape'
}

export function morphAfterTimer(phase: MorphPhase): MorphPhase {
  return phase === 'shape' ? 'reveal' : 'idle'
}

function setMorph(next: MorphPhase): void {
  if (morphTimer !== null) clearTimeout(morphTimer)
  morphTimer = null
  if (next !== 'idle') {
    morphTimer = setTimeout(() => setMorph(morphAfterTimer(next)), next === 'shape' ? MORPH_SHAPE_MS : MORPH_REVEAL_MS)
  }
  if (next === morph) return
  morph = next
  morphListeners.forEach((fn) => fn())
}

/** Starts, restarts or skips the morph for an edge change of the drawn panel. */
export function noteEdgeChange(from: StickPosition, to: StickPosition, sameDisplay: boolean): void {
  if (from === to) return
  setMorph(morphOnEdgeChange({ from, to, sameDisplay, reduceMotion: selectReduceMotion(useStore.getState()) }, morph))
}

export function currentMorphPhase(): MorphPhase {
  return morph
}

function subscribeMorph(fn: () => void): () => void {
  morphListeners.add(fn)
  return () => morphListeners.delete(fn)
}

export function usePanelMorph(): MorphPhase {
  return useSyncExternalStore(subscribeMorph, currentMorphPhase, () => 'idle')
}
