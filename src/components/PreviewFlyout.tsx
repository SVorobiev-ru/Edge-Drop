import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, selectReduceMotion } from '../store/appStore'
import { CopyIcon, CloseIcon } from './icons'
import { createPortal } from 'react-dom'
import { useAdaptiveSpring } from '../hooks/useAdaptiveSpring'
import { IS_DARWIN } from '../lib/edge'
import { playButtonClickSound } from '../lib/soundEffects'

import { useTranslation } from '../i18n'
import { sideFlyoutDockOffset, sideFlyoutHoverRect, sideFlyoutMaxHeight, sideFlyoutPlacement } from '../lib/flyoutPlacement'
import type { StickPosition } from '../../shared/types'
import { usePreviewSelection } from './preview/usePreviewSelection'
import { SYS_FONT, CODE_FONT } from './preview/QuickActions'
import { PreviewContent } from './preview/PreviewContent'

/** Fast start, soft landing — no overshoot, no spring hang. */
const flyoutEaseOpen = [0.16, 1, 0.3, 1] as const
const flyoutEaseClose = [0.3, 0, 0.2, 1] as const

const flyoutVariants = {
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

export function PreviewFlyout({ isRight }: { isRight: boolean }) {
  const { t } = useTranslation()
  const previewItemId = useStore((s) => s.previewItemId)
  const items = useStore((s) => s.items)
  const settings = useStore((s) => s.settings)
  const adaptiveSpring = useAdaptiveSpring()
  
  const item = previewItemId ? items.find((i) => i.id === previewItemId) : null

  const screenH = typeof window !== 'undefined' ? window.innerHeight : 800
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 1140

  const reduceMotion = useStore(selectReduceMotion) || adaptiveSpring.type === 'tween'

  const previewItemRect = useStore((s) => s.previewItemRect)
  const placement = sideFlyoutPlacement({
    settings,
    viewport: { width: screenW, height: screenH },
    isRight,
    horizontalWidth: 440,
    verticalWidth: 440,
    anchorRect: previewItemRect,
    anchorFallbackWidth: 210,
    anchorOnSideEdges: true
  })
  const { stickPosition, isTop, isHorizontal, panelH, panelTop, dock, dockLeft, flyoutWidth, flyoutLeft } = placement
  const maxFlyoutHeight = sideFlyoutMaxHeight(placement, Math.min(460, Math.max(200, screenH - 240)))

  const [dragOver, setDragOver] = useState(false)
  const flyoutRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!item || !flyoutRef.current) {
      useStore.getState().setPreviewFlyoutRect(null)
      return
    }

    const updateRect = () => {
      if (!flyoutRef.current) return
      // offsetHeight ignores the wrapper transform, so the hover
      // keep-alive zone stays full-size while the open/close motion plays.
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
  }, [item?.id, panelTop, panelH, isHorizontal, isTop, dockLeft, flyoutLeft, flyoutWidth, dock.y, dock.height])

  // Dismiss preview flyout when user clicks inside the clipboard shelf (outside the flyout)
  useEffect(() => {
    if (!previewItemId) return

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (!target || typeof target.closest !== 'function') return

      // Keep open if interaction is inside the preview flyout itself
      if (target.closest('[data-preview-flyout], .preview-flyout')) {
        return
      }

      // If clicked on any item card: let the card's handleCardClick handle it cleanly without race conditions
      if (target.closest('.item-main, .item-card')) {
        return
      }

      // Clicked inside the clipboard shelf (.blade, .root, .header, empty list space, footer, etc.)
      const inClipboard = Boolean(target.closest('.blade') || target.closest('.root'))
      if (inClipboard) {
        useStore.getState().setPreviewItemId(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [previewItemId])

  const handleDragOver = (e: React.DragEvent) => {
    const activeDrag = useStore.getState().internalDragReq
    if (item && activeDrag && activeDrag.id !== item.id) {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const activeDrag = useStore.getState().internalDragReq
    if (item && activeDrag && activeDrag.id !== item.id) {
      await window.edge.mergeItems(activeDrag.id, item.id)
      useStore.getState().setInternalDragReq(null)
    }
  }

  const { selectedKeys, setSelectedKeys, toggleSelectKey, allItemKeys, handleSelectAllToggle, handleBatchCopy, handleBatchPaste } = usePreviewSelection(item)


  return createPortal(
    <AnimatePresence onExitComplete={() => {
      if (!useStore.getState().previewItemId) {
        window.edge.setPreviewMode(false)
      }
    }}>
      {item && (
        <motion.div
          key={item.id}
          custom={stickPosition}
          variants={flyoutVariants}
          initial={reduceMotion ? 'reducedHidden' : 'hidden'}
          animate={reduceMotion ? 'reducedShown' : 'shown'}
          exit={reduceMotion ? 'reducedHidden' : 'exit'}
          transition={reduceMotion ? { duration: 0.12, ease: 'linear' } : undefined}
          style={
            isHorizontal
              ? {
                  position: 'absolute',
                  left: dockLeft + flyoutLeft,
                  width: flyoutWidth,
                  ...sideFlyoutDockOffset(placement),
                  display: 'flex',
                  flexDirection: 'column',
                  pointerEvents: 'none',
                  zIndex: 5,
                  originX: 0.5,
                  originY: isTop ? 0 : 1,
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
                  width: 440,
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
            className="preview-flyout"
            data-preview-flyout="true"
            onContextMenu={(e) => {
              if (!IS_DARWIN || !previewItemId) return
              e.preventDefault()
              useStore.getState().showItemMenu(previewItemId)
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              width: '100%',
              maxHeight: maxFlyoutHeight,
              background: dragOver ? 'var(--bg-flyout-drop)' : 'var(--bg-flyout)',
              borderRadius: 20,
              border: dragOver ? '2px dashed #4caf50' : 'none',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: dragOver ? '0 0 35px rgba(76, 175, 80, 0.3)' : 'none',
              pointerEvents: 'auto',
              transition: 'background 0.2s ease, border 0.2s ease, box-shadow 0.2s ease',
              position: 'relative'
            }}
          >
          {dragOver && (
            <div
              style={{
                position: 'absolute',
                top: 14,
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#4caf50',
                color: '#000',
                fontWeight: 600,
                fontSize: 12,
                padding: '6px 14px',
                borderRadius: 20,
                zIndex: 10,
                boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>+ {t('onboarding.dropToExtract')}</span>
            </div>
          )}
          {/* Content — even bezels, no header chrome */}
          <div style={{ padding: selectedKeys.size > 0 ? '20px 20px 68px 20px' : '20px', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none', msOverflowStyle: 'none', flex: 1, minHeight: 0 }}>
            <PreviewContent
              item={item}
              selectedKeys={selectedKeys}
              onToggleSelectKey={toggleSelectKey}
            />
          </div>

          {/* Floating Multi-Selection Batch Action Bar */}
          <AnimatePresence>
            {selectedKeys.size > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 14, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                style={{
                  position: 'absolute',
                  bottom: 12,
                  left: 12,
                  right: 12,
                  background: 'rgba(16, 16, 20, 0.92)',
                  border: '1px solid rgb(var(--ink) / 0.12)',
                  boxShadow: 'inset 0 1px 0 rgb(var(--ink) / 0.1), 0 12px 32px rgba(0, 0, 0, 0.75)',
                  borderRadius: 12,
                  padding: '7px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  zIndex: 20
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    background: 'rgb(var(--ink) / 0.08)',
                    border: '1px solid rgb(var(--ink) / 0.16)',
                    color: 'var(--text-primary)',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontFamily: CODE_FONT,
                    letterSpacing: '0.02em',
                    whiteSpace: 'nowrap'
                  }}>
                    {t('flyout.selectedCount').replace('{count}', String(selectedKeys.size))}
                  </div>
                  <button
                    onClick={handleSelectAllToggle}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'rgb(var(--ink) / max(0.65, var(--text-alpha-floor)))',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      padding: '2px 4px',
                      fontFamily: SYS_FONT,
                      transition: 'color 0.15s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'rgb(var(--ink) / max(0.65, var(--text-alpha-floor)))')}
                  >
                    {selectedKeys.size === allItemKeys.length ? t('flyout.deselectAll') : t('flyout.selectAll')}
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    title={t('flyout.copySelected')}
                    aria-label={t('flyout.copySelected')}
                    onClick={handleBatchCopy}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      height: 28,
                      background: 'rgb(var(--ink) / 0.06)',
                      border: '1px solid rgb(var(--ink) / 0.08)',
                      color: 'rgb(var(--ink) / max(0.85, var(--text-alpha-floor)))',
                      borderRadius: 8,
                      padding: '0 10px',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: SYS_FONT,
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgb(var(--ink) / 0.16)'
                      e.currentTarget.style.color = 'var(--text-primary)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgb(var(--ink) / 0.06)'
                      e.currentTarget.style.color = 'rgb(var(--ink) / max(0.85, var(--text-alpha-floor)))'
                    }}
                  >
                    <CopyIcon width={13} height={13} />
                    <span>{t('item.copy')}</span>
                  </button>

                  <button
                    title={t('flyout.pasteSelected')}
                    aria-label={t('flyout.pasteSelected')}
                    onClick={handleBatchPaste}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      height: 28,
                      background: 'var(--surface-inverse)',
                      border: 'none',
                      color: 'var(--on-inverse)',
                      borderRadius: 8,
                      padding: '0 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: SYS_FONT,
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span>{t('flyout.paste')}</span>
                  </button>

                  <button
                    title={t('flyout.clearSelection')}
                    aria-label={t('flyout.clearSelection')}
                    onClick={() => {
                      playButtonClickSound()
                      setSelectedKeys(new Set())
                    }}
                    style={{
                      width: 28,
                      height: 28,
                      background: 'rgb(var(--ink) / 0.06)',
                      border: '1px solid rgb(var(--ink) / 0.08)',
                      color: 'rgb(var(--ink) / max(0.7, var(--text-alpha-floor)))',
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgb(var(--ink) / 0.16)'
                      e.currentTarget.style.color = 'var(--text-primary)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgb(var(--ink) / 0.06)'
                      e.currentTarget.style.color = 'rgb(var(--ink) / max(0.7, var(--text-alpha-floor)))'
                    }}
                  >
                    <CloseIcon width={14} height={14} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
