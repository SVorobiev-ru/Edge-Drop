import { describe, expect, it } from 'vitest'
import { itemMatchesQuery } from '../src/hooks/useFilteredItems'
import { itemAccessibleLabel } from '../src/lib/itemLabel'
import type { ClipboardItemDto } from '../shared/types'

function dto(data: ClipboardItemDto['data'], pinned = false): ClipboardItemDto {
  return { id: 'x', data, capturedAt: Date.UTC(2026, 0, 15, 12), hitCount: 1, pinned }
}

const image = (extra: Partial<{ fileName: string; source: 'screenshot' | 'image' }>) =>
  dto({ kind: 'image', imageId: 'a1', width: 10, height: 10, bytes: 100, preview: 'data:image/png;base64,xx', ...extra })

describe('search matches images', () => {
  it('finds an image by its original file name', () => {
    const item = image({ fileName: 'Invoice-March.PNG', source: 'image' })
    expect(itemMatchesQuery(item, 'invoice')).toBe(true)
    expect(itemMatchesQuery(item, 'march.png')).toBe(true)
    expect(itemMatchesQuery(item, 'receipt')).toBe(false)
  })

  it('finds an unnamed image by its display name', () => {
    expect(itemMatchesQuery(image({ source: 'screenshot' }), 'screenshot')).toBe(true)
    expect(itemMatchesQuery(image({ source: 'image' }), 'image')).toBe(true)
    expect(itemMatchesQuery(image({ source: 'image' }), 'screenshot')).toBe(false)
  })

  it('finds a collection when any image matches', () => {
    const collection = dto({
      kind: 'image-collection',
      images: [
        { imageId: 'a', width: 1, height: 1, bytes: 1, preview: 'p', fileName: 'cat.jpg' },
        { imageId: 'b', width: 1, height: 1, bytes: 1, preview: 'p', fileName: 'dog.jpg' }
      ]
    })
    expect(itemMatchesQuery(collection, 'dog')).toBe(true)
    expect(itemMatchesQuery(collection, 'bird')).toBe(false)
  })

  it('finds image files by file name and by display name', () => {
    const named = dto({ kind: 'files', paths: ['/Users/me/Pictures/Sunset.heic'] })
    expect(itemMatchesQuery(named, 'sunset')).toBe(true)
    const internal = dto({ kind: 'files', paths: ['/Users/me/Library/edge-drop/images/ab12cd34-ef56ab78.png'] })
    expect(itemMatchesQuery(internal, 'screenshot')).toBe(true)
    expect(itemMatchesQuery(internal, 'ab12cd34')).toBe(true)
  })

  it('keeps text and file matching, and matches pinned items the same way', () => {
    expect(itemMatchesQuery(dto({ kind: 'text', text: 'Hello World', isUrl: false }), 'world')).toBe(true)
    expect(itemMatchesQuery(dto({ kind: 'files', paths: ['C:\\docs\\Report.pdf'] }), 'report')).toBe(true)
    expect(itemMatchesQuery(dto({ kind: 'files', paths: ['C:\\docs\\Report.pdf'] }), 'docs')).toBe(false)
    expect(itemMatchesQuery(dto({ kind: 'text', text: 'pinned note', isUrl: false }, true), 'note')).toBe(true)
    expect(itemMatchesQuery(image({}), '')).toBe(true)
  })
})

describe('card accessible label', () => {
  it('describes each kind of item', () => {
    expect(itemAccessibleLabel(dto({ kind: 'text', text: '  Hello\n world ', isUrl: false }))).toBe('Hello world')
    expect(itemAccessibleLabel(image({ fileName: 'Holiday.png' }))).toBe('Holiday.png')
    expect(itemAccessibleLabel(dto({ kind: 'files', paths: ['/tmp/a.pdf', '/tmp/b.pdf'] }))).toBe('2 files')
    expect(itemAccessibleLabel(dto({ kind: 'files', paths: ['/tmp/notes.txt'] }))).toBe('notes.txt')
    expect(
      itemAccessibleLabel(dto({ kind: 'image-collection', images: [{ imageId: 'a', width: 1, height: 1, bytes: 1, preview: 'p' }] }))
    ).toBe('1 images')
  })

  it('truncates long text', () => {
    const label = itemAccessibleLabel(dto({ kind: 'text', text: 'x'.repeat(500), isUrl: false }))
    expect(label.length).toBe(80)
  })
})

describe('search on Windows', () => {
  it('keeps the upstream rule: text and file names only, images hidden', () => {
    expect(itemMatchesQuery(image({ fileName: 'Invoice.png' }), 'invoice', false)).toBe(false)
    expect(itemMatchesQuery(dto({ kind: 'image-collection', images: [] } as any), 'x', false)).toBe(false)
    expect(itemMatchesQuery(dto({ kind: 'text', text: 'Hello World', isUrl: false }), 'world', false)).toBe(true)
    expect(itemMatchesQuery(dto({ kind: 'files', paths: ['C:\\docs\\Report.pdf'] }), 'report', false)).toBe(true)
    expect(itemMatchesQuery({ ...dto({ kind: 'text', text: 'body', isUrl: false }), title: 'Invoice' }, 'invoice', false)).toBe(false)
    expect(itemMatchesQuery(image({}), '', false)).toBe(true)
  })
})
