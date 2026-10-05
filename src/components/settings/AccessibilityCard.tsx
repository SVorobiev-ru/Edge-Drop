import { useEffect, useState } from 'react'
import { IS_DARWIN } from '../../lib/edge'
import { playButtonClickSound } from '../../lib/soundEffects'
import { useTranslation } from '../../i18n'
import { useSettingsLayout } from './layout'

const ACCESSIBILITY_POLL_MS = 3000

export function useAccessibilityStatus() {
  const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(null)
  useEffect(() => {
    if (!IS_DARWIN) return
    let cancelled = false
    const refresh = () => {
      Promise.resolve()
        .then(() => window.edge.getAccessibilityStatus())
        .then((trusted) => {
          if (!cancelled) setAccessibilityTrusted(typeof trusted === 'boolean' ? trusted : null)
        })
        .catch(() => {})
    }
    refresh()
    const timer = window.setInterval(refresh, ACCESSIBILITY_POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const handleGrantAccessibility = async () => {
    playButtonClickSound()
    try {
      const trusted = await window.edge.requestAccessibility()
      if (typeof trusted === 'boolean') setAccessibilityTrusted(trusted)
      if (trusted) return
    } catch {
      /* ignore */
    }
    try {
      await window.edge.openAccessibilitySettings()
    } catch {
      /* ignore */
    }
  }

  return { accessibilityTrusted, handleGrantAccessibility }
}

export function AccessibilityCard({
  accessibilityTrusted,
  handleGrantAccessibility
}: ReturnType<typeof useAccessibilityStatus>) {
  const { t } = useTranslation()
  const { titleId, cardClass } = useSettingsLayout()
  return (
    <div className={cardClass('accessibility-card', 'behaviour-col')}>
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('onboarding.accessibilityTitle')}</div>
        <div className="setting-title" id={titleId('accessibility')}>{t('behaviour.accessibilityTitle')}</div>
        {accessibilityTrusted !== null && (
          <div
            className={`setting-desc accessibility-status ${accessibilityTrusted ? 'granted' : 'missing'}`}
            role="status"
          >
            {accessibilityTrusted ? t('behaviour.accessibilityGranted') : t('behaviour.accessibilityMissing')}
          </div>
        )}
      </div>
      {accessibilityTrusted === false && (
        <div className="shelf-card-bottom">
          <button
            type="button"
            className="pill display-pill"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => {
              void handleGrantAccessibility()
            }}
          >
            {t('behaviour.accessibilityOpenSettings')}
          </button>
          <div className="setting-desc accessibility-repair-hint">{t('behaviour.accessibilityRepairHint')}</div>
        </div>
      )}
    </div>
  )
}
