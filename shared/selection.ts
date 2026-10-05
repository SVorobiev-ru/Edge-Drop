import type { ItemKind } from './types'

export const SELECTION_LIMIT = 200
const TEXT_JOINER = '\n\n'
const HTML_JOINER = '<br><br>'

export interface Selection {
  ids: string[]
  anchor: string | null
  base: string[]
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null, base: [] }

interface OrderedItem {
  id: string
  pinned: boolean
}

interface KindedItem {
  data: { kind: ItemKind }
}

function union(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set(a)
  const out = [...a]
  for (const id of b) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function span(order: readonly string[], from: string, to: string): string[] | null {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0 || b < 0) return null
  return order.slice(Math.min(a, b), Math.max(a, b) + 1)
}

export function toggleSelection(sel: Selection, id: string): Selection {
  const ids = sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id]
  return { ids, anchor: id, base: ids }
}

export function selectRange(sel: Selection, order: readonly string[], target: string): Selection {
  const anchor = sel.anchor && order.includes(sel.anchor) ? sel.anchor : target
  const base = sel.anchor === anchor ? sel.base : sel.ids
  const range = span(order, anchor, target)
  if (!range) return sel
  return { ids: union(base, range), anchor, base }
}

export function extendSelection(sel: Selection, order: readonly string[], from: string, to: string): Selection {
  if (sel.ids.length === 0 || !sel.anchor || !order.includes(sel.anchor)) {
    const range = span(order, from, to)
    if (!range) return sel
    return { ids: union(sel.ids, range), anchor: from, base: sel.ids }
  }
  return selectRange(sel, order, to)
}

export function selectAll(order: readonly string[]): Selection {
  return { ids: [...order], anchor: order[0] ?? null, base: [] }
}

export function pruneSelection(sel: Selection, existing: ReadonlySet<string>): Selection {
  if (sel.ids.every((id) => existing.has(id)) && (!sel.anchor || existing.has(sel.anchor))) return sel
  const ids = sel.ids.filter((id) => existing.has(id))
  if (ids.length === 0) return EMPTY_SELECTION
  return {
    ids,
    anchor: sel.anchor && existing.has(sel.anchor) ? sel.anchor : null,
    base: sel.base.filter((id) => existing.has(id))
  }
}

export function orderSelection<T extends OrderedItem>(items: readonly T[], ids: readonly string[]): T[] {
  const wanted = new Set(ids)
  const picked = items.filter((it) => wanted.has(it.id))
  return [...picked.filter((it) => it.pinned), ...picked.filter((it) => !it.pinned)]
}

export function allTextLike<T extends KindedItem>(items: readonly T[]): items is readonly (T & { data: { kind: 'text' } })[] {
  return items.length > 0 && items.every((it) => it.data.kind === 'text')
}

export function allStackable(items: readonly KindedItem[]): boolean {
  return items.length > 1 && items.every((it) => it.data.kind !== 'text')
}

export interface TextPart {
  text: string
  html?: string
}

export function joinTextParts(parts: readonly TextPart[], plain: boolean): TextPart {
  const text = parts.map((p) => p.text).join(TEXT_JOINER)
  if (plain || parts.length === 0 || !parts.every((p) => !!p.html)) return { text }
  return { text, html: parts.map((p) => p.html as string).join(HTML_JOINER) }
}
