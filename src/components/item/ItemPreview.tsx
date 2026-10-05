import type { ClipboardItemDto } from '../../../shared/types'
import { basename, previewText, formatImageDisplayName, imageItemDisplayName } from '../../lib/format'
import { getFileKind } from '../../lib/fileType'
import { FileKindIcon } from '../icons'
import { LinkPreviewCard } from '../LinkPreviewCard'
import { parseColor } from '../../lib/colorUtils'
import { t } from '../../i18n'
import { fileStreamUrl } from './itemActions'

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

export function Preview({ item }: { item: ClipboardItemDto }) {
  switch (item.data.kind) {
    case 'text': {
      if (item.data.isUrl) {
        return <LinkPreviewCard url={item.data.text} />
      }
      const colorInfo = parseColor(item.data.text)
      if (colorInfo) {
        return (
          <div className="color-swatch-content">
            <div className="color-swatch-code">{colorInfo.displayText}</div>
          </div>
        )
      }
      return <div className="preview" dir="auto">{previewText(item.data.text)}</div>
    }

    case 'image':
      return (
        <div className="thumb-wrap">
          {item.data.preview ? (
            <img
              className="thumb"
              src={item.data.preview}
              alt={imageItemDisplayName(item.data, item.capturedAt)}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ) : (
            <div className="preview">[{t('item.imageItem')}]</div>
          )}
        </div>
      )

    case 'files': {
      const first = item.data.paths[0]
      const entry = item.data.entries?.[0]
      const rawName = entry?.name ?? basename(first)
      const displayName = formatImageDisplayName(first, item.capturedAt)
      const isInternalHash = /^[a-z0-9]{6,12}-[a-z0-9]{6,12}\.[a-z0-9]+$/i.test(rawName) || first.includes('edge-drop/images') || first.includes('edge-drop\\images') || first.includes('edge-drop/temp') || first.includes('edge-drop\\temp')
      const isImage = !entry?.isDirectory && (entry?.isImage || getFileKind(first).kind === 'image')

      // Single image file — show its thumbnail.
      if (item.data.paths.length === 1 && isImage) {
        return (
          <>
            <div className="thumb-wrap">
              {entry?.preview ? (
                <img
                  className="thumb"
                  src={entry.preview}
                  onError={(e) => {
                    const fallback = fileStreamUrl(first)
                    if (e.currentTarget.src !== fallback) {
                      e.currentTarget.src = fallback
                    }
                  }}
                  alt={displayName}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                />
              ) : (
                <div className="preview">[{t('item.imagePlaceholder')}: {displayName}]</div>
              )}
            </div>
            {!isInternalHash && (
              <div className="preview single" style={{ marginTop: 4 }}>
                {displayName}
              </div>
            )}
          </>
        )
      }
      // Non-image single file — show hero icon on top, and name on the bottom!
      const info = getFileKind(first, entry?.isDirectory)
      return (
        <div className="single-file-preview">
          <div className="single-file-hero" style={{ color: info.color }}>
            <FileKindIcon path={first} isDirectory={entry?.isDirectory} />
          </div>
          <div className="single-file-meta">
            <div className="preview single single-file-name" title={displayName}>
              {displayName}
            </div>
          </div>
        </div>
      )
    }
  }
}
