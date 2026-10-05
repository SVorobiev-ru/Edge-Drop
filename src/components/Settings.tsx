import { useEffect, useState, useRef, useLayoutEffect, useId } from 'react'
import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, selectReduceMotion } from '../store/appStore'
import type { DisplayInfo, Settings as SettingsShape, UpdateMode } from '../../shared/types'
import { resolveUpdateMode } from '../../shared/types'
import {
  LogoIndicatorIcon,
  TickIndicatorIcon,
  CopyIndicatorIcon,
  SparkleIndicatorIcon
} from './CopyIndicatorCurve'
import { ChevronRightIcon, CloseIcon, LogOutIcon, StarIcon, InfoIcon, GithubOctocatLogo, MicrosoftStoreLogo } from './icons'
import { SlideCommit } from './SlideCommit'
import { WakeSlider } from './WakeSlider'
import { PANEL_WIDTH_MAX, PANEL_WIDTH_MIN, PANEL_WIDTH_STEP, resolvePanelWidth } from '../hooks/useEdgeHover'
import { LanguageDropdown } from './settings/LanguageDropdown'
import { displayedUpdateMode, visibleUpdateModes } from './settings/updateMode'
import { Divider, Pills, SettingsLayoutContext, ToggleCard, settingsLayout, useSettingsLayout, type SettingsTab } from './settings/layout'
import { AccessibilityCard, useAccessibilityStatus } from './settings/AccessibilityCard'
import { IgnoredAppsCard, useIgnoredApps } from './settings/IgnoredAppsCard'
import { PLATFORM_TOGGLE_HOTKEY, PasteQueueHotkeyCard, ToggleHotkeyCard } from './settings/HotkeyCards'
import { BackupCard } from './settings/BackupCard'
import { ThemeCards } from './settings/ThemeCards'
import { CaptureScreenshotsCard, HideFromCaptureCard, IgnoreRemoteCard, PastePlainCard, RecognizeTextCard } from './settings/PrivacyCards'
import { playDialTickSound, playToggleSound, playButtonClickSound } from '../lib/soundEffects'
import { useTranslation } from '../i18n'
import { getLangLabel } from '../i18n/languages'
import { REPO_URL, CHANGELOG_URL, SUPPORT_URL } from '../lib/links'
import { IS_DARWIN } from '../lib/edge'
import '../styles/settings.css'
import { isHorizontalEdge } from '../../shared/panelPlacement'

export function Settings({
  inlineIndicatorStyle,
  isHorizontal: propIsHorizontal
}: {
  inlineIndicatorStyle?: boolean
  isHorizontal?: boolean
}) {
  const settings = useStore((s) => s.settings)
  const isHorizontal = propIsHorizontal ?? isHorizontalEdge(settings.stickPosition)
  const idBase = useId()

  return (
    <SettingsLayoutContext.Provider value={settingsLayout(isHorizontal, idBase)}>
      <SettingsContent inlineIndicatorStyle={inlineIndicatorStyle} />
    </SettingsLayoutContext.Provider>
  )
}

