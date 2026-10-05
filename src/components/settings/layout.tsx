import { createContext, useContext } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Toggle } from './Toggle'

export type SettingsTab = 'behaviour' | 'position' | 'appearance'

interface SettingsLayout {
  isHorizontal: boolean
  titleId: (name: string) => string
  cardClass: (kind: string, col: string) => string
}

export function settingsLayout(isHorizontal: boolean, idBase: string): SettingsLayout {
  return {
    isHorizontal,
    titleId: (name) => `${idBase}-${name}`,
    cardClass: (kind, col) => (isHorizontal ? `settings-shelf-card ${kind} ${col}` : 'setting-card')
  }
}

export const SettingsLayoutContext = createContext<SettingsLayout>(settingsLayout(false, ''))

export function useSettingsLayout(): SettingsLayout {
  return useContext(SettingsLayoutContext)
}

export function Divider({ label }: { label: string }) {
  const { isHorizontal } = useSettingsLayout()
  return isHorizontal ? (
    <div className="shelf-section-divider">
      <span className="shelf-section-divider-text">{label}</span>
    </div>
  ) : (
    <div className="setting-section-divider">
      <span className="setting-section-divider-text">{label}</span>
    </div>
  )
}

interface PillOption {
  key: string | number
  label: string
  active: boolean
  onSelect: () => void
}

interface PillsLayout {
  columns: number
  gap: number
  fullWidth?: boolean
  pill: CSSProperties
  verticalGrid?: boolean
}

export function Pills({ labelId, options, layout }: { labelId: string; options: PillOption[]; layout: PillsLayout }) {
  const { isHorizontal } = useSettingsLayout()
  return (
    <div
      className="setting-pills"
      role="group"
      aria-labelledby={labelId}
      style={
        isHorizontal
          ? { display: 'grid', gridTemplateColumns: `repeat(${layout.columns}, 1fr)`, gap: layout.gap, ...(layout.fullWidth ? { width: '100%' } : {}) }
          : layout.verticalGrid
          ? { display: 'grid', gridTemplateColumns: `repeat(${layout.columns}, 1fr)`, gap: 5 }
          : undefined
      }
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className={`pill ${opt.active ? 'active' : ''}`}
          aria-pressed={opt.active}
          style={isHorizontal ? layout.pill : undefined}
          onClick={opt.onSelect}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

interface ToggleCardProps {
  id: string
  kind: string
  col: string
  group: string
  title: string
  desc: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  dimmed?: boolean
}

export function ToggleCard({ id, kind, col, group, title, desc, checked, onChange, disabled, dimmed }: ToggleCardProps) {
  const { isHorizontal, titleId, cardClass } = useSettingsLayout()
  return (
    <div
      className={cardClass(kind, col)}
      style={!isHorizontal && dimmed !== undefined ? { opacity: dimmed ? 0.45 : 1, transition: 'opacity 0.2s ease' } : undefined}
    >
      <div className="shelf-card-top">
        <div className="setting-group-label">{group}</div>
      </div>
      <div className="shelf-card-inline" style={isHorizontal && dimmed !== undefined ? { opacity: dimmed ? 0.45 : 1 } : undefined}>
        <div className="shelf-card-inline-text">
          <div className="setting-title" id={titleId(id)}>{title}</div>
          <div className="setting-desc">{desc}</div>
        </div>
        <div className="shelf-card-inline-action">
          <Toggle checked={checked} onChange={onChange} disabled={disabled} labelledBy={titleId(id)} />
        </div>
      </div>
    </div>
  )
}
