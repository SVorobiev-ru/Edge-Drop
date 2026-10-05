import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION,
  allStackable,
  allTextLike,
  extendSelection,
  joinTextParts,
  orderSelection,
  pruneSelection,
  selectAll,
  selectRange,
  toggleSelection,
  type Selection
} from '../shared/selection'
import { resolveNavKey, resolveToggle, type NavContext, type NavKey } from '../src/lib/keyboardNav'
import { itemMatchesQuery, itemMatchesTypeFilter } from '../src/hooks/useFilteredItems'
import type { ClipboardItemDto } from '../shared/types'

const ORDER = ['a', 'b', 'c', 'd', 'e']

function sel(ids: string[], anchor: string | null = ids[ids.length - 1] ?? null): Selection {
  return { ids, anchor, base: ids }
}

describe('toggle', () => {
  it('adds and removes an item and moves the anchor', () => {
    const one = toggleSelection(EMPTY_SELECTION, 'b')
    expect(one).toEqual({ ids: ['b'], anchor: 'b', base: ['b'] })
    const two = toggleSelection(one, 'd')
    expect(two.ids).toEqual(['b', 'd'])
    expect(two.anchor).toBe('d')
    const back = toggleSelection(two, 'b')
    expect(back.ids).toEqual(['d'])
    expect(back.anchor).toBe('b')
  })
})

describe('range', () => {
  it('selects from the anchor to the clicked item in either direction', () => {
    expect(selectRange(sel(['b']), ORDER, 'd').ids).toEqual(['b', 'c', 'd'])
    expect(selectRange(sel(['d']), ORDER, 'a').ids).toEqual(['d', 'a', 'b', 'c'])
  })

  it('keeps items toggled before the anchor was set and re-ranges from the same anchor', () => {
    const start = toggleSelection(toggleSelection(EMPTY_SELECTION, 'e'), 'b')
    const first = selectRange(start, ORDER, 'd')
    expect(new Set(first.ids)).toEqual(new Set(['e', 'b', 'c', 'd']))
    const shrink = selectRange(first, ORDER, 'c')
    expect(new Set(shrink.ids)).toEqual(new Set(['e', 'b', 'c']))
  })

  it('starts at the clicked item when there is no usable anchor', () => {
    expect(selectRange(EMPTY_SELECTION, ORDER, 'c').ids).toEqual(['c'])
    expect(selectRange(sel(['zz'], 'zz'), ORDER, 'c').ids).toEqual(['zz', 'c'])
  })

  it('ignores a target outside the visible order', () => {
    const s = sel(['a'])
    expect(selectRange(s, ORDER, 'zz')).toBe(s)
  })
})

describe('keyboard extend', () => {
  it('grows from the active item and shrinks back', () => {
    const one = extendSelection(EMPTY_SELECTION, ORDER, 'b', 'c')
    expect(one.ids).toEqual(['b', 'c'])
    const two = extendSelection(one, ORDER, 'c', 'd')
    expect(two.ids).toEqual(['b', 'c', 'd'])
    const back = extendSelection(two, ORDER, 'd', 'c')
    expect(back.ids).toEqual(['b', 'c'])
  })
})

describe('select all', () => {
  it('selects exactly the visible order, which already respects search and type filter', () => {
    const items = [
      { id: 'a', pinned: false, capturedAt: 1, hitCount: 1, data: { kind: 'text', text: 'apple', isUrl: false } },
      { id: 'b', pinned: false, capturedAt: 1, hitCount: 1, data: { kind: 'text', text: 'https://apple.com', isUrl: true } },
      { id: 'c', pinned: false, capturedAt: 1, hitCount: 1, data: { kind: 'text', text: 'banana', isUrl: false } }
    ] as ClipboardItemDto[]
    const visible = items.filter((it) => itemMatchesQuery(it, 'apple') && itemMatchesTypeFilter(it, 'text')).map((it) => it.id)
    expect(selectAll(visible).ids).toEqual(['a'])
    expect(selectAll([]).ids).toEqual([])
  })
})

describe('pruning', () => {
  it('drops ids that left the history and keeps the same object when nothing changed', () => {
    const s = { ids: ['a', 'b', 'c'], anchor: 'b', base: ['a', 'b'] }
    expect(pruneSelection(s, new Set(ORDER))).toBe(s)
    expect(pruneSelection(s, new Set(['a', 'c']))).toEqual({ ids: ['a', 'c'], anchor: null, base: ['a'] })
    expect(pruneSelection(s, new Set(['x']))).toBe(EMPTY_SELECTION)
  })
})

describe('visual order and kinds', () => {
  const items = [
    { id: 'r1', pinned: false, data: { kind: 'image' as const } },
    { id: 'p1', pinned: true, data: { kind: 'files' as const } },
    { id: 'r2', pinned: false, data: { kind: 'text' as const } },
    { id: 'p2', pinned: true, data: { kind: 'text' as const } }
  ]

  it('orders pinned first, then recent, each in history order', () => {
    expect(orderSelection(items, ['r2', 'p2', 'r1', 'p1']).map((it) => it.id)).toEqual(['p1', 'p2', 'r1', 'r2'])
  })

  it('classifies text-only and stackable selections', () => {
    expect(allTextLike([items[2], items[3]])).toBe(true)
    expect(allTextLike([items[0], items[2]])).toBe(false)
    expect(allTextLike([])).toBe(false)
    expect(allStackable([items[0], items[1]])).toBe(true)
    expect(allStackable([items[0]])).toBe(false)
    expect(allStackable([items[0], items[2]])).toBe(false)
  })
})

