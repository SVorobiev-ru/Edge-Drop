import { Divider } from './layout'
import { ThemeCards } from './ThemeCards'
import { LogOutIcon, StarIcon, GithubOctocatLogo, MicrosoftStoreLogo } from '../icons'
import { playButtonClickSound } from '../../lib/soundEffects'
import { REPO_URL, CHANGELOG_URL, SUPPORT_URL } from '../../lib/links'
import { IS_DARWIN } from '../../lib/edge'
import type { SettingsState } from './useSettingsState'
import type { updateCards } from './UpdateCards'
import type { behaviourCards } from './BehaviourCards'
import type { positionCards } from './PositionCards'
import type { appearanceCards } from './AppearanceCards'

export type SettingsCards = ReturnType<typeof updateCards> & ReturnType<typeof behaviourCards> & ReturnType<typeof positionCards> & ReturnType<typeof appearanceCards>

export function renderHorizontalSettings(s: SettingsState, cards: SettingsCards) {
  const { t, settings, patch, isStoreBuild, currentVersion, styleFlyoutOpen, setStyleFlyoutOpen, languageFlyoutOpen, setLanguageFlyoutOpen, horizontalTab, shelfTrackRef, horizontalTabScrollPositions, isSwitchingTabRef, hasPromotedTopUpdate } = s
  const { renderPromotedUpdateCard, renderUpdateModeCard, renderHorizontalUpdateStatusCard, renderBehaviourCards, renderPlacementCard, renderDisplayCard, renderLocationHintCard, renderMacPositionHintCard, renderHoverAreaCard, renderThicknessCard, renderCopyIndicatorCard, renderIndicatorStyleCard, renderSoundCard, renderMotionCards } = cards

  const handleShelfWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (IS_DARWIN && e.deltaX !== 0) return
    if (e.deltaY !== 0) {
      e.currentTarget.scrollLeft += e.deltaY
    }
  }

  const handleShelfScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (isSwitchingTabRef.current) return
    if (styleFlyoutOpen) {
      setStyleFlyoutOpen(false)
    }
    if (languageFlyoutOpen) {
      setLanguageFlyoutOpen(false)
    }
    horizontalTabScrollPositions.current[horizontalTab] = e.currentTarget.scrollLeft
  }

  const renderHorizontalCommunityCard = () => (
    <div className="settings-shelf-card support-card">
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('footer.communityAndSupport') || 'COMMUNITY & SUPPORT'}</div>
        <div className="setting-title">{t('footer.communityAndSupport')}</div>
        <div className="setting-desc">{t('footer.supportTagline') || '100% free & open-source clipboard'}</div>
      </div>
      <div className="shelf-card-bottom">
        <button
          type="button"
          className="shelf-kofi-btn"
          onClick={() => {
            playButtonClickSound()
            window.open(SUPPORT_URL, '_blank')
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="#ff4757" stroke="none" style={{ flexShrink: 0 }}>
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
          <span>{t('footer.supportOnKofi')}</span>
        </button>
        {isStoreBuild ? (
          <button
            type="button"
            className="shelf-github-btn"
            onClick={() => {
              playButtonClickSound()
              window.open('ms-windows-store://review/?ProductId=9P3JMHN9M4NR', '_blank')
            }}
          >
            <MicrosoftStoreLogo width={13} height={13} className="store-logo-icon" />
            <span>{t('footer.reviewOnStore')}</span>
          </button>
        ) : (
          <button
            type="button"
            className="shelf-github-btn"
            onClick={() => {
              playButtonClickSound()
              window.open(REPO_URL, '_blank')
            }}
          >
            <GithubOctocatLogo width={13} height={13} className="github-octocat-icon" />
            <span>{t('footer.starOnGithub')}</span>
            <StarIcon width={12} height={12} className="star-icon" fill="#fbbf24" stroke="#fbbf24" style={{ marginLeft: 2 }} />
          </button>
        )}
      </div>
    </div>
  )

  const renderHorizontalAboutCard = () => (
    <div className="settings-shelf-card about-card">
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.aboutEdgeDrop') || 'ABOUT EDGE-DROP'}</div>
        <div className="setting-title">{currentVersion ? `Edge-Drop v${currentVersion}` : 'Edge-Drop'}</div>
        <div className="setting-desc">{t('footer.feedbackDesc')}</div>
      </div>
      <div className="shelf-card-bottom">
        <button
          type="button"
          className="pill display-pill"
          style={{ width: '100%', justifyContent: 'center', height: 30, fontSize: 11.5, fontWeight: 550, borderRadius: 999 }}
          onClick={() => {
            playButtonClickSound()
            window.open(`${REPO_URL}/issues/new/choose`, '_blank')
          }}
        >
          {t('footer.submitFeedback')}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
          <button
            type="button"
            className="version-changelog-link"
            style={{ fontSize: 11 }}
            onClick={() => {
              playButtonClickSound()
              if (currentVersion) patch({ lastSeenChangelogVersion: currentVersion })
              window.open(CHANGELOG_URL, '_blank')
            }}
          >
            {t('header.whatsNew')} ↗
          </button>
          <button
            type="button"
            className="shelf-quit-btn"
            onClick={() => {
              playButtonClickSound()
              void window.edge.quitApp()
            }}
          >
            <LogOutIcon width={11} height={11} />
            <span>{t('tray.quit')}</span>
          </button>
        </div>
      </div>
    </div>
  )

  const renderHorizontalFooter = () => (
    <>
      {/* ── SUB-GROUP 6 DIVIDER: Community & Support ── */}
      <Divider label={t('footer.communityAndSupport') || 'COMMUNITY & SUPPORT'} />

      {/* Card 13: Community & Feedback */}
      {renderHorizontalCommunityCard()}

      {/* Card 14: About & Quit */}
      {renderHorizontalAboutCard()}
    </>
  )

  return (
    <div className="settings-horizontal-shelf">
      <div
        className="settings-shelf-track tab-view"
        ref={shelfTrackRef}
        onWheel={handleShelfWheel}
        onScroll={handleShelfScroll}
      >
        {/* ── TAB 1: BEHAVIOUR ── */}
        {horizontalTab === 'behaviour' && (
          <>
            {renderPromotedUpdateCard()}
            {renderBehaviourCards()}

            {/* ── SUB-GROUP 5 DIVIDER: Updates ── */}
            {!isStoreBuild && <Divider label={t('tabs.updates') || 'UPDATES'} />}
            {renderUpdateModeCard()}
            {!isStoreBuild && !hasPromotedTopUpdate && renderHorizontalUpdateStatusCard()}

            {renderHorizontalFooter()}
          </>
        )}

        {/* ── TAB 2: POSITION ── */}
        {horizontalTab === 'position' && (
          <>
            {/* ── SUB-GROUP 1 DIVIDER: Position ── */}
            <Divider label={t('tabs.position') || 'POSITION'} />
            {IS_DARWIN ? renderMacPositionHintCard() : renderPlacementCard()}
            {!IS_DARWIN && renderDisplayCard()}
            {renderLocationHintCard()}

            {/* ── SUB-GROUP 2 DIVIDER: Trigger Zone ── */}
            <Divider label={t('position.triggerZone') || 'TRIGGER ZONE'} />
            {renderHoverAreaCard()}
            {renderThicknessCard()}

            {renderHorizontalFooter()}
          </>
        )}

        {/* ── TAB 3: APPEARANCE ── */}
        {horizontalTab === 'appearance' && (
          <>
            {IS_DARWIN && <ThemeCards />}

            {/* ── SUB-GROUP 1 DIVIDER: Copy Indicator ── */}
            <Divider label={t('appearance.copyIndicatorTitle') || 'COPY INDICATOR'} />
            {renderCopyIndicatorCard()}
            {(settings.showCopyIndicator ?? true) && renderIndicatorStyleCard()}

            {/* ── SUB-GROUP 2 DIVIDER: Audio & Feedback ── */}
            <Divider label={t('appearance.audioAndFeedback') || 'AUDIO FEEDBACK'} />
            {renderSoundCard()}
            {renderMotionCards()}

            {renderHorizontalFooter()}
          </>
        )}
      </div>
    </div>
  )
}
