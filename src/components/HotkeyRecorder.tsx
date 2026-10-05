import { useState, useEffect, useRef, useCallback } from 'react'
import { playToggleSound, playButtonClickSound } from '../lib/soundEffects'
import { RotateCcwIcon, CloseIcon } from './icons'
import { edge, IS_DARWIN } from '../lib/edge'
import { useStore } from '../store/appStore'
import { useTranslation } from '../i18n'
import { isReservedMacAccelerator } from './settings/hotkeys'

interface HotkeyRecorderProps {
  hotkey: string
  onChange: (nextHotkey: string) => void
  defaultHotkey?: string
  onReject?: (reason: 'reserved') => void
}

/** Formats an Electron accelerator string (e.g. "Alt+Shift+C") into individual display keys. */
export function parseKeyBadges(accelerator: string): string[] {
  if (!accelerator) return IS_DARWIN ? ['⌥', 'C'] : ['Alt', 'C']
  return accelerator
    .split('+')
    .map((k) => {
      const trimmed = k.trim()
      if (IS_DARWIN) {
        if (trimmed === 'CommandOrControl' || trimmed === 'Meta' || trimmed === 'Super' || trimmed === 'Command') return '⌘'
        if (trimmed === 'Ctrl' || trimmed === 'Control') return '⌃'
        if (trimmed === 'Alt' || trimmed === 'Option') return '⌥'
        if (trimmed === 'Shift') return '⇧'
      }
      if (trimmed === 'CommandOrControl' || trimmed === 'Ctrl') return 'Ctrl'
      if (trimmed === 'Meta' || trimmed === 'Super' || trimmed === 'Command') return 'Win'
      return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed
    })
}

