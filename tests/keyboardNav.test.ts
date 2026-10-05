import { describe, expect, it } from 'vitest'
import { nextActiveAfterRemoval, resolveNavKey, type NavContext, type NavKey } from '../src/lib/keyboardNav'

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

const key = (k: string, mods: Partial<NavKey> = {}): NavKey => ({
  key: k,
  meta: false,
  ctrl: false,
  alt: false,
  shift: false,
  ...mods
})

describe('arrow movement', () => {
  it('moves down and up within bounds', () => {
    expect(resolveNavKey(key('ArrowDown'), ctx())).toEqual({ type: 'move', index: 2 })
    expect(resolveNavKey(key('ArrowUp'), ctx())).toEqual({ type: 'move', index: 0 })
    expect(resolveNavKey(key('ArrowUp'), ctx({ active: 0 }))).toEqual({ type: 'none' })
    expect(resolveNavKey(key('ArrowDown'), ctx({ active: 4 }))).toEqual({ type: 'none' })
  })

  it('starts at the first item when nothing is active', () => {
    expect(resolveNavKey(key('ArrowDown'), ctx({ active: -1 }))).toEqual({ type: 'move', index: 0 })
    expect(resolveNavKey(key('ArrowUp'), ctx({ active: -1 }))).toEqual({ type: 'move', index: 0 })
  })

  it('uses left and right only in the horizontal dock, mirrored for RTL', () => {
    expect(resolveNavKey(key('ArrowRight'), ctx())).toEqual({ type: 'none' })
    expect(resolveNavKey(key('ArrowRight'), ctx({ horizontal: true }))).toEqual({ type: 'move', index: 2 })
    expect(resolveNavKey(key('ArrowLeft'), ctx({ horizontal: true }))).toEqual({ type: 'move', index: 0 })
    expect(resolveNavKey(key('ArrowLeft'), ctx({ horizontal: true, rtl: true }))).toEqual({ type: 'move', index: 2 })
  })

  it('does nothing on an empty list', () => {
    expect(resolveNavKey(key('ArrowDown'), ctx({ count: 0, active: -1 }))).toEqual({ type: 'none' })
    expect(resolveNavKey(key('Enter'), ctx({ count: 0, active: -1 }))).toEqual({ type: 'none' })
  })
})

describe('paste and item commands', () => {
  it('pastes the active item with Return, inverted with Option or Shift', () => {
    expect(resolveNavKey(key('Enter'), ctx())).toEqual({ type: 'paste', index: 1, invert: false })
    expect(resolveNavKey(key('Enter', { alt: true }), ctx())).toEqual({ type: 'paste', index: 1, invert: true })
    expect(resolveNavKey(key('Enter', { shift: true }), ctx())).toEqual({ type: 'paste', index: 1, invert: true })
  })

  it('pastes the n-th visible item with Command+digit', () => {
    expect(resolveNavKey(key('1', { meta: true }), ctx())).toEqual({ type: 'paste', index: 0, invert: false })
    expect(resolveNavKey(key('5', { meta: true }), ctx())).toEqual({ type: 'paste', index: 4, invert: false })
    expect(resolveNavKey(key('6', { meta: true }), ctx())).toEqual({ type: 'none' })
    expect(resolveNavKey(key('2', { meta: true }), ctx({ focus: 'search' }))).toEqual({ type: 'paste', index: 1, invert: false })
  })

  it('reads the digit from the physical key', () => {
    expect(resolveNavKey(key('¡', { meta: true, alt: true, code: 'Digit1' }), ctx())).toEqual({ type: 'paste', index: 0, invert: true })
    expect(resolveNavKey(key('@', { meta: true, shift: true, code: 'Digit2' }), ctx())).toEqual({ type: 'paste', index: 1, invert: true })
    expect(resolveNavKey(key('&', { meta: true, code: 'Digit1' }), ctx())).toEqual({ type: 'paste', index: 0, invert: false })
    expect(resolveNavKey(key('1', { meta: true, code: 'Numpad1' }), ctx())).toEqual({ type: 'none' })
    expect(resolveNavKey(key('1', { meta: true, code: 'KeyQ' }), ctx())).toEqual({ type: 'none' })
  })

  it('maps copy, delete, pin and preview to the active item', () => {
    expect(resolveNavKey(key('c', { meta: true }), ctx())).toEqual({ type: 'copy', index: 1 })
    expect(resolveNavKey(key('Backspace', { meta: true }), ctx())).toEqual({ type: 'delete', index: 1 })
    expect(resolveNavKey(key('p', { meta: true }), ctx())).toEqual({ type: 'pin', index: 1 })
    expect(resolveNavKey(key(' '), ctx())).toEqual({ type: 'preview', index: 1 })
  })

  it('leaves text editing shortcuts to the search field', () => {
    expect(resolveNavKey(key('c', { meta: true }), ctx({ focus: 'search' }))).toEqual({ type: 'none' })
    expect(resolveNavKey(key('Backspace', { meta: true }), ctx({ focus: 'search' }))).toEqual({ type: 'none' })
    expect(resolveNavKey(key(' '), ctx({ focus: 'search' }))).toEqual({ type: 'none' })
    expect(resolveNavKey(key('a'), ctx({ focus: 'search' }))).toEqual({ type: 'none' })
  })

  it('still moves and pastes while typing in search', () => {
    expect(resolveNavKey(key('ArrowDown'), ctx({ focus: 'search' }))).toEqual({ type: 'move', index: 2 })
    expect(resolveNavKey(key('Enter'), ctx({ focus: 'search', active: -1 }))).toEqual({ type: 'paste', index: 0, invert: false })
  })

  it('ignores everything inside other editable fields and during IME composition', () => {
    expect(resolveNavKey(key('Escape'), ctx({ focus: 'editable' }))).toEqual({ type: 'none' })
    expect(resolveNavKey(key('Enter', { composing: true }), ctx())).toEqual({ type: 'none' })
  })
})

