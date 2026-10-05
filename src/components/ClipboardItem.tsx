/**
 * ClipboardItem — a single history/shelf entry.
 *
 * Interactions:
 *   - Click body            -> paste item (write to clipboard + simulate Ctrl+V)
 *   - Drag the tile         -> native OS drag-out (via useDragOut)
 *   - File bundle: click body -> expand/collapse
 *   - Drag collapsed bundle -> drag all files as one entity
 *   - Drag expanded sub-row -> drag just that one file
 *   - Pin / Delete          -> quick actions on hover
 *   - Copy button (⧉)      -> single-click copy (just clipboard, no Ctrl+V)
 *
 * Visual: a raised dark tile. Image items show a thumbnail; text items show a
 * clamped preview; file items list names or bundle badge. Motion is handled by
 * the parent list (layout/AnimatePresence), so this component stays presentational.
 */
import { memo, useState, useCallback, useEffect, useRef, forwardRef } from 'react'
import { motion } from 'framer-motion'
import type { ClipboardItemDto } from '../../shared/types'
import type { DragRequest } from '../../shared/types'
import { useStore } from '../store/appStore'
import { useDragOut } from '../hooks/useDragOut'
import { itemRenderKey } from '../lib/itemSignature'
import { itemAccessibleLabel } from '../lib/itemLabel'
import { ErrorBoundary, WarningGlyph } from './ErrorBoundary'
import { playButtonClickSound, playToggleSound, playDeleteSound, playCardExpandSound } from '../lib/soundEffects'
import { CheckIcon, CopyIcon, PinIcon, PinFillIcon, TrashIcon, ExpandIcon, ContractIcon, ExternalLinkIcon } from './icons'
import '../styles/item.css'
import { tryPaste } from '../lib/tryPaste'
import { parseColor } from '../lib/colorUtils'
import { useTranslation } from '../i18n'
import { edge, IS_DARWIN } from '../lib/edge'
import { pasteOptionsFor, pastePlainFor } from '../lib/pasteOptions'
import { getNavOrder } from '../lib/keyboardNav'
import { isHorizontalEdge } from '../../shared/panelPlacement'
import { fileStreamUrl, openItemMenu, releaseFocus, startSelectionDrag } from './item/itemActions'
import { RelativeTime, SourceAppLine, TitleEditor, KindBadge, ItemDetails } from './item/ItemMeta'
import { BundleFluidPreview } from './item/Bundle'
import { Preview } from './item/ItemPreview'

export { RelativeTime, fileStreamUrl }

interface Props {
  item: ClipboardItemDto
}

/* ------------------------------------------------------------------ */
/* Main item card                                                      */
/* ------------------------------------------------------------------ */

