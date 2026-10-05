import type { StickPosition } from './types'

export const TRIGGER_PX = 3    // leftmost px that count as "the edge"
export const BUFFER_PX = 30                 // 30px overshoot buffer across adjacent monitors

const SPLIT_ZONE_TOP_PX = 80
const SPLIT_ZONE_SIDE_PX = 100

export function isInSplitEdgeZone(input: {
  x: number
  y: number
  windowWidth: number
  windowHeight?: number
  stickPosition: StickPosition
}): boolean {
  const { x, y, windowWidth, windowHeight, stickPosition } = input
  if (stickPosition === 'top') return y <= SPLIT_ZONE_TOP_PX
  if (stickPosition === 'bottom') return windowHeight !== undefined && y >= windowHeight - SPLIT_ZONE_TOP_PX
  if (stickPosition === 'right') return x >= windowWidth - SPLIT_ZONE_SIDE_PX
  return x <= SPLIT_ZONE_SIDE_PX
}