describe('search entry', () => {
  it('focuses search with Command+F', () => {
    expect(resolveNavKey(key('f', { meta: true }), ctx())).toEqual({ type: 'focusSearch', text: '' })
  })

  it('sends a printable character into the search field', () => {
    expect(resolveNavKey(key('a'), ctx())).toEqual({ type: 'focusSearch', text: 'a' })
    expect(resolveNavKey(key('Я'), ctx())).toEqual({ type: 'focusSearch', text: 'Я' })
  })

  it('routes typing to the emoji search in the emoji view', () => {
    expect(resolveNavKey(key('s'), ctx({ view: 'emoji' }))).toEqual({ type: 'focusSearch', text: 's' })
    expect(resolveNavKey(key('ArrowDown'), ctx({ view: 'emoji' }))).toEqual({ type: 'none' })
  })
})

describe('staged Escape', () => {
  it('closes the preview first', () => {
    expect(resolveNavKey(key('Escape'), ctx({ previewOpen: true, query: 'x' }))).toEqual({ type: 'closePreview' })
  })

  it('clears the query, then leaves the field, then closes the panel', () => {
    expect(resolveNavKey(key('Escape'), ctx({ focus: 'search', query: 'abc' }))).toEqual({ type: 'clearQuery' })
    expect(resolveNavKey(key('Escape'), ctx({ focus: 'search' }))).toEqual({ type: 'blur' })
    expect(resolveNavKey(key('Escape'), ctx())).toEqual({ type: 'close' })
  })

  it('goes back to the list from settings or emoji', () => {
    expect(resolveNavKey(key('Escape'), ctx({ view: 'settings' }))).toEqual({ type: 'back' })
    expect(resolveNavKey(key('Escape'), ctx({ view: 'emoji' }))).toEqual({ type: 'back' })
  })
})

describe('Tab and header focus', () => {
  it('cycles header controls in both directions', () => {
    expect(resolveNavKey(key('Tab'), ctx())).toEqual({ type: 'cycleFocus', backwards: false })
    expect(resolveNavKey(key('Tab', { shift: true }), ctx())).toEqual({ type: 'cycleFocus', backwards: true })
  })

  it('leaves arrows to a focused header control', () => {
    expect(resolveNavKey(key('ArrowDown'), ctx({ focus: 'header' }))).toEqual({ type: 'none' })
    expect(resolveNavKey(key('Escape'), ctx({ focus: 'header' }))).toEqual({ type: 'blur' })
  })
})

describe('active item after deletion', () => {
  it('moves to the next item, or the previous one at the end', () => {
    expect(nextActiveAfterRemoval(['a', 'b', 'c'], 'b')).toBe('c')
    expect(nextActiveAfterRemoval(['a', 'b', 'c'], 'c')).toBe('b')
    expect(nextActiveAfterRemoval(['a'], 'a')).toBeNull()
    expect(nextActiveAfterRemoval(['a'], 'z')).toBeNull()
  })
})