const ClipboardItemBase = forwardRef<HTMLDivElement, Props>(({ item }, ref) => {
  const { t } = useTranslation()
  const copy = useStore.getState().copy
  const paste = useStore.getState().paste
  const togglePin = useStore.getState().togglePin
  const remove = useStore.getState().remove
  const setInternalDragReq = useStore.getState().setInternalDragReq
  const startDrag = useDragOut()
  const [copied, setCopied] = useState(false)

  const isHorizontal = useStore((s) => isHorizontalEdge(s.settings.stickPosition))
  const colorInfo = item.data.kind === 'text' ? parseColor(item.data.text) : null

  // Accordion expansion: ONE stack open at a time, coordinated store-wide
  // (expanding another stack collapses this one; Escape / outside click /
  // filter or settings switches collapse via the same store field).
  const expanded = useStore((s) => s.expandedStackId === item.id)
  const setExpandedFlag = useCallback((v: boolean) => {
    useStore.getState().setExpandedStackId(v ? item.id : null)
  }, [item.id])

  const isPreviewing = useStore((s) => s.previewItemId === item.id)
  const isActive = useStore((s) => s.activeItemId === item.id)
  const isSelected = useStore((s) => IS_DARWIN && !!s.selectedMap[item.id])
  const multiSelected = useStore((s) => IS_DARWIN && s.selection.ids.length > 1 && !!s.selectedMap[item.id])
  const queueIndex = useStore((s) => s.queueIndex[item.id] ?? -1)
  const renaming = useStore((s) => s.renamingId === item.id)
  const fullTextRef = useRef<string | null>(null)
  const fullTextRequestedRef = useRef(false)
  const isBundle = (item.data.kind === 'files' && item.data.paths.length > 1) || item.data.kind === 'image-collection'

  const bundleCount = item.data.kind === 'image-collection'
    ? item.data.images.length
    : item.data.kind === 'files'
      ? item.data.paths.length
      : 0

  const screenW = typeof window !== 'undefined' ? window.innerWidth : 1140
  const expandedWidth = expanded && isHorizontal
    ? Math.min(screenW - 80, Math.max(300, 36 + bundleCount * 112))
    : undefined

  useEffect(() => {
    if (!isBundle && expanded) setExpandedFlag(false)
  }, [isBundle, expanded, setExpandedFlag])

  // ── Intuitive collapse affordances ──────────────────────────────────────
  // While THIS stack is the open one, a pointerdown anywhere OUTSIDE this
  // card (other cards, empty shelf space) collapses it — standard disclosure
  // behavior. Everything INSIDE this card is exempt, including its empty
  // padding/margins: a partial-boundary exemption caused the infamous
  // collapse→re-expand bounce, because the follow-up click event dispatched
  // against freshly-collapsed state and the body contract re-opened it.
  // The preview flyout is exempt too, so interacting there never surprises.
  useEffect(() => {
    if (!expanded) return

    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Element | null
      if (!target || typeof target.closest !== 'function') return
      if (target.closest('[data-expanded-stack]')) return
      if (target.closest('[data-preview-flyout], .preview-flyout')) return
      setExpandedFlag(false)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [expanded, setExpandedFlag])

  const onCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    playButtonClickSound()
    copy(item.id)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 900)
  }, [copy, item.id])

  const onPaste = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    // Safety guard: NEVER paste if this card is currently previewing (blurred)
    if (useStore.getState().previewItemId === item.id) {
      return
    }
    const opts = pasteOptionsFor(item, useStore.getState().settings, !!e?.altKey, edge.platform)
    tryPaste(() => paste(item.id, opts))
  }, [paste, item])

  const onExpand = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isBundle) {
      playCardExpandSound(true)
      setExpandedFlag(true)
      if (useStore.getState().tutorialStep === 4 && item.id === 'onboarding-files') {
        useStore.getState().setTutorialStep(5)
      }
    }
  }, [isBundle, item.id, setExpandedFlag])

  const onCollapse = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    playCardExpandSound(false)
    setExpandedFlag(false)
  }, [setExpandedFlag])

  const handleDragStart = useCallback((e: React.DragEvent, req: DragRequest) => {
    if (item.data.kind === 'text') {
      if (!IS_DARWIN || !e.dataTransfer) {
        // We no longer support dragging text/links.
        // Prevent the default browser drag behavior (e.g. text selection dragging) entirely.
        e.preventDefault()
        return
      }
      const text = fullTextRef.current ?? item.data.text
      e.dataTransfer.setData('text/plain', text)
      if (item.data.isUrl) e.dataTransfer.setData('text/uri-list', text.trim())
      if (item.data.html) e.dataTransfer.setData('text/html', item.data.html)
      e.dataTransfer.effectAllowed = 'copy'
      useStore.getState().setTextDragActive(true)
      return
    } else {
      // Images and files need OS-level file handles via Electron's startDrag.
      // Cancel the HTML5 drag (preventDefault) so the browser doesn't run its
      // own ghost in parallel; Electron's startDrag starts an independent OLE
      // drag managed by the OS. Fire the IPC synchronously so main calls
      // event.sender.startDrag(...) on the same tick.
      e.preventDefault()
      setInternalDragReq(req)
      startDrag(req)
    }
  }, [item.data, startDrag, setInternalDragReq])

  const handlePrestage = useCallback(() => {
    if (item.data.kind !== 'text' && !isPreviewing) {
      window.edge.prestageDrag({ id: item.id })
    } else if (IS_DARWIN && item.data.kind === 'text' && item.data.hasFullPayload && !fullTextRequestedRef.current) {
      fullTextRequestedRef.current = true
      try {
        void Promise.resolve(edge.getFullText(item.id))
          .then((full) => {
            if (typeof full === 'string' && full) fullTextRef.current = full
            else fullTextRequestedRef.current = false
          })
          .catch(() => {
            fullTextRequestedRef.current = false
          })
      } catch {
        fullTextRequestedRef.current = false
      }
    }
  }, [item.data, isPreviewing, item.id])

  const pointerStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const wasPreviewingRef = useRef(false)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Track if THIS card was the actively previewed (blurred) card when pointer clicked
    wasPreviewingRef.current = (useStore.getState().previewItemId === item.id) || isPreviewing
    if (e.button === 0) {
      pointerStartRef.current = { x: e.clientX, y: e.clientY, moved: false }
    }
    handlePrestage()
  }, [isPreviewing, item.id, handlePrestage])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointerStartRef.current) return
    const dist = Math.hypot(e.clientX - pointerStartRef.current.x, e.clientY - pointerStartRef.current.y)
    if (dist > 5) {
      pointerStartRef.current.moved = true
    }
  }, [])

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    if (pointerStartRef.current?.moved) {
      // User dragged or attempted to drag — do not execute click/paste!
      pointerStartRef.current = null
      e.stopPropagation()
      return
    }
    pointerStartRef.current = null

    if (IS_DARWIN && (e.shiftKey || e.metaKey)) {
      e.stopPropagation()
      e.preventDefault()
      wasPreviewingRef.current = false
      const state = useStore.getState()
      if (e.shiftKey) state.selectRangeTo(item.id, getNavOrder())
      else state.toggleSelected(item.id)
      return
    }

    // In that particular scenario only:
    // When this card is open in preview flyout (blurred), clicking it only
    // minimizes the preview flyout and does NOT paste
    const currentPreviewId = useStore.getState().previewItemId
    if (currentPreviewId === item.id || isPreviewing || wasPreviewingRef.current) {
      wasPreviewingRef.current = false
      e.stopPropagation()
      e.preventDefault()
      playCardExpandSound(false)
      useStore.getState().setPreviewItemId(null)
      return
    }
    wasPreviewingRef.current = false

    // If another card was previewing and user clicked this card to paste:
    // Dismiss the other card's preview and proceed with pasting this card
    if (currentPreviewId && currentPreviewId !== item.id) {
      useStore.getState().setPreviewItemId(null)
    }

    const selectionState = useStore.getState()
    if (IS_DARWIN && selectionState.selection.ids.length > 0) {
      e.stopPropagation()
      if (selectionState.selectedMap[item.id]) {
        const plain = pastePlainFor(selectionState.settings, e.altKey, edge.platform)
        tryPaste(() => { void selectionState.pasteSelection(plain).catch(() => {}) })
        return
      }
      selectionState.clearSelection()
      return
    }

    if (isBundle && !expanded) {
      onExpand(e)
    } else if (!isBundle) {
      onPaste(e)
    }
  }, [isPreviewing, isBundle, expanded, onExpand, onPaste, item.id])

  return (
    <motion.div
      ref={ref}
      initial={false}
      animate={{ opacity: 1 }}
      className={`item${item.pinned ? ' pinned' : ''}${isBundle ? ' bundle' : ''}${expanded ? ' is-expanded' : ''}${colorInfo ? ` is-color-card ${colorInfo.isLight ? 'is-light-color' : 'is-dark-color'}` : ''}`}
      data-expanded-stack={expanded ? 'true' : undefined}
      style={{
        ...(expandedWidth ? { width: expandedWidth, minWidth: expandedWidth, maxWidth: expandedWidth } : {}),
        ...(colorInfo ? {
          '--card-color': colorInfo.cssColor,
          backgroundColor: colorInfo.cssColor
        } as React.CSSProperties : {})
      }}
    >
      {copied && (
        <motion.div
          key="copy-ripple"
          initial={{ opacity: 0.75, scale: 0.2 }}
          animate={{ opacity: 0, scale: 1.6 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 16,
            background: colorInfo?.isLight
              ? 'radial-gradient(circle at center, rgba(0, 0, 0, 0.25) 0%, rgba(0, 0, 0, 0.06) 45%, transparent 75%)'
              : colorInfo
                ? 'radial-gradient(circle at center, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.08) 45%, transparent 75%)'
                : 'radial-gradient(circle at center, rgb(var(--ink) / 0.3) 0%, rgb(var(--ink) / 0.08) 45%, transparent 75%)',
            pointerEvents: 'none',
            zIndex: 15
          }}
        />
      )}
      <div
        className={`item-main${isPreviewing ? ' force-actions previewing' : ''}${isActive ? ' kb-active' : ''}${isSelected ? ' is-selected' : ''}`}
        data-id={item.id}
        role={IS_DARWIN ? 'button' : undefined}
        tabIndex={IS_DARWIN ? 0 : undefined}
        aria-label={itemAccessibleLabel(item)}
        aria-expanded={isBundle ? expanded : undefined}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.currentTarget.click()
          }
        }}
        draggable={!isPreviewing && !renaming && (item.data.kind !== 'text' || IS_DARWIN) && (!isBundle || !expanded)}
        onContextMenu={(e) => openItemMenu(e, item.id)}
        onMouseEnter={handlePrestage}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onDragStart={(e) => {
          if (pointerStartRef.current) pointerStartRef.current.moved = true
          if (multiSelected) {
            startSelectionDrag(e)
            return
          }
          handleDragStart(e, { id: item.id })
        }}
        onDragEnd={() => {
          setInternalDragReq(null)
          useStore.getState().setTextDragActive(false)
        }}
        onDragOver={(e) => {
          const activeDrag = useStore.getState().internalDragReq
          if (activeDrag && useStore.getState().selectionDragActive) {
            e.preventDefault()
            e.stopPropagation()
          } else if (activeDrag && activeDrag.id !== item.id) {
            e.preventDefault()
          } else if (activeDrag && activeDrag.id === item.id) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onDrop={(e) => {
          const activeDrag = useStore.getState().internalDragReq
          if (activeDrag && useStore.getState().selectionDragActive) {
            e.preventDefault()
            e.stopPropagation()
            setInternalDragReq(null)
          } else if (activeDrag && activeDrag.id !== item.id) {
            e.preventDefault()
            e.stopPropagation()
            window.edge.mergeItems(activeDrag.id, item.id)
            setInternalDragReq(null)
          } else if (activeDrag && activeDrag.id === item.id) {
            e.preventDefault()
            e.stopPropagation()
            setInternalDragReq(null)
          }
        }}
        onClick={handleCardClick}
      >
        {isSelected && (
          <span className="select-check" aria-hidden="true">
            <CheckIcon width={11} height={11} />
          </span>
        )}
        {queueIndex >= 0 && (
          <span className="queue-badge" aria-hidden="true">
            {queueIndex + 1}
          </span>
        )}
        <div className="body">
          <div className={`item-content${item.title || renaming ? ' has-title' : ''}`}>
            {renaming ? (
              <TitleEditor item={item} />
            ) : item.title && (!isBundle || !expanded) ? (
              <div className="item-title" dir="auto" title={item.title}>{item.title}</div>
            ) : null}
            {isBundle ? (
                <BundleFluidPreview 
                  item={item} 
                  expanded={expanded} 
                  isHorizontal={isHorizontal}
                  onDragStart={handleDragStart} 
                  onCopy={onCopy} 
                  onRemove={() => remove(item.id)} 
                  onCollapse={onCollapse}
                />
            ) : (
              <Preview item={item} />
            )}
            {item.sourceApp?.bundleId && (!isBundle || !expanded) && (
              <SourceAppLine bundleId={item.sourceApp.bundleId} name={item.sourceApp.name} />
            )}
          </div>
          {(!isBundle || !expanded) && (
            <div className="item-footer">
              <div className="meta">
                <KindBadge item={item} />
                <ItemDetails item={item} />
                {item.hitCount > 1 && (
                  <>
                    <span>·</span>
                    <span className="meta-hit-count" title={t('item.copiedTimes', { count: item.hitCount })}>
                      ×{item.hitCount}
                    </span>
                  </>
                )}
                {copied && <span className="meta-copied">· {t('item.copied')}</span>}
              </div>
              <RelativeTime capturedAt={item.capturedAt} />
            </div>
          )}
        </div>

        <div 
          className="actions" 
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); }} 
          style={{ display: isBundle && expanded ? 'none' : undefined }}
        >
          <button
            className={`act${item.pinned ? ' active' : ''}`}
            title={item.pinned ? t('item.unpin') : t('item.pin')}
            aria-label={item.pinned ? t('item.unpin') : t('item.pin')}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              releaseFocus(e)
              playToggleSound(!item.pinned)
              togglePin(item.id, !item.pinned)
            }}
          >
            {item.pinned ? <PinFillIcon /> : <PinIcon />}
          </button>
          <button
            className={`act${isPreviewing ? ' preview-contract active' : ' preview-expand'}`}
            title={isPreviewing ? t('header.close') : t('item.expand')}
            aria-label={isPreviewing ? t('header.close') : t('item.expand')}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              releaseFocus(e)
              playCardExpandSound(!isPreviewing)
              const rect = e.currentTarget.closest('.item-main')?.getBoundingClientRect()
              const rectData = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined
              useStore.getState().setPreviewItemId(isPreviewing ? null : item.id, rectData)
            }}
          >
            {isPreviewing ? <ContractIcon /> : <ExpandIcon />}
          </button>
          <button 
            className="act" 
            title={t('item.copy')} 
            aria-label={t('item.copy')}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              releaseFocus(e)
              onCopy(e)
            }}
          >
            <CopyIcon />
          </button>
          {item.data.kind === 'text' && item.data.isUrl && (
            <button
              className="act"
              title={t('flyout.openLink')}
              aria-label={t('flyout.openLink')}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                releaseFocus(e)
                playButtonClickSound()
                window.open((item.data as any).text, '_blank')
              }}
            >
              <ExternalLinkIcon />
            </button>
          )}
          <div className="act-divider" />
          <button
            className="act danger"
            title={t('item.delete')}
            aria-label={t('item.delete')}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              releaseFocus(e)
              playDeleteSound()
              remove(item.id)
            }}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </motion.div>
  )
})

