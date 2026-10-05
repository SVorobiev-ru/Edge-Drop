import { useStore } from '../../store/appStore'
import { playButtonClickSound } from '../../lib/soundEffects'
import { useTranslation } from '../../i18n'
import { useSettingsLayout } from './layout'

export function BackupCard() {
  const { t } = useTranslation()
  const { titleId, cardClass } = useSettingsLayout()
  const pushToast = useStore((s) => s.pushToast)

  const handleExportPinned = () => {
    playButtonClickSound()
    Promise.resolve()
      .then(() => window.edge.exportHistory())
      .catch(() => {})
  }

  const handleImportPinned = () => {
    playButtonClickSound()
    Promise.resolve()
      .then(() => window.edge.importHistory())
      .catch(() => {
        pushToast({ id: Date.now().toString(), message: t('toast.importFailed'), tone: 'error' })
      })
  }

  return (
    <div className={cardClass('backup-card', 'behaviour-col')}>
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('item.pinned')}</div>
        <div className="setting-title" id={titleId('backup')}>{t('behaviour.backupTitle')}</div>
        <div className="setting-desc">{t('behaviour.backupDesc')}</div>
      </div>
      <div className="shelf-card-bottom">
        <div
          className="setting-pills"
          role="group"
          aria-labelledby={titleId('backup')}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 5, width: '100%' }}
        >
          <button type="button" className="pill" onClick={handleExportPinned}>
            {t('behaviour.exportPinned')}
          </button>
          <button type="button" className="pill" onClick={handleImportPinned}>
            {t('behaviour.importPinned')}
          </button>
        </div>
      </div>
    </div>
  )
}
