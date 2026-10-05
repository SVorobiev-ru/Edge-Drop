import { describe, expect, it, vi } from 'vitest'
import type { ClipboardItem } from '../shared/types'

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn() },
  app: { getPreferredSystemLanguages: () => ['en-US'], getLocale: () => 'en-US' }
}))

import { buildItemMenuTemplate, type ItemMenuActions, type ItemMenuContext } from '../electron/main/itemMenu'
import { quickLookTarget } from '../electron/main/quickLook'

function actions(): ItemMenuActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    paste: vi.fn(),
    pastePlain: vi.fn(),
    copy: vi.fn(),
    togglePin: vi.fn(),
    rename: vi.fn(),
    preview: vi.fn(),
    reveal: vi.fn(),
    addToQueue: vi.fn(),
    ignoreApp: vi.fn(),
    remove: vi.fn()
  }
}

const t = (key: string, params?: Record<string, string | number>) => (params ? `${key}(${Object.values(params).join(',')})` : key)

function labels(ctx: ItemMenuContext): string[] {
  return buildItemMenuTemplate(ctx, actions(), t).map((entry) => (entry.type === 'separator' ? '---' : String(entry.label)))
}

describe('buildItemMenuTemplate', () => {
  it('builds the full menu for a text item with a source app', () => {
    expect(labels({ kind: 'text', pinned: false, sub: false, canPreview: false, canReveal: false, ignoreApp: { bundleId: 'com.apple.Safari', name: 'Safari' } })).toEqual([
      'menu.paste', 'menu.pastePlain', 'menu.copy',
      '---', 'menu.pin', 'menu.rename', 'menu.addToQueue',
      '---', 'menu.ignoreApp(Safari)',
      '---', 'menu.delete'
    ])
  })

  it('offers Unpin, Quick Look and Finder for a pinned file item without plain paste', () => {
    expect(labels({ kind: 'files', pinned: true, sub: false, canPreview: true, canReveal: true })).toEqual([
      'menu.paste', 'menu.copy',
      '---', 'menu.unpin', 'menu.rename', 'menu.preview', 'menu.revealInFinder', 'menu.addToQueue',
      '---', 'menu.delete'
    ])
  })

  it('limits a sub-item menu to actions that work on one file', () => {
    expect(labels({ kind: 'files', pinned: false, sub: true, canPreview: true, canReveal: true })).toEqual([
      'menu.paste', 'menu.copy',
      '---', 'menu.preview', 'menu.revealInFinder',
      '---', 'menu.delete'
    ])
  })

  it('falls back to the bundle id and escapes ampersands in the app name', () => {
    const named = buildItemMenuTemplate({ kind: 'image', pinned: false, sub: false, canPreview: true, canReveal: true, ignoreApp: { bundleId: 'com.att.app', name: 'AT&T' } }, actions(), t)
    expect(named.map((e) => e.label)).toContain('menu.ignoreApp(AT&&T)')
    const bare = buildItemMenuTemplate({ kind: 'image', pinned: false, sub: false, canPreview: true, canReveal: true, ignoreApp: { bundleId: 'com.example.x' } }, actions(), t)
    expect(bare.map((e) => e.label)).toContain('menu.ignoreApp(com.example.x)')
  })

  it('wires every entry to its action', () => {
    const a = actions()
    const template = buildItemMenuTemplate({ kind: 'text', pinned: false, sub: false, canPreview: true, canReveal: true, ignoreApp: { bundleId: 'x' } }, a, t)
    for (const entry of template) {
      if (entry.type !== 'separator') (entry.click as () => void)()
    }
    for (const fn of Object.values(a)) expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('quickLookTarget', () => {
  const resolve = (imageId: string, ext?: string) => (imageId === 'gone' ? null : `/store/${imageId}.${ext ?? 'png'}`)
  const item = (data: ClipboardItem['data']): ClipboardItem => ({ id: 'i', data, capturedAt: 1, hitCount: 1, pinned: false })

  it('uses the first file or a requested file that belongs to the item', () => {
    const files = item({ kind: 'files', paths: ['/a.pdf', '/b.png'] })
    expect(quickLookTarget(files, undefined, resolve)).toBe('/a.pdf')
    expect(quickLookTarget(files, '/b.png', resolve)).toBe('/b.png')
    expect(quickLookTarget(files, '/etc/passwd', resolve)).toBeNull()
  })

  it('resolves stored images and collection members', () => {
    expect(quickLookTarget(item({ kind: 'image', imageId: 'x', width: 1, height: 1, bytes: 1 }), undefined, resolve)).toBe('/store/x.png')
    const collection = item({ kind: 'image-collection', images: [{ imageId: 'p', width: 1, height: 1, bytes: 1 }, { imageId: 'q', width: 1, height: 1, bytes: 1, ext: 'jpg' }] })
    expect(quickLookTarget(collection, undefined, resolve)).toBe('/store/p.png')
    expect(quickLookTarget(collection, 'q', resolve)).toBe('/store/q.jpg')
    expect(quickLookTarget(item({ kind: 'image', imageId: 'gone', width: 1, height: 1, bytes: 1 }), undefined, resolve)).toBeNull()
  })

  it('has nothing to preview for text', () => {
    expect(quickLookTarget(item({ kind: 'text', text: 'x', isUrl: false }), undefined, resolve)).toBeNull()
  })
})
