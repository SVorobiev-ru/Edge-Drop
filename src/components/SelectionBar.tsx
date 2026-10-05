import { useMemo, type ReactNode } from 'react'
import { useStore } from '../store/appStore'
import { useTranslation } from '../i18n'
import { allStackable, allTextLike, orderSelection } from '../../shared/selection'
import { tryPaste } from '../lib/tryPaste'
import { pastePlainFor } from '../lib/pasteOptions'
import { edge } from '../lib/edge'
import { playButtonClickSound, playDeleteSound, playToggleSound } from '../lib/soundEffects'
import { BundleIcon, ClipboardIcon, CloseIcon, CopyIcon, PinFillIcon, PinIcon, TrashIcon, TypeIcon } from './icons'

interface BarButton {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  onClick: (e: React.MouseEvent) => void
}

export function SelectionBar({ isHorizontal = false }: { isHorizontal?: boolean }) {
  const { t } = useTranslation()
  const ids = useStore((s) => s.selection.ids)
  const items = useStore((s) => s.items)
  const selected = useMemo(() => orderSelection(items, ids), [items, ids])
  const count = ids.length
  if (count === 0) return null

  const state = () => useStore.getState()
  const allPinned = selected.length > 0 && selected.every((it) => it.pinned)
  const iconSize = isHorizontal ? 14 : 13
  const label = t('selection.count', { count })

  const buttons: BarButton[] = [
    {
      key: 'paste',
      label: t('selection.paste'),
      icon: <ClipboardIcon width={iconSize} height={iconSize} />,
      onClick: (e) => {
        const plain = pastePlainFor(state().settings, e.altKey, edge.platform)
        tryPaste(() => { void state().pasteSelection(plain).catch(() => {}) })
      }
    },
    {
      key: 'copy',
      label: t('selection.copy'),
      icon: <CopyIcon width={iconSize} height={iconSize} />,
      onClick: () => {
        playButtonClickSound()
        void state().copySelection().catch(() => {})
      }
    }
  ]
  if (allTextLike(selected)) {
    buttons.push({
      key: 'pastePlain',
      label: t('selection.pastePlain'),
      icon: <TypeIcon width={iconSize} height={iconSize} />,
      onClick: () => {
        tryPaste(() => { void state().pasteSelection(true).catch(() => {}) })
      }
    })
  }
  if (allStackable(selected)) {
    buttons.push({
      key: 'stack',
      label: t('selection.stack'),
      icon: <BundleIcon width={iconSize} height={iconSize} />,
      onClick: () => {
        playButtonClickSound()
        void state().stackSelection().catch(() => {})
      }
    })
  }
  buttons.push(
    {
      key: 'pin',
      label: allPinned ? t('selection.unpin') : t('selection.pin'),
      icon: allPinned ? <PinFillIcon width={iconSize} height={iconSize} /> : <PinIcon width={iconSize} height={iconSize} />,
      onClick: () => {
        playToggleSound(!allPinned)
        void state().pinSelection(!allPinned).catch(() => {})
      }
    },
    {
      key: 'delete',
      label: t('selection.delete'),
      icon: <TrashIcon width={iconSize} height={iconSize} />,
      danger: true,
      onClick: () => {
        playDeleteSound()
        void state().deleteSelection().catch(() => {})
      }
    },
    {
      key: 'clear',
      label: t('selection.clear'),
      icon: <CloseIcon width={iconSize} height={iconSize} />,
      onClick: () => {
        playButtonClickSound()
        state().clearSelection()
      }
    }
  )

  return (
    <div className={`selection-bar${isHorizontal ? ' horizontal' : ''}`} role="toolbar" aria-label={label}>
      <span className="selection-bar-count" title={label}>
        <span className="selection-bar-text">{label}</span>
        <span className="selection-bar-badge" aria-hidden="true">{count}</span>
      </span>
      <div className="selection-bar-actions">
        {buttons.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`selection-bar-btn${b.danger ? ' danger' : ''}`}
            title={b.label}
            aria-label={b.label}
            onClick={(e) => {
              e.stopPropagation()
              b.onClick(e)
            }}
          >
            {b.icon}
          </button>
        ))}
      </div>
    </div>
  )
}
