import { describe, expect, it } from 'vitest'
import { itemMatchesQuery, itemMatchesTypeFilter } from '../src/hooks/useFilteredItems'
import { loadLanguage, t } from '../src/i18n'
import { useStore } from '../src/store/appStore'
import type { ClipboardItemDto } from '../shared/types'

function dto(extra: Partial<ClipboardItemDto>, data?: ClipboardItemDto['data']): ClipboardItemDto {
  return {
    id: 'x',
    data: data ?? { kind: 'text', text: 'plain body', isUrl: false },
    capturedAt: Date.UTC(2026, 0, 15, 12),
    hitCount: 1,
    pinned: false,
    ...extra
  }
}

const screenshot: ClipboardItemDto['data'] = {
  kind: 'image',
  imageId: 'a1',
  width: 10,
  height: 10,
  bytes: 100,
  preview: 'data:,',
  source: 'screenshot'
}

describe('search and filter cache', () => {
  it('answers repeated and different queries on the same item object consistently', () => {
    const item = dto({ title: 'Invoice Template' }, { kind: 'files', paths: ['/Users/me/Report.PDF', '/Users/me/photo.png'] })
    for (let i = 0; i < 2; i++) {
      expect(itemMatchesQuery(item, 'invoice')).toBe(true)
      expect(itemMatchesQuery(item, 'report')).toBe(true)
      expect(itemMatchesQuery(item, 'missing')).toBe(false)
      expect(itemMatchesQuery(item, 'invoice', false)).toBe(false)
      expect(itemMatchesQuery(item, 'PHOTO', false)).toBe(true)
      expect(itemMatchesTypeFilter(item, 'files')).toBe(true)
      expect(itemMatchesTypeFilter(item, 'images')).toBe(false)
    }
  })

  it('sees a rename, an edit and a merge once the item object is replaced', () => {
    const item = dto({ title: 'Old name' })
    expect(itemMatchesQuery(item, 'old name')).toBe(true)
    const renamed = { ...item, title: 'Fresh name' }
    expect(itemMatchesQuery(renamed, 'old name')).toBe(false)
    expect(itemMatchesQuery(renamed, 'fresh')).toBe(true)

    const note = dto({}, { kind: 'text', text: 'hello', isUrl: false })
    expect(itemMatchesTypeFilter(note, 'text')).toBe(true)
    expect(itemMatchesTypeFilter(note, 'colors')).toBe(false)
    const edited = { ...note, data: { kind: 'text' as const, text: '#ff8800', isUrl: false } }
    expect(itemMatchesTypeFilter(edited, 'text')).toBe(false)
    expect(itemMatchesTypeFilter(edited, 'colors')).toBe(true)
    expect(itemMatchesQuery(edited, 'hello')).toBe(false)

    const photos = dto({}, { kind: 'files', paths: ['a.png'] })
    expect(itemMatchesTypeFilter(photos, 'images')).toBe(true)
    const merged = { ...photos, data: { kind: 'files' as const, paths: ['a.png', 'doc.pdf'] } }
    expect(itemMatchesTypeFilter(merged, 'images')).toBe(false)
    expect(itemMatchesTypeFilter(merged, 'files')).toBe(true)
    expect(itemMatchesQuery(merged, 'doc.pdf')).toBe(true)
  })

  it('searches text longer than the cached limit', () => {
    const item = dto({}, { kind: 'text', text: `${'a'.repeat(150_000)} Needle`, isUrl: false })
    for (const rich of [true, false]) {
      expect(itemMatchesQuery(item, 'needle', rich)).toBe(true)
      expect(itemMatchesQuery(item, 'needle', rich)).toBe(true)
      expect(itemMatchesQuery(item, 'thread', rich)).toBe(false)
    }
  })

  it('follows the language for generated image names on the same item object', async () => {
    const item = dto({}, screenshot)
    useStore.setState((s) => ({ settings: { ...s.settings, language: 'en' } }))
    const english = t('item.screenshot')
    expect(itemMatchesQuery(item, english)).toBe(true)

    useStore.setState((s) => ({ settings: { ...s.settings, language: 'ru' } }))
    expect(itemMatchesQuery(item, english)).toBe(true)
    await loadLanguage('ru')
    const russian = t('item.screenshot')
    expect(russian).not.toBe(english)
    expect(itemMatchesQuery(item, russian)).toBe(true)
    expect(itemMatchesQuery(item, english)).toBe(false)

    useStore.setState((s) => ({ settings: { ...s.settings, language: 'en' } }))
    expect(itemMatchesQuery(item, english)).toBe(true)
    expect(itemMatchesQuery(item, russian)).toBe(false)
  })
})
