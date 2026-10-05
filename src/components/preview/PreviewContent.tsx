import { useState, useEffect } from 'react'
import { useStore } from '../../store/appStore'
import { formatBytes, formatImageDisplayName, fileStreamUrl } from '../../lib/format'
import { getFileKind } from '../../lib/fileType'
import { FileKindIcon, CopyIcon, CheckIcon, ExternalLinkIcon, GlobeIcon } from '../icons'
import { parseUrlPreview } from '../../lib/urlPreview'
import { useDragOut } from '../../hooks/useDragOut'
import { tryPaste } from '../../lib/tryPaste'
import { pasteOptionsFor } from '../../lib/pasteOptions'
import { edge } from '../../lib/edge'

import { useTranslation } from '../../i18n'
import { QuickActionButton, ExplorerButton, SelectionBadge, SYS_FONT } from './QuickActions'

export function PreviewContent({
  item,
  selectedKeys,
  onToggleSelectKey
}: {
  item: any
  selectedKeys?: Set<string>
  onToggleSelectKey?: (key: string, e?: React.MouseEvent) => void
}) {
  const { t } = useTranslation()
  const startDrag = useDragOut()

  const [fullText, setFullText] = useState<string | null>(null)

  useEffect(() => {
    if (item?.data?.kind === 'text' && item.data.hasFullPayload) {
      window.edge.getFullText(item.id).then((t) => setFullText(t)).catch(() => {})
    } else {
      setFullText(null)
    }
  }, [item?.id, item?.data?.hasFullPayload])

  if (item.data.kind === 'text') {
    const activeText = fullText ?? item.data.text
    const text: string = activeText.length > 20000
      ? activeText.slice(0, 20000) + `\n\n${t('flyout.contentTruncated')}`
      : activeText
    const isUrl = item.data.isUrl

    if (isUrl) {
      const info = parseUrlPreview(activeText)
      return (
        <div
          onClick={(e) => {
            const sel = window.getSelection()?.toString()
            if (sel && sel.trim().length > 0) return
            e.stopPropagation()
            const opts = pasteOptionsFor(item, useStore.getState().settings, e.altKey, edge.platform)
            tryPaste(() => useStore.getState().paste(item.id, opts))
          }}
          title={t('flyout.clickToPaste')}
          style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 14, cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgb(var(--ink) / 0.08)',
              border: '1px solid rgb(var(--ink) / 0.14)',
              borderRadius: 999,
              padding: '3px 10px',
              maxWidth: 'calc(100% - 75px)',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box'
            }}>
              <GlobeIcon width={13} height={13} style={{ color: 'rgb(var(--ink) / max(0.85, var(--text-alpha-floor)))', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontFamily: SYS_FONT, flexShrink: 0, whiteSpace: 'nowrap' }}>{info.serviceName}</span>
              <span style={{ fontSize: 11, color: 'rgb(var(--ink) / max(0.35, var(--text-alpha-floor)))', flexShrink: 0 }}>·</span>
              <span style={{ fontSize: 11.5, color: 'rgb(var(--ink) / max(0.65, var(--text-alpha-floor)))', fontFamily: SYS_FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flexShrink: 1 }}>{info.domain}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <QuickActionButton
                title={t('flyout.openLink')}
                icon={ExternalLinkIcon}
                onClick={() => window.open(activeText, '_blank')}
              />
              <QuickActionButton
                title={t('flyout.copyText')}
                icon={CopyIcon}
                onClick={() => navigator.clipboard.writeText(info.cleanUrl || activeText)}
              />
            </div>
          </div>

          {info.title && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--text-primary)',
                lineHeight: 1.35,
                fontFamily: SYS_FONT,
                wordBreak: 'break-word'
              }}>
                {info.title}
              </div>
              {info.subtitle && (
                <div>
                  <span style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'rgb(var(--ink) / max(0.6, var(--text-alpha-floor)))',
                    background: 'rgb(var(--ink) / 0.08)',
                    padding: '2px 7px',
                    borderRadius: 4,
                    display: 'inline-block'
                  }}>
                    {info.subtitle}
                  </span>
                </div>
              )}
            </div>
          )}

          <div
            onClick={(e) => {
              e.stopPropagation()
              window.open(activeText, '_blank')
            }}
            style={{
              padding: '10px 12px',
              background: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid rgb(var(--ink) / 0.08)',
              borderRadius: 10,
              fontSize: 12,
              color: 'rgb(var(--ink) / max(0.80, var(--text-alpha-floor)))',
              fontFamily: 'var(--font-ui)',
              wordBreak: 'break-all',
              lineHeight: 1.45,
              cursor: 'pointer',
              transition: 'background 0.15s ease, border-color 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgb(var(--ink) / 0.08)'
              e.currentTarget.style.borderColor = 'rgb(var(--ink) / 0.16)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(0, 0, 0, 0.25)'
              e.currentTarget.style.borderColor = 'rgb(var(--ink) / 0.08)'
            }}
          >
            {info.cleanUrl || activeText}
          </div>
        </div>
      )
    }

    return (
      <div
        onClick={(e) => {
          const sel = window.getSelection()?.toString()
          if (sel && sel.trim().length > 0) return
          e.stopPropagation()
          const opts = pasteOptionsFor(item, useStore.getState().settings, e.altKey, edge.platform)
          tryPaste(() => useStore.getState().paste(item.id, opts))
        }}
        title={t('flyout.clickToPaste')}
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, position: 'sticky', top: 0, zIndex: 2 }}>
          <QuickActionButton
            title={t('flyout.copyText')}
            icon={CopyIcon}
            onClick={() => useStore.getState().copy(item.id)}
          />
        </div>
        <div dir="auto" style={{
          color: 'rgb(var(--ink) / max(0.88, var(--text-alpha-floor)))',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 13.5,
          lineHeight: 1.65,
          fontFamily: 'var(--font-ui)',
          fontWeight: 400,
          letterSpacing: '0.01em'
        }}>
          {text}
        </div>
      </div>
    )
  }
  
  if (item.data.kind === 'image') {
    return (
      <div
        draggable={true}
        onDragStart={(e) => {
          e.preventDefault()
          const req = { id: item.id }
          useStore.getState().setInternalDragReq(req)
          startDrag(req)
        }}
        onDragEnd={() => useStore.getState().setInternalDragReq(null)}
        onClick={(e) => {
          e.stopPropagation()
          tryPaste(() => useStore.getState().paste(item.id))
        }}
        title={t('flyout.clickToPasteDrag')}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', cursor: 'grab' }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, position: 'absolute', top: 8, right: 8, zIndex: 2 }}>
          <QuickActionButton
            title={t('flyout.copyImage')}
            icon={CopyIcon}
            onClick={() => useStore.getState().copy(item.id)}
            solidDark={true}
          />
        </div>
        {item.data.imageId && (
          <img src={`edgelocal://${item.data.imageId}`} alt="preview" style={{ width: '100%', maxHeight: '65vh', objectFit: 'contain', borderRadius: 8 }} draggable={false} />
        )}
        <div style={{ fontSize: 12, color: 'rgb(var(--ink) / max(0.4, var(--text-alpha-floor)))', fontFamily: SYS_FONT, letterSpacing: '0.02em' }}>
          {item.data.width} × {item.data.height} · {formatBytes(item.data.fileBytes || item.data.bytes)}
        </div>
      </div>
    )
  }

  if (item.data.kind === 'image-collection') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {item.data.images.map((img: any, idx: number) => {
          const isSelected = selectedKeys?.has(img.imageId) ?? false
          return (
            <div
              key={img.imageId}
              draggable={true}
              onDragStart={(e) => {
                e.preventDefault()
                const sel = selectedKeys ? Array.from(selectedKeys) : []
                const req = (sel.length > 0 && isSelected)
                  ? { id: item.id }
                  : { id: item.id, imageId: img.imageId }
                useStore.getState().setInternalDragReq(req)
                startDrag(req)
              }}
              onDragEnd={() => useStore.getState().setInternalDragReq(null)}
              onClick={(e) => {
                e.stopPropagation()
                if (selectedKeys && selectedKeys.size > 0 && onToggleSelectKey) {
                  onToggleSelectKey(img.imageId, e)
                } else {
                  tryPaste(() => window.edge.pasteSubitem({ id: item.id, imageId: img.imageId }))
                }
              }}
              title={selectedKeys && selectedKeys.size > 0 ? (isSelected ? t('flyout.clickToDeselect') : t('flyout.clickToSelect')) : t('flyout.clickToPasteImageDrag')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                position: 'relative',
                cursor: 'grab',
                padding: 4,
                borderRadius: 10,
                border: isSelected ? '2px solid #ffffff' : '2px solid transparent',
                background: isSelected ? 'rgb(var(--ink) / 0.08)' : 'transparent',
                boxShadow: isSelected ? '0 0 16px rgb(var(--ink) / 0.2)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 3 }}>
                <SelectionBadge
                  isSelected={isSelected}
                  onToggle={(e) => onToggleSelectKey?.(img.imageId, e)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, position: 'absolute', top: 12, right: 12, zIndex: 2 }}>
                <QuickActionButton
                  title={t('flyout.copyImage')}
                  icon={CopyIcon}
                  onClick={() => useStore.getState().copySubitem({ id: item.id, imageId: img.imageId })}
                  solidDark={true}
                />
              </div>
              <img src={`edgelocal://${img.imageId}`} alt="" style={{ width: '100%', maxHeight: '65vh', objectFit: 'contain', borderRadius: 8 }} draggable={false} />
              <div style={{ fontSize: 11, color: 'rgb(var(--ink) / max(0.35, var(--text-alpha-floor)))', textAlign: 'center', fontFamily: SYS_FONT, letterSpacing: '0.02em' }}>
                {idx + 1} / {item.data.images.length} · {img.width} × {img.height} · {formatBytes(img.fileBytes || img.bytes)}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (item.data.kind === 'files') {
    const isSingleImage = item.data.paths.length === 1 && (item.data.entries?.[0]?.isImage || getFileKind(item.data.paths[0]).kind === 'image')
    if (isSingleImage) {
      const p = item.data.paths[0]
      const entry = item.data.entries?.[0]
      const fileName = formatImageDisplayName(entry?.name || p, item.capturedAt)
      const fullResUrl = fileStreamUrl(p)
      return (
        <div
          draggable={true}
          onDragStart={(e) => {
            e.preventDefault()
            const req = { id: item.id, paths: [p] }
            useStore.getState().setInternalDragReq(req)
            startDrag(req)
          }}
          onDragEnd={() => useStore.getState().setInternalDragReq(null)}
          onClick={(e) => {
            e.stopPropagation()
            tryPaste(() => useStore.getState().paste(item.id))
          }}
          title={t('flyout.clickToPasteDrag')}
          style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', cursor: 'grab' }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, position: 'absolute', top: 8, right: 8, zIndex: 2 }}>
            <QuickActionButton
              title={t('flyout.copyFile')}
              icon={CopyIcon}
              onClick={() => useStore.getState().copy(item.id)}
              solidDark={true}
              size={28}
            />
            <ExplorerButton
              path={p}
              title={t('flyout.openInExplorer')}
              solidDark={true}
              size={28}
            />
          </div>
          <img
            src={fullResUrl}
            onError={(e) => {
              if (entry?.preview) {
                e.currentTarget.src = entry.preview
              }
            }}
            alt={fileName}
            style={{ width: '100%', maxHeight: '65vh', objectFit: 'contain', borderRadius: 8 }}
            draggable={false}
          />
          <div style={{ fontSize: 12, color: 'rgb(var(--ink) / max(0.5, var(--text-alpha-floor)))', fontFamily: SYS_FONT, letterSpacing: '0.02em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{fileName}</span>
            {entry?.size ? <span>{formatBytes(entry.size)}</span> : null}
          </div>
        </div>
      )
    }

    const isSingleNonImage = item.data.paths.length === 1
    if (isSingleNonImage) {
      const p = item.data.paths[0]
      const entry = item.data.entries?.[0]
      const info = getFileKind(p, entry?.isDirectory)
      const fileName = formatImageDisplayName(entry?.name || p, item.capturedAt)
      return (
        <div
          draggable={true}
          onDragStart={(e) => {
            e.preventDefault()
            const req = { id: item.id, paths: [p] }
            useStore.getState().setInternalDragReq(req)
            startDrag(req)
          }}
          onDragEnd={() => useStore.getState().setInternalDragReq(null)}
          onClick={(e) => {
            e.stopPropagation()
            tryPaste(() => useStore.getState().paste(item.id))
          }}
          title={t('flyout.clickToPasteDrag')}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 16,
            padding: '36px 20px 28px',
            background: 'rgb(var(--ink) / 0.035)',
            borderRadius: 14,
            border: '1px solid rgb(var(--ink) / 0.06)',
            position: 'relative',
            cursor: 'grab'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, position: 'absolute', top: 12, right: 12, zIndex: 2 }}>
            <QuickActionButton
              title={t('flyout.copyFile')}
              icon={CopyIcon}
              onClick={() => useStore.getState().copy(item.id)}
              size={28}
            />
            <ExplorerButton
              path={p}
              title={t('flyout.openInExplorer')}
              size={28}
            />
          </div>

          <div style={{
            width: 104,
            height: 104,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            filter: 'drop-shadow(0 8px 24px rgba(0, 0, 0, 0.55))',
            marginTop: 4
          }}>
            <FileKindIcon path={p} width={104} height={104} isDirectory={entry?.isDirectory} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '100%', padding: '0 10px' }}>
            <div
              title={fileName}
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text-primary)',
                wordBreak: 'break-word',
                lineHeight: 1.4,
                fontFamily: SYS_FONT
              }}
            >
              {fileName}
            </div>
            <div style={{ fontSize: 12, color: 'rgb(var(--ink) / max(0.45, var(--text-alpha-floor)))', fontFamily: SYS_FONT, letterSpacing: '0.02em' }}>
              {!entry?.isDirectory && entry?.size ? `${formatBytes(entry.size)} · ` : ''}{info.label}
            </div>
          </div>
        </div>
      )
    }

    const hasImageFiles = item.data.entries?.some((e: any) => !e.isDirectory && e.isImage) || item.data.paths.some((p: string, i: number) => {
      const e = item.data.entries?.[i]
      return !e?.isDirectory && getFileKind(p, e?.isDirectory).kind === 'image'
    })
    const useSingleColumn = hasImageFiles

    return (
      <div style={{ display: useSingleColumn ? 'flex' : 'grid', flexDirection: useSingleColumn ? 'column' : undefined, gridTemplateColumns: useSingleColumn ? undefined : 'repeat(2, minmax(0, 1fr))', gap: 12, width: '100%', boxSizing: 'border-box' }}>
        {item.data.paths.map((p: string, i: number) => {
          const entry = item.data.entries?.[i]
          const info = getFileKind(p, entry?.isDirectory)
          const fileName = formatImageDisplayName(entry?.name || p, item.capturedAt)
          const isSelected = selectedKeys?.has(p) ?? false
          const isImg = !entry?.isDirectory && (entry?.isImage || info.kind === 'image')

          if (isImg) {
            const fullResUrl = fileStreamUrl(p)
            return (
              <div
                key={i}
                draggable={true}
                onDragStart={(e) => {
                  e.preventDefault()
                  const sel = selectedKeys ? Array.from(selectedKeys) : []
                  const req = (sel.length > 0 && isSelected)
                    ? { id: item.id, paths: sel }
                    : { id: item.id, paths: [p] }
                  useStore.getState().setInternalDragReq(req)
                  startDrag(req)
                }}
                onDragEnd={() => useStore.getState().setInternalDragReq(null)}
                onClick={(e) => {
                  e.stopPropagation()
                  if (selectedKeys && selectedKeys.size > 0 && onToggleSelectKey) {
                    onToggleSelectKey(p, e)
                  } else {
                    tryPaste(() => window.edge.pasteSubitem({ id: item.id, paths: [p] }))
                  }
                }}
                title={t('flyout.clickToPasteDrag')}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 4,
                  background: isSelected ? 'rgb(var(--ink) / 0.08)' : 'transparent',
                  borderRadius: 10,
                  border: isSelected ? '2px solid #ffffff' : '2px solid transparent',
                  cursor: 'grab',
                  position: 'relative',
                  minWidth: 0,
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                {onToggleSelectKey && (
                  <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 3 }}>
                    <SelectionBadge
                      isSelected={isSelected}
                      onToggle={(e) => onToggleSelectKey(p, e)}
                    />
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, position: 'absolute', top: 12, right: 12, zIndex: 2 }}>
                  <QuickActionButton
                    title={t('flyout.copyFile')}
                    icon={CopyIcon}
                    onClick={() => useStore.getState().copySubitem({ id: item.id, paths: [p] })}
                    solidDark={true}
                  />
                  <ExplorerButton
                    path={p}
                    title={t('flyout.openInExplorer')}
                    solidDark={true}
                  />
                </div>

                <img
                  src={fullResUrl}
                  onError={(e) => {
                    if (entry?.preview) e.currentTarget.src = entry.preview
                  }}
                  alt={fileName}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  style={{ width: '100%', maxHeight: '65vh', objectFit: 'contain', borderRadius: 8 }}
                />
                <div style={{ fontSize: 11, color: 'rgb(var(--ink) / max(0.35, var(--text-alpha-floor)))', textAlign: 'center', fontFamily: SYS_FONT, letterSpacing: '0.02em' }}>
                  {fileName}{entry?.size ? ` · ${formatBytes(entry.size)}` : ''}
                </div>
              </div>
            )
          }

          // Non-image file card in multi-file view (2-column grid or single column)
          return (
            <div
              key={i}
              draggable={true}
              onDragStart={(e) => {
                e.preventDefault()
                const sel = selectedKeys ? Array.from(selectedKeys) : []
                const req = (sel.length > 0 && isSelected)
                  ? { id: item.id, paths: sel }
                  : { id: item.id, paths: [p] }
                useStore.getState().setInternalDragReq(req)
                startDrag(req)
              }}
              onDragEnd={() => useStore.getState().setInternalDragReq(null)}
              onClick={(e) => {
                e.stopPropagation()
                if (selectedKeys && selectedKeys.size > 0 && onToggleSelectKey) {
                  onToggleSelectKey(p, e)
                } else {
                  tryPaste(() => window.edge.pasteSubitem({ id: item.id, paths: [p] }))
                }
              }}
              title={t('flyout.clickToPasteDrag')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 8,
                padding: '14px 10px 12px',
                background: isSelected ? 'rgb(var(--ink) / 0.12)' : 'rgb(var(--ink) / 0.035)',
                borderRadius: 12,
                border: isSelected ? '1px solid rgb(var(--ink) / 0.3)' : '1px solid rgb(var(--ink) / 0.06)',
                cursor: 'grab',
                position: 'relative',
                minWidth: 0,
                width: '100%',
                boxSizing: 'border-box'
              }}
            >
              {/* Top Controls: Checkbox (left) + Action Buttons (right) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 4 }}>
                {onToggleSelectKey ? (
                  <div
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleSelectKey(p, e)
                    }}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      border: isSelected ? '1.5px solid var(--surface-inverse)' : '1.5px solid rgb(var(--ink) / 0.3)',
                      background: isSelected ? 'var(--surface-inverse)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      flexShrink: 0
                    }}
                  >
                    {isSelected && (
                      <CheckIcon width={12} height={12} style={{ color: 'var(--on-inverse)', strokeWidth: 3 }} />
                    )}
                  </div>
                ) : <div />}

                <div style={{ display: 'flex', gap: 4 }}>
                  <QuickActionButton
                    title={t('flyout.copyFile')}
                    icon={CopyIcon}
                    onClick={() => useStore.getState().copySubitem({ id: item.id, paths: [p] })}
                    size={24}
                  />
                  <ExplorerButton
                    path={p}
                    title={t('flyout.openInExplorer')}
                    size={24}
                  />
                </div>
              </div>

              {/* Centered Large 3D Pastel Vector Icon */}
              <div style={{
                width: 64,
                height: 64,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                filter: 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.45))',
                marginTop: 8
              }}>
                <FileKindIcon path={p} width={64} height={64} isDirectory={entry?.isDirectory} />
              </div>

              {/* File Name & Metadata below icon */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%', minWidth: 0, padding: '0 4px', boxSizing: 'border-box' }}>
                <span
                  title={fileName}
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'rgb(var(--ink) / max(0.92, var(--text-alpha-floor)))',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                    lineHeight: 1.35,
                    fontFamily: SYS_FONT,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}
                >
                  {fileName}
                </span>
                <span style={{ fontSize: 11, color: 'rgb(var(--ink) / max(0.42, var(--text-alpha-floor)))', fontFamily: SYS_FONT, letterSpacing: '0.02em' }}>
                  {!entry?.isDirectory && entry?.size ? formatBytes(entry.size) : info.label}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return null
}
