export interface NavKey {
  key: string
  code?: string
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  composing?: boolean
}

export type NavFocus = 'none' | 'search' | 'header' | 'editable'

export interface NavContext {
  view: 'list' | 'emoji' | 'settings'
  focus: NavFocus
  count: number
  active: number
  horizontal: boolean
  rtl: boolean
  query: string
  previewOpen: boolean
  selected?: number
}

export type NavAction =
  | { type: 'none' }
  | { type: 'move'; index: number }
  | { type: 'paste'; index: number; invert: boolean }
  | { type: 'copy'; index: number }
  | { type: 'delete'; index: number }
  | { type: 'pin'; index: number }
  | { type: 'preview'; index: number }
  | { type: 'focusSearch'; text: string }
  | { type: 'clearQuery' }
  | { type: 'blur' }
  | { type: 'closePreview' }
  | { type: 'back' }
  | { type: 'close' }
  | { type: 'cycleFocus'; backwards: boolean }
  | { type: 'extend'; from: number; index: number }
  | { type: 'selectAll' }
  | { type: 'clearSelection' }
  | { type: 'pasteSelection'; invert: boolean }
  | { type: 'copySelection' }
  | { type: 'deleteSelection' }
  | { type: 'pinSelection' }

const NONE: NavAction = { type: 'none' }

let navOrder: string[] = []

export function setNavOrder(ids: string[]): void {
  navOrder = ids
}

export function getNavOrder(): string[] {
  return navOrder
}

function clamp(index: number, count: number): number {
  return Math.max(0, Math.min(count - 1, index))
}

function moveDelta(key: string, ctx: NavContext): number {
  if (key === 'ArrowDown') return 1
  if (key === 'ArrowUp') return -1
  if (!ctx.horizontal) return 0
  if (key === 'ArrowRight') return ctx.rtl ? -1 : 1
  if (key === 'ArrowLeft') return ctx.rtl ? 1 : -1
  return 0
}

function isPrintable(k: NavKey): boolean {
  return k.key.length === 1 && !k.meta && !k.ctrl
}

function digitOf(k: NavKey): number {
  const code = k.code ? /^Digit([1-9])$/.exec(k.code) : null
  if (code) return Number(code[1])
  if (k.code === undefined && /^[1-9]$/.test(k.key)) return Number(k.key)
  return 0
}

function escapeAction(ctx: NavContext): NavAction {
  if (ctx.view === 'list' && (ctx.selected ?? 0) > 0) return { type: 'clearSelection' }
  if (ctx.previewOpen) return { type: 'closePreview' }
  if (ctx.view === 'list' && ctx.query) return { type: 'clearQuery' }
  if (ctx.focus === 'search' || ctx.focus === 'header') return { type: 'blur' }
  if (ctx.view !== 'list') return { type: 'back' }
  return { type: 'close' }
}

export function resolveNavKey(k: NavKey, ctx: NavContext): NavAction {
  if (k.composing) return NONE
  if (ctx.focus === 'editable') return NONE

  if (k.key === 'Escape') return escapeAction(ctx)
  if (k.key === 'Tab') return { type: 'cycleFocus', backwards: k.shift }

  if (ctx.view !== 'list') {
    if (ctx.view === 'emoji' && ctx.focus === 'none' && isPrintable(k) && k.key !== ' ') {
      return { type: 'focusSearch', text: k.key }
    }
    return NONE
  }

  if (ctx.focus === 'header') return NONE

  const hasItems = ctx.count > 0
  const active = hasItems && ctx.active >= 0 && ctx.active < ctx.count ? ctx.active : -1
  const hasSelection = (ctx.selected ?? 0) > 0

  const digit = digitOf(k)
  if (k.meta && !k.ctrl && digit > 0) {
    const index = digit - 1
    return index < ctx.count ? { type: 'paste', index, invert: k.alt || k.shift } : NONE
  }

  const delta = moveDelta(k.key, ctx)
  if (delta !== 0 && k.shift && !k.meta && !k.ctrl && !k.alt) {
    if (!hasItems) return NONE
    if (ctx.focus === 'search' && (k.key === 'ArrowLeft' || k.key === 'ArrowRight')) return NONE
    const from = active < 0 ? 0 : active
    const next = active < 0 ? 0 : clamp(active + delta, ctx.count)
    return { type: 'extend', from, index: next }
  }

  if (delta !== 0 && !k.meta && !k.ctrl) {
    if (!hasItems) return NONE
    const next = active < 0 ? 0 : clamp(active + delta, ctx.count)
    return next === active ? NONE : { type: 'move', index: next }
  }

  if (k.key === 'Enter' && !k.meta && !k.ctrl) {
    if (hasSelection) return { type: 'pasteSelection', invert: k.alt || k.shift }
    if (active < 0) return hasItems && ctx.focus === 'search' ? { type: 'paste', index: 0, invert: k.alt || k.shift } : NONE
    return { type: 'paste', index: active, invert: k.alt || k.shift }
  }

  if (k.meta && !k.ctrl && !k.alt) {
    const lower = k.key.toLowerCase()
    if (lower === 'f') return { type: 'focusSearch', text: '' }
    if (ctx.focus === 'search') return NONE
    if (lower === 'a' && !k.shift) return hasItems ? { type: 'selectAll' } : NONE
    if (hasSelection) {
      if (lower === 'c' && !k.shift) return { type: 'copySelection' }
      if (lower === 'p' && !k.shift) return { type: 'pinSelection' }
      if (k.key === 'Backspace' || k.key === 'Delete') return { type: 'deleteSelection' }
    }
    if (active < 0) return NONE
    if (lower === 'c' && !k.shift) return { type: 'copy', index: active }
    if (lower === 'p' && !k.shift) return { type: 'pin', index: active }
    if (k.key === 'Backspace' || k.key === 'Delete') return { type: 'delete', index: active }
    return NONE
  }

  if (ctx.focus === 'search') return NONE

  if (k.key === ' ' && !k.alt && !k.shift) {
    return active < 0 ? NONE : { type: 'preview', index: active }
  }

  if (isPrintable(k) && k.key !== ' ') return { type: 'focusSearch', text: k.key }

  return NONE
}

export function nextActiveAfterRemoval(order: readonly string[], removedId: string): string | null {
  const index = order.indexOf(removedId)
  if (index < 0) return null
  const rest = order.filter((id) => id !== removedId)
  if (rest.length === 0) return null
  return rest[Math.min(index, rest.length - 1)]
}

type ToggleDecision = 'open' | 'close' | 'keyboard'

export function resolveToggle(forceOpen: boolean | undefined, source: string | undefined, isOpen: boolean, keyboard = true): ToggleDecision {
  const next = forceOpen !== undefined ? forceOpen : !isOpen
  if (!next) return 'close'
  if (keyboard && isOpen && forceOpen === true && source) return 'keyboard'
  return 'open'
}