/** Converts a KeyboardEvent to modifier list + primary key name. */
export function eventToAccelerator(e: KeyboardEvent): { accelerator: string; isValid: boolean; partialBadges: string[] } {
  const modifiers: string[] = []

  if (e.ctrlKey) modifiers.push('Ctrl')
  if (e.altKey) modifiers.push('Alt')
  if (e.shiftKey) modifiers.push('Shift')
  if (e.metaKey) modifiers.push('Super')

  // Identify main non-modifier key
  let keyName = ''
  const code = e.code
  const key = e.key

  if (/^Key[A-Z]$/i.test(code)) {
    keyName = code.slice(3).toUpperCase()
  } else if (/^Digit[0-9]$/i.test(code)) {
    keyName = code.slice(5)
  } else if (/^F(?:[1-9]|1[0-9])$/i.test(code)) {
    keyName = code.toUpperCase()
  } else if (code === 'Space') {
    keyName = 'Space'
  } else if (code === 'Tab') {
    keyName = 'Tab'
  } else if (code === 'Backspace') {
    keyName = 'Backspace'
  } else if (code === 'Enter') {
    keyName = 'Enter'
  } else if (code === 'Comma') {
    keyName = ','
  } else if (code === 'Period') {
    keyName = '.'
  } else if (code === 'Slash') {
    keyName = '/'
  } else if (code === 'Backquote') {
    keyName = '`'
  } else if (code === 'Minus') {
    keyName = '-'
  } else if (code === 'Equal') {
    keyName = '='
  } else if (key && key.length === 1 && !['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    keyName = key.toUpperCase()
  }

  const isModifierOnly = ['Control', 'Alt', 'Shift', 'Meta'].includes(key)
  const isFKey = /^F(?:[1-9]|1[0-9])$/i.test(keyName)
  const hasModifier = modifiers.length > 0

  const allParts = [...modifiers]
  if (keyName && !isModifierOnly) {
    allParts.push(keyName)
  }

  const isValid = (hasModifier && !!keyName && !isModifierOnly) || isFKey

  return {
    accelerator: allParts.join('+'),
    isValid,
    partialBadges: IS_DARWIN ? parseKeyBadges(allParts.join('+')) : allParts.map(p => (p === 'Super' ? 'Win' : p))
  }
}

export function HotkeyRecorder({ hotkey, onChange, defaultHotkey = 'Alt+C', onReject }: HotkeyRecorderProps) {
  const { t } = useTranslation()
  const [isRecording, setIsRecording] = useState(false)
  const [pressedBadges, setPressedBadges] = useState<string[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  const activeHotkey = hotkey || defaultHotkey
  const displayBadges = parseKeyBadges(activeHotkey)
  const isDefault = activeHotkey === defaultHotkey

  const stopRecording = useCallback((canceled = false) => {
    setIsRecording(false)
    setPressedBadges([])
    if (!useStore.getState().keyboardMode) {
      try {
        edge.focusWindow(false).catch?.(() => {})
      } catch {
        /* ignore */
      }
    }
    try {
      edge.pauseHotkey(false).catch?.(() => {})
    } catch {
      /* ignore */
    }
    if (canceled) {
      playButtonClickSound()
    }
  }, [])

  const startRecording = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    try {
      window.focus()
      edge.focusWindow(true).catch?.(() => {})
    } catch {
      /* ignore */
    }

    try {
      edge.pauseHotkey(true).catch?.(() => {})
    } catch {
      /* ignore */
    }

    playButtonClickSound()
    setIsRecording(true)
    setPressedBadges([])
  }, [])

  useEffect(() => {
    if (!isRecording) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        stopRecording(true)
        return
      }

      const { accelerator, isValid, partialBadges } = eventToAccelerator(e)
      setPressedBadges(partialBadges)

      if (isValid) {
        if (IS_DARWIN && isReservedMacAccelerator(accelerator)) {
          stopRecording(true)
          onReject?.('reserved')
          return
        }
        playToggleSound(true)
        stopRecording(false)
        onChange(accelerator)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const { partialBadges } = eventToAccelerator(e)
      setPressedBadges(partialBadges)
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        stopRecording(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('keyup', handleKeyUp, { capture: true })
    window.addEventListener('mousedown', handleClickOutside)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('keyup', handleKeyUp, { capture: true })
      window.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isRecording, onChange, onReject, stopRecording])

  const handleResetDefault = (e: React.MouseEvent) => {
    e.stopPropagation()
    playButtonClickSound()
    stopRecording(false)
    onChange(defaultHotkey)
  }

  const recordingHint = t('behaviour.hotkeyRecording') || 'Press key combination...'
  const cancelTitle = `${t('behaviour.hotkeyCancel') || 'Cancel'} (Esc)`
  const resetTitle = t('behaviour.hotkeyReset', { shortcut: defaultHotkey }) || `Reset to default (${defaultHotkey})`
  const editLabel = t('behaviour.hotkeyEdit') || 'Edit'

  return (
    <div ref={containerRef} className="hotkey-recorder-wrap">
      <div
        className={`hotkey-field ${isRecording ? 'is-recording' : ''}`}
        onClick={!isRecording ? startRecording : undefined}
      >
        {isRecording ? (
          <div className="hotkey-field-content">
            <div className="hotkey-recording-indicator">
              <span className="recording-pulse-dot" />
              {pressedBadges.length > 0 ? (
                <div className="hotkey-keycaps-row">
                  {pressedBadges.map((badge, idx) => (
                    <span key={idx} className="hotkey-keycap-item">
                      {idx > 0 && <span className="hotkey-plus-symbol">+</span>}
                      <kbd className="hotkey-keycap is-active">{badge}</kbd>
                    </span>
                  ))}
                  <span className="hotkey-plus-symbol" style={{ opacity: 0.35 }}>+ ...</span>
                </div>
              ) : (
                <span className="hotkey-recording-hint">{recordingHint}</span>
              )}
            </div>

            <button
              type="button"
              className="hotkey-cancel-icon-btn"
              onClick={(e) => {
                e.stopPropagation()
                stopRecording(true)
              }}
              title={cancelTitle}
            >
              <CloseIcon width={11} height={11} />
              <span className="hotkey-esc-text">Esc</span>
            </button>
          </div>
        ) : (
          <div className="hotkey-field-content">
            <div className="hotkey-keycaps-row">
              {displayBadges.map((badge, idx) => (
                <span key={idx} className="hotkey-keycap-item">
                  {idx > 0 && <span className="hotkey-plus-symbol">+</span>}
                  <kbd className="hotkey-keycap">{badge}</kbd>
                </span>
              ))}
            </div>

            <div className="hotkey-field-actions">
              {!isDefault && (
                <button
                  type="button"
                  className="hotkey-inline-reset-btn"
                  onClick={handleResetDefault}
                  title={resetTitle}
                >
                  <RotateCcwIcon width={12} height={12} />
                </button>
              )}
              <span className="hotkey-field-edit-badge">{editLabel}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
