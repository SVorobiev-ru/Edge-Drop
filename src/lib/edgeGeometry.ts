import type { Settings } from '../../shared/types'
import { PANEL_WIDTH_DEFAULT, clampDockHeight, clampPanelWidth } from '../../shared/panelWidth'
import { dockSpan, isHorizontalEdge } from '../../shared/panelPlacement'

export function resolvePanelWidth(settings: Pick<Settings, 'panelWidth' | 'stickPosition'>): number {
  if (isHorizontalEdge(settings.stickPosition)) return PANEL_WIDTH_DEFAULT
  return clampPanelWidth(settings.panelWidth)
}

/** Hysteresis thresholds for closing the panel.
 * KEEP_OPEN_PX: if cursor x is <= this, the panel stays open (clearly inside blade).
 * START_CLOSE_PX: if cursor x is > this, start the close timer (clearly outside).
 * Gap between the two prevents rapid cancel/schedule oscillation at the blade edge
 * when the cursor hovers just outside the visual boundary.
 */
export function panelZones(settings: Pick<Settings, 'panelWidth' | 'stickPosition'>) {
  const wide = resolvePanelWidth(settings)
  return {
    wide,
    keepOpen: wide - 15,
    startClose: wide + 20,
    previewWide: wide + 470
  }
}

/** Depth of the dock area that keeps the panel open, measured from its screen edge. */
export function dockBladeHeight(settings: Pick<Settings, 'dockHeight'>): number {
  return clampDockHeight(settings.dockHeight) + 8
}

export function getHorizontalDockMetrics(
  displayWidth: number,
  horizontalOffset = 0.5,
  hotZoneHeight = 0.25,
  triggerAlignment: 'top' | 'center' | 'bottom' | 'left' | 'right' = 'center',
  dockWidthSetting?: number
) {
  const { width: dockWidth, minX, maxX } = dockSpan(displayWidth, dockWidthSetting)
  const hOffset = Math.min(1, Math.max(0, horizontalOffset))
  const dockX = minX + Math.round(Math.max(0, maxX - minX) * hOffset)
  const dockCenterX = dockX + dockWidth / 2
  // Trigger bar length scales with hotZoneHeight (+25% increase):
  // Small (0.25) => 275px, Medium (0.40) => 400px, Large (0.60) => 575px
  const triggerWidth = Math.round(
    hotZoneHeight >= 0.55 ? 575 : hotZoneHeight >= 0.35 ? 400 : 275
  )
  let triggerLeft = dockCenterX - triggerWidth / 2
  let triggerRight = dockCenterX + triggerWidth / 2

  if (triggerAlignment === 'top' || triggerAlignment === 'left') {
    triggerLeft = dockX
    triggerRight = dockX + triggerWidth
  } else if (triggerAlignment === 'bottom' || triggerAlignment === 'right') {
    triggerLeft = dockX + dockWidth - triggerWidth
    triggerRight = dockX + dockWidth
  }

  return {
    dockWidth,
    dockX,
    dockCenterX,
    triggerWidth,
    triggerLeft,
    triggerRight
  }
}
