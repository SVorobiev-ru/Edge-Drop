import { motion } from 'framer-motion'
import { useStore } from '../../store/appStore'
import { LanguageDropdown } from './LanguageDropdown'
import { Divider, Pills, ToggleCard } from './layout'
import { AccessibilityCard } from './AccessibilityCard'
import { IgnoredAppsCard } from './IgnoredAppsCard'
import { PLATFORM_TOGGLE_HOTKEY, PasteQueueHotkeyCard, ToggleHotkeyCard } from './HotkeyCards'
import { BackupCard } from './BackupCard'
import { CaptureScreenshotsCard, HideFromCaptureCard, IgnoreRemoteCard, PastePlainCard, RecognizeTextCard } from './PrivacyCards'
import { playButtonClickSound } from '../../lib/soundEffects'
import { getLangLabel } from '../../i18n/languages'
import { IS_DARWIN } from '../../lib/edge'
import type { SettingsState } from './useSettingsState'

export function behaviourCards(s: SettingsState) {
  const { t, settings, isHorizontal, titleId, cardClass, patch, languageFlyoutOpen, setLanguageFlyoutOpen, selectedLang, accessibility, ignoredApps } = s

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

  return { renderBehaviourCards }
}
