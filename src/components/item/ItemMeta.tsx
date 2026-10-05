import { memo, useState, useEffect, useRef } from 'react'
import type { ClipboardItemDto } from '../../../shared/types'
import { useStore } from '../../store/appStore'
import { formatBytes, relativeTime } from '../../lib/format'
import { getFileKind } from '../../lib/fileType'
import { parseColor } from '../../lib/colorUtils'
import { useTranslation, t } from '../../i18n'
import { useRelativeTimeTick } from '../../hooks/useRelativeTimeTick'
import { useInputEngagement } from '../../hooks/useInputEngagement'
import { IS_DARWIN } from '../../lib/edge'

export const RelativeTime = memo(function RelativeTime({ capturedAt }: { capturedAt: number }) {
  useRelativeTimeTick()
  return <span className="meta-time">{relativeTime(capturedAt)}</span>
})

export const SourceAppLine = memo(function SourceAppLine({ bundleId, name }: { bundleId: string; name?: string }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const icon = useStore((s) => s.appIcons[bundleId])
  useEffect(() => {
    if (!IS_DARWIN || icon !== undefined) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver !== 'function') {
      useStore.getState().requestAppIcon(bundleId)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      useStore.getState().requestAppIcon(bundleId)
    }, { rootMargin: '120px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [bundleId, icon])
  const label = t('item.sourceApp', { app: name || bundleId })
  return (
    <div ref={ref} className="item-source" title={label}>
      {icon ? <img className="item-source-icon" src={icon} alt="" draggable={false} /> : null}
      <span className="item-source-name">{label}</span>
    </div>
  )
})

export function TitleEditor({ item }: { item: ClipboardItemDto }) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(item.title ?? '')
  const doneRef = useRef(false)
  const { engage, disengage } = useInputEngagement(inputRef)

  useEffect(() => {
    engage()
    const raf = window.requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      input.select()
      try { input.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch { /* ignore */ }
    })
    return () => window.cancelAnimationFrame(raf)
  }, [engage])

  const finish = (save: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    disengage()
    const state = useStore.getState()
    if (save && value.trim() !== (item.title ?? '')) void state.renameItem(item.id, value)
    else state.setRenamingId(null)
  }

  return (
    <input
      ref={inputRef}
      className="item-title-input"
      type="text"
      value={value}
      placeholder={t('item.untitled')}
      aria-label={t('menu.rename')}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Kind badge                                                          */
/* ------------------------------------------------------------------ */

export function KindBadge({ item }: { item: ClipboardItemDto }) {
  switch (item.data.kind) {
    case 'text':
      if (item.data.isUrl)
        return <span className="kind-badge url">{t('filters.links').toLowerCase()}</span>
      if (item.data.isColor || parseColor(item.data.text))
        return <span className="kind-badge color">{t('item.colorItem')}</span>
      return <span className="kind-badge">{t('filters.text').toLowerCase()}</span>
    case 'image':
      return (
        <span className="kind-badge">
          {t('item.imageItem').toLowerCase()}
        </span>
      )
    case 'image-collection':
      return (
        <span className="kind-badge">
          {item.data.images.length} {t('filters.images').toLowerCase()}
        </span>
      )
    case 'files': {
      const firstPath = item.data.paths[0]
      const entry = item.data.entries?.[0]
      const info = getFileKind(firstPath, entry?.isDirectory)
      const count = item.data.paths.length
      const isImage = count === 1 && !entry?.isDirectory && (entry?.isImage || info.kind === 'image')
      if (isImage) {
        return (
          <span className="kind-badge">
            {t('item.imageItem').toLowerCase()}
          </span>
        )
      }
      const label = count > 1 ? `${count} ${t('filters.files').toLowerCase()}` : info.label.toLowerCase()
      return (
        <span className="kind-badge" style={{ color: count > 1 ? undefined : info.color }}>
          {label}
        </span>
      )
    }
  }
}

export function ItemDetails({ item }: { item: ClipboardItemDto }) {
  switch (item.data.kind) {
    case 'text': {
      if (item.data.isUrl) {
        let domain = ''
        try {
          const urlStr = item.data.text.startsWith('http://') || item.data.text.startsWith('https://')
            ? item.data.text
            : `https://${item.data.text}`
          domain = new URL(urlStr).hostname.replace(/^www\./, '')
        } catch {}
        if (domain) {
          return <span className="meta-detail">· {domain}</span>
        }
        return null
      }

      const colorInfo = parseColor(item.data.text)
      if (item.data.isColor || colorInfo) {
        return null
      }

      return null
    }

    case 'image': {
      const dims = item.data.width && item.data.height ? `${item.data.width}×${item.data.height}` : ''
      const size = item.data.fileBytes || item.data.bytes ? formatBytes(item.data.fileBytes || item.data.bytes) : ''
      return (
        <>
          {dims && <span className="meta-detail">· {dims}</span>}
          {size && <span className="meta-detail">· {size}</span>}
        </>
      )
    }

    case 'image-collection': {
      const totalBytes = item.data.images?.reduce((acc, img) => acc + (img.fileBytes || img.bytes || 0), 0) || 0
      return totalBytes > 0 ? <span className="meta-detail">· {formatBytes(totalBytes)}</span> : null
    }

    case 'files': {
      const entries = item.data.entries
      const totalBytes = entries?.reduce((acc, e) => acc + (e.size || 0), 0) || 0
      return totalBytes > 0 ? <span className="meta-detail">· {formatBytes(totalBytes)}</span> : null
    }

    default:
      return null
  }
}
