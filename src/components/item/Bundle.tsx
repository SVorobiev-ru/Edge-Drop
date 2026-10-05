import { type ReactNode } from 'react'
import { motion } from 'framer-motion'
import type { ClipboardItemDto } from '../../../shared/types'
import { MAX_STACK } from '../../../shared/types'
import type { DragRequest } from '../../../shared/types'
import { useStore } from '../../store/appStore'
import { formatBytes, formatImageDisplayName } from '../../lib/format'
import { getFileKind } from '../../lib/fileType'
import { CopyIcon, FileKindIcon, FileStackPhoto, PinIcon, PinFillIcon, TrashIcon, MinusIcon, ChevronUpIcon, ChevronLeftIcon } from '../icons'
import { tryPaste } from '../../lib/tryPaste'
import { useTranslation, t } from '../../i18n'
import { fileStreamUrl, openItemMenu, releaseFocus } from './itemActions'

const expandEase = [0.16, 1, 0.3, 1] as const
const collapseEase = [0.4, 0, 0.2, 1] as const

const stackSlotVariants = {
  open: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.28, ease: expandEase }
  },
  closed: {
    opacity: 0,
    y: -10,
    scale: 0.92,
    transition: { duration: 0.18, ease: collapseEase }
  }
}

const listSlotVariants = {
  open: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.24,
      ease: expandEase,
      staggerChildren: 0.032,
      delayChildren: 0.05
    }
  },
  closed: {
    opacity: 0,
    y: 8,
    transition: { duration: 0.15, ease: collapseEase }
  }
}

const rowVariants = {
  open: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: expandEase }
  },
  closed: {
    opacity: 0,
    y: 8,
    transition: { duration: 0.12, ease: collapseEase }
  }
}

function BundleExpandShell({
  expanded,
  stack,
  list
}: {
  expanded: boolean
  stack: ReactNode
  list: ReactNode
}) {
  return (
    <div className={`fluid-bundle${expanded ? ' is-expanded' : ''}`}>
      <div className="bundle-slot bundle-slot-stack" aria-hidden={expanded}>
        <motion.div
          className="bundle-slot-inner"
          initial={false}
          animate={expanded ? 'closed' : 'open'}
          variants={stackSlotVariants}
          style={{ originY: 0.5 }}
        >
          {stack}
        </motion.div>
      </div>
      <div className="bundle-slot bundle-slot-list" aria-hidden={!expanded}>
        <motion.div
          className="bundle-slot-inner fluid-list"
          initial={false}
          animate={expanded ? 'open' : 'closed'}
          variants={listSlotVariants}
        >
          {list}
        </motion.div>
      </div>
    </div>
  )
}

function BundleToolbar({
  count,
  showCapacity,
  showPin,
  pinned,
  onCollapse,
  onCopy,
  onRemove,
  onTogglePin
}: {
  count?: number
  showCapacity?: boolean
  showPin?: boolean
  pinned?: boolean
  onCollapse: (e?: React.MouseEvent) => void
  onCopy: (e: React.MouseEvent) => void
  onRemove: () => void
  onTogglePin?: () => void
}) {
  return (
    // The ENTIRE toolbar bar is a collapse target — a huge, always-visible
    // hit area where the user's eyes already are. The pills stopPropagation,
    // so Copy/Pin/Delete still do their own jobs without collapsing.
    <div
      className="bundle-actions"
      title={t('item.collapsePinned')}
      onClick={(e) => {
        e.stopPropagation()
        onCollapse(e)
      }}
    >
      <button
        type="button"
        className="bundle-collapse-hit"
        title={t('item.collapsePinned')}
        aria-label={t('item.collapsePinned')}
        onClick={(e) => {
          e.stopPropagation()
          releaseFocus(e)
          onCollapse(e)
        }}
      >
        <ChevronUpIcon />
      </button>
      {showCapacity && count != null && (
        <div className="bundle-capacity">
          {count} / {MAX_STACK}
        </div>
      )}
      <div className="actions-pill">
        {showPin && onTogglePin && (
          <button
            className={`act${pinned ? ' active' : ''}`}
            title={pinned ? t('item.unpin') : t('item.pin')}
            aria-label={pinned ? t('item.unpin') : t('item.pin')}
            onClick={(e) => {
              e.stopPropagation()
              releaseFocus(e)
              onTogglePin()
            }}
          >
            {pinned ? <PinFillIcon /> : <PinIcon />}
          </button>
        )}
        {/* blur() on every pill: without it the button keeps focus and the
            card's :focus-within rule latches the action bar open after the
            cursor leaves. */}
        <button
          className="act"
          title={t('item.copy')}
          aria-label={t('item.copy')}
          onClick={(e) => { e.stopPropagation(); releaseFocus(e); onCopy(e) }}
        >
          <CopyIcon />
        </button>
        <button
          className="act danger"
          title={t('item.delete')}
          aria-label={t('item.delete')}
          onClick={(e) => { e.stopPropagation(); releaseFocus(e); onRemove() }}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  )
}

