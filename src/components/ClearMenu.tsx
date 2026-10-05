import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { TrashIcon } from './icons'
import { useAnchoredMenu, useMenuDismiss } from '../hooks/useAnchoredMenu'
import { playButtonClickSound } from '../lib/soundEffects'
import { useTranslation } from '../i18n'
import type { ClipboardItemDto } from '../../shared/types'

interface ClearMenuProps {
  /** Full item list (pinned + recent) to compute time-window ids from. */
  items: ClipboardItemDto[]
  disabled: boolean
  /** Panel's own open/closed state — closes this menu whenever the panel closes. */
  panelOpen: boolean
  /** Clear a specific set of ids (used for the time-window options via deleteBatch). */
  onClear: (ids: string[]) => void
  /** Clear all unpinned history. */
  onClearAll: () => void
  /** Direction menu flies out. Defaults to 'up' for bottom footer, 'down' for header. */
  menuDirection?: 'up' | 'down'
}

const WINDOWS: { key: '1h' | '6h' | '24h'; hours: number }[] = [
  { key: '1h', hours: 1 },
  { key: '6h', hours: 6 },
  { key: '24h', hours: 24 }
]

const menuItemStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  padding: '7px 10px',
  borderRadius: 7,
  background: 'transparent',
  color: 'rgb(var(--ink) / max(0.85, var(--text-alpha-floor)))',
  fontSize: 12,
  fontWeight: 400,
  border: 'none',
  cursor: 'pointer',
  textAlign: 'start',
  transition: 'background 0.12s ease'
}

export function ClearMenu({
  items,
  disabled,
  panelOpen,
  onClear,
  onClearAll,
  menuDirection = 'up'
}: ClearMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Force-close menu when panel slides closed
  useEffect(() => {
    if (!panelOpen) {
      setOpen(false)
      setConfirmAll(false)
    }
  }, [panelOpen])

  useMenuDismiss(open, [ref, menuRef], () => setOpen(false))

  // Re-arm "Clear all" confirmation whenever menu closes
  useEffect(() => {
    if (!open) setConfirmAll(false)
  }, [open])

  const clearWindow = (hours: number) => {
    const cutoff = Date.now() - hours * 3600 * 1000
    // Pinned items are never included in a bulk clear
    const ids = items.filter((it) => !it.pinned && it.capturedAt >= cutoff).map((it) => it.id)
    playButtonClickSound()
    setOpen(false)
    if (ids.length > 0) onClear(ids)
  }

  const handleAllClick = () => {
    if (!confirmAll) {
      playButtonClickSound()
      setConfirmAll(true)
      return
    }
    playButtonClickSound()
    setOpen(false)
    onClearAll()
  }

  const { style: placedStyle, direction, width: placedWidth } = useAnchoredMenu(open, ref, menuRef, {
    prefer: menuDirection,
    align: 'end',
    onLost: () => setOpen(false)
  })
  const isMenuDown = direction === 'down'

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className={`text-btn${open ? ' active' : ''}`}
        onClick={() => {
          if (disabled) return
          playButtonClickSound()
          setOpen((v) => !v)
        }}
        disabled={disabled}
        title={t('item.clear')}
        style={{ display: 'flex', alignItems: 'center', gap: 5 }}
      >
        <TrashIcon width={13} height={13} className="clear-btn-icon" />
        <span>{t('item.clear')}</span>
      </button>

      {createPortal(<AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: isMenuDown ? -6 : 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: isMenuDown ? -6 : 6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{
              ...placedStyle,
              minWidth: Math.min(190, placedWidth ?? 190),
              boxSizing: 'border-box',
              background: 'var(--bg-flyout)',
              border: '1px solid rgb(var(--ink) / 0.08)',
              borderRadius: 16,
              padding: 4,
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(0, 0, 0, 0.5)',
              zIndex: 10000,
              scrollbarWidth: 'none'
            }}
          >
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => clearWindow(w.hours)}
                style={menuItemStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgb(var(--ink) / 0.07)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                {t(`item.clearLast${w.key}` as any)}
              </button>
            ))}

            <div style={{ height: 1, background: 'rgb(var(--ink) / 0.1)', margin: '4px 2px' }} />

            <button
              type="button"
              onClick={handleAllClick}
              style={{
                ...menuItemStyle,
                color: confirmAll ? '#ff5252' : 'rgb(var(--ink) / max(0.85, var(--text-alpha-floor)))',
                fontWeight: confirmAll ? 600 : 400
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgb(var(--ink) / 0.07)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {confirmAll ? t('item.clearAllConfirm') : t('item.clearAll')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  )
}
