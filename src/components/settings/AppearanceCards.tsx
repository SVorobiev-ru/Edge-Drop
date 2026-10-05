import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import type { Settings as SettingsShape } from '../../../shared/types'
import {
  LogoIndicatorIcon,
  TickIndicatorIcon,
  CopyIndicatorIcon,
  SparkleIndicatorIcon
} from '../CopyIndicatorCurve'
import { ChevronRightIcon, CloseIcon } from '../icons'
import { Divider, Pills, ToggleCard } from './layout'
import { playToggleSound, playButtonClickSound } from '../../lib/soundEffects'
import { IS_DARWIN } from '../../lib/edge'
import type { SettingsState } from './useSettingsState'

export function appearanceCards(s: SettingsState) {
  const { t, settings, isHorizontal, titleId, cardClass, patch, localInlineOpen, isTutorial, isFlyoutActive, indicatorBtnRef, handleToggleFlyout } = s

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

  const renderMotionCards = () => (
    <>
      <Divider label={t('onboarding.accessibilityTitle')} />
      {renderReduceMotionCard()}
    </>
  )

  return { renderCopyIndicatorCard, renderIndicatorStyleCard, renderTextSizeCard, renderSoundCard, renderMotionCards }
}
