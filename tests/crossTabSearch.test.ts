import { describe, expect, it } from 'vitest'
import { groupedCount, groupItems } from '../src/hooks/useFilteredItems'
import type { ClipboardItemDto } from '../shared/types'

let seq = 0
function text(value: string, opts: { pinned?: boolean; url?: boolean } = {}): ClipboardItemDto {
  return {
    id: `t${++seq}`,
    data: { kind: 'text', text: value, isUrl: !!opts.url },
    capturedAt: 1_700_000_000_000 - seq,
    hitCount: 1,
    pinned: !!opts.pinned
  }
}

function files(path: string): ClipboardItemDto {
  return { id: `f${++seq}`, data: { kind: 'files', paths: [path] }, capturedAt: 1_700_000_000_000 - seq, hitCount: 1, pinned: false }
}

const note = text('invoice number 42')
const pinnedNote = text('pinned invoice template', { pinned: true })
const link = text('https://example.com/invoice', { url: true })
const pinnedLink = text('https://example.com/invoice/pinned', { pinned: true, url: true })
const pdf = files('/Users/me/Documents/Invoice-March.pdf')
const unrelated = text('shopping list')
const items = [note, link, pdf, unrelated, pinnedNote, pinnedLink]
const ids = (list: ClipboardItemDto[]) => list.map((it) => it.id)

describe('search across tabs', () => {
  it('ranks the active tab first, then the other tabs, pinned first in each group', () => {
    const g = groupItems(items, 'invoice', 'links', { rich: true, acrossTabs: true })
    expect(ids(g.pinned)).toEqual([pinnedLink.id])
    expect(ids(g.recent)).toEqual([link.id])
    expect(ids(g.others)).toEqual([pinnedNote.id, note.id, pdf.id])
  })

  it('finds everything in the active group on the All tab', () => {
    const g = groupItems(items, 'invoice', 'all', { rich: true, acrossTabs: true })
    expect(ids(g.pinned)).toEqual([pinnedNote.id, pinnedLink.id])
    expect(ids(g.recent)).toEqual([note.id, link.id, pdf.id])
    expect(g.others).toEqual([])
  })

  it('lists other tabs even when the active tab has no match', () => {
    const g = groupItems(items, 'march', 'text', { rich: true, acrossTabs: true })
    expect(g.pinned).toEqual([])
    expect(g.recent).toEqual([])
    expect(ids(g.others)).toEqual([pdf.id])
  })

  it('keeps the tab filter alone without a query', () => {
    const g = groupItems(items, '   ', 'links', { rich: true, acrossTabs: true })
    expect(ids(g.recent)).toEqual([link.id])
    expect(ids(g.pinned)).toEqual([pinnedLink.id])
    expect(g.others).toEqual([])
  })

  it('keeps the upstream single-tab search when cross-tab search is off', () => {
    const g = groupItems(items, 'invoice', 'links', { rich: false, acrossTabs: false })
    expect(ids(g.recent)).toEqual([link.id])
    expect(g.others).toEqual([])
  })

  it('counts the hits from other tabs in the header total', () => {
    const g = groupItems(items, 'invoice', 'links', { rich: true, acrossTabs: true })
    expect(g.others.length).toBeGreaterThan(0)
    expect(groupedCount(g)).toBe(g.pinned.length + g.recent.length + g.others.length)
    expect(groupedCount(groupItems(items, 'invoice', 'links', { rich: false, acrossTabs: false }))).toBe(2)
  })
})
