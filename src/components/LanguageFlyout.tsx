/**
 * LanguageFlyout — Obsidian Flyout Selection Panel for Display Language in Horizontal Layout.
 *
 * Provides an elegant, clean single-column list of all application languages
 * with native scripts, English subnames, and smooth spring entry/exit animations.
 */
import { useRef, useEffect } from 'react'
import { useStore } from '../store/appStore'
import { CloseIcon } from './icons'
import { playButtonClickSound } from '../lib/soundEffects'
import { useTranslation } from '../i18n'
import { SideFlyoutShell, flyoutVariants, type SideFlyoutMotion } from './SideFlyoutShell'

const reducedVariants = { hidden: flyoutVariants.reducedHidden, shown: flyoutVariants.reducedShown, exit: flyoutVariants.reducedHidden }

function languageFlyoutMotion(reduceMotion: boolean): SideFlyoutMotion {
  return {
    variants: reduceMotion ? reducedVariants : flyoutVariants,
    initial: 'hidden',
    animate: 'shown',
    exit: 'exit'
  }
}

function dismissLanguageFlyout(): void {
  useStore.getState().setLanguageFlyoutOpen(false)
}

export function LanguageFlyout({ isRight }: { isRight: boolean }) {
  const { t, language, languages } = useTranslation()
  const languageFlyoutOpen = useStore((s) => s.languageFlyoutOpen)
  const setLanguageFlyoutOpen = useStore((s) => s.setLanguageFlyoutOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const open = useStore((s) => s.open)
  const patch = useStore((s) => s.patchSettings)

  const isVisible = languageFlyoutOpen && settingsOpen && open

  const listRef = useRef<HTMLDivElement | null>(null)

  const languageFlyoutAnchorRect = useStore((s) => s.languageFlyoutAnchorRect)

  // Auto-scroll to active language on open
  useEffect(() => {
    if (isVisible && listRef.current) {
      const activeBtn = listRef.current.querySelector<HTMLButtonElement>('[data-active="true"]')
      if (activeBtn) {
        if ((language || 'system') === 'system') {
          listRef.current.scrollTop = 0
        } else {
          listRef.current.scrollTop = Math.max(0, activeBtn.offsetTop - 36)
        }
      }
    }
  }, [isVisible, language])

  return (
    <SideFlyoutShell
      isRight={isRight}
      visible={isVisible}
      motionKey="language-flyout-wrapper"
      motionProps={languageFlyoutMotion}
      horizontalWidth={270}
      horizontalStyle={{ zIndex: 9999 }}
      anchorRect={languageFlyoutAnchorRect}
      insideSelector="[data-language-flyout], .language-flyout, .language-toggle-btn"
      onDismiss={dismissLanguageFlyout}
      panelProps={{ className: 'preview-flyout language-flyout', 'data-language-flyout': 'true' }}
      panelStyle={{
        background: 'var(--bg-2)',
        borderRadius: 18,
        border: 'none',
        outline: 'none',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 'none',
        pointerEvents: 'auto',
        position: 'relative',
        padding: '12px 10px 10px 10px',
        boxSizing: 'border-box'
      }}
    >
      {() => (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 8px 4px', borderBottom: 'none' }}>
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgb(var(--ink) / max(0.42, var(--text-alpha-floor)))', marginBottom: 2 }}>
                  LANGUAGE
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                  {t('behaviour.languageTitle')}
                </div>
              </div>
              <button
                type="button"
                className="icon-btn"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: 'rgb(var(--ink) / 0.06)',
                  border: 'none',
                  color: 'rgb(var(--ink) / max(0.7, var(--text-alpha-floor)))',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'background 0.15s ease, color 0.15s ease'
                }}
                onClick={() => {
                  playButtonClickSound()
                  setLanguageFlyoutOpen(false)
                }}
                title={t('header.close')}
              >
                <CloseIcon width={11} height={11} />
              </button>
            </div>

            {/* Clean Single-Column List (No Horizontal Scroll) */}
            <div
              ref={listRef}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                overflowY: 'auto',
                overflowX: 'hidden',
                paddingTop: 6,
                paddingRight: 2,
                maxHeight: 190,
                scrollbarWidth: 'none',
                boxSizing: 'border-box'
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
                      setLanguageFlyoutOpen(false)
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      borderRadius: 8,
                      background: active ? 'rgb(var(--ink) / 0.12)' : 'transparent',
                      border: active ? '1px solid rgb(var(--ink) / 0.18)' : '1px solid transparent',
                      color: active ? 'var(--text-primary)' : 'rgb(var(--ink) / max(0.8, var(--text-alpha-floor)))',
                      fontSize: 12,
                      fontWeight: active ? 600 : 400,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.12s ease, border-color 0.12s ease',
                      flexShrink: 0,
                      boxSizing: 'border-box'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                      <span style={{ fontWeight: active ? 600 : 500, color: active ? 'var(--text-primary)' : 'rgb(var(--ink) / max(0.9, var(--text-alpha-floor)))', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {lang.nativeName}
                      </span>
                      {lang.code !== 'system' && !lang.nativeName.includes('(') && lang.nativeName !== lang.name && (
                        <span style={{ fontSize: 10.5, color: 'rgb(var(--ink) / max(0.42, var(--text-alpha-floor)))', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          ({lang.name})
                        </span>
                      )}
                    </div>
                    {active && (
                      <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, marginLeft: 6, flexShrink: 0 }}>
                        ✓
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </>
      )}
    </SideFlyoutShell>
  )
}
