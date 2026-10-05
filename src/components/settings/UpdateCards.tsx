import { useStore } from '../../store/appStore'
import type { UpdateMode } from '../../../shared/types'
import { InfoIcon } from '../icons'
import { SlideCommit } from '../SlideCommit'
import { visibleUpdateModes } from './updateMode'
import { Pills } from './layout'
import { playButtonClickSound } from '../../lib/soundEffects'
import { CHANGELOG_URL } from '../../lib/links'
import { IS_DARWIN } from '../../lib/edge'
import type { SettingsState } from './useSettingsState'

export function updateCards(s: SettingsState) {
  const { t, isHorizontal, titleId, cardClass, patch, updateInfo, isStoreBuild, currentVersion, updateDownloaded, shownUpdateMode, checkState, handleManualCheck, handleStartDownload, isDownloading, hasBackgroundUpdate, downloadPercent, hasPromotedTopUpdate, updateBannerRef } = s

  const handleOpenChangelog = () => {
    playButtonClickSound()
    const targetVersion = checkState.version || updateInfo?.latestVersion || currentVersion
    if (targetVersion) {
      patch({ lastSeenChangelogVersion: targetVersion })
    }
    window.open(CHANGELOG_URL, '_blank')
  }

  // ── Promoted Top Update Card Renderer ──────────────────────────────────────
  const renderPromotedUpdateCard = () => {
    if (isStoreBuild) return null
    if (!hasPromotedTopUpdate) return null
    const promotedClass = isHorizontal ? 'settings-shelf-card update-promoted-card behaviour-col' : 'setting-card update-promoted-card'

    const infoButton = (
      <button
        type="button"
        className="update-info-btn"
        title={t('header.whatsNew') || "What's New"}
        aria-label={t('header.whatsNew') || "What's New"}
        onClick={handleOpenChangelog}
      >
        <InfoIcon width={13} height={13} />
      </button>
    )

    if (updateDownloaded) {
      return (
        <div className={promotedClass}>
          <div className="shelf-card-top">
            <div className="update-header-row">
              <div className="update-group-label">
                <span className="update-dot" />
                <span>{t('behaviour.updateLabelReady') || 'UPDATE READY'}</span>
              </div>
              {infoButton}
            </div>
            <div className="setting-title">
              {t('behaviour.updateReadyTitle', { version: updateDownloaded.version })}
            </div>
            <div className="setting-desc">
              {t('behaviour.updateReadyDesc')}
            </div>
          </div>
          <div className="shelf-card-bottom">
            <SlideCommit
              label={t('behaviour.restart') || 'Restart'}
              doneLabel={t('behaviour.restarting') || 'Restarting...'}
              errorLabel={t('behaviour.restartFailed') || 'Restart failed'}
              height={32}
              radius={10}
              onConfirm={() => {
                playButtonClickSound()
                void window.edge.installUpdate()
              }}
            />
          </div>
        </div>
      )
    }

    if (isDownloading) {
      return (
        <div className={promotedClass}>
          <div className="shelf-card-top">
            <div className="update-header-row">
              <div className="update-group-label">
                <span className="update-dot checking" />
                <span>{t('behaviour.updateLabelDownloading') || 'DOWNLOADING UPDATE'}</span>
              </div>
              {infoButton}
            </div>
            <div className="setting-title">
              {updateInfo?.latestVersion
                ? t('behaviour.updateAvailableTitle', { version: updateInfo.latestVersion })
                : t('behaviour.downloadingUpdate')}
            </div>
            <div className="setting-desc">
              {downloadPercent > 0 ? t('behaviour.downloadingWithPercent', { percent: downloadPercent }) : t('behaviour.downloadingUpdate')}
            </div>
          </div>
          <div className="shelf-card-bottom">
            <div className="shelf-update-progress-wrap">
              <div className="shelf-progress-bar" style={{ width: `${downloadPercent}%` }} />
              <span className="shelf-progress-text">{downloadPercent > 0 ? `${downloadPercent}%` : 'Connecting...'}</span>
            </div>
          </div>
        </div>
      )
    }

    if (checkState.status === 'available' || hasBackgroundUpdate) {
      const versionStr = checkState.version || updateInfo?.latestVersion || ''
      const skipButton = (
        <button
          type="button"
          className="update-action-btn secondary"
          style={{ flex: '0 0 68px' }}
          onClick={() => {
            playButtonClickSound()
            useStore.getState().dismissUpdate()
          }}
        >
          {t('behaviour.skip')}
        </button>
      )
      return (
        <div className={promotedClass}>
          <div className="shelf-card-top">
            <div className="update-header-row">
              <div className="update-group-label">
                <span className="update-dot" />
                <span>{t('behaviour.updateLabelAvailable') || 'NEW UPDATE AVAILABLE'}</span>
              </div>
              {infoButton}
            </div>
            <div className="setting-title">
              {t('behaviour.updateAvailableTitle', { version: versionStr })}
            </div>
            <div className="setting-desc">
              {t('behaviour.updateAvailableDesc')}
            </div>
          </div>
          <div className="shelf-card-bottom">
            {IS_DARWIN ? (
              <div className="update-action-stack">
                <button
                  type="button"
                  className="update-action-btn primary"
                  style={{ width: '100%' }}
                  onClick={() => {
                    playButtonClickSound()
                    handleStartDownload()
                  }}
                >
                  {t('behaviour.installUpdate')}
                </button>
                <div className="update-action-row">
                  <button
                    type="button"
                    className="update-action-btn secondary"
                    style={{ flex: 1 }}
                    onClick={handleOpenChangelog}
                  >
                    {t('behaviour.openReleasePage')}
                  </button>
                  {skipButton}
                </div>
              </div>
            ) : (
              <div className="update-action-row">
                <button
                  type="button"
                  className="update-action-btn primary"
                  style={{ flex: 1 }}
                  onClick={() => {
                    playButtonClickSound()
                    handleStartDownload()
                  }}
                >
                  {t('behaviour.update') || 'Update'}
                </button>
                {skipButton}
              </div>
            )}
          </div>
        </div>
      )
    }

    return null
  }

  // ── Manual update card renderer (idle/check states at the bottom) ──
  const renderManualUpdateCard = (withRef = false) => {
    // Hidden while the promoted top card shows an actionable state — the
    // top card already carries Download/Skip/Restart/progress, so rendering
    // both would duplicate the prompt. The idle branch below IS the Check
    // button, which is exactly what belongs at the bottom.
    if (isStoreBuild || hasPromotedTopUpdate) return null
    return (
      <div className="manual-update-section" ref={withRef ? updateBannerRef : undefined} style={{ width: '100%' }}>
        <div className="manual-update-card">
          {checkState.status === 'checking' ? (
            <>
              <div className="manual-update-info">
                <div className="manual-update-title">{t('behaviour.checkForUpdates')}</div>
                <div className="manual-update-desc">{t('behaviour.checkingForUpdates')}</div>
              </div>
              <button
                type="button"
                className="manual-update-pill outline"
                disabled
              >
                <span className="update-dot checking" />
                <span>{t('behaviour.checkingForUpdates')}</span>
              </button>
            </>
          ) : checkState.status === 'up-to-date' ? (
            <>
              <div className="manual-update-info">
                <div className="manual-update-title">
                  <span className="update-dot available" />
                  <span>{t('behaviour.isUpToDate')}</span>
                </div>
                <div className="manual-update-desc">
                  {t('footer.version')} {currentVersion}
                </div>
              </div>
              <button
                type="button"
                className="manual-update-pill outline"
                onClick={() => {
                  playButtonClickSound()
                  handleManualCheck()
                }}
              >
                {t('behaviour.checkAgain')}
              </button>
            </>
          ) : checkState.status === 'error' ? (
            <>
              <div className="manual-update-info">
                <div className="manual-update-title error">
                  {t('behaviour.updateCheckFailed')}
                </div>
                <div className="manual-update-desc error">
                  {checkState.error || t('behaviour.updateCheckFailed')}
                </div>
              </div>
              <button
                type="button"
                className="manual-update-pill outline"
                onClick={() => {
                  playButtonClickSound()
                  handleManualCheck()
                }}
              >
                {t('behaviour.tryAgain')}
              </button>
            </>
          ) : (
            <>
              <div className="manual-update-info">
                <div className="manual-update-title">{t('behaviour.checkForUpdates')}</div>
                <div className="manual-update-desc">
                  {t('footer.version')} {currentVersion}
                </div>
              </div>
              <button
                type="button"
                className="manual-update-pill outline"
                onClick={() => {
                  playButtonClickSound()
                  handleManualCheck()
                }}
              >
                {t('behaviour.checkForUpdates')}
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // Card 11: Application Updates (3-mode selector)
  const renderUpdateModeCard = () => {
    const labels: Record<UpdateMode, string> = {
      auto: t('behaviour.updateModeAuto') || 'Automatic',
      notify: t('behaviour.updateModeNotify') || 'Notify me',
      off: t('behaviour.updateModeOff') || 'Off'
    }
    const modes = visibleUpdateModes(IS_DARWIN)
    return (
      <div className={cardClass('updates-card', 'behaviour-col')}>
        <div className="shelf-card-top">
          <div className="setting-group-label">{t('groups.updates') || 'UPDATES'}</div>
          <div className="setting-title" id={titleId('updateMode')}>
            {IS_DARWIN ? t('behaviour.updateCheckTitle') : t('behaviour.autoUpdatesTitle')}
          </div>
          <div className="setting-desc">
            {!isStoreBuild
              ? (shownUpdateMode === 'auto'
                ? t('behaviour.autoUpdatesDescOn')
                : shownUpdateMode === 'notify'
                ? (t('behaviour.updateModeNotifyDesc') || 'Notify when updates are available without downloading')
                : t('behaviour.autoUpdatesDescOff'))
              : 'Managed by Microsoft Store'}
          </div>
        </div>
        {!isStoreBuild && (
          <div className="shelf-card-bottom">
            <Pills
              labelId={titleId('updateMode')}
              options={modes.map((id) => ({
                key: id,
                label: labels[id],
                active: shownUpdateMode === id,
                onSelect: () => { playButtonClickSound(); patch({ updateMode: id }) }
              }))}
              layout={{
                columns: modes.length,
                gap: 5,
                fullWidth: true,
                verticalGrid: true,
                pill: { height: 32, fontSize: 11, fontWeight: 500, padding: '0 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', justifyContent: 'center' }
              }}
            />
          </div>
        )}
      </div>
    )
  }

  // Card 12: Update Status & Actions (idle/check states; hidden
  // while the promoted front card shows an actionable state)
  const renderHorizontalUpdateStatusCard = () => (
    <div className="settings-shelf-card check-updates-card behaviour-col" ref={updateBannerRef}>
      <div className="shelf-card-top">
        <div className="setting-group-label">
          UPDATE STATUS
        </div>
        <div className="setting-title" style={{ lineHeight: 1.3 }}>
          {checkState.status === 'checking'
            ? t('behaviour.checkingForUpdates')
            : checkState.status === 'up-to-date'
            ? t('behaviour.isUpToDate')
            : checkState.status === 'error'
            ? t('behaviour.updateCheckFailed')
            : t('behaviour.checkForUpdates')}
        </div>
        <div className="setting-desc">
          {checkState.status === 'error'
            ? (checkState.error || t('behaviour.updateCheckFailed'))
            : `Edge-Drop v${currentVersion}`}
        </div>
      </div>
      <div className="shelf-card-bottom">
        <button
          type="button"
          className="pill display-pill"
          style={{ width: '100%', justifyContent: 'center', fontSize: 11.5, height: 32 }}
          disabled={checkState.status === 'checking'}
          onClick={() => {
            playButtonClickSound()
            handleManualCheck()
          }}
        >
          {checkState.status === 'checking' ? (
            <>
              <span className="update-dot checking" style={{ marginRight: 6 }} />
              <span>{t('behaviour.checkingForUpdates')}</span>
            </>
          ) : checkState.status === 'up-to-date' ? (
            t('behaviour.checkAgain')
          ) : checkState.status === 'error' ? (
            t('behaviour.tryAgain')
          ) : (
            t('behaviour.checkForUpdates')
          )}
        </button>
      </div>
    </div>
  )

  return { renderPromotedUpdateCard, renderManualUpdateCard, renderUpdateModeCard, renderHorizontalUpdateStatusCard }
}
