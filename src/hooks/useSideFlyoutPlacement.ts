import { useStore } from '../store/appStore'
import { sideFlyoutPlacement, type FlyoutAnchorRect, type SideFlyoutPlacement } from '../lib/flyoutPlacement'

export interface SideFlyoutPlacementOptions {
  isRight: boolean
  horizontalWidth: number
  verticalWidth: number
  anchorRect: FlyoutAnchorRect | null
  anchorFallbackWidth: number
}

export function useSideFlyoutPlacement(options: SideFlyoutPlacementOptions): SideFlyoutPlacement {
  const settings = useStore((s) => s.settings)
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 1200
  const screenH = typeof window !== 'undefined' ? window.innerHeight : 800
  return sideFlyoutPlacement({ ...options, settings, viewport: { width: screenW, height: screenH } })
}
