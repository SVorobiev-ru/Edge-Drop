export interface ListAnchor {
  id: string
  /** Distance from the viewport start to the item start, in px. */
  offset: number
}

export interface ItemSpan {
  id: string
  start: number
  end: number
}

export function pickAnchor(spans: readonly ItemSpan[], viewportStart: number): ListAnchor | null {
  const first = spans.find((s) => s.end > viewportStart + 1)
  return first ? { id: first.id, offset: first.start - viewportStart } : null
}

export function pickFirstVisible(spans: readonly ItemSpan[], viewportStart: number): string | null {
  return (spans.find((s) => s.start >= viewportStart - 1) ?? spans.find((s) => s.end > viewportStart + 1))?.id ?? null
}

export function anchoredScroll(currentScroll: number, itemStart: number, viewportStart: number, anchor: ListAnchor): number {
  return Math.max(0, currentScroll + (itemStart - viewportStart) - anchor.offset)
}

function itemSpans(list: HTMLElement, horizontal: boolean): ItemSpan[] {
  const spans: ItemSpan[] = []
  list.querySelectorAll<HTMLElement>('.item-main[data-id]').forEach((el) => {
    const id = el.dataset.id
    if (!id) return
    const r = el.getBoundingClientRect()
    spans.push(horizontal ? { id, start: r.left, end: r.right } : { id, start: r.top, end: r.bottom })
  })
  return spans
}

export function captureListAnchor(list: HTMLElement | null, horizontal: boolean): ListAnchor | null {
  if (!list || list.clientHeight === 0) return null
  const box = list.getBoundingClientRect()
  return pickAnchor(itemSpans(list, horizontal), horizontal ? box.left : box.top)
}

export function firstVisibleItemId(list: HTMLElement | null, horizontal: boolean): string | null {
  if (!list || list.clientHeight === 0) return null
  const box = list.getBoundingClientRect()
  return pickFirstVisible(itemSpans(list, horizontal), horizontal ? box.left : box.top)
}

export function restoreListAnchor(list: HTMLElement | null, horizontal: boolean, anchor: ListAnchor | null | undefined): boolean {
  if (!list || !anchor || list.clientHeight === 0) return false
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(anchor.id) : anchor.id
  const el = list.querySelector<HTMLElement>(`.item-main[data-id="${escaped}"]`)
  if (!el) return false
  const box = list.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  if (horizontal) list.scrollLeft = anchoredScroll(list.scrollLeft, r.left, box.left, anchor)
  else list.scrollTop = anchoredScroll(list.scrollTop, r.top, box.top, anchor)
  return true
}
