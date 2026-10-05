import { useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store/appStore'
import { Divider, SettingsLayoutContext, settingsLayout } from './settings/layout'
import { ThemeCards } from './settings/ThemeCards'
import { useSettingsState } from './settings/useSettingsState'
import { settingsFooter } from './settings/SettingsFooter'
import { updateCards } from './settings/UpdateCards'
import { behaviourCards } from './settings/BehaviourCards'
import { positionCards } from './settings/PositionCards'
import { appearanceCards } from './settings/AppearanceCards'
import { renderHorizontalSettings } from './settings/HorizontalSettings'
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
  const state = useSettingsState(inlineIndicatorStyle)
  const { t, settings, isHorizontal, TABS, isStoreBuild, activeTab, scrollListRef, handleTabSwitch } = state
  const { PersistentFooter } = settingsFooter(state)
  const cards = { ...updateCards(state), ...behaviourCards(state), ...positionCards(state), ...appearanceCards(state) }
  const { renderPromotedUpdateCard, renderManualUpdateCard, renderUpdateModeCard, renderBehaviourCards, renderPlacementCard, renderPositionSliderCard, renderDisplayCard, renderLocationHintCard, renderMacPositionHintCard, renderTriggerAlignmentCard, renderHoverAreaCard, renderThicknessCard, renderPanelHeightCard, renderPanelWidthCard, renderCopyIndicatorCard, renderIndicatorStyleCard, renderTextSizeCard, renderSoundCard, renderMotionCards } = cards

  // ── Horizontal Layout (Top / Bottom Dock Position) ────────────────────────
  if (isHorizontal) {
    return renderHorizontalSettings(state, cards)
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