describe('text join', () => {
  it('joins with a blank line and keeps html only when all parts have it', () => {
    expect(joinTextParts([{ text: 'a', html: '<b>a</b>' }, { text: 'b', html: '<i>b</i>' }], false)).toEqual({ text: 'a\n\nb', html: '<b>a</b><br><br><i>b</i>' })
    expect(joinTextParts([{ text: 'a', html: '<b>a</b>' }, { text: 'b' }], false)).toEqual({ text: 'a\n\nb' })
    expect(joinTextParts([{ text: 'a', html: '<b>a</b>' }, { text: 'b', html: '<i>b</i>' }], true)).toEqual({ text: 'a\n\nb' })
  })
})

const ctx = (over: Partial<NavContext> = {}): NavContext => ({
  view: 'list',
  focus: 'none',
  count: 5,
  active: 1,
  horizontal: false,
  rtl: false,
  query: '',
  previewOpen: false,
  ...over
})

const key = (k: string, mods: Partial<NavKey> = {}): NavKey => ({ key: k, meta: false, ctrl: false, alt: false, shift: false, ...mods })

describe('selection keys', () => {
  it('Escape clears the selection before every other stage', () => {
    expect(resolveNavKey(key('Escape'), ctx({ selected: 2, previewOpen: true, query: 'x', focus: 'search' }))).toEqual({ type: 'clearSelection' })
    expect(resolveNavKey(key('Escape'), ctx({ selected: 0, previewOpen: true }))).toEqual({ type: 'closePreview' })
    expect(resolveNavKey(key('Escape'), ctx())).toEqual({ type: 'close' })
  })

  it('shift+arrows extend, plain arrows still move', () => {
    expect(resolveNavKey(key('ArrowDown', { shift: true }), ctx())).toEqual({ type: 'extend', from: 1, index: 2 })
    expect(resolveNavKey(key('ArrowUp', { shift: true }), ctx({ active: -1 }))).toEqual({ type: 'extend', from: 0, index: 0 })
    expect(resolveNavKey(key('ArrowDown'), ctx())).toEqual({ type: 'move', index: 2 })
  })

  it('uses shift+left/right only in the top dock', () => {
    expect(resolveNavKey(key('ArrowRight', { shift: true }), ctx())).toEqual({ type: 'none' })
    expect(resolveNavKey(key('ArrowRight', { shift: true }), ctx({ horizontal: true }))).toEqual({ type: 'extend', from: 1, index: 2 })
    expect(resolveNavKey(key('ArrowRight', { shift: true }), ctx({ horizontal: true, focus: 'search' }))).toEqual({ type: 'none' })
  })

  it('cmd+A selects all visible items, but not inside the search field', () => {
    expect(resolveNavKey(key('a', { meta: true }), ctx())).toEqual({ type: 'selectAll' })
    expect(resolveNavKey(key('a', { meta: true }), ctx({ focus: 'search' }))).toEqual({ type: 'none' })
    expect(resolveNavKey(key('a', { meta: true }), ctx({ count: 0, active: -1 }))).toEqual({ type: 'none' })
  })

  it('Return, cmd+C, cmd+Backspace and cmd+P act on the selection when there is one', () => {
    const s = ctx({ selected: 3 })
    expect(resolveNavKey(key('Enter'), s)).toEqual({ type: 'pasteSelection', invert: false })
    expect(resolveNavKey(key('Enter', { alt: true }), s)).toEqual({ type: 'pasteSelection', invert: true })
    expect(resolveNavKey(key('c', { meta: true }), s)).toEqual({ type: 'copySelection' })
    expect(resolveNavKey(key('Backspace', { meta: true }), s)).toEqual({ type: 'deleteSelection' })
    expect(resolveNavKey(key('p', { meta: true }), s)).toEqual({ type: 'pinSelection' })
    expect(resolveNavKey(key('Enter'), ctx())).toEqual({ type: 'paste', index: 1, invert: false })
    expect(resolveNavKey(key('c', { meta: true }), ctx())).toEqual({ type: 'copy', index: 1 })
  })
})

describe('explicit open while the panel is open', () => {
  it('enters keyboard mode instead of toggling', () => {
    expect(resolveToggle(true, 'menu', true)).toBe('keyboard')
    expect(resolveToggle(true, 'hotkey', true)).toBe('keyboard')
  })

  it('keeps the regular behaviour otherwise', () => {
    expect(resolveToggle(true, 'menu', false)).toBe('open')
    expect(resolveToggle(true, undefined, true)).toBe('open')
    expect(resolveToggle(undefined, 'hotkey', true)).toBe('close')
    expect(resolveToggle(undefined, 'hotkey', false)).toBe('open')
    expect(resolveToggle(false, 'menu', true)).toBe('close')
  })

  it('always opens on Windows', () => {
    expect(resolveToggle(true, 'menu', true, false)).toBe('open')
    expect(resolveToggle(true, 'hotkey', true, false)).toBe('open')
    expect(resolveToggle(undefined, 'hotkey', true, false)).toBe('close')
  })
})
