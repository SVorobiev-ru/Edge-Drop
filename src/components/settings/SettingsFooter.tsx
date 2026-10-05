import { LogOutIcon, StarIcon, GithubOctocatLogo, MicrosoftStoreLogo } from '../icons'
import { playButtonClickSound } from '../../lib/soundEffects'
import { REPO_URL, CHANGELOG_URL, SUPPORT_URL } from '../../lib/links'
import { IS_DARWIN } from '../../lib/edge'
import type { SettingsState } from './useSettingsState'

export function settingsFooter(s: SettingsState) {
  const { t, patch, isStoreBuild, currentVersion } = s

  // ── Persistent footer shared across all tabs ───────────────────────────
  const PersistentFooter = (
    <>
      {/* Community & Support */}
      <div className="setting-section-divider">
        <span className="setting-section-divider-text">{t('footer.communityAndSupport') || 'COMMUNITY & SUPPORT'}</span>
      </div>

      <div className="setting-card">
        <div className="shelf-card-top">
          <div className="setting-group-label">{t('groups.feedback') || 'FEEDBACK'}</div>
          <div className="setting-title">{t('footer.feedbackTitle')}</div>
          <div className="setting-desc">{t('footer.feedbackDesc')}</div>
        </div>
        <div className="shelf-card-bottom">
          <button
            className="pill display-pill"
            style={{ width: '100%', justifyContent: 'center', padding: '7px 14px', cursor: 'pointer', whiteSpace: IS_DARWIN ? 'normal' : 'nowrap', fontSize: '12.5px' }}
            onClick={() => {
              playButtonClickSound()
              window.open(`${REPO_URL}/issues/new/choose`, '_blank')
            }}
          >
            {t('footer.submitFeedback')}
          </button>
        </div>
      </div>

      {/* Support & GitHub Promo Card */}
      <div className="setting-card" style={{ padding: '14px' }}>
        <div className="support-promo" style={{ margin: 0, padding: 0, background: 'transparent', border: 'none' }}>
          <div className="support-promo-title">
            {t('footer.supportPromo')}
          </div>
          <div className="support-buttons-group">
            {/* Primary Action: Support via Ko-fi / UPI */}
            <button
              className="kofi-support-btn"
              onClick={() => {
                playButtonClickSound()
                window.open(SUPPORT_URL, '_blank')
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#ff4757" stroke="none" style={{ flexShrink: 0 }}>
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
              <span>{t('footer.supportOnKofi')}</span>
            </button>

            {/* Secondary Action: GitHub Star on GitHub builds / Review on Microsoft Store for Store builds */}
            {isStoreBuild ? (
              <button
                type="button"
                className="store-review-promo-btn"
                onClick={() => {
                  playButtonClickSound()
                  window.open('ms-windows-store://review/?ProductId=9P3JMHN9M4NR', '_blank')
                }}
              >
                <MicrosoftStoreLogo width={14} height={14} className="store-logo-icon" />
                <span>{t('footer.reviewOnStore')}</span>
              </button>
            ) : (
              <button
                type="button"
                className="github-promo-btn"
                onClick={() => {
                  playButtonClickSound()
                  window.open(REPO_URL, '_blank')
                }}
              >
                <GithubOctocatLogo width={14} height={14} className="github-octocat-icon" />
                <span>{t('footer.starOnGithub')}</span>
                <StarIcon width={13} height={13} className="star-icon" fill="#fbbf24" stroke="#fbbf24" style={{ marginLeft: 2 }} />
              </button>
            )}
          </div>
          <div className="app-version-footer">
            <span>{t('footer.version')} {currentVersion}</span>
            <span className="version-separator">·</span>
            <button
              type="button"
              className="version-changelog-link"
              onClick={() => {
                playButtonClickSound()
                if (currentVersion) {
                  patch({ lastSeenChangelogVersion: currentVersion })
                }
                window.open(CHANGELOG_URL, '_blank')
              }}
            >
              <span>{t('header.whatsNew')}</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>↗</span>
            </button>
          </div>
        </div>
      </div>

      {/* Subtle Bottom Quit Button */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12, marginBottom: 8 }}>
        <button
          className="subtle-quit-btn"
          onClick={() => {
            playButtonClickSound()
            void window.edge.quitApp()
          }}
        >
          <LogOutIcon width={13} height={13} />
          <span>{t('tray.quit')}</span>
        </button>
      </div>
    </>
  )

  return { PersistentFooter }
}
