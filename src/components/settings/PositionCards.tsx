import { useStore } from '../../store/appStore'
import type { DisplayInfo } from '../../../shared/types'
import { WakeSlider } from '../WakeSlider'
import { PANEL_WIDTH_MAX, PANEL_WIDTH_MIN, PANEL_WIDTH_STEP, resolvePanelWidth } from '../../hooks/useEdgeHover'
import { Pills, ToggleCard } from './layout'
import { playButtonClickSound } from '../../lib/soundEffects'
import { isHorizontalEdge } from '../../../shared/panelPlacement'
import type { SettingsState } from './useSettingsState'

export function positionCards(s: SettingsState) {
  const { t, settings, isHorizontal, titleId, cardClass, patch, setSliderActive, edgeTransition, startEdgeTransition, handleSliderInput, handleSliderRelease, handleThicknessInput, handleThicknessRelease, handlePanelWidthInput, handlePanelWidthRelease, displays } = s

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

  return { renderPlacementCard, renderPositionSliderCard, renderDisplayCard, renderLocationHintCard, renderMacPositionHintCard, renderTriggerAlignmentCard, renderHoverAreaCard, renderThicknessCard, renderPanelHeightCard, renderPanelWidthCard }
}
