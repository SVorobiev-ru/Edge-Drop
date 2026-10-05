import { panelRect } from './panelPosition'
import { isHorizontalEdge } from '../../shared/panelPlacement'
import type { Settings, StickPosition } from '../../shared/types'

export const FLYOUT_GAP = 12

export interface FlyoutAnchorRect {
  x?: number
  width?: number
}

export interface SideFlyoutPlacementInput {
  settings: Settings
  viewport: { width: number; height: number }
  isRight: boolean
  horizontalWidth: number
  verticalWidth: number
  anchorRect: FlyoutAnchorRect | null
  anchorFallbackWidth: number
  anchorOnSideEdges?: boolean
}

export interface SideFlyoutPlacement {
  stickPosition: StickPosition
  isHorizontal: boolean
  isTop: boolean
  screenH: number
  panelH: number
  panelTop: number
  dock: ReturnType<typeof panelRect>
  dockLeft: number
  flyoutWidth: number
  anchorCenterX: number
  flyoutLeft: number
}

export interface FlyoutHoverRect {
  top: number
  bottom: number
  left?: number
  right?: number
}

export function sideFlyoutPlacement({
  settings,
  viewport,
  isRight,
  horizontalWidth,
  verticalWidth,
  anchorRect,
  anchorFallbackWidth,
  anchorOnSideEdges = false
}: SideFlyoutPlacementInput): SideFlyoutPlacement {
  const stickPosition = (settings.stickPosition || (isRight ? 'right' : 'left')) as StickPosition
  const isHorizontal = isHorizontalEdge(stickPosition)
  const isTop = stickPosition === 'top'

  const screenW = viewport.width
  const screenH = viewport.height
  const pFrac = settings.panelHeight || 0.6
  const panelH = screenH * pFrac
  const minY = panelH / 2
  const maxY = screenH - panelH / 2
  const vOffset = settings.verticalOffset ?? 0.5
  const midY = Math.round(minY + vOffset * (maxY - minY))
  const panelTop = midY - panelH / 2

  const dock = panelRect(settings, { width: screenW, height: screenH }, null, null)
  const dockWidth = dock.width
  const flyoutWidth = isHorizontal ? horizontalWidth : verticalWidth
  const dockLeft = dock.x
  const anchorCenterX = (isHorizontal || anchorOnSideEdges) && anchorRect?.x !== undefined
    ? (anchorRect.x + (anchorRect.width || anchorFallbackWidth) / 2) - dockLeft
    : dockWidth / 2
  const minLeft = 12
  const maxLeft = Math.max(minLeft, dockWidth - flyoutWidth - 12)
  const flyoutLeft = Math.max(minLeft, Math.min(maxLeft, Math.round(anchorCenterX - flyoutWidth / 2)))

  return { stickPosition, isHorizontal, isTop, screenH, panelH, panelTop, dock, dockLeft, flyoutWidth, anchorCenterX, flyoutLeft }
}

export function sideFlyoutMaxHeight(placement: SideFlyoutPlacement, horizontalMaxHeight: number): number {
  return placement.isHorizontal ? horizontalMaxHeight : Math.max(100, placement.panelH - 24)
}

export function sideFlyoutOrigin(placement: SideFlyoutPlacement, isRight: boolean): { originX: number; originY: number } {
  const { isHorizontal, isTop, anchorCenterX, flyoutLeft, flyoutWidth } = placement
  const originX = isHorizontal
    ? Math.max(0.08, Math.min(0.92, (anchorCenterX - flyoutLeft) / flyoutWidth))
    : (isRight ? 1 : 0)
  const originY = isHorizontal ? (isTop ? 0 : 1) : 0.5
  return { originX, originY }
}

export function sideFlyoutDockOffset(placement: SideFlyoutPlacement): { top: number } | { bottom: number } {
  const { isTop, dock, screenH } = placement
  return isTop ? { top: dock.y + dock.height + FLYOUT_GAP } : { bottom: screenH - dock.y + FLYOUT_GAP }
}

export function sideFlyoutHoverRect(placement: SideFlyoutPlacement, h: number): FlyoutHoverRect {
  const { isHorizontal, isTop, dock, flyoutLeft, flyoutWidth, panelTop, panelH } = placement
  if (isHorizontal) {
    return {
      top: isTop ? dock.y + dock.height : dock.y - FLYOUT_GAP - h,
      bottom: isTop ? dock.y + dock.height + FLYOUT_GAP + h : dock.y,
      left: flyoutLeft,
      right: flyoutLeft + flyoutWidth
    }
  }
  const top = panelTop + (panelH - h) / 2
  return { top, bottom: top + h }
}
