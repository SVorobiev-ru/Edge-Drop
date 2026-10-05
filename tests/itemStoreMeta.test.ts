import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ItemData } from '../shared/types'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', async () => ({
  app: (await import('./helpers/electronMock')).userDataApp(() => mocks.userData),
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => false, toPNG: () => Buffer.from('converted') }),
    createFromBuffer: (buf: Buffer) => ({ isEmpty: () => buf.includes('broken') })
  },
  clipboard: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock('koffi', () => import('./helpers/koffiMock'))

import { ItemStore, type PinnedExport } from '../electron/store/ItemStore'
import { MAX_ITEM_HTML_CHARS } from '../electron/clipboard/formats'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const TIFF_MAGIC = Buffer.from([0x49, 0x49, 0x2a, 0x00])

function png(tag: string): Buffer {
  return Buffer.concat([PNG_MAGIC, Buffer.from(tag)])
}

function tiff(tag: string): Buffer {
  return Buffer.concat([TIFF_MAGIC, Buffer.from(`tiff-${tag}`)])
}

function text(value: string, extra: Partial<Extract<ItemData, { kind: 'text' }>> = {}): ItemData {
  return { kind: 'text', text: value, isUrl: false, ...extra }
}

function payloads(): string[] {
  return readdirSync(join(mocks.userData, 'payloads')).sort()
}

const created: string[] = []

