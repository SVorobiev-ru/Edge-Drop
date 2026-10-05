import { describe, expect, it, vi } from 'vitest'
import type { ClipboardItem } from '../shared/types'

vi.mock('electron', () => ({ powerMonitor: { getSystemIdleTime: () => 0 } }))
vi.mock('../electron/main/state', () => ({
  getStore: () => ({ list: () => [], resolveStoredImagePath: () => null }),
  loadSettings: () => ({ recognizeImageText: true }),
  pushState: { items: vi.fn() }
}))

import { joinRecognizedLines, pickLanguages, recognizeText, type VisionObjc } from '../electron/main/ocrWorker'
import { ocrImagePaths, selectNextOcrItem, takeBacklogSlot } from '../electron/main/ocr'

type Obj = { tag: string; [k: string]: unknown }

function fakeObjc(opts: { lines?: Array<string | null>; supported?: string[]; perform?: boolean; url?: boolean } = {}) {
  const released: string[] = []
  const configured: Array<{ level: number; languageCorrection: boolean; languages: readonly string[] }> = []
  const pools = { opened: 0, closed: 0 }
  const lines = opts.lines ?? ['Hello', 'Привет']
  const observations: Obj[] = lines.map((line, i) => ({ tag: `obs${i}`, line }))
  const objc: VisionObjc = {
    withPool<T>(fn: () => T): T {
      pools.opened++
      try {
        return fn()
      } finally {
        pools.closed++
      }
    },
    fileUrl: (path) => (opts.url === false ? null : { tag: 'url', path }),
    newHandler: () => ({ tag: 'handler' }),
    newTextRequest: () => ({ tag: 'request' }),
    supportedLanguages: () => opts.supported ?? ['en-US', 'fr-FR', 'ru-RU'],
    configure: (_req, o) => {
      configured.push(o)
    },
    perform: () => opts.perform ?? true,
    results: () => ({ tag: 'results' }),
    count: () => observations.length,
    at: (_arr, i) => observations[i],
    topCandidate: (obs) => ((obs as Obj).line === null ? null : { tag: 'candidate', line: (obs as Obj).line }),
    candidateString: (candidate) => String((candidate as Obj).line),
    release: (obj) => {
      released.push((obj as Obj).tag)
    }
  }
  return { objc, released, configured, pools }
}

describe('recognizeText with a mocked ObjC layer', () => {
  it('collects the top candidate of each observation and configures an accurate request', () => {
    const { objc, released, configured, pools } = fakeObjc({ lines: ['  First   line ', null, 'Вторая строка', ''] })

    expect(recognizeText(objc, '/img.png')).toBe('First line\nВторая строка')
    expect(configured).toEqual([{ level: 0, languageCorrection: true, languages: ['ru-RU', 'en-US'] }])
    expect(released.sort()).toEqual(['handler', 'request'])
    expect(pools).toEqual({ opened: 1, closed: 1 })
  })

  it('only asks for languages the system supports', () => {
    const { objc, configured } = fakeObjc({ supported: ['en-US'] })
    recognizeText(objc, '/img.png')
    expect(configured[0].languages).toEqual(['en-US'])
  })

  it('returns null when Vision fails and still releases the objects', () => {
    const { objc, released } = fakeObjc({ perform: false })
    expect(recognizeText(objc, '/img.png')).toBeNull()
    expect(released.sort()).toEqual(['handler', 'request'])
  })

  it('returns null when the file URL cannot be made', () => {
    const { objc, released } = fakeObjc({ url: false })
    expect(recognizeText(objc, '/img.png')).toBeNull()
    expect(released).toEqual([])
  })

  it('returns an empty string for an image without text', () => {
    const { objc } = fakeObjc({ lines: [] })
    expect(recognizeText(objc, '/img.png')).toBe('')
  })
})

describe('OCR helpers', () => {
  it('picks wanted languages in order', () => {
    expect(pickLanguages(['en-US', 'ru-RU', 'de-DE'])).toEqual(['ru-RU', 'en-US'])
    expect(pickLanguages([])).toEqual([])
  })

  it('caps the stored text', () => {
    expect(joinRecognizedLines(['abc', 'def'], 5)).toBe('abc\nd')
  })

  const image = (id: string, capturedAt: number, extra: Partial<ClipboardItem> = {}): ClipboardItem => ({
    id,
    data: { kind: 'image', imageId: `img-${id}`, width: 1, height: 1, bytes: 1 },
    capturedAt,
    hitCount: 1,
    pinned: false,
    ...extra
  })

  it('prefers fresh captures, then the newest backlog item, skipping done and attempted ones', () => {
    const now = 1_000_000
    const items: ClipboardItem[] = [
      { id: 't', data: { kind: 'text', text: 'x', isUrl: false }, capturedAt: now, hitCount: 1, pinned: false },
      image('done', now, { ocrText: '' }),
      image('old1', now - 600_000),
      image('fresh', now - 1_000),
      image('old2', now - 300_000)
    ]
    expect(selectNextOcrItem(items, new Set(), now)).toEqual({ item: items[3], fresh: true })
    expect(selectNextOcrItem(items, new Set(['fresh']), now)).toEqual({ item: items[4], fresh: false })
    expect(selectNextOcrItem(items, new Set(['fresh', 'old2', 'old1']), now)).toBeNull()
  })

  it('limits backlog jobs per minute', () => {
    const history: number[] = []
    expect(takeBacklogSlot(history, 0, 2)).toBe(true)
    expect(takeBacklogSlot(history, 1_000, 2)).toBe(true)
    expect(takeBacklogSlot(history, 2_000, 2)).toBe(false)
    expect(takeBacklogSlot(history, 60_000, 2)).toBe(true)
  })

  it('resolves stored image paths for single images and collections', () => {
    const resolve = (id: string) => (id === 'gone' ? null : `/store/${id}.png`)
    expect(ocrImagePaths(image('a', 1), resolve)).toEqual(['/store/img-a.png'])
    const collection: ClipboardItem = {
      id: 'c',
      data: { kind: 'image-collection', images: [{ imageId: 'p', width: 1, height: 1, bytes: 1 }, { imageId: 'gone', width: 1, height: 1, bytes: 1 }] },
      capturedAt: 1,
      hitCount: 1,
      pinned: false
    }
    expect(ocrImagePaths(collection, resolve)).toEqual(['/store/p.png'])
  })
})
