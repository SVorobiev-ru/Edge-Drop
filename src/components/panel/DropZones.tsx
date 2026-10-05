import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { useStore } from '../../store/appStore'
import type { StickPosition } from '../../../shared/types'

import { useTranslation } from '../../i18n'

export function DropOverlay() {
  const { t } = useTranslation()
  const dragActive = useStore((s) => s.dragActive)
  const internalDragReq = useStore((s) => s.internalDragReq)
  const textDragActive = useStore((s) => s.textDragActive)

  return (
    <AnimatePresence>
      {dragActive && !internalDragReq && !textDragActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '14px',
            pointerEvents: 'none',
            background: 'var(--bg-drop-overlay)',
            textAlign: 'center',
            padding: '24px'
          }}
        >
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '16px',
              background: 'rgb(var(--ink) / 0.05)',
              border: '1px solid rgb(var(--ink) / 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgb(var(--ink) / 0.9)'
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v13"></path>
              <path d="m8 12 4 4 4-4"></path>
              <path d="M4 20h16"></path>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'rgb(var(--ink) / 0.95)', letterSpacing: '0.01em' }}>
              {t('item.dropToSave')}
            </div>
            <div style={{ fontSize: '12px', fontWeight: 400, color: 'rgb(var(--ink) / max(0.5, var(--text-alpha-floor)))', lineHeight: 1.4 }}>
              {t('item.dropToSaveDesc')}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function SplitDropZone({ stickPosition = 'left' }: { stickPosition?: StickPosition }) {
  const internalDragReq = useStore((s) => s.internalDragReq)
  const isSubitemDragging = !!(
    internalDragReq &&
    (internalDragReq.imageId || (internalDragReq.paths && internalDragReq.paths.length > 0))
  )

  const [isOver, setIsOver] = useState(false)

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    setIsOver(true)
  }

  const handleDragLeave = () => {
    setIsOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsOver(false)
    const req = useStore.getState().internalDragReq
    if (req && (req.imageId || (req.paths && req.paths.length > 0))) {
      window.edge.splitItem(req)
      useStore.getState().setInternalDragReq(null)
    }
  }

  const isTop = stickPosition === 'top'
  const isBottom = stickPosition === 'bottom'
  const isRight = stickPosition === 'right'

  // Orientation alignment:
  // When dock is on LEFT, drop zone is on the LEFT (-15px x-offset)
  // When dock is on RIGHT, drop zone is on the RIGHT (+15px x-offset)
  // When dock is on TOP, drop zone is at the TOP (-15px y-offset)
  const initialMotion = isTop
    ? { opacity: 0, y: -15 }
    : isBottom
      ? { opacity: 0, y: 15 }
      : isRight
      ? { opacity: 0, x: 15 }
      : { opacity: 0, x: -15 }

  const exitMotion = initialMotion

  const styleByPos: React.CSSProperties = isTop
    ? {
        top: 0,
        left: 0,
        right: 0,
        height: isOver ? 72 : 56,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start'
      }
    : isBottom
      ? {
          bottom: 0,
          left: 0,
          right: 0,
          height: isOver ? 72 : 56,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-end'
        }
      : isRight
      ? {
          top: 0,
          bottom: 0,
          right: 0,
          width: isOver ? 100 : 80,
          justifyContent: 'flex-end',
          alignItems: 'center'
        }
      : {
          top: 0,
          bottom: 0,
          left: 0,
          width: isOver ? 100 : 80,
          justifyContent: 'flex-start',
          alignItems: 'center'
        }

  return (
    <AnimatePresence>
      {isSubitemDragging && (
        <motion.div
          className={`split-dropzone pos-${stickPosition}${isOver ? ' active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            if (!isOver) setIsOver(true)
          }}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          initial={initialMotion}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={exitMotion}
          transition={{ type: 'spring', stiffness: 350, damping: 25 }}
          style={styleByPos}
        >
          <div className="glow-line" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
