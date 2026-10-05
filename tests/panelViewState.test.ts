import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../src/store/appStore'
import { resetViewAfterClose } from '../src/lib/shelf'
import { anchoredScroll, pickAnchor, pickFirstVisible } from '../src/lib/listAnchor'
import { DEFAULT_SETTINGS } from '../shared/types'

const g = globalThis as { window?: unknown }
const originalWindow = g.window

beforeEach(() => {
  g.window = { edge: { setPreviewMode: vi.fn() } }
  useStore.setState({
    open: false,
    settings: { ...DEFAULT_SETTINGS },
    settingsOpen: true,
    settingsTab: 'appearance',
    query: 'invoice',
    emojiOpen: false,
    typeFilter: 'links'
  })
})

afterEach(() => {
  g.window = originalWindow
})

describe('view after the panel retracts', () => {
  it('keeps Settings, its tab, the search and the tab on macOS', () => {
    resetViewAfterClose(true)
    const s = useStore.getState()
    expect(s.settingsOpen).toBe(true)
    expect(s.settingsTab).toBe('appearance')
    expect(s.query).toBe('invoice')
    expect(s.typeFilter).toBe('links')
  })

  it('resets Settings, search and emoji on Windows, keeping the tab', () => {
    useStore.setState({ settingsOpen: false, emojiOpen: true })
    resetViewAfterClose(false)
    const s = useStore.getState()
    expect(s.settingsOpen).toBe(false)
    expect(s.emojiOpen).toBe(false)
    expect(s.query).toBe('')
    expect(s.typeFilter).toBe('links')
  })

  it('does nothing when the panel was reopened before the reset ran', () => {
    useStore.setState({ open: true })
    resetViewAfterClose(false)
    expect(useStore.getState().settingsOpen).toBe(true)
    expect(useStore.getState().query).toBe('invoice')
  })
})

describe('list anchor', () => {
  const spans = [
    { id: 'a', start: -180, end: -100 },
    { id: 'b', start: -92, end: -20 },
    { id: 'c', start: -12, end: 60 },
    { id: 'd', start: 68, end: 140 }
  ]

  it('anchors on the first item that is at least partly in view', () => {
    expect(pickAnchor(spans, 0)).toEqual({ id: 'c', offset: -12 })
    expect(pickAnchor(spans.slice(2), 0)).toEqual({ id: 'c', offset: -12 })
    expect(pickAnchor([], 0)).toBeNull()
  })

  it('ignores an item that only touches the top edge', () => {
    expect(pickAnchor([{ id: 'x', start: -40, end: 1 }, { id: 'y', start: 9, end: 50 }], 0)).toEqual({ id: 'y', offset: 9 })
  })

  it('starts keyboard navigation at the first fully visible item', () => {
    expect(pickFirstVisible(spans, 0)).toBe('d')
    expect(pickFirstVisible(spans, -92)).toBe('b')
    expect(pickFirstVisible([{ id: 'tall', start: -300, end: 400 }], 0)).toBe('tall')
    expect(pickFirstVisible([], 0)).toBeNull()
  })

  it('keeps the anchored item in place when items are added above it', () => {
    const anchor = { id: 'c', offset: 12 }
    // Two 80px cards arrived above: the item moved down by 160px at scrollTop 0.
    expect(anchoredScroll(0, 100 + 172, 100, anchor)).toBe(160)
    // Already scrolled: the shift is added to the current offset.
    expect(anchoredScroll(300, 100 + 172, 100, anchor)).toBe(460)
  })

  it('leaves the scroll alone when nothing moved and never goes negative', () => {
    expect(anchoredScroll(240, 112, 100, { id: 'c', offset: 12 })).toBe(240)
    expect(anchoredScroll(0, 100, 100, { id: 'c', offset: 12 })).toBe(0)
  })
})
