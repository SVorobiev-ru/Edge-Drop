import { execFile } from 'node:child_process'
import type { StickPosition } from './geometry'
import { TRIGGER_PX, BUFFER_PX } from '../../shared/edgeZones'
import type { Rect } from '../../shared/types'

export type ScreenRect = Rect

export type DockOrientation = 'left' | 'bottom' | 'right'

export interface ScreenInsets {
  left: number
  right: number
  top: number
  bottom: number
}

export function screenInsets(bounds: ScreenRect, workArea: ScreenRect): ScreenInsets {
  return {
    left: Math.max(0, workArea.x - bounds.x),
    right: Math.max(0, bounds.x + bounds.width - (workArea.x + workArea.width)),
    top: Math.max(0, workArea.y - bounds.y),
    bottom: Math.max(0, bounds.y + bounds.height - (workArea.y + workArea.height))
  }
}

export function menuBarHeight(bounds: ScreenRect, workArea: ScreenRect): number {
  return screenInsets(bounds, workArea).top
}

export function visibleDockSide(bounds: ScreenRect, workArea: ScreenRect): DockOrientation | null {
  const insets = screenInsets(bounds, workArea)
  if (insets.left > 0) return 'left'
  if (insets.right > 0) return 'right'
  if (insets.bottom > 0) return 'bottom'
  return null
}

export function isDockOnStickEdge(bounds: ScreenRect, workArea: ScreenRect, position: StickPosition): boolean {
  return position !== 'top' && visibleDockSide(bounds, workArea) === position
}

export function parseDockOrientation(raw: string | null | undefined): DockOrientation {
  const value = (raw ?? '').trim().toLowerCase()
  return value === 'left' || value === 'right' ? value : 'bottom'
}

export function pickInitialStickPosition(orientation: DockOrientation | null): StickPosition {
  if (orientation === 'left') return 'right'
  return 'left'
}

export function readDockOrientation(): Promise<DockOrientation | null> {
  return new Promise((resolve) => {
    try {
      execFile('/usr/bin/defaults', ['read', 'com.apple.dock', 'orientation'], { timeout: 3000 }, (err, stdout) => {
        resolve(err ? null : parseDockOrientation(String(stdout)))
      })
    } catch {
      resolve(null)
    }
  })
}

export const MAC_DOCK_EDGE_BAND_PX = 12

export interface MacTriggerZone {
  probeArea: ScreenRect
  hotZoneWidth: number
  menuBarHeight: number
  dockOnEdge: boolean
}

export function macTriggerZone(input: {
  bounds: ScreenRect
  workArea: ScreenRect
  stickPosition: StickPosition
  hotZoneWidth: number
}): MacTriggerZone {
  const { bounds, workArea, stickPosition, hotZoneWidth } = input

  if (stickPosition === 'top') {
    const top = menuBarHeight(bounds, workArea)
    return {
      probeArea: { x: workArea.x, y: workArea.y - top, width: workArea.width, height: workArea.height + top },
      hotZoneWidth,
      menuBarHeight: top,
      dockOnEdge: false
    }
  }

  const dockOnEdge = isDockOnStickEdge(bounds, workArea, stickPosition)
  return {
    probeArea: { ...workArea },
    hotZoneWidth: dockOnEdge ? Math.max(hotZoneWidth, MAC_DOCK_EDGE_BAND_PX) : hotZoneWidth,
    menuBarHeight: menuBarHeight(bounds, workArea),
    dockOnEdge
  }
}

export function macReportedPoint(input: {
  zone: MacTriggerZone
  stickPosition: StickPosition
  clientX: number
  clientY: number
  distFromEdge: number
  armed: boolean
  expanded: boolean
  hotZoneWidth: number
}): { x: number; y: number } {
  const { zone, stickPosition, clientX, clientY, distFromEdge, armed, expanded, hotZoneWidth } = input

  if (stickPosition === 'top') {
    if (zone.menuBarHeight <= 0 || !expanded || clientY <= hotZoneWidth) {
      return { x: clientX, y: clientY }
    }
    const windowY = clientY - zone.menuBarHeight
    return { x: clientX, y: windowY <= hotZoneWidth ? hotZoneWidth + 1 : windowY }
  }

  if (!zone.dockOnEdge) return { x: clientX, y: clientY }

  let dist = distFromEdge
  if (armed) {
    dist = Math.min(distFromEdge, TRIGGER_PX)
  } else if (distFromEdge >= -BUFFER_PX && distFromEdge <= TRIGGER_PX) {
    dist = TRIGGER_PX + 1
  }
  if (stickPosition === 'bottom') return { x: clientX, y: zone.probeArea.height - dist }
  return {
    x: stickPosition === 'right' ? zone.probeArea.width - dist : dist,
    y: clientY
  }
}

export interface PanelPlacement {
  displayId: number | undefined
  bounds: ScreenRect
}

export function panelPlacementChanged(before: PanelPlacement | null, after: PanelPlacement | null): boolean {
  if (!before || !after) return before !== after
  if (before.displayId !== after.displayId) return true
  return (
    before.bounds.x !== after.bounds.x ||
    before.bounds.y !== after.bounds.y ||
    before.bounds.width !== after.bounds.width ||
    before.bounds.height !== after.bounds.height
  )
}