/**
 * Memo comparator backed by a value-based render key: every `state:items`
 * push recreates all DTO objects, so shallow identity compare would re-render
 * the entire list on each push. This skips the re-render unless any field the
 * card actually displays changed. Store-subscription-driven updates (open,
 * previewing) and local state (copied/expanded) are unaffected — memo only
 * gates prop-driven renders.
 */
function BrokenItemTile({ item }: { item: ClipboardItemDto }) {
  const { t } = useTranslation()
  return (
    <div className="item item-broken">
      <WarningGlyph size={16} />
      <span className="item-broken-text">{t('item.renderFailed')}</span>
      <button
        type="button"
        className="act danger"
        title={t('item.delete')}
        aria-label={t('item.delete')}
        onClick={() => {
          playDeleteSound()
          void useStore.getState().remove(item.id)
        }}
      >
        <TrashIcon />
      </button>
    </div>
  )
}

const GuardedClipboardItem = forwardRef<HTMLDivElement, Props>(({ item }, ref) => (
  <ErrorBoundary label={`item ${item.id}`} resetKey={item} fallback={() => <BrokenItemTile item={item} />}>
    <ClipboardItemBase ref={ref} item={item} />
  </ErrorBoundary>
))

export const ClipboardItemCard = memo(
  GuardedClipboardItem,
  (prevProps, nextProps) => {
    const prev = prevProps.item
    const next = nextProps.item
    return (
      prev.id === next.id &&
      prev.pinned === next.pinned &&
      prev.hitCount === next.hitCount &&
      prev.capturedAt === next.capturedAt &&
      prev.title === next.title &&
      prev.sourceApp?.bundleId === next.sourceApp?.bundleId &&
      prev.sourceApp?.name === next.sourceApp?.name &&
      itemRenderKey(prev) === itemRenderKey(next)
    )
  }
)
