import { useState } from 'react'
import { motion } from 'framer-motion'
import { playToggleSound } from '../../lib/soundEffects'

export function Toggle({
  checked,
  onChange,
  disabled,
  labelledBy
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  labelledBy?: string
}) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <button
      type="button"
      className={`setting-toggle${checked ? ' checked' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => {
        if (disabled) return
        playToggleSound(!checked)
        onChange(!checked)
      }}
      style={{
        flexShrink: 0,
        width: 36,
        height: 20,
        borderRadius: 999,
        background: disabled
          ? 'rgb(var(--ink) / 0.05)'
          : checked
          ? 'var(--surface-inverse)'
          : isHovered
          ? 'rgb(var(--ink) / 0.18)'
          : 'rgb(var(--ink) / 0.12)',
        border: 'none',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 0,
        outline: 'none',
        transition: 'background 0.18s ease, opacity 0.18s ease',
        boxShadow: 'none',
        opacity: disabled ? 0.38 : 1
      }}
    >
      <motion.span
        className="toggle-thumb"
        initial={false}
        animate={{
          x: checked ? 19 : 3
        }}
        transition={{
          type: 'spring',
          stiffness: 520,
          damping: 32,
          mass: 0.5
        }}
        style={{
          position: 'absolute',
          top: 3,
          left: 0,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: checked ? 'var(--on-inverse)' : 'var(--surface-inverse)',
          transition: 'background-color 0.18s ease',
          boxShadow: 'none',
          pointerEvents: 'none'
        }}
      />
    </button>
  )
}