function SettingsContent({ inlineIndicatorStyle }: { inlineIndicatorStyle?: boolean }) {
  const { t, language, languages } = useTranslation()
  const settings = useStore((s) => s.settings)
  const { isHorizontal, titleId, cardClass } = useSettingsLayout()

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: 'behaviour',  label: t('tabs.behaviour') },
    { id: 'position',   label: t('tabs.position') },
    { id: 'appearance', label: t('tabs.appearance') },
  ]
  const patch = useStore((s) => s.patchSettings)
  const updateInfo = useStore((s) => s.updateInfo)
  const isStoreBuild = useStore((s) => s.isStoreBuild)
  const currentVersion = useStore((s) => s.currentVersion)
  const reduceMotion = useStore(selectReduceMotion)
  const styleFlyoutOpen = useStore((s) => s.styleFlyoutOpen)
  const setStyleFlyoutOpen = useStore((s) => s.setStyleFlyoutOpen)
  const languageFlyoutOpen = useStore((s) => s.languageFlyoutOpen)
  const setLanguageFlyoutOpen = useStore((s) => s.setLanguageFlyoutOpen)
  const setSliderActive = useStore((s) => s.setSliderActive)
  const edgeTransition = useStore((s) => s.edgeTransition)
  const startEdgeTransition = useStore((s) => s.startEdgeTransition)

  const selectedLang = languages.find((l) => l.code === (language || 'system')) || languages[0]

  const lastTickVal = useRef<number>(settings.verticalOffset ?? 0.5)
  const horizontalTab = useStore((s) => s.settingsTab)
  const shelfTrackRef = useRef<HTMLDivElement>(null)
  const horizontalTabScrollPositions = useRef<Record<SettingsTab, number>>({
    behaviour: 0,
    position: 0,
    appearance: 0
  })
  const isSwitchingTabRef = useRef(false)

  // Reset horizontal tab to 'behaviour' and scroll positions to 0 on mount,
  // but preserve 'position' if already on it or actively transitioning edges.
  useEffect(() => {
    if (isHorizontal) {
      const currentTab = useStore.getState().settingsTab
      const isTransitioning = !!useStore.getState().edgeTransition?.active
      if (currentTab !== 'position' && !isTransitioning) {
        useStore.getState().setSettingsTab('behaviour')
      }
      horizontalTabScrollPositions.current = {
        behaviour: 0,
        position: 0,
        appearance: 0
      }
    }
  }, [isHorizontal])

  // Restore target section's independent horizontal scroll position when tab changes
  useLayoutEffect(() => {
    if (!isHorizontal) return
    isSwitchingTabRef.current = true
    if (shelfTrackRef.current) {
      const targetPos = horizontalTabScrollPositions.current[horizontalTab] ?? 0
      shelfTrackRef.current.scrollLeft = targetPos
    }
    const id = requestAnimationFrame(() => {
      isSwitchingTabRef.current = false
    })
    return () => cancelAnimationFrame(id)
  }, [isHorizontal, horizontalTab])

  const handleSliderInput = (rawVal: number) => {
    const clamped = Math.min(1.0, Math.max(0.0, rawVal))
    if (Math.abs(clamped - lastTickVal.current) >= 0.05) {
      lastTickVal.current = clamped
      playDialTickSound()
    }
    useStore.setState((s) => ({
      settings: { ...s.settings, verticalOffset: clamped }
    }))
  }

  const handleSliderRelease = (rawVal: number) => {
    const snapped = Math.round(rawVal / 0.05) * 0.05
    const clamped = Math.min(1.0, Math.max(0.0, snapped))
    lastTickVal.current = clamped
    playDialTickSound()
    patch({ verticalOffset: clamped })
  }

  const handleThicknessInput = (rawVal: number) => {
    const clamped = Math.min(7, Math.max(1, Math.round(rawVal)))
    if (clamped !== (settings.hotZoneWidth ?? 3)) {
      playDialTickSound()
      useStore.setState((s) => ({
        settings: { ...s.settings, hotZoneWidth: clamped }
      }))
    }
  }

  const handleThicknessRelease = (rawVal: number) => {
    const clamped = Math.min(7, Math.max(1, Math.round(rawVal)))
    setSliderActive(false)
    playDialTickSound()
    patch({ hotZoneWidth: clamped })
  }

  const handlePanelWidthInput = (rawVal: number) => {
    const next = resolvePanelWidth({ panelWidth: rawVal, stickPosition: settings.stickPosition })
    if (next !== resolvePanelWidth(settings)) {
      playDialTickSound()
      useStore.setState((s) => ({
        settings: { ...s.settings, panelWidth: next }
      }))
    }
  }

  const handlePanelWidthRelease = (rawVal: number) => {
    const next = resolvePanelWidth({ panelWidth: rawVal, stickPosition: settings.stickPosition })
    setSliderActive(false)
    playDialTickSound()
    patch({ panelWidth: next })
  }

  const [localInlineOpen, setLocalInlineOpen] = useState(false)
  const isTutorial = inlineIndicatorStyle || (typeof window !== 'undefined' && window.location.hash.includes('onboarding'))
  const isFlyoutActive = isTutorial ? localInlineOpen : styleFlyoutOpen
  const indicatorBtnRef = useRef<HTMLButtonElement | null>(null)

  const handleToggleFlyout = (anchorEl?: HTMLElement | null) => {
    if (isTutorial) {
      setLocalInlineOpen(!localInlineOpen)
    } else {
      const nextOpen = !styleFlyoutOpen
      let rect: { x: number; y: number; width: number; height: number } | null = null
      if (nextOpen && anchorEl) {
        const r = anchorEl.getBoundingClientRect()
        rect = { x: r.left, y: r.top, width: r.width, height: r.height }
      }
      setStyleFlyoutOpen(nextOpen, rect)
    }
  }

  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  useEffect(() => {
    if (IS_DARWIN) return
    const timer = window.setTimeout(() => {
      window.edge.getDisplays().then(setDisplays).catch(() => {})
    }, 250)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    let timer: number
    const pullTimer = window.setTimeout(() => {
      void useStore.getState().refreshLaunchAtLogin()
      timer = window.setInterval(() => {
        void useStore.getState().refreshLaunchAtLogin()
      }, 2000)
    }, 300)
    return () => {
      window.clearTimeout(pullTimer)
      if (timer) window.clearInterval(timer)
    }
  }, [])

  const accessibility = useAccessibilityStatus()

  const ignoredApps = useIgnoredApps()

  const updateDownloaded = updateInfo?.downloaded ? { version: updateInfo.latestVersion } : null
  const updateMode = resolveUpdateMode(settings)
  const shownUpdateMode = displayedUpdateMode(updateMode, IS_DARWIN)

  const checkState = useStore((s) => s.manualCheckState)
  const handleManualCheck = () => useStore.getState().startManualCheck()
  const handleStartDownload = () => {
    void useStore.getState().startManualDownload()
  }

  const isManualDownloading = checkState.status === 'downloading'
  const isDownloading = isManualDownloading || (!updateDownloaded && !!updateInfo?.hasUpdate && (shownUpdateMode === 'auto' || !!updateInfo?.downloadProgress))
  // Update waiting for a user decision (Notify mode prompt or available check).
  const hasBackgroundUpdate = !updateDownloaded && !isDownloading && (!!updateInfo?.hasUpdate || checkState.status === 'available')
  const downloadPercent = updateInfo?.downloadProgress?.percent ?? 0

  // ── Tab state & Independent Scroll Memory per section ──────────────────────
  const activeTab = useStore((s) => s.settingsTab)
  const setActiveTab = useStore((s) => s.setSettingsTab)
  const scrollListRef = useRef<HTMLDivElement>(null)
  const tabScrollPositions = useRef<Record<SettingsTab, number>>({
    behaviour: 0,
    position: 0,
    appearance: 0
  })

  const handleTabSwitch = (newTab: SettingsTab) => {
    if (newTab === activeTab) return
    if (styleFlyoutOpen) {
      setStyleFlyoutOpen(false)
    }
    // Save current section's scroll position
    if (scrollListRef.current) {
      tabScrollPositions.current[activeTab] = scrollListRef.current.scrollTop
    }
    playButtonClickSound()
    setActiveTab(newTab)
  }

  // Close flyout if settings closes or unmounts
  useEffect(() => {
    return () => {
      if (useStore.getState().styleFlyoutOpen) {
        useStore.getState().setStyleFlyoutOpen(false)
      }
    }
  }, [])

  // Restore target section's independent scroll position when tab changes
  useEffect(() => {
    if (scrollListRef.current) {
      const targetPos = tabScrollPositions.current[activeTab] ?? 0
      scrollListRef.current.scrollTop = targetPos
    }
  }, [activeTab])

  // When update check finds a new update, smoothly scroll to top/front to highlight the update card
  useEffect(() => {
    if (checkState.status === 'available') {
      const behavior = reduceMotion ? 'auto' : 'smooth'
      if (isHorizontal) {
        if (shelfTrackRef.current) {
          shelfTrackRef.current.scrollTo({ left: 0, behavior })
        }
        horizontalTabScrollPositions.current.behaviour = 0
      } else {
        if (scrollListRef.current) {
          scrollListRef.current.scrollTo({ top: 0, behavior })
        }
        tabScrollPositions.current.behaviour = 0
      }
    }
  }, [checkState.status, isHorizontal, reduceMotion])

  // ── Promoted Active Update State ───────────────────────────────────────────
  // The top card shows all active update lifecycle stages:
  // 1) Downloaded update -> 'Restart to Update'
  // 2) Downloading in progress -> Live progress bar
  // 3) Update found & available -> 'Download & Update' / 'Skip'
  const hasPromotedTopUpdate = !isStoreBuild && (
    !!updateDownloaded ||
    isDownloading ||
    hasBackgroundUpdate
  )
  const updateBannerRef = useRef<HTMLDivElement | null>(null)

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

  // Card 1: Language
  const renderLanguageCard = () => (
    <div className={cardClass('shortcuts-card', 'behaviour-col')}>
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.general') || 'GENERAL'}</div>
        <div className="setting-title" id={titleId('language')}>{t('behaviour.languageTitle')}</div>
        <div className="setting-desc">
          {isHorizontal ? (t('groups.languageSelectDesc') || 'Select application display language') : t('behaviour.languageDesc')}
        </div>
      </div>
      <div className="shelf-card-bottom">
        {isHorizontal ? (
          <button
            type="button"
            className={`language-shelf-btn language-toggle-btn ${languageFlyoutOpen ? 'flyout-open' : ''}`}
            aria-expanded={languageFlyoutOpen}
            onClick={(e) => {
              playButtonClickSound()
              const rect = e.currentTarget.getBoundingClientRect()
              setLanguageFlyoutOpen(!languageFlyoutOpen, rect)
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, overflow: 'hidden' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.65, flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {getLangLabel(selectedLang)}
              </span>
            </div>
            <motion.span
              animate={{ rotate: languageFlyoutOpen ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'flex', alignItems: 'center', opacity: 0.65, flexShrink: 0, marginLeft: 6 }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </motion.span>
          </button>
        ) : (
          <LanguageDropdown />
        )}
      </div>
    </div>
  )

  // Card 2: Launch at Login
  const renderLaunchAtLoginCard = () => (
    <ToggleCard
      id="launchAtLogin"
      kind="system-card"
      col="behaviour-col"
      group={t('groups.startup') || 'STARTUP'}
      title={t('behaviour.launchAtLoginTitle')}
      desc={t('behaviour.launchAtLoginDesc')}
      checked={settings.launchAtLogin}
      onChange={(v) => useStore.getState().setLaunchAtLogin(v)}
    />
  )

  // Card 3: Incognito Mode
  const renderIncognitoCard = () => (
    <ToggleCard
      id="incognito"
      kind="incognito-card"
      col="behaviour-col"
      group={t('groups.privacy') || 'PRIVACY'}
      title={t('behaviour.incognitoTitle')}
      desc={t('behaviour.incognitoDesc')}
      checked={settings.incognito}
      onChange={(v) => patch({ incognito: v })}
    />
  )

  // Card 4: Hover Activation
  const renderHoverActivationCard = () => (
    <ToggleCard
      id="hoverActivation"
      kind="hover-card"
      col="behaviour-col"
      group={t('groups.hoverActivation') || 'HOVER ACTIVATION'}
      title={t('behaviour.hoverActivationTitle')}
      desc={(settings.hoverActivation ?? true)
        ? t('behaviour.hoverActivationDescOn')
        : t('behaviour.hoverActivationDescOff', { shortcut: settings.toggleHotkey || PLATFORM_TOGGLE_HOTKEY })}
      checked={settings.hoverActivation ?? true}
      onChange={(v) => {
        if (!v) {
          patch({ hoverActivation: false, suppressInFullscreen: false })
        } else {
          patch({ hoverActivation: true, suppressInFullscreen: true })
        }
      }}
    />
  )

  // Card 6: Fullscreen Protection
  const renderFullscreenCard = () => (
    <ToggleCard
      id="fullscreenProtection"
      kind="fullscreen-card"
      col="behaviour-col"
      group={t('groups.fullscreenProtection') || 'FULLSCREEN PROTECTION'}
      title={t('behaviour.fullscreenProtectionTitle')}
      desc={(settings.hoverActivation ?? true)
        ? t('behaviour.fullscreenProtectionDesc')
        : t('behaviour.disabledHoverOff')}
      checked={(settings.hoverActivation ?? true) ? settings.suppressInFullscreen : false}
      onChange={(v) => (settings.hoverActivation ?? true) && patch({ suppressInFullscreen: v })}
      disabled={!(settings.hoverActivation ?? true)}
      dimmed={!(settings.hoverActivation ?? true)}
    />
  )

  // Card 7: Move Pasted to Top
  const renderMovePastedCard = () => (
    <ToggleCard
      id="movePastedToTop"
      kind="order-card"
      col="behaviour-col"
      group={t('groups.clipboardBehaviour') || 'CLIPBOARD BEHAVIOUR'}
      title={t('behaviour.movePastedToTopTitle')}
      desc={t('behaviour.movePastedToTopDesc')}
      checked={settings.movePastedToTop ?? true}
      onChange={(v) => patch({ movePastedToTop: v })}
    />
  )

  // Card 8: Clear Unpinned on Restart
  const renderClearUnpinnedCard = () => (
    <ToggleCard
      id="clearUnpinnedOnRestart"
      kind="rules-card"
      col="behaviour-col"
      group={t('groups.restartCleanup') || 'RESTART CLEANUP'}
      title={t('behaviour.clearUnpinnedTitle')}
      desc={t('behaviour.clearUnpinnedDesc')}
      checked={settings.clearUnpinnedOnRestart}
      onChange={(v) => patch({ clearUnpinnedOnRestart: v })}
    />
  )

  // Card 9: History Capacity
  const renderCapacityCard = () => (
    <div className={cardClass('storage-card', 'behaviour-col')}>
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.storageCapacity') || 'STORAGE CAPACITY'}</div>
        <div className="setting-title" id={titleId('historyLimit')}>{t('behaviour.capacityTitle')}</div>
        <div className="setting-desc">{t('behaviour.capacityDesc')}</div>
      </div>
      <div className="shelf-card-bottom">
        <Pills
          labelId={titleId('historyLimit')}
          options={[
            { label: '100', val: 100 },
            { label: '250', val: 250 },
            { label: '500', val: 500 },
            { label: '1000', val: 1000 }
          ].map((opt) => ({
            key: opt.val,
            label: opt.label,
            active: settings.historyLimit === opt.val,
            onSelect: () => { playButtonClickSound(); patch({ historyLimit: opt.val }) }
          }))}
          layout={{ columns: 4, gap: 5, pill: { height: 32, fontSize: 11.5, fontWeight: 500, padding: 0 } }}
        />
      </div>
    </div>
  )

  // Card 10: Auto-Delete Timer
  const renderAutoDeleteCard = () => (
    <div className={cardClass('autodelete-card', 'behaviour-col')}>
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.autoDelete') || 'AUTO-DELETE'}</div>
        <div className="setting-title" id={titleId('autoDelete')}>{t('behaviour.autoDeleteTitle')}</div>
        <div className="setting-desc">{t('behaviour.autoDeleteDesc')}</div>
      </div>
      <div className="shelf-card-bottom">
        <Pills
          labelId={titleId('autoDelete')}
          options={[
            { label: t('behaviour.never'), val: 0 },
            { label: '1h', val: 1 },
            { label: '6h', val: 6 },
            { label: '24h', val: 24 },
            { label: '7d', val: 168 }
          ].map((opt) => ({
            key: opt.val,
            label: opt.label,
            active: settings.autoDeleteHours === opt.val,
            onSelect: () => { playButtonClickSound(); patch({ autoDeleteHours: opt.val }) }
          }))}
          layout={{ columns: 5, gap: 4, pill: { height: 32, fontSize: 11, fontWeight: 500, padding: 0 } }}
        />
      </div>
    </div>
  )

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

  // Card 1: Edge Placement
  const renderPlacementCard = () => (
    <div className={cardClass('placement-card', 'position-col')}>
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.placement') || 'PLACEMENT'}</div>
        <div className="setting-title" id={titleId('placement')} style={isHorizontal ? { color: 'var(--text-primary)' } : undefined}>{t('position.edgePlacementTitle')}</div>
        <div className="setting-desc">{t('position.edgePlacementDesc')}</div>
      </div>
      <div className="shelf-card-bottom">
        <div className={isHorizontal ? 'placement-3way-wrap shelf-placement-3way' : 'placement-3way-wrap'} role="group" aria-labelledby={titleId('placement')}>
          {([
            { edge: 'left' as const, label: t('position.leftEdge') || 'Left Edge' },
            { edge: 'top' as const, label: t('position.topEdge') || 'Top Edge' },
            { edge: 'right' as const, label: t('position.rightEdge') || 'Right Edge' }
          ]).map(({ edge, label }) => {
            const active = edgeTransition?.active ? edgeTransition.to === edge : settings.stickPosition === edge
            return (
              <button
                key={edge}
                type="button"
                className={`pill ${active ? 'active' : ''} ${edgeTransition?.active && edgeTransition.to === edge ? 'transitioning' : ''}`}
                aria-pressed={active}
                disabled={edgeTransition?.active}
                onClick={() => {
                  void startEdgeTransition(edge)
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  // Card 2: Position Range Slider
  const renderPositionSliderCard = () => {
    const isHorizontalDock = settings.stickPosition === 'top'
    const offsetVal = isHorizontalDock ? (settings.horizontalOffset ?? 0.5) : (settings.verticalOffset ?? 0.5)
    const sliderTitle = isHorizontalDock ? (t('position.horizontalPositionTitle') || 'Horizontal Position') : t('position.verticalPositionTitle')
    const sliderDesc = isHorizontalDock ? (t('position.horizontalPositionDesc') || 'Adjust horizontal alignment along screen edge') : t('position.verticalPositionDesc')

    return (
      <div className="setting-card">
        <div className="shelf-card-top">
          <div className="setting-group-label">{t('groups.alignment') || 'ALIGNMENT'}</div>
          <div className="setting-slider-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <div>
              <div className="setting-title" id={titleId('offset')}>{sliderTitle}</div>
              <div className="setting-desc">{sliderDesc}</div>
            </div>
            <div className="setting-slider-val">
              {`${Math.round(offsetVal * 100)}%`}
            </div>
          </div>
        </div>

        <div className="shelf-card-bottom">
          <div className="setting-slider-wrap">
            <WakeSlider
              ariaLabel={sliderTitle}
              ariaLabelledBy={titleId('offset')}
              min={0}
              max={1}
              step={0.002}
              bars={28}
              height={28}
              restHeight={8}
              gap={3}
              value={offsetVal}
              onStart={() => {
                void window.edge.setInteractive(true)
                setSliderActive(true)
              }}
              onRelease={(val) => {
                setSliderActive(false)
                if (isHorizontalDock) {
                  patch({ horizontalOffset: val })
                } else {
                  handleSliderRelease(val)
                }
              }}
              onChange={(raw) => {
                if (isHorizontalDock) {
                  patch({ horizontalOffset: raw })
                } else {
                  handleSliderInput(raw)
                }
              }}
            />

            <div className="setting-slider-labels">
              {[
                { label: isHorizontalDock ? 'Left' : '0%', val: 0 },
                { label: 'Center', val: 0.5 },
                { label: isHorizontalDock ? 'Right' : '100%', val: 1.0 }
              ].map((pos) => {
                const active = Math.abs(offsetVal - pos.val) < 0.04
                return (
                  <button
                    key={pos.val}
                    type="button"
                    className={`slider-label-btn${active ? ' active' : ''}`}
                    onClick={() => {
                      if (isHorizontalDock) {
                        patch({ horizontalOffset: pos.val })
                      } else {
                        handleSliderRelease(pos.val)
                      }
                    }}
                  >
                    {pos.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Card 3: Target Display
  const renderDisplayCard = () => {
    const currentDisplay = displays.find((disp) => disp.isCurrent)
    const activeDisplayId = currentDisplay
      ? currentDisplay.id
      : (settings.stickDisplayId ?? displays.find((disp) => disp.isPrimary)?.id ?? displays[0]?.id)
    const selectDisplay = (id: DisplayInfo['id']) => {
      playButtonClickSound()
      patch({ stickDisplayId: id })
      useStore.getState().notifyPositionChanged()
    }
    return (
      <div className={cardClass('display-card', 'position-col')}>
        <div className="shelf-card-top">
          <div className="setting-group-label">{t('groups.displayMonitor') || 'DISPLAY MONITOR'}</div>
          <div className="setting-title" id={titleId('display')}>{t('position.displayTitle')}</div>
          <div className="setting-desc">{t('position.displayDesc')}</div>
        </div>
        <div className="shelf-card-bottom">
          {isHorizontal ? (
            displays.length === 0 ? (
              <div className="pill disabled">{t('position.loadingDisplays')}</div>
            ) : (
              displays.map((d) => {
                const isActive = activeDisplayId === d.id
                const displayName = d.isPrimary ? t('position.primaryDisplay') : d.name
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`pill display-pill ${isActive ? 'active' : ''}`}
                    aria-pressed={isActive}
                    style={{ width: '100%', justifyContent: 'space-between', padding: '6px 14px', fontSize: 11.5, height: 32, flexShrink: 0 }}
                    onClick={() => selectDisplay(d.id)}
                  >
                    <span className="pill-name" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginRight: 8 }}>{displayName}</span>
                    <span className="pill-res" style={{ opacity: 0.75, fontSize: 11, flexShrink: 0 }}>{d.resolution}</span>
                  </button>
                )
              })
            )
          ) : (
            <div className="setting-pills" role="group" aria-labelledby={titleId('display')}>
              {displays.length === 0 && <div className="pill disabled">{t('position.loadingDisplays')}</div>}
              {displays.map((d) => {
                const isActive = activeDisplayId === d.id
                const displayName = d.isPrimary ? t('position.primaryDisplay') : d.name
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`pill display-pill ${isActive ? 'active' : ''}`}
                    aria-pressed={isActive}
                    onClick={() => selectDisplay(d.id)}
                  >
                    <div className="pill-name">{displayName}</div>
                    <div className="pill-res">{d.resolution}</div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Card 4: Location Hint
  const renderLocationHintCard = () => (
    <ToggleCard
      id="edgeLocationHint"
      kind="beacon-card"
      col="position-col"
      group={t('groups.locationHint') || 'LOCATION HINT'}
      title={t('position.edgeLocationHintTitle')}
      desc={isHorizontal
        ? (t('groups.edgeHintPulseDesc') || 'Beacon pulse along edge to hint dock position')
        : t('position.edgeLocationHintDesc')}
      checked={settings.showEdgeLocationHint ?? false}
      onChange={(v) => patch({ showEdgeLocationHint: v })}
    />
  )

  const renderMacPositionHintCard = () => (
    <div className={cardClass('position-hint-card', 'position-col')}>
      <div className="shelf-card-top">
        <div className="setting-desc">{t('position.macMoveHint')}</div>
        <div className="setting-desc">{t('position.macResizeHint')}</div>
      </div>
    </div>
  )

  // Card 5: Trigger Alignment
  const renderTriggerAlignmentCard = () => (
    <div className="setting-card">
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.triggerPosition') || 'TRIGGER POSITION'}</div>
        <div className="setting-title" id={titleId('triggerAlignment')}>{t('position.edgeTriggerPositionTitle')}</div>
        <div className="setting-desc">{t('position.edgeTriggerPositionDesc')}</div>
      </div>
      <div className="shelf-card-bottom">
        <Pills
          labelId={titleId('triggerAlignment')}
          options={[
            { label: isHorizontalEdge(settings.stickPosition) ? (t('position.left') || 'Left') : t('position.top'), val: 'top' as const },
            { label: t('position.center'), val: 'center' as const },
            { label: isHorizontalEdge(settings.stickPosition) ? (t('position.right') || 'Right') : t('position.bottom'), val: 'bottom' as const }
          ].map((opt) => ({
            key: opt.val,
            label: opt.label,
            active: (settings.triggerAlignment || 'center') === opt.val,
            onSelect: () => {
              playButtonClickSound()
              patch({ triggerAlignment: opt.val })
              useStore.getState().notifyPositionChanged()
            }
          }))}
          layout={{ columns: 3, gap: 5, pill: {} }}
        />
      </div>
    </div>
  )

  // Card 6: Hover Area Size
  const renderHoverAreaCard = () => (
    <div className={cardClass('trigger-bar-card', 'position-col')}>
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.hoverZoneLength') || 'HOVER ZONE LENGTH'}</div>
        <div className="setting-title" id={titleId('hoverArea')}>{t('position.hoverAreaSizeTitle')}</div>
        <div className="setting-desc">{t('position.hoverAreaSizeDesc')}</div>
      </div>
      <div className="shelf-card-bottom">
        <Pills
          labelId={titleId('hoverArea')}
          options={[
            { label: t('appearance.small'), val: 0.25 },
            { label: t('position.medium'), val: 0.4 },
            { label: t('appearance.large'), val: 0.6 }
          ].map((opt) => ({
            key: opt.val,
            label: opt.label,
            active: Math.abs(settings.hotZoneHeight - opt.val) < 0.08,
            onSelect: () => {
              playButtonClickSound()
              patch({ hotZoneHeight: opt.val })
            }
          }))}
          layout={{ columns: 3, gap: 5, fullWidth: true, pill: { height: 32, fontSize: 11.5, fontWeight: 500, padding: 0 } }}
        />
      </div>
    </div>
  )

  // Card 7: Edge Trigger Thickness
  const renderThicknessCard = () => (
    <div className={cardClass('trigger-thickness-card', 'position-col')}>
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.triggerThickness') || 'TRIGGER THICKNESS'}</div>
        <div className="setting-slider-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div>
            <div className="setting-title" id={titleId('thickness')}>{t('position.edgeTriggerThicknessTitle')}</div>
            <div className="setting-desc">{t('position.edgeTriggerThicknessDesc')}</div>
          </div>
          <div
            className="setting-slider-val"
            style={isHorizontal ? { flexShrink: 0, padding: '2px 8px', fontSize: 11, fontWeight: 600, borderRadius: 6 } : undefined}
          >
            {`${settings.hotZoneWidth ?? 3}px`}
          </div>
        </div>
      </div>
      <div className="shelf-card-bottom">
        <div className="setting-slider-wrap" style={isHorizontal ? { gap: 4, padding: '2px 0' } : undefined}>
          <WakeSlider
            ariaLabel={t('position.edgeTriggerThicknessTitle')}
            ariaLabelledBy={titleId('thickness')}
            min={1}
            max={7}
            step={1}
            bars={28}
            height={28}
            restHeight={8}
            gap={3}
            value={settings.hotZoneWidth ?? 3}
            onStart={() => {
              void window.edge.setInteractive(true)
              setSliderActive(true)
            }}
            onRelease={(val) => {
              handleThicknessRelease(val)
            }}
            onChange={(val) => {
              handleThicknessInput(val)
            }}
          />
          <div className="setting-slider-labels" style={isHorizontal ? { marginTop: 2 } : undefined}>
            {[
              { label: 'Min', val: 1 },
              { label: 'Mid', val: 4 },
              { label: 'Max', val: 7 }
            ].map((preset) => {
              const currentPx = settings.hotZoneWidth ?? 3
              const active = currentPx === preset.val
              return (
                <button
                  key={preset.val}
                  type="button"
                  className={`slider-label-btn${active ? ' active' : ''}`}
                  style={isHorizontal ? { fontSize: 10, padding: '2px 8px' } : undefined}
                  onClick={() => {
                    if (currentPx !== preset.val) {
                      handleThicknessRelease(preset.val)
                    }
                  }}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )

  // Card 8: Panel Height
  const renderPanelHeightCard = () => (
    <div className="setting-card">
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.panelHeight') || 'PANEL HEIGHT'}</div>
        <div className="setting-title" id={titleId('panelHeight')}>{t('position.panelHeightTitle')}</div>
        <div className="setting-desc">{t('position.panelHeightDesc')}</div>
      </div>
      <div className="shelf-card-bottom">
        <Pills
          labelId={titleId('panelHeight')}
          options={[
            { label: t('appearance.small'), val: 0.5 },
            { label: t('position.medium'), val: 0.65 },
            { label: t('appearance.large'), val: 0.8 }
          ].map((opt) => ({
            key: opt.val,
            label: opt.label,
            active: Math.abs((settings.panelHeight || 0.6) - opt.val) < 0.08,
            onSelect: () => {
              playButtonClickSound()
              patch({ panelHeight: opt.val })
            }
          }))}
          layout={{ columns: 3, gap: 5, pill: {} }}
        />
      </div>
    </div>
  )

  const renderPanelWidthCard = () => {
    const width = resolvePanelWidth(settings)
    return (
      <div className="setting-card">
        <div className="shelf-card-top">
          <div className="setting-slider-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <div>
              <div className="setting-title" id={titleId('panelWidth')}>{t('behaviour.panelWidthTitle')}</div>
              <div className="setting-desc">{t('behaviour.panelWidthDesc')}</div>
            </div>
            <div className="setting-slider-val">
              {`${width}px`}
            </div>
          </div>
        </div>
        <div className="shelf-card-bottom">
          <div className="setting-slider-wrap">
            <WakeSlider
              ariaLabel={t('behaviour.panelWidthTitle')}
              ariaLabelledBy={titleId('panelWidth')}
              min={PANEL_WIDTH_MIN}
              max={PANEL_WIDTH_MAX}
              step={PANEL_WIDTH_STEP}
              bars={28}
              height={28}
              restHeight={8}
              gap={3}
              value={width}
              onStart={() => {
                void window.edge.setInteractive(true)
                setSliderActive(true)
              }}
              onRelease={(val) => {
                handlePanelWidthRelease(val)
              }}
              onChange={(val) => {
                handlePanelWidthInput(val)
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  // Card 1: Copy Indicator Toggle
  const renderCopyIndicatorCard = () => (
    <ToggleCard
      id="copyIndicator"
      kind="beacon-toggle-card"
      col="appearance-col"
      group={t('groups.copyBeacon') || 'COPY BEACON'}
      title={t('appearance.copyIndicatorTitle')}
      desc={t('appearance.copyIndicatorDesc')}
      checked={settings.showCopyIndicator ?? true}
      onChange={(v) => patch({ showCopyIndicator: v })}
    />
  )

  const renderInlineIndicatorOption = (
    style: NonNullable<SettingsShape['copyIndicatorStyle']>,
    active: boolean,
    icon: ReactNode,
    label: string
  ) => (
    <div
      onClick={() => {
        playButtonClickSound()
        patch({ copyIndicatorStyle: style })
      }}
      style={{
        background: active ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)',
        border: active ? '1px solid rgba(255, 255, 255, 0.3)' : '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 10,
        padding: '12px 8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        gap: 8,
        transition: 'all 0.2s ease'
      }}
    >
      <div style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#ffffff' }}>{label}</div>
    </div>
  )

  // Card 2: Visual Copy Beacon Style
  const renderIndicatorStyleCard = () => (
    <div className={cardClass('copy-card', 'appearance-col')}>
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.beaconStyle') || 'BEACON STYLE'}</div>
      </div>
      <div className="shelf-card-inline">
        <div className="shelf-card-inline-text">
          <div className="setting-title">{t('appearance.indicatorStyleTitle')}</div>
          <div className="setting-desc">{t('appearance.indicatorStyleDesc')}</div>
        </div>
        <div className="shelf-card-inline-action">
          <button
            ref={indicatorBtnRef}
            type="button"
            className={`icon-btn style-preview-toggle-btn ${isFlyoutActive ? 'active' : ''}`}
            title={isFlyoutActive ? t('appearance.closeStyleSelector') : t('appearance.openStyleSelector')}
            aria-expanded={isFlyoutActive}
            onClick={(e) => {
              playButtonClickSound()
              handleToggleFlyout(e.currentTarget)
            }}
          >
            {isFlyoutActive ? <CloseIcon /> : <ChevronRightIcon />}
          </button>
        </div>
      </div>

      {!isHorizontal && isTutorial && localInlineOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          style={{ overflow: 'hidden', marginTop: 12, marginBottom: 8 }}
        >
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 10,
            padding: 12,
            background: '#09090b',
            borderRadius: 12,
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            {/* Logo Card */}
            {renderInlineIndicatorOption('logo', (settings.copyIndicatorStyle || 'logo') === 'logo', <LogoIndicatorIcon fillColor="#ffffff" size={30} />, t('appearance.logoStyle'))}

            {/* Tick Card */}
            {renderInlineIndicatorOption('check', settings.copyIndicatorStyle === 'check', <TickIndicatorIcon fillColor="#ffffff" size={30} />, t('appearance.tickStyle'))}

            {/* Copy Card */}
            {renderInlineIndicatorOption('copy', settings.copyIndicatorStyle === 'copy', <CopyIndicatorIcon fillColor="#ffffff" size={30} />, t('appearance.copyStyle'))}

            {/* Sparkle Card */}
            {renderInlineIndicatorOption('sparkle', settings.copyIndicatorStyle === 'sparkle', <SparkleIndicatorIcon fillColor="#ffffff" size={30} />, t('appearance.sparkleStyle'))}
          </div>
        </motion.div>
      )}
    </div>
  )

  // Card 3: Text Size
  const renderTextSizeCard = () => (
    <div className="setting-card">
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.textSize') || 'TEXT SIZE'}</div>
        <div className="setting-title" id={titleId('textSize')}>{t('appearance.textSizeTitle')}</div>
        <div className="setting-desc">{t('appearance.textSizeDesc')}</div>
      </div>
      <div className="shelf-card-bottom">
        <Pills
          labelId={titleId('textSize')}
          options={[
            { label: t('appearance.small'), val: 0.85 },
            { label: t('appearance.normal'), val: 1.0 },
            { label: t('appearance.large'), val: 1.15 }
          ].map((opt) => ({
            key: opt.val,
            label: opt.label,
            active: Math.abs((settings.fontSizeScale ?? 1.0) - opt.val) < 0.05,
            onSelect: () => {
              playButtonClickSound()
              patch({ fontSizeScale: opt.val })
            }
          }))}
          layout={{ columns: 3, gap: 5, pill: {} }}
        />
      </div>
    </div>
  )

  // Card 4: Audio & Feedback
  const renderSoundCard = () => (
    <ToggleCard
      id="soundEffects"
      kind="audio-card"
      col="appearance-col"
      group={t('groups.audioFeedback') || 'AUDIO FEEDBACK'}
      title={t('behaviour.soundEffectsTitle')}
      desc={t('behaviour.soundEffectsDesc')}
      checked={settings.soundEffects ?? true}
      onChange={(v) => {
        if (v) playToggleSound(true)
        patch({ soundEffects: v })
      }}
    />
  )

  const renderReduceMotionCard = () => (
    <ToggleCard
      id="reduceMotion"
      kind="motion-card"
      col="appearance-col"
      group={t('onboarding.accessibilityTitle')}
      title={t('behaviour.reduceMotionTitle')}
      desc={IS_DARWIN ? (
        <>
          {t('behaviour.reduceMotionDesc')}
          <span className="setting-desc-note">{t('behaviour.reduceMotionSystemNote')}</span>
        </>
      ) : (
        t('behaviour.reduceMotionDesc')
      )}
      checked={!!settings.reduceMotion}
      onChange={(v) => patch({ reduceMotion: v })}
    />
  )

  const renderBehaviourCards = () => (
    <>
      {/* ── SUB-GROUP 1: General & Startup ───────────────── */}
      <Divider label={t('tabs.generalStartup') || 'GENERAL & STARTUP'} />
      {renderLanguageCard()}
      {renderLaunchAtLoginCard()}
      {IS_DARWIN && <AccessibilityCard {...accessibility} />}
      {renderIncognitoCard()}
      {IS_DARWIN && <CaptureScreenshotsCard />}
      {IS_DARWIN && <HideFromCaptureCard />}
      {IS_DARWIN && <IgnoreRemoteCard />}
      {IS_DARWIN && <IgnoredAppsCard {...ignoredApps} />}

      {/* ── SUB-GROUP 2: Shortcuts & Hover ──────────────── */}
      <Divider label={t('tabs.activationShortcuts') || 'SHORTCUTS & HOVER'} />
      {renderHoverActivationCard()}
      <ToggleHotkeyCard />
      {IS_DARWIN && <PasteQueueHotkeyCard />}
      {renderFullscreenCard()}

      {/* ── SUB-GROUP 3: Clipboard Rules ─────────────────── */}
      <Divider label={t('tabs.clipboardRules') || 'CLIPBOARD RULES'} />
      {renderMovePastedCard()}
      {renderClearUnpinnedCard()}
      {IS_DARWIN && <PastePlainCard />}
      {IS_DARWIN && <RecognizeTextCard />}

      {/* ── SUB-GROUP 4: Storage & Retention ─────────────── */}
      <Divider label={t('tabs.storageRetention') || 'STORAGE & RETENTION'} />
      {renderCapacityCard()}
      {renderAutoDeleteCard()}
      {IS_DARWIN && <BackupCard />}
    </>
  )

  const renderMotionCards = () => (
    <>
      <Divider label={t('onboarding.accessibilityTitle')} />
      {renderReduceMotionCard()}
    </>
  )

  // ── Horizontal Layout (Top / Bottom Dock Position) ────────────────────────
  if (isHorizontal) {
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


  const maxTabLen = Math.max(...TABS.map((tab) => tab.label.length))
  const tabFontSize = maxTabLen > 15 ? '9px' : maxTabLen > 13 ? '9.5px' : maxTabLen > 11 ? '10px' : maxTabLen > 9 ? '10.8px' : '11.5px'
  const tabLetterSpacing = maxTabLen > 13 ? '-0.03em' : maxTabLen > 10 ? '-0.015em' : '0'

  return (
    <div
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
    >
      {/* ── Stationary Fixed Header (Tab Selector) ────────────────── */}
          <div className="settings-fixed-header">
            <div className="settings-tab-bar">
              {TABS.map((tab) => {
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`settings-tab-btn${active ? ' active' : ''}`}
                    onClick={() => handleTabSwitch(tab.id)}
                    style={{
                      fontSize: `calc(${tabFontSize} * var(--font-scale, 1))`,
                      letterSpacing: tabLetterSpacing
                    }}
                  >
                    <span className="settings-tab-text">{tab.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Scrollable Content Area (Independent per section) ───────── */}
          <div className="settings-scroll-list" ref={scrollListRef}>

            {/* ── Tab 1: Behaviour (First) ──────────────────────────────── */}
            <AnimatePresence mode="wait" initial={!IS_DARWIN}>
              {activeTab === 'behaviour' && (
                <motion.div
                  key="tab-behaviour"
                  initial={{ opacity: 0, scale: 0.98, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: -4 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  {renderPromotedUpdateCard()}
                  {renderBehaviourCards()}

                  {/* ── UPDATES SECTION (Consolidated above Community & Support) ── */}
                  {!isStoreBuild && (
                    <>
                      <Divider label={t('tabs.updates') || 'UPDATES'} />
                      {renderUpdateModeCard()}
                      {renderManualUpdateCard(true)}
                    </>
                  )}

                  {PersistentFooter}
                </motion.div>
              )}

              {/* ── Tab 2: Position (Second) ─────────────────────────────── */}
              {activeTab === 'position' && (
                <motion.div
                  key="tab-position"
                  initial={{ opacity: 0, scale: 0.98, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: -4 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  {/* ── GROUP: Position ──────────────────────────────────── */}
                  <Divider label={t('tabs.position') || 'POSITION'} />
                  {IS_DARWIN ? renderMacPositionHintCard() : (
                    <>
                      {renderPlacementCard()}
                      {renderPositionSliderCard()}
                      {renderDisplayCard()}
                    </>
                  )}

                  {/* ── GROUP: Trigger Zone ──────────────────────────────── */}
                  <Divider label={t('position.triggerZone') || 'TRIGGER ZONE'} />
                  {renderLocationHintCard()}
                  {renderTriggerAlignmentCard()}
                  {renderHoverAreaCard()}
                  {renderThicknessCard()}
                  {renderPanelHeightCard()}
                  {!IS_DARWIN && settings.stickPosition !== 'top' && renderPanelWidthCard()}

                  {PersistentFooter}
                </motion.div>
              )}

              {/* ── Tab 3: Appearance (Third) ────────────────────────────── */}
              {activeTab === 'appearance' && (
                <motion.div
                  key="tab-appearance"
                  initial={{ opacity: 0, scale: 0.98, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: -4 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  {IS_DARWIN && <ThemeCards />}

                  {/* ── GROUP: Copy Indicator ────────────────────────────── */}
                  <Divider label={t('appearance.copyIndicatorTitle') || 'COPY INDICATOR'} />
                  {renderCopyIndicatorCard()}
                  {(settings.showCopyIndicator ?? true) && renderIndicatorStyleCard()}

                  {/* ── GROUP: Typography ────────────────────────────────── */}
                  <Divider label={t('appearance.typography') || 'TYPOGRAPHY'} />
                  {renderTextSizeCard()}

                  {/* ── GROUP: Audio & Feedback ──────────────────────────── */}
                  <Divider label={t('appearance.audioAndFeedback') || 'AUDIO FEEDBACK'} />
                  {renderSoundCard()}
                  {renderMotionCards()}

                  {PersistentFooter}
                </motion.div>
              )}
            </AnimatePresence>

          </div>
        </div>
      )
    }