function freshUserData(): void {
  mocks.userData = join(tmpdir(), `ed-meta-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  created.push(mocks.userData)
  for (const dir of ['payloads', 'images', 'thumbnails']) mkdirSync(join(mocks.userData, dir), { recursive: true })
}

function addImage(store: ItemStore, imageId: string, bytes: Buffer, width = 1440): void {
  store.stageImageBytes(imageId, bytes)
  store.add({ kind: 'image', imageId, width, height: 900, bytes: bytes.length, ext: 'png', source: 'screenshot' }, 50)
}

beforeEach(() => {
  freshUserData()
  setPlatform('darwin')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  restorePlatform()
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

afterAll(() => {
  restorePlatform()
})

describe('source app on items', () => {
  it('stores the source app of a new item and passes it through the DTO', () => {
    const store = new ItemStore()
    store.add(text('hello'), 50, { sourceApp: { bundleId: 'com.apple.Safari', name: 'Safari' } })

    expect(store.list()[0].sourceApp).toEqual({ bundleId: 'com.apple.Safari', name: 'Safari' })
    expect(store.toDto()[0].sourceApp).toEqual({ bundleId: 'com.apple.Safari', name: 'Safari' })
  })

  it('keeps the original source app when dedupe promotes an existing item', () => {
    const store = new ItemStore()
    store.add(text('same'), 50, { sourceApp: { bundleId: 'com.apple.Safari', name: 'Safari' } })
    store.add(text('other'), 50, { sourceApp: { bundleId: 'com.apple.Notes', name: 'Notes' } })
    store.add(text('same'), 50, { sourceApp: { bundleId: 'com.apple.Terminal', name: 'Terminal' } })

    expect(store.list()).toHaveLength(2)
    expect(store.list()[0].data).toMatchObject({ text: 'same' })
    expect(store.list()[0].hitCount).toBe(2)
    expect(store.list()[0].sourceApp).toEqual({ bundleId: 'com.apple.Safari', name: 'Safari' })
  })

  it('leaves the field out when the source is unknown and survives a restart otherwise', () => {
    const store = new ItemStore()
    store.add(text('unknown'), 50)
    store.add(text('known'), 50, { sourceApp: { bundleId: 'com.apple.Notes' } })
    store.persistSync()

    const reopened = new ItemStore()
    reopened.load()
    expect(reopened.list()[0].sourceApp).toEqual({ bundleId: 'com.apple.Notes' })
    expect('sourceApp' in reopened.list()[1]).toBe(false)
  })
})

describe('setOcrText', () => {
  it('stores recognized text of an image, caps it at 20 000 chars and persists it', () => {
    const store = new ItemStore()
    addImage(store, 'img-ocr', png('ocr'))
    const id = store.list()[0].id

    expect(store.setOcrText(id, 'x'.repeat(25_000))).toBe(true)
    expect(store.list()[0].ocrText).toHaveLength(20_000)
    store.setOcrText(id, 'Invoice 42')
    store.persistSync()

    const reopened = new ItemStore()
    reopened.load()
    expect(reopened.list()[0].ocrText).toBe('Invoice 42')
    expect(reopened.toDto()[0].ocrText).toBe('Invoice 42')
  })

  it('keeps an empty string as the "no text" marker', () => {
    const store = new ItemStore()
    addImage(store, 'img-blank', png('blank'))
    const id = store.list()[0].id
    expect(store.setOcrText(id, '')).toBe(true)
    expect(store.list()[0].ocrText).toBe('')
    expect(store.setOcrText(id, '')).toBe(false)
  })

  it('refuses text items and unknown ids', () => {
    const store = new ItemStore()
    store.add(text('body'), 50)
    expect(store.setOcrText(store.list()[0].id, 'x')).toBe(false)
    expect('ocrText' in store.list()[0]).toBe(false)
    expect(store.setOcrText('missing', 'x')).toBe(false)
  })
})

describe('setTitle', () => {
  it('trims, caps at 120 chars, persists and reaches the DTO', () => {
    const store = new ItemStore()
    store.add(text('body'), 50)
    const id = store.list()[0].id

    expect(store.setTitle(id, `  ${'t'.repeat(200)}  `)).toBe(true)
    expect(store.list()[0].title).toBe('t'.repeat(120))

    store.setTitle(id, '  Invoice template ')
    store.persistSync()
    expect(store.toDto()[0].title).toBe('Invoice template')

    const reopened = new ItemStore()
    reopened.load()
    expect(reopened.list()[0].title).toBe('Invoice template')
  })

  it('clears the title with an empty string and reports an unknown id', () => {
    const store = new ItemStore()
    store.add(text('body'), 50)
    const id = store.list()[0].id
    store.setTitle(id, 'Named')

    expect(store.setTitle(id, '   ')).toBe(true)
    expect('title' in store.list()[0]).toBe(false)
    expect(store.setTitle('missing', 'x')).toBe(false)
  })

  it('passes ocrText and title through the DTO of every kind', () => {
    const store = new ItemStore()
    writeFileSync(join(mocks.userData, 'images', 'img-1.png'), png('one'))
    writeFileSync(
      join(mocks.userData, 'items.json'),
      JSON.stringify({
        items: [
          { id: 'a', data: { kind: 'image', imageId: 'img-1', width: 2, height: 2, bytes: 11, ext: 'png' }, capturedAt: 3, hitCount: 1, pinned: false, ocrText: 'recognised', title: 'Shot' },
          { id: 'b', data: { kind: 'text', text: 'note', isUrl: false }, capturedAt: 2, hitCount: 1, pinned: false, title: 'Note' },
          { id: 'c', data: { kind: 'files', paths: ['/tmp/a.txt'] }, capturedAt: 1, hitCount: 1, pinned: false, title: 'File' }
        ]
      })
    )
    store.load()

    const dto = store.toDto()
    expect(dto[0]).toMatchObject({ ocrText: 'recognised', title: 'Shot' })
    expect(dto[1]).toMatchObject({ title: 'Note' })
    expect(dto[2]).toMatchObject({ title: 'File' })
  })
})

describe('large html and rtf payloads', () => {
  const bigHtml = `<p>${'h'.repeat(MAX_ITEM_HTML_CHARS + 10)}</p>`

  it('keeps html above the inline limit in a payload file on darwin', () => {
    const store = new ItemStore()
    store.add(text('rich', { html: bigHtml }), 50)
    const item = store.list()[0]

    expect(item.data.kind === 'text' && item.data.html).toBeUndefined()
    expect(payloads()).toEqual([`${item.id}.html`])
    expect(store.getFullHtml(item.id)).toBe(bigHtml)
    expect(store.getRichText(item.id)).toEqual({ text: 'rich', html: bigHtml })
  })

  it('keeps small html inline', () => {
    const store = new ItemStore()
    store.add(text('rich', { html: '<b>rich</b>' }), 50)
    const item = store.list()[0]

    expect(payloads()).toEqual([])
    expect(store.getFullHtml(item.id)).toBe('<b>rich</b>')
  })

  it('stores rtf next to the text and returns text, html and rtf together', () => {
    const store = new ItemStore()
    const long = 'x'.repeat(500)
    store.add(text(long, { html: '<b>x</b>' }), 50, { rtf: '{\\rtf1 x}' })
    const item = store.list()[0]

    expect(payloads()).toEqual([`${item.id}.rtf`, `${item.id}.txt`])
    expect(store.getRtf(item.id)).toBe('{\\rtf1 x}')
    expect(store.getRichText(item.id)).toEqual({ text: long, html: '<b>x</b>', rtf: '{\\rtf1 x}' })
  })

  it('keeps the payloads across a restart and sweeps the ones without an item', () => {
    const store = new ItemStore()
    store.add(text('rich', { html: bigHtml }), 50, { rtf: '{\\rtf1 rich}' })
    const id = store.list()[0].id
    store.persistSync()
    const stale = Date.now() / 1000 - 120
    for (const name of ['gone.html', 'gone.rtf']) {
      writeFileSync(join(mocks.userData, 'payloads', name), 'stale')
      utimesSync(join(mocks.userData, 'payloads', name), stale, stale)
    }

    const reopened = new ItemStore()
    reopened.load()

    expect(payloads()).toEqual([`${id}.html`, `${id}.rtf`])
    expect(reopened.getRichText(id)).toEqual({ text: 'rich', html: bigHtml, rtf: '{\\rtf1 rich}' })
  })

  it('removes html and rtf payloads together with the item', () => {
    const store = new ItemStore()
    store.add(text('x'.repeat(500), { html: bigHtml }), 50, { rtf: '{\\rtf1 x}' })
    const id = store.list()[0].id
    expect(payloads()).toHaveLength(3)

    store.delete(id)
    expect(payloads()).toEqual([])
  })

  it('removes the payloads of items evicted by the history limit', () => {
    const store = new ItemStore()
    store.add(text('old', { html: bigHtml }), 1, { rtf: '{\\rtf1 old}' })
    store.add(text('new'), 1)

    expect(store.list()).toHaveLength(1)
    expect(payloads()).toEqual([])
  })

  it('moves oversized inline html of loaded items into a payload file', () => {
    writeFileSync(
      join(mocks.userData, 'items.json'),
      JSON.stringify({ items: [{ id: 'legacy', data: { kind: 'text', text: 'legacy', html: bigHtml, isUrl: false }, capturedAt: 1, hitCount: 1, pinned: false }] })
    )
    const store = new ItemStore()
    store.load()

    expect(store.list()[0].data.kind === 'text' && store.list()[0].data.html).toBeUndefined()
    expect(store.getFullHtml('legacy')).toBe(bigHtml)
  })

  it('still drops oversized html and ignores rtf on win32', () => {
    setPlatform('win32')
    const store = new ItemStore()
    store.add(text('rich', { html: bigHtml }), 50, { rtf: '{\\rtf1 rich}' })
    const id = store.list()[0].id

    expect(payloads()).toEqual([])
    expect(store.getRichText(id)).toEqual({ text: 'rich' })
  })
})

describe('stored image bytes', () => {
  it('returns the stored png as the original', () => {
    const store = new ItemStore()
    addImage(store, 'img-png', png('retina'))

    expect(store.storedImageBytes('img-png', 'png')).toEqual({ original: { type: 'public.png', bytes: png('retina') } })
  })

  it('returns the tiff original together with the display png', () => {
    const store = new ItemStore()
    addImage(store, 'img-tiff', png('display'))
    store.stageOriginalImage('img-tiff', tiff('source'), 'tiff')

    expect(store.storedImageBytes('img-tiff', 'png')).toEqual({
      original: { type: 'public.tiff', bytes: tiff('source') },
      png: png('display')
    })
    expect(store.getImagePath('img-tiff')).toBe(join(mocks.userData, 'images', 'img-tiff.png'))
    expect(store.resolveStoredImagePath('img-tiff', 'png')).toBe(join(mocks.userData, 'images', 'img-tiff.png'))
  })

  it('returns null for other formats, unknown ids and files that are not images', () => {
    const store = new ItemStore()
    writeFileSync(join(mocks.userData, 'images', 'fake.png'), 'not a png')
    writeFileSync(join(mocks.userData, 'images', 'photo.jpg'), 'jpeg')

    expect(store.storedImageBytes('fake', 'png')).toBeNull()
    expect(store.storedImageBytes('photo', 'jpg')).toBeNull()
    expect(store.storedImageBytes('missing', 'png')).toBeNull()
    expect(store.storedImageBytes('')).toBeNull()
  })

  it('keeps the tiff original across a restart and removes it with the item', () => {
    const store = new ItemStore()
    addImage(store, 'img-tiff', png('display'))
    store.stageOriginalImage('img-tiff', tiff('source'), 'tiff')
    store.persistSync()

    const reopened = new ItemStore()
    reopened.load()
    expect(existsSync(join(mocks.userData, 'images', 'img-tiff.orig.tiff'))).toBe(true)

    reopened.delete(reopened.list()[0].id)
    expect(readdirSync(join(mocks.userData, 'images'))).toEqual([])
  })
})

describe('pinned export and import', () => {
  function seedFiles(): string[] {
    const dir = realpathSync.native(mocks.userData)
    const paths = [join(dir, 'a.txt'), join(dir, 'b.txt')]
    for (const p of paths) writeFileSync(p, 'file')
    return paths
  }

  function seed(): ItemStore {
    const store = new ItemStore()
    const long = `long ${'y'.repeat(600)}`
    store.add(text('unpinned'), 50)
    store.add(text('#ff8800', { isColor: true }), 50)
    store.add(text('https://example.com/a', { isUrl: true }), 50, { sourceApp: { bundleId: 'com.apple.Safari', name: 'Safari' } })
    store.add(text(long, { html: `<p>${'h'.repeat(MAX_ITEM_HTML_CHARS + 1)}</p>` }), 50, { rtf: '{\\rtf1 long}' })
    store.add({ kind: 'files', paths: seedFiles() }, 50)
    addImage(store, 'img-a', png('shot-a'))
    for (const it of store.list()) {
      if (it.data.kind !== 'text' || it.data.text !== 'unpinned') store.setPinned(it.id, true)
    }
    const titled = store.list().find((it) => it.data.kind === 'text' && it.data.isUrl)!
    store.setTitle(titled.id, 'Docs')
    return store
  }

  it('exports pinned items as a versioned document with full payloads', () => {
    const doc = seed().exportPinned()

    expect(doc.format).toBe('edge-drop-pinned')
    expect(doc.version).toBe(1)
    expect(Number.isNaN(Date.parse(doc.exportedAt))).toBe(false)
    expect(doc.items).toHaveLength(5)
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)

    const image = doc.items.find((it) => it.kind === 'image')!
    expect(image.kind === 'image' && Buffer.from(image.png, 'base64').equals(png('shot-a'))).toBe(true)
    expect(image).toMatchObject({ width: 1440, height: 900, bytes: png('shot-a').length, source: 'screenshot' })

    const link = doc.items.find((it) => it.kind === 'text' && it.isUrl)!
    expect(link).toMatchObject({ text: 'https://example.com/a', title: 'Docs', sourceApp: { bundleId: 'com.apple.Safari', name: 'Safari' } })

    const long = doc.items.find((it) => it.kind === 'text' && it.text.startsWith('long '))!
    expect(long.kind === 'text' && long.text.length).toBe(605)
    expect(long.kind === 'text' && long.html?.length).toBe(MAX_ITEM_HTML_CHARS + 8)
    expect(long.kind === 'text' && long.rtf).toBe('{\\rtf1 long}')

    expect(doc.items.find((it) => it.kind === 'text' && it.isColor)).toMatchObject({ text: '#ff8800', isColor: true })
    const dir = realpathSync.native(mocks.userData)
    expect(doc.items.find((it) => it.kind === 'files')).toMatchObject({ paths: [join(dir, 'a.txt'), join(dir, 'b.txt')] })
    expect(doc.items.some((it) => it.kind === 'text' && it.text === 'unpinned')).toBe(false)
  })

  it('round-trips into an empty store', () => {
    const doc = JSON.parse(JSON.stringify(seed().exportPinned())) as PinnedExport
    freshUserData()
    const target = new ItemStore()

    expect(target.importPinned(doc)).toBe(5)
    expect(target.list().every((it) => it.pinned)).toBe(true)

    const again = target.exportPinned()
    expect(again.items).toEqual(doc.items)

    const image = target.list().find((it) => it.data.kind === 'image')!
    expect(image.data.kind === 'image' && readFileSync(join(mocks.userData, 'images', `${image.data.imageId}.png`)).equals(png('shot-a'))).toBe(true)

    const reopened = new ItemStore()
    reopened.load()
    expect(reopened.list()).toHaveLength(5)
    expect(reopened.exportPinned().items).toEqual(doc.items)
  })

  it('dedupes against existing items and inside the document', () => {
    const source = seed()
    const doc = source.exportPinned()

    expect(source.importPinned(doc)).toBe(0)
    expect(source.list()).toHaveLength(6)
    expect(readdirSync(join(mocks.userData, 'images'))).toEqual(['img-a.png'])

    const twice = { ...doc, items: [...doc.items, ...doc.items, { kind: 'text', text: 'brand new', isUrl: false, capturedAt: 5 }] }
    expect(source.importPinned(twice)).toBe(1)
    expect(source.list()).toHaveLength(7)
  })

  it('pins an existing unpinned duplicate without counting it', () => {
    const store = new ItemStore()
    store.add(text('already here'), 50)

    expect(store.importPinned({ format: 'edge-drop-pinned', version: 1, exportedAt: '', items: [{ kind: 'text', text: 'already here', isUrl: false }] })).toBe(0)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].pinned).toBe(true)
  })

  it('rejects documents of the wrong shape', () => {
    const store = new ItemStore()
    const item = { kind: 'text', text: 'x', isUrl: false }

    for (const doc of [
      null,
      undefined,
      'text',
      42,
      [],
      {},
      { format: 'something-else', version: 1, items: [item] },
      { format: 'edge-drop-pinned', version: 2, items: [item] },
      { format: 'edge-drop-pinned', version: '1', items: [item] },
      { format: 'edge-drop-pinned', version: 1 },
      { format: 'edge-drop-pinned', version: 1, items: { 0: item } },
      { format: 'edge-drop-pinned', version: 1, items: new Array(5001).fill(item) }
    ]) {
      expect(store.importPinned(doc)).toBe(0)
    }
    expect(store.list()).toHaveLength(0)
    expect(existsSync(join(mocks.userData, 'items.json'))).toBe(false)
  })

  it('skips malformed items and imports the valid ones', () => {
    const store = new ItemStore()
    const good = png('good').toString('base64')
    const realFile = join(mocks.userData, 'c.txt')
    writeFileSync(realFile, 'c')
    const doc = {
      format: 'edge-drop-pinned',
      version: 1,
      exportedAt: 'whenever',
      items: [
        null,
        'string',
        7,
        [],
        { kind: 'unknown' },
        { kind: 'text' },
        { kind: 'text', text: 42 },
        { kind: 'text', text: '   ' },
        { kind: 'files', paths: [] },
        { kind: 'files', paths: 'nope' },
        { kind: 'files', paths: ['/ok', 5] },
        { kind: 'files', paths: ['/bad\u0000path'] },
        { kind: 'image', width: 10, height: 10, png: '' },
        { kind: 'image', width: 10, height: 10, png: 'not base64 !!!' },
        { kind: 'image', width: 10, height: 10, png: Buffer.from('plain text, no png magic').toString('base64') },
        { kind: 'image', width: 10, height: 10, png: png('broken').toString('base64') },
        { kind: 'image', width: -1, height: 10, png: good },
        { kind: 'image', width: 10, height: 1e9, png: good },
        { kind: 'image', width: '10', height: 10, png: good },
        { kind: 'image-collection', images: [] },
        { kind: 'image-collection', images: [{ width: 1, height: 1, png: good }, { width: 1, height: 1, png: 'x' }] },
        { kind: 'text', text: 'valid text', isUrl: 'yes', title: { toString: 1 }, sourceApp: 'Safari', capturedAt: 'yesterday', html: 12, rtf: [] },
        { kind: 'files', paths: [join(mocks.userData, 'missing.txt')] },
        { kind: 'files', paths: [realFile], title: `  ${'n'.repeat(300)}`, sourceApp: { bundleId: 'com.apple.finder', name: 5 }, capturedAt: 1234 },
        { kind: 'image', width: 10, height: 10, bytes: 'big', png: good, fileName: '../../evil.png', source: 'weird' }
      ]
    }

    expect(store.importPinned(doc)).toBe(3)

    const [txt, files, image] = store.list()
    expect(txt.data).toEqual({ kind: 'text', text: 'valid text', isUrl: false })
    expect('title' in txt).toBe(false)
    expect('sourceApp' in txt).toBe(false)
    expect(txt.capturedAt).toBeGreaterThan(1234)
    expect(files).toMatchObject({ title: 'n'.repeat(120), sourceApp: { bundleId: 'com.apple.finder' }, capturedAt: 1234, pinned: true })
    expect(files.data).toEqual({ kind: 'files', paths: [realpathSync.native(realFile)] })
    expect(image.data).toMatchObject({ kind: 'image', width: 10, height: 10, bytes: png('good').length, ext: 'png' })
    expect(image.data.kind === 'image' && image.data.fileName).toBeUndefined()
    expect(image.data.kind === 'image' && image.data.source).toBeUndefined()
    expect(image.data.kind === 'image' && /^[a-z0-9]+-[a-z0-9]+$/.test(image.data.imageId)).toBe(true)
    expect(readdirSync(join(mocks.userData, 'images'))).toHaveLength(1)
  })

  it('imports only existing files and folders, by their real path', () => {
    const store = new ItemStore()
    const dir = join(mocks.userData, 'docs')
    mkdirSync(dir)
    const file = join(dir, 'report.pdf')
    writeFileSync(file, 'pdf')
    const link = join(mocks.userData, 'link.pdf')
    symlinkSync(file, link)
    const doc = {
      format: 'edge-drop-pinned',
      version: 1,
      items: [
        { kind: 'files', paths: [link, dir, join(dir, 'gone.pdf')] },
        { kind: 'files', paths: ['/dev/null'] },
        { kind: 'files', paths: [join(mocks.userData, 'nothing-here')] }
      ]
    }

    expect(store.importPinned(doc)).toBe(1)
    expect(store.list()[0].data).toEqual({ kind: 'files', paths: [realpathSync.native(file), realpathSync.native(dir)] })
  })

  it('exports and imports an image collection', () => {
    const store = new ItemStore()
    store.stageImageBytes('col-1', png('one'))
    store.stageImageBytes('col-2', png('two'))
    store.add(
      {
        kind: 'image-collection',
        images: [
          { imageId: 'col-1', width: 10, height: 10, bytes: 11, ext: 'png' },
          { imageId: 'col-2', width: 20, height: 20, bytes: 12, ext: 'png' }
        ]
      },
      50
    )
    store.setPinned(store.list()[0].id, true)
    const doc = JSON.parse(JSON.stringify(store.exportPinned()))

    expect(store.importPinned(doc)).toBe(0)

    freshUserData()
    const target = new ItemStore()
    expect(target.importPinned(doc)).toBe(1)
    const data = target.list()[0].data
    expect(data.kind === 'image-collection' && data.images.map((img) => [img.width, img.bytes])).toEqual([[10, 11], [20, 12]])
    expect(readdirSync(join(mocks.userData, 'images'))).toHaveLength(2)
  })
})