function HorizontalBundleExpanded({
  item,
  onCollapse,
  onCopy,
  onRemove,
  onDragStart
}: {
  item: ClipboardItemDto
  onCollapse: (e?: React.MouseEvent) => void
  onCopy: (e: React.MouseEvent) => void
  onRemove: () => void
  onDragStart: (e: React.DragEvent, req: DragRequest) => void
}) {
  const { t } = useTranslation()
  const isImageCollection = item.data.kind === 'image-collection'
  const isFiles = item.data.kind === 'files'
  const images = item.data.kind === 'image-collection' ? item.data.images : []
  const paths = item.data.kind === 'files' ? item.data.paths : []
  const entries = item.data.kind === 'files' ? item.data.entries : undefined

  return (
    <div className="horizontal-bundle-expanded">
      {/* Top Header Toolbar */}
      <div
        className="horizontal-bundle-header"
        title={t('item.collapsePinned')}
        onClick={(e) => {
          e.stopPropagation()
          onCollapse(e)
        }}
      >
        <button
          type="button"
          className="bundle-collapse-hit"
          title={t('item.collapsePinned')}
          aria-label={t('item.collapsePinned')}
          onClick={(e) => {
            e.stopPropagation()
            releaseFocus(e)
            onCollapse(e)
          }}
        >
          <ChevronLeftIcon />
        </button>
        <div className="actions-pill" onClick={(e) => e.stopPropagation()}>
          <button
            className="act"
            title={t('item.copy')}
            aria-label={t('item.copy')}
            onClick={(e) => { e.stopPropagation(); releaseFocus(e); onCopy(e) }}
          >
            <CopyIcon />
          </button>
          <button
            className="act danger"
            title={t('item.delete')}
            aria-label={t('item.delete')}
            onClick={(e) => { e.stopPropagation(); releaseFocus(e); onRemove() }}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Horizontal Sub-Item Track */}
      <div className="horizontal-subitem-track" onClick={(e) => e.stopPropagation()}>
        {isImageCollection && images.map((img) => (
          <motion.div
            key={img.imageId}
            className="horizontal-subitem-tile"
            variants={rowVariants}
            draggable
            onMouseEnter={() => window.edge.prestageDrag({ id: item.id, imageId: img.imageId })}
            onPointerDown={() => window.edge.prestageDrag({ id: item.id, imageId: img.imageId })}
            onDragStartCapture={(e: any) => { e.stopPropagation(); onDragStart(e, { id: item.id, imageId: img.imageId }) }}
            onClick={(e) => { e.stopPropagation(); tryPaste(() => window.edge.pasteSubitem({ id: item.id, imageId: img.imageId })) }}
            onContextMenu={(e) => openItemMenu(e, item.id, { id: item.id, imageId: img.imageId })}
          >
            <div className="horizontal-subitem-actions">
              <button
                className="act subitem-copy-btn"
                title={t('item.copy')}
                aria-label={t('item.copy')}
                onClick={(e) => {
                  e.stopPropagation()
                  releaseFocus(e)
                  useStore.getState().copySubitem({ id: item.id, imageId: img.imageId })
                }}
              >
                <CopyIcon width={11} height={11} />
              </button>
              <button
                className="act subitem-delete-btn"
                title={t('item.ungroup')}
                aria-label={t('item.ungroup')}
                onClick={(e) => {
                  e.stopPropagation()
                  releaseFocus(e)
                  window.edge.splitItem({ id: item.id, imageId: img.imageId, splitPlacement: 'after' })
                }}
              >
                <MinusIcon width={11} height={11} />
              </button>
            </div>
            <div className="horizontal-subitem-icon-wrap">
              <img
                src={img.preview}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                className="horizontal-subitem-img"
              />
            </div>
            <div className="horizontal-subitem-meta">
              <span className="horizontal-subitem-name">{img.width}×{img.height}</span>
              <span className="horizontal-subitem-sub">{formatBytes(img.fileBytes || img.bytes)}</span>
            </div>
          </motion.div>
        ))}

        {isFiles && paths.map((filePath, index) => {
          const entry = entries?.[index]
          const name = formatImageDisplayName(entry?.name ?? filePath, item.capturedAt)
          const size = entry?.size ?? 0
          const isImg = entry?.isImage && entry.preview

          return (
            <motion.div
              key={`${item.id}-${filePath}-${index}`}
              className="horizontal-subitem-tile"
              variants={rowVariants}
              draggable
              onMouseEnter={() => window.edge.prestageDrag({ id: item.id, paths: [filePath] })}
              onPointerDown={() => window.edge.prestageDrag({ id: item.id, paths: [filePath] })}
              onDragStartCapture={(e: any) => { e.stopPropagation(); onDragStart(e, { id: item.id, paths: [filePath] }) }}
              onClick={(e) => { e.stopPropagation(); tryPaste(() => window.edge.pasteSubitem({ id: item.id, paths: [filePath] })) }}
              onContextMenu={(e) => openItemMenu(e, item.id, { id: item.id, paths: [filePath] })}
            >
              <div className="horizontal-subitem-actions">
                <button
                  className="act subitem-copy-btn"
                  title={t('item.copyFilePath')}
                  aria-label={t('item.copyFilePath')}
                  onClick={(e) => {
                    e.stopPropagation()
                    releaseFocus(e)
                    useStore.getState().copySubitem({ id: item.id, paths: [filePath] })
                  }}
                >
                  <CopyIcon width={11} height={11} />
                </button>
                <button
                  className="act subitem-delete-btn"
                  title={t('item.ungroup')}
                  aria-label={t('item.ungroup')}
                  onClick={(e) => {
                    e.stopPropagation()
                    releaseFocus(e)
                    window.edge.splitItem({ id: item.id, paths: [filePath], splitPlacement: 'after' })
                  }}
                >
                  <MinusIcon width={11} height={11} />
                </button>
              </div>
              <div className="horizontal-subitem-icon-wrap">
                {isImg ? (
                  <img
                    src={entry.preview!}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="horizontal-subitem-img"
                  />
                ) : (
                  <FileKindIcon path={filePath} width={40} height={40} isDirectory={entry?.isDirectory} />
                )}
              </div>
              <div className="horizontal-subitem-meta">
                <span className="horizontal-subitem-name" title={name}>{name}</span>
                <span className="horizontal-subitem-sub">{size > 0 ? formatBytes(size) : getFileKind(filePath, entry?.isDirectory).label}</span>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

export function BundleFluidPreview({
  item,
  expanded,
  isHorizontal = false,
  onDragStart,
  onCopy,
  onRemove,
  onCollapse,
}: {
  item: ClipboardItemDto
  expanded: boolean
  isHorizontal?: boolean
  onDragStart: (e: React.DragEvent, req: DragRequest) => void
  onCopy: (e: React.MouseEvent) => void
  onRemove: () => void
  onCollapse: (e?: React.MouseEvent) => void
}) {
  if (isHorizontal && expanded) {
    return (
      <HorizontalBundleExpanded
        item={item}
        onCollapse={onCollapse}
        onCopy={onCopy}
        onRemove={onRemove}
        onDragStart={onDragStart}
      />
    )
  }

  if (item.data.kind === 'image-collection') {
    const more = item.data.images.length - 1
    const photoSize = isHorizontal ? 76 : 124
    return (
      <BundleExpandShell
        expanded={expanded}
        stack={
          <>
            <div className="bundle-stack-large" style={isHorizontal ? { height: 82 } : undefined}>
              {item.data.images.slice(0, 4).map((img, pathIndex) => ({ img, pathIndex })).reverse().map(({ img }, idx, arr) => {
                const realIndex = arr.length - 1 - idx
                const spread = arr.length > 1 ? (isHorizontal ? 12 : 16) : 0
                const rotSpread = arr.length > 1 ? (isHorizontal ? 5 : 7) : 0
                const centerOffset = ((arr.length - 1) * spread) / 2
                const centerRot = ((arr.length - 1) * rotSpread) / 2
                const stackMotion = {
                  x: realIndex * spread - centerOffset,
                  y: 0,
                  rotate: realIndex * rotSpread - centerRot,
                  scale: 1 - realIndex * 0.04
                }
                return (
                  <motion.div
                    key={img.imageId}
                    className="bundle-stack-icon-item"
                    animate={stackMotion}
                    style={{
                      zIndex: 10 - realIndex,
                      width: photoSize,
                      height: photoSize,
                      marginTop: -photoSize / 2,
                      marginLeft: -photoSize / 2
                    }}
                  >
                    <FileStackPhoto src={img.preview} width={photoSize} height={photoSize} />
                  </motion.div>
                )
              })}
            </div>
            {more > 0 && <div className="bundle-more-label">{t('item.moreImages', { count: more })}</div>}
          </>
        }
        list={
          <>
            <BundleToolbar
              showPin
              pinned={item.pinned}
              onCollapse={onCollapse}
              onCopy={onCopy}
              onRemove={onRemove}
              onTogglePin={() => useStore.getState().togglePin(item.id, !item.pinned)}
            />
            {item.data.images.map((img) => (
              <motion.div
                key={img.imageId}
                className="fluid-card-row"
                variants={rowVariants}
                draggable
                onMouseEnter={() => window.edge.prestageDrag({ id: item.id, imageId: img.imageId })}
                onPointerDown={() => window.edge.prestageDrag({ id: item.id, imageId: img.imageId })}
                onDragStartCapture={(e: any) => { e.stopPropagation(); onDragStart(e, { id: item.id, imageId: img.imageId }) }}
                onClick={(e) => { e.stopPropagation(); tryPaste(() => window.edge.pasteSubitem({ id: item.id, imageId: img.imageId })) }}
                onContextMenu={(e) => openItemMenu(e, item.id, { id: item.id, imageId: img.imageId })}
              >
                <div className="fluid-row-icon">
                  <img
                    src={img.preview}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="fluid-row-img"
                  />
                </div>
                <div className="fluid-row-content">
                  <div className="fluid-row-name">{t('item.imageItem')} · {img.width} × {img.height}</div>
                  <div className="fluid-row-sub">{formatBytes(img.fileBytes || img.bytes)}</div>
                </div>
                <div className="fluid-row-actions">
                  <button
                    className="act subitem-delete-btn"
                    title={t('item.ungroup')}
                    aria-label={t('item.ungroup')}
                    onClick={(e) => { e.stopPropagation(); releaseFocus(e); window.edge.splitItem({ id: item.id, imageId: img.imageId, splitPlacement: 'after' }); }}
                  >
                    <MinusIcon width={12} height={12} />
                  </button>
                </div>
              </motion.div>
            ))}
          </>
        }
      />
    )
  }

  if (item.data.kind === 'files') {
    const entries = item.data.entries
    const paths = item.data.paths
    const count = paths.length
    const photoSize = isHorizontal ? 76 : 124
    return (
      <BundleExpandShell
        expanded={expanded}
        stack={
          <>
            <div className="bundle-stack-large" style={isHorizontal ? { height: 82 } : undefined}>
              {paths.slice(0, 4).map((filePath, i) => ({ filePath, pathIndex: i })).reverse().map(({ filePath, pathIndex }, idx, arr) => {
                const realIndex = arr.length - 1 - idx
                const entry = entries?.[pathIndex]
                const isImg = !!(entry?.isImage && entry.preview)
                const spread = arr.length > 1 ? (isHorizontal ? 12 : 16) : 0
                const rotSpread = arr.length > 1 ? (isHorizontal ? 5 : 7) : 0
                const centerOffset = ((arr.length - 1) * spread) / 2
                const centerRot = ((arr.length - 1) * rotSpread) / 2
                const stackMotion = {
                  x: realIndex * spread - centerOffset,
                  y: 0,
                  rotate: realIndex * rotSpread - centerRot,
                  scale: 1 - realIndex * 0.04
                }

                return (
                  <motion.div
                    key={`${item.id}-${pathIndex}`}
                    className="bundle-stack-icon-item"
                    animate={stackMotion}
                    style={{
                      zIndex: 10 - realIndex,
                      width: photoSize,
                      height: photoSize,
                      marginTop: -photoSize / 2,
                      marginLeft: -photoSize / 2
                    }}
                  >
                    {isImg ? (
                      <FileStackPhoto
                        src={entry.preview!}
                        width={photoSize}
                        height={photoSize}
                        fallbackSrc={fileStreamUrl(filePath)}
                      />
                    ) : (
                      <FileKindIcon path={filePath} width={photoSize} height={photoSize} isDirectory={entry?.isDirectory} />
                    )}
                  </motion.div>
                )
              })}
            </div>
            {count > 1 ? (
              <div className="bundle-more-label">{t('item.moreFiles', { count: count - 1 })}</div>
            ) : (
              <div className="bundle-more-label">{t('item.singleFile')}</div>
            )}
          </>
        }
        list={
          <>
            <BundleToolbar
              count={count}
              showCapacity
              onCollapse={onCollapse}
              onCopy={onCopy}
              onRemove={onRemove}
            />
            {paths.map((filePath, index) => {
              const entry = entries?.[index]
              const name = formatImageDisplayName(entry?.name ?? filePath, item.capturedAt)
              const size = entry?.size ?? 0
              return (
                <motion.div
                  key={`${item.id}-${filePath}-${index}`}
                  className="fluid-card-row"
                  variants={rowVariants}
                  draggable
                  onMouseEnter={() => window.edge.prestageDrag({ id: item.id, paths: [filePath] })}
                  onPointerDown={() => window.edge.prestageDrag({ id: item.id, paths: [filePath] })}
                  onDragStartCapture={(e: any) => { e.stopPropagation(); onDragStart(e, { id: item.id, paths: [filePath] }) }}
                  onClick={(e) => { e.stopPropagation(); tryPaste(() => window.edge.pasteSubitem({ id: item.id, paths: [filePath] })) }}
                  onContextMenu={(e) => openItemMenu(e, item.id, { id: item.id, paths: [filePath] })}
                >
                  <div className="fluid-row-icon">
                    {entry?.isImage && entry.preview ? (
                      <FileStackPhoto src={entry.preview} width={48} height={48} fallbackSrc={fileStreamUrl(filePath)} />
                    ) : (
                      <FileKindIcon path={filePath} width={44} height={44} isDirectory={entry?.isDirectory} />
                    )}
                  </div>
                  <div className="fluid-row-content">
                    <div className="fluid-row-name" title={name}>{name}</div>
                    <div className="fluid-row-sub">
                      {size > 0 ? formatBytes(size) : getFileKind(filePath, entry?.isDirectory).label}
                    </div>
                  </div>
                  <div className="fluid-row-actions">
                    <button
                      className="act subitem-copy-btn"
                      title={t('item.copyFilePath')}
                      aria-label={t('item.copyFilePath')}
                      onClick={(e) => { e.stopPropagation(); releaseFocus(e); useStore.getState().copySubitem({ id: item.id, paths: [filePath] }); }}
                    >
                      <CopyIcon width={12} height={12} />
                    </button>
                    <button
                      className="act subitem-delete-btn"
                      title={t('item.ungroup')}
                      aria-label={t('item.ungroup')}
                      onClick={(e) => { e.stopPropagation(); releaseFocus(e); window.edge.splitItem({ id: item.id, paths: [filePath], splitPlacement: 'after' }); }}
                    >
                      <MinusIcon width={12} height={12} />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </>
        }
      />
    )
  }
  return null
}
