import { useStore } from '../../store/appStore'
import type { ThemeMode } from '../../../shared/types'
import { playButtonClickSound } from '../../lib/soundEffects'
import { useTranslation } from '../../i18n'
import { Divider, Pills, ToggleCard, useSettingsLayout } from './layout'

function ThemeCard() {
  const { t } = useTranslation()
  const { titleId, cardClass } = useSettingsLayout()
  const theme: ThemeMode = useStore((s) => s.settings.theme) ?? 'dark'
  const patch = useStore((s) => s.patchSettings)
  return (
    <div className={cardClass('theme-card', 'appearance-col')}>
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('tabs.appearance')}</div>
        <div className="setting-title" id={titleId('theme')}>{t('behaviour.themeTitle')}</div>
        <div className="setting-desc">{t('behaviour.themeDesc')}</div>
      </div>
      <div className="shelf-card-bottom">
        <Pills
          labelId={titleId('theme')}
          options={([
            { id: 'system' as ThemeMode, label: t('behaviour.themeSystem') },
            { id: 'dark' as ThemeMode, label: t('behaviour.themeDark') },
            { id: 'light' as ThemeMode, label: t('behaviour.themeLight') }
          ]).map((opt) => ({
            key: opt.id,
            label: opt.label,
            active: theme === opt.id,
            onSelect: () => {
              playButtonClickSound()
              patch({ theme: opt.id })
            }
          }))}
          layout={{ columns: 3, gap: 5, fullWidth: true, pill: { height: 32, fontSize: 11.5, fontWeight: 500, padding: 0 } }}
        />
      </div>
    </div>
  )
}

function VibrancyCard() {
  const { t } = useTranslation()
  const vibrancy = useStore((s) => s.settings.vibrancy)
  const patch = useStore((s) => s.patchSettings)
  return (
    <ToggleCard
      id="vibrancy"
      kind="vibrancy-card"
      col="appearance-col"
      group={t('tabs.appearance')}
      title={t('behaviour.vibrancyTitle')}
      desc={t('behaviour.vibrancyDesc')}
      checked={!!vibrancy}
      onChange={(v) => patch({ vibrancy: v })}
    />
  )
}

export function ThemeCards() {
  const { t } = useTranslation()
  return (
    <>
      <Divider label={t('behaviour.themeTitle')} />
      <ThemeCard />
      <VibrancyCard />
    </>
  )
}
