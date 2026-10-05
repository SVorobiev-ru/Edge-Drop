import { useStore } from '../store/appStore'
import { useTranslation } from '../i18n'
import type { TypeFilter } from '../../shared/types'
import { IS_DARWIN } from '../lib/edge'

const TYPE_KEYS: Record<Exclude<TypeFilter, 'all'>, string> = {
  text: 'Text',
  links: 'Links',
  images: 'Images',
  files: 'Files',
  colors: 'Colors'
}

export function EmptyState({ filtered }: { filtered: boolean }) {
  const { t } = useTranslation()
  const typeFilter = useStore((s) => s.typeFilter)

  let title = filtered ? t('emptyState.noResultsFound') : t('emptyState.shelfEmpty')
  let hint = filtered ? t('emptyState.noResultsHint') : t('emptyState.shelfEmptyHint')

  if (typeFilter !== 'all' && !(IS_DARWIN && filtered)) {
    const kind = TYPE_KEYS[typeFilter]
    title = t(`emptyState.no${kind}Found`)
    hint = t(`emptyState.copy${kind}Hint`)
  }

  return (
    <div className="empty">
      <div className="empty-text">
        <div className="big">{title}</div>
        <div className="hint">{hint}</div>
      </div>
    </div>
  )
}
