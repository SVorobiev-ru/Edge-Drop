import type { ClipboardItemDto } from '../../shared/types'
import { t } from '../i18n'
import { formatImageDisplayName, imageItemDisplayName, previewText } from './format'

export function itemAccessibleLabel(item: ClipboardItemDto): string {
  const data = item.data
  switch (data.kind) {
    case 'text':
      return previewText(data.text, 80)
    case 'image':
      return imageItemDisplayName(data, item.capturedAt)
    case 'image-collection':
      return `${data.images.length} ${t('filters.images').toLowerCase()}`
    case 'files': {
      if (data.paths.length > 1) return `${data.paths.length} ${t('filters.files').toLowerCase()}`
      const first = data.paths[0] ?? ''
      return formatImageDisplayName(data.entries?.[0]?.name ?? first, item.capturedAt)
    }
  }
}
