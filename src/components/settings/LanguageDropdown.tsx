import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../../store/appStore'
import { useAnchoredMenu, useMenuDismiss } from '../../hooks/useAnchoredMenu'
import { playButtonClickSound } from '../../lib/soundEffects'
import { useTranslation } from '../../i18n'
import { getLangLabel } from '../../i18n/languages'

export function LanguageDropdown({ direction = 'down', compact = false }: { direction?: 'up' | 'down'; compact?: boolean } = {}) {
  const { language, languages } = useTranslation()
  const patch = useStore((s) => s.patchSettings)
  const [isOpen, setIsOpen] = useState(false)
  const panelOpen = useStore((s) => s.open)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const selectedLang = languages.find((l) => l.code === (language || 'system')) || languages[0]

  useMenuDismiss(isOpen, [dropdownRef, listRef], () => setIsOpen(false))
  const { style: placedStyle, direction: placedDirection } = useAnchoredMenu(isOpen, dropdownRef, listRef, {
    prefer: direction,
    align: 'stretch',
    maxHeight: direction === 'up' ? (compact ? 88 : 140) : 180,
    onLost: () => setIsOpen(false)
  })

  useEffect(() => {
    if (!panelOpen) setIsOpen(false)
  }, [panelOpen])

  useEffect(() => {
    if (isOpen && listRef.current) {
      const activeBtn = listRef.current.querySelector<HTMLButtonElement>('[data-active="true"]')
      if (activeBtn) {
        if (selectedLang.code === 'system') {
          listRef.current.scrollTop = 0
        } else {
          listRef.current.scrollTop = Math.max(0, activeBtn.offsetTop - 4)
        }
      }
    }
  }, [isOpen, selectedLang.code])

  return (
    <div ref={dropdownRef} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => {
          playButtonClickSound()
          setIsOpen(!isOpen)
        }}
        style={{
          width: '100%',
          height: compact ? 28 : 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isOpen ? 'rgb(var(--ink) / 0.08)' : 'rgb(var(--ink) / 0.05)',
          color: 'var(--text-primary)',
          border: isOpen ? '1px solid rgb(var(--ink) / 0.22)' : '1px solid rgb(var(--ink) / 0.12)',
          borderRadius: compact ? 8 : 10,
          padding: compact ? '0 10px' : '8px 12px',
          fontSize: compact ? 11.5 : 12.5,
          fontWeight: 500,
          outline: 'none',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
          transition: 'all 0.15s ease'
        }}
      >
        <span style={{ minWidth: 0, overflowWrap: 'anywhere', textAlign: 'start' }}>{getLangLabel(selectedLang)}</span>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginInlineStart: 6, color: 'rgb(var(--ink) / max(0.6, var(--text-alpha-floor)))' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </motion.span>
      </button>

      {createPortal(<AnimatePresence>
        {isOpen && (
          <motion.div
            ref={listRef}
            initial={{ opacity: 0, y: placedDirection === 'up' ? -6 : 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: placedDirection === 'up' ? -6 : 6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{
              ...placedStyle,
              boxSizing: 'border-box',
              background: 'var(--bg-dock-btn)',
              border: '1px solid rgb(var(--ink) / 0.14)',
              borderRadius: 10,
              padding: '4px',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgb(var(--ink) / 0.05)',
              zIndex: 10000,
              scrollbarWidth: 'none'
            }}
          >
            {languages.map((lang) => {
              const active = lang.code === (language || 'system')
              return (
                <button
                  key={lang.code}
                  type="button"
                  data-active={active ? 'true' : 'false'}
                  onClick={() => {
                    playButtonClickSound()
                    patch({ language: lang.code })
                    setIsOpen(false)
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: compact ? '5px 8px' : '7px 10px',
                    borderRadius: 7,
                    background: active ? 'rgb(var(--ink) / 0.12)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'rgb(var(--ink) / max(0.8, var(--text-alpha-floor)))',
                    fontSize: compact ? 11.5 : 12,
                    fontWeight: active ? 600 : 400,
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.12s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = 'rgb(var(--ink) / 0.07)'
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <span>{getLangLabel(lang)}</span>
                  {active && <span style={{ color: '#4caf50', fontSize: 13, fontWeight: 700 }}>✓</span>}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  )
}
