import { useStore } from '../store/appStore'
import { edge } from '../lib/edge'
import { playButtonClickSound } from '../lib/soundEffects'
import { useTranslation } from '../i18n'
import { CloseIcon } from './icons'

export function QueueChip({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const count = useStore((s) => s.queueIds.length)
  if (count === 0) return null
  const label = t('queue.title', { count })
  return (
    <div className={`queue-chip${compact ? ' compact' : ''}`} role="status" title={label} aria-label={label}>
      <span className="queue-chip-label">{compact ? count : label}</span>
      <button
        type="button"
        className="queue-chip-clear"
        title={t('queue.clear')}
        aria-label={t('queue.clear')}
        onClick={(e) => {
          e.stopPropagation()
          playButtonClickSound()
          try {
            void Promise.resolve(edge.queueClear()).catch(() => {})
          } catch { /* ignore */ }
          useStore.getState().setQueueIds([])
        }}
      >
        <CloseIcon width={10} height={10} />
      </button>
    </div>
  )
}
