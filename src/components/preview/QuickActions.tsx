import { useState } from 'react'
import { FolderOpenIcon, CheckIcon } from '../icons'

import { useTranslation, t } from '../../i18n'

export function QuickActionButton({
  title,
  icon: Icon,
  onClick,
  activeColor = '#4caf50',
  solidDark = false,
  size = 28
}: {
  title: string
  icon: any
  onClick: () => any
  activeColor?: string
  solidDark?: boolean
  size?: number
}) {
  const [copied, setCopied] = useState(false)

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await onClick()
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const defaultBg = solidDark ? 'rgba(0, 0, 0, 0.85)' : 'rgb(var(--ink) / 0.06)'
  const defaultBorder = solidDark ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid rgb(var(--ink) / 0.08)'
  const defaultColor = solidDark ? '#ffffff' : 'rgb(var(--ink) / max(0.75, var(--text-alpha-floor)))'

  const hoverBg = solidDark ? 'rgba(0, 0, 0, 0.98)' : 'rgb(var(--ink) / 0.18)'
  const hoverColor = solidDark ? '#ffffff' : 'var(--text-primary)'
  const iconSize = size === 24 ? 12 : 14
  const borderRadius = size === 24 ? 6 : 8

  return (
    <button
      title={copied ? t('flyout.copied') : title}
      aria-label={copied ? t('flyout.copied') : title}
      onClick={handleClick}
      style={{
        width: size,
        height: size,
        background: copied ? (solidDark ? '#4caf50' : 'rgba(76, 175, 80, 0.2)') : defaultBg,
        border: copied ? (solidDark ? '1px solid #4caf50' : '1px solid rgba(76, 175, 80, 0.4)') : defaultBorder,
        color: copied ? (solidDark ? '#ffffff' : activeColor) : defaultColor,
        borderRadius,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s ease',
        flexShrink: 0,
        boxShadow: solidDark ? '0 4px 12px rgba(0, 0, 0, 0.5)' : undefined
      }}
      onMouseEnter={(e) => {
        if (!copied) {
          e.currentTarget.style.background = hoverBg
          e.currentTarget.style.color = hoverColor
        }
      }}
      onMouseLeave={(e) => {
        if (!copied) {
          e.currentTarget.style.background = defaultBg
          e.currentTarget.style.color = defaultColor
        }
      }}
    >
      {copied ? <CheckIcon width={iconSize} height={iconSize} /> : <Icon width={iconSize} height={iconSize} />}
    </button>
  )
}

export function ExplorerButton({
  path,
  title,
  size = 28,
  solidDark = false
}: {
  path: string
  title?: string
  size?: number
  solidDark?: boolean
}) {
  const { t } = useTranslation()
  const defaultBg = solidDark ? 'rgba(0, 0, 0, 0.85)' : 'rgb(var(--ink) / 0.06)'
  const defaultBorder = solidDark ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid rgb(var(--ink) / 0.08)'
  const defaultColor = solidDark ? '#ffffff' : 'rgb(var(--ink) / max(0.75, var(--text-alpha-floor)))'
  const hoverBg = solidDark ? 'rgba(0, 0, 0, 0.98)' : 'rgb(var(--ink) / 0.18)'
  const hoverColor = solidDark ? '#ffffff' : 'var(--text-primary)'
  const iconSize = size === 24 ? 12 : 14
  const borderRadius = size === 24 ? 6 : 8

  return (
    <button
      title={title || t('flyout.openInExplorer')}
      aria-label={title || t('flyout.openInExplorer')}
      onClick={(e) => {
        e.stopPropagation()
        window.edge.revealFile(path)
      }}
      style={{
        width: size,
        height: size,
        background: defaultBg,
        border: defaultBorder,
        color: defaultColor,
        borderRadius,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s ease',
        flexShrink: 0,
        boxShadow: solidDark ? '0 4px 12px rgba(0, 0, 0, 0.5)' : undefined
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = hoverBg
        e.currentTarget.style.color = hoverColor
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = defaultBg
        e.currentTarget.style.color = defaultColor
      }}
    >
      <FolderOpenIcon width={iconSize} height={iconSize} />
    </button>
  )
}

export const SYS_FONT = 'var(--font-ui)'
export const CODE_FONT = 'var(--font-ui)'

export function SelectionBadge({
  isSelected,
  onToggle
}: {
  isSelected: boolean
  onToggle: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onToggle(e)
      }}
                      title={isSelected ? t('flyout.deselectItem') : t('flyout.selectItem')}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 4,
        margin: -4,
        cursor: 'pointer',
        zIndex: 6,
        flexShrink: 0
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 5,
          background: isSelected ? '#ffffff' : 'rgba(0, 0, 0, 0.75)',
          border: isSelected ? '2px solid #ffffff' : '2px solid rgba(255, 255, 255, 0.5)',
          color: isSelected ? '#000000' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: isSelected ? '0 2px 8px rgba(0, 0, 0, 0.6)' : '0 2px 6px rgba(0, 0, 0, 0.4)',
          transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease'
        }}
      >
        {isSelected && (
          <CheckIcon width={14} height={14} />
        )}
      </div>
    </div>
  )
}
