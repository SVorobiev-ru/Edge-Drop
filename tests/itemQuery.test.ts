import { describe, expect, it } from 'vitest'
import { itemMatchesQuery } from '../src/hooks/useFilteredItems'
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

describe('search covers item metadata', () => {
  it('matches the user title case-insensitively', () => {
    const item = dto({ title: 'Invoice Template' })
    expect(itemMatchesQuery(item, 'invoice')).toBe(true)
    expect(itemMatchesQuery(item, 'TEMPLATE')).toBe(true)
  })

  it('matches recognized text of an image', () => {
    const item = dto({ ocrText: 'Total due: 42 EUR' }, screenshot)
    expect(itemMatchesQuery(item, 'total due')).toBe(true)
    expect(itemMatchesQuery(item, 'usd')).toBe(false)
  })

  it('matches the source app name but not its bundle id', () => {
    const item = dto({ sourceApp: { bundleId: 'com.apple.Safari', name: 'Safari' } })
    expect(itemMatchesQuery(item, 'safari')).toBe(true)
    expect(itemMatchesQuery(item, 'com.apple')).toBe(false)
  })

  it('still matches content when metadata is absent', () => {
    expect(itemMatchesQuery(dto({}), 'body')).toBe(true)
    expect(itemMatchesQuery(dto({}), 'nothing')).toBe(false)
  })
})
