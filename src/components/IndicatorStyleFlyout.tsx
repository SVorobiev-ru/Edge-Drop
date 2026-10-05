/**
 * IndicatorStyleFlyout — Side Flyout Preview Panel for Copy Indicator Styles.
 *
 * Compact 2-column grid flyout layout for style selection:
 *   - Logo, Tick, Copy preview cards
 *   - No heavy text descriptions
 *   - Clean spring exit/entry matching PreviewFlyout
 */
import { useStore } from '../store/appStore'
import {
  LogoIndicatorIcon,
  TickIndicatorIcon,
  CopyIndicatorIcon,
  SparkleIndicatorIcon
} from './CopyIndicatorCurve'
import { CloseIcon } from './icons'
import { playButtonClickSound } from '../lib/soundEffects'
import { useTranslation } from '../i18n'
import { isHorizontalEdge } from '../../shared/panelPlacement'
import { SideFlyoutShell, flyoutVariants, type SideFlyoutMotion } from './SideFlyoutShell'

function indicatorStyleFlyoutMotion(reduceMotion: boolean): SideFlyoutMotion {
  return {
    variants: flyoutVariants,
    initial: reduceMotion ? 'reducedHidden' : 'hidden',
    animate: reduceMotion ? 'reducedShown' : 'shown',
    exit: reduceMotion ? 'reducedHidden' : 'exit',
    transition: reduceMotion ? { duration: 0.12, ease: 'linear' } : undefined
  }
}

function dismissIndicatorStyleFlyout(): void {
  useStore.getState().setStyleFlyoutOpen(false)
}

function restorePreviewModeAfterExit(): void {
  const s = useStore.getState()
  const isHoriz = isHorizontalEdge(s.settings.stickPosition)
  if (!isHoriz && !s.styleFlyoutOpen && !s.previewItemId) {
    window.edge.setPreviewMode(false)
  }
}

export function IndicatorStyleFlyout({ isRight }: { isRight: boolean }) {
  const { t } = useTranslation()
  const styleFlyoutOpen = useStore((s) => s.styleFlyoutOpen)
  const setStyleFlyoutOpen = useStore((s) => s.setStyleFlyoutOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const open = useStore((s) => s.open)
  const settings = useStore((s) => s.settings)
  const patch = useStore((s) => s.patchSettings)

  const isVisible = styleFlyoutOpen && settingsOpen && open

  const styleFlyoutAnchorRect = useStore((s) => s.styleFlyoutAnchorRect)

  return (
    <SideFlyoutShell
      isRight={isRight}
      visible={isVisible}
      motionKey="indicator-style-flyout"
      motionProps={indicatorStyleFlyoutMotion}
      horizontalWidth={320}
      horizontalStyle={{ display: 'flex', flexDirection: 'column', zIndex: 10 }}
      anchorRect={styleFlyoutAnchorRect}
      insideSelector="[data-preview-flyout], .preview-flyout, .style-preview-toggle-btn"
      onDismiss={dismissIndicatorStyleFlyout}
      onExitComplete={restorePreviewModeAfterExit}
      panelProps={{ className: 'preview-flyout', 'data-preview-flyout': 'true' }}
      panelStyle={{
        background: 'var(--bg-2)',
        borderRadius: 20,
        border: 'none',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 'none',
        pointerEvents: 'auto',
        position: 'relative',
        padding: 12
      }}
    >
      {() => (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                {t('flyout.copyBeaconStyleTitle')}
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
                  setStyleFlyoutOpen(false)
                }}
                title={t('header.close')}
              >
                <CloseIcon width={11} height={11} />
              </button>
            </div>

            {/* 2-Column Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, overflowY: 'visible', padding: 1 }}>
              {/* Card 1: Logo */}
              <StyleCard
                active={(settings.copyIndicatorStyle || 'logo') === 'logo'}
                onClick={() => {
                  playButtonClickSound()
                  patch({ copyIndicatorStyle: 'logo' })
                  useStore.getState().triggerCopyFlare()
                }}
                preview={<LogoIndicatorIcon fillColor="#ffffff" size={30} />}
                title={t('appearance.logoStyle')}
              />

              {/* Card 2: Tick */}
              <StyleCard
                active={(settings.copyIndicatorStyle || 'logo') === 'check'}
                onClick={() => {
                  playButtonClickSound()
                  patch({ copyIndicatorStyle: 'check' })
                  useStore.getState().triggerCopyFlare()
                }}
                preview={<TickIndicatorIcon fillColor="#ffffff" size={30} />}
                title={t('appearance.tickStyle')}
              />

              {/* Card 3: Copy */}
              <StyleCard
                active={(settings.copyIndicatorStyle || 'logo') === 'copy'}
                onClick={() => {
                  playButtonClickSound()
                  patch({ copyIndicatorStyle: 'copy' })
                  useStore.getState().triggerCopyFlare()
                }}
                preview={<CopyIndicatorIcon fillColor="#ffffff" size={30} />}
                title={t('appearance.copyStyle')}
              />

              {/* Card 4: Sparkle */}
              <StyleCard
                active={(settings.copyIndicatorStyle || 'logo') === 'sparkle'}
                onClick={() => {
                  playButtonClickSound()
                  patch({ copyIndicatorStyle: 'sparkle' })
                  useStore.getState().triggerCopyFlare()
                }}
                preview={<SparkleIndicatorIcon fillColor="#ffffff" size={30} />}
                title={t('appearance.sparkleStyle')}
              />
            </div>
          </>
      )}
    </SideFlyoutShell>
  )
}

function StyleCard({
  active,
  onClick,
  preview,
  title,
  style
}: {
  active: boolean
  onClick: () => void
  preview: React.ReactNode
  title: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={`indicator-card ${active ? 'active' : ''}`}
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '10px 8px 8px',
        background: 'var(--bg-2)',
        border: active ? '2px solid #ffffff' : '2px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 14,
        position: 'relative',
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        userSelect: 'none',
        overflow: 'hidden',
        outline: 'none',
        boxShadow: active ? '0 4px 16px rgba(0, 0, 0, 0.5), 0 0 14px rgb(var(--ink) / 0.12)' : 'none',
        boxSizing: 'border-box',
        ...style
      }}
    >
      {active && (
        <div className="indicator-card-badge" style={{ top: 5, right: 5 }}>
          ✓
        </div>
      )}
      <div
        className="indicator-card-stage"
        style={{
          width: '100%',
          height: 48,
          background: '#000000',
          borderRadius: 8,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: 'none'
        }}
      >
        {preview}
      </div>
      <div
        style={{
          fontSize: 11.5,
          fontWeight: active ? 600 : 500,
          color: active ? 'var(--text-primary)' : 'rgb(var(--ink) / max(0.7, var(--text-alpha-floor)))',
          textAlign: 'center',
          letterSpacing: '-0.01em'
        }}
      >
        {title}
      </div>
    </div>
  )
}
