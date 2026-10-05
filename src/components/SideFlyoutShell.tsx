import { useRef, useEffect, type CSSProperties, type ReactNode } from 'react'
import { motion, AnimatePresence, type HTMLMotionProps } from 'framer-motion'
import { useStore, selectReduceMotion } from '../store/appStore'
import { createPortal } from 'react-dom'
import { useAdaptiveSpring } from '../hooks/useAdaptiveSpring'
import { useSideFlyoutPlacement } from '../hooks/useSideFlyoutPlacement'
import { sideFlyoutDockOffset, sideFlyoutHoverRect, sideFlyoutMaxHeight, sideFlyoutOrigin, type FlyoutAnchorRect } from '../lib/flyoutPlacement'
import type { StickPosition } from '../../shared/types'

/** Fast start, soft landing — matching PreviewFlyout */
const flyoutEaseOpen = [0.16, 1, 0.3, 1] as const
const flyoutEaseClose = [0.3, 0, 0.2, 1] as const

export const flyoutVariants = {
  hidden: (dir: StickPosition) => ({
    opacity: 0,
    x: dir === 'right' ? 14 : dir === 'left' ? -14 : 0,
    y: dir === 'top' ? -14 : dir === 'bottom' ? 14 : 0,
    scale: 0.97,
  }),
  shown: {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    transition: {
      x: { duration: 0.26, ease: flyoutEaseOpen },
      y: { duration: 0.26, ease: flyoutEaseOpen },
      scale: { duration: 0.26, ease: flyoutEaseOpen },
      opacity: { duration: 0.18, ease: 'easeOut' as const },
    },
  },
  exit: (dir: StickPosition) => ({
    opacity: 0,
    x: dir === 'right' ? 10 : dir === 'left' ? -10 : 0,
    y: dir === 'top' ? -10 : dir === 'bottom' ? 10 : 0,
    scale: 0.98,
    transition: {
      x: { duration: 0.18, ease: flyoutEaseClose },
      y: { duration: 0.18, ease: flyoutEaseClose },
      scale: { duration: 0.18, ease: flyoutEaseClose },
      opacity: { duration: 0.14, ease: 'easeIn' as const },
    },
  }),
  reducedHidden: { opacity: 0 },
  reducedShown: { opacity: 1 },
}

export type SideFlyoutMotion = Pick<HTMLMotionProps<'div'>, 'variants' | 'initial' | 'animate' | 'exit' | 'transition'>

export interface SideFlyoutShellProps {
  isRight: boolean
  visible: boolean
  motionKey: string
  motionProps: (reduceMotion: boolean) => SideFlyoutMotion
  horizontalWidth: number
  horizontalStyle: CSSProperties
  anchorRect: FlyoutAnchorRect | null
  insideSelector: string
  onDismiss: () => void
  onExitComplete?: () => void
  panelProps: { className: string } & Record<`data-${string}`, string>
  panelStyle: CSSProperties
  children: () => ReactNode
}

export function SideFlyoutShell({
  isRight,
  visible: isVisible,
  motionKey,
  motionProps,
  horizontalWidth,
  horizontalStyle,
  anchorRect,
  insideSelector,
  onDismiss,
  onExitComplete,
  panelProps,
  panelStyle,
  children
}: SideFlyoutShellProps) {
  const adaptiveSpring = useAdaptiveSpring()
  const reduceMotion = useStore(selectReduceMotion) || adaptiveSpring.type === 'tween'

  const flyoutRef = useRef<HTMLDivElement | null>(null)

  const placement = useSideFlyoutPlacement({ isRight, horizontalWidth, verticalWidth: 280, anchorRect, anchorFallbackWidth: 32 })
  const { stickPosition, isHorizontal, isTop, screenH, panelH, panelTop, dock, dockLeft, flyoutWidth, flyoutLeft } = placement

  const maxFlyoutHeight = sideFlyoutMaxHeight(placement, 260)
  const { originX, originY } = sideFlyoutOrigin(placement, isRight)

  useEffect(() => {
    if (!isVisible || !flyoutRef.current) {
      useStore.getState().setPreviewFlyoutRect(null)
      return
    }

    const updateRect = () => {
      if (!flyoutRef.current) return
      const h = flyoutRef.current.offsetHeight
      useStore.getState().setPreviewFlyoutRect(sideFlyoutHoverRect(placement, h))
    }

    updateRect()
    const ro = new ResizeObserver(updateRect)
    ro.observe(flyoutRef.current)
    window.addEventListener('resize', updateRect)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', updateRect)
      useStore.getState().setPreviewFlyoutRect(null)
    }
  }, [isVisible, isHorizontal, isTop, screenH, flyoutLeft, flyoutWidth, panelTop, panelH, dock.y, dock.height])

  // Dismiss flyout when clicking outside
  useEffect(() => {
    if (!isVisible) return

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (!target || typeof target.closest !== 'function') return

      if (target.closest(insideSelector)) {
        return
      }

      const inBlade = Boolean(target.closest('.blade') || target.closest('.root') || target.closest('.settings-horizontal-shelf'))
      if (inBlade) {
        onDismiss()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [isVisible])

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {isVisible && (
        <motion.div
          key={motionKey}
          custom={stickPosition}
          {...motionProps(reduceMotion)}
          style={
            isHorizontal
              ? {
                  position: 'absolute',
                  left: dockLeft + flyoutLeft,
                  width: flyoutWidth,
                  ...sideFlyoutDockOffset(placement),
                  ...horizontalStyle,
                  pointerEvents: 'none',
                  originX,
                  originY,
                  willChange: 'transform, opacity',
                  backfaceVisibility: 'hidden',
                }
              : {
                  position: 'absolute',
                  top: panelTop,
                  height: panelH,
                  [isRight ? 'right' : 'left']: 'var(--panel-width)',
                  marginLeft: isRight ? 0 : 12,
                  marginRight: isRight ? 12 : 0,
                  width: 280,
                  display: 'flex',
                  alignItems: 'center',
                  pointerEvents: 'none',
                  zIndex: 5,
                  originX: isRight ? 1 : 0,
                  originY: 0.5,
                  willChange: 'transform, opacity',
                  backfaceVisibility: 'hidden',
                }
          }
        >
          <div
            ref={flyoutRef}
            {...panelProps}
            style={{
              width: '100%',
              maxHeight: maxFlyoutHeight,
              ...panelStyle
            }}
          >
            {children()}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
