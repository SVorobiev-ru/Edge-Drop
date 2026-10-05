import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipboardItem } from '../shared/types'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  items: [] as ClipboardItem[],
  settings: { recognizeImageText: true } as Record<string, unknown>,
  jobs: [] as string[],
  setOcrText: vi.fn(() => true)
}))

vi.mock('koffi', () => import('./helpers/koffiMock'))
vi.mock('electron', () => ({ powerMonitor: { getSystemIdleTime: () => 0 } }))
vi.mock('../electron/main/state', () => ({
  getStore: () => ({
    list: () => mocks.items,
    resolveStoredImagePath: (imageId: string) => `/store/${imageId}.png`,
    setOcrText: mocks.setOcrText
  }),
  loadSettings: () => mocks.settings,
  pushState: { items: vi.fn() }
}))
vi.mock('../electron/main/ocrWorker?modulePath', () => ({ default: '/fake/ocrWorker.js' }))
vi.mock('node:worker_threads', () => {
  class Worker {
    private handlers: Record<string, Array<(arg: unknown) => void>> = {}
    on(event: string, cb: (arg: unknown) => void): this {
      ;(this.handlers[event] ??= []).push(cb)
      return this
    }
    postMessage(job: { id: number; path: string }): void {
      mocks.jobs.push(job.path)
      queueMicrotask(() => {
        for (const cb of this.handlers.message ?? []) cb({ id: job.id, ok: true, text: 'text' })
      })
    }
    terminate(): Promise<number> {
      return Promise.resolve(0)
    }
  }
  return { Worker, isMainThread: true, parentPort: null, workerData: null }
})

type Ocr = typeof import('../electron/main/ocr')

function image(id: string): ClipboardItem {
  return { id, data: { kind: 'image', imageId: `img-${id}`, width: 1, height: 1, bytes: 1 }, capturedAt: Date.now(), hitCount: 1, pinned: false }
}

let ocr: Ocr

beforeEach(async () => {
  vi.useFakeTimers()
  setPlatform('darwin')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.items = []
  mocks.settings = { recognizeImageText: true }
  mocks.jobs = []
  mocks.setOcrText.mockClear()
  vi.resetModules()
  ocr = await import('../electron/main/ocr')
})

afterEach(() => {
  ocr.stopImageTextRecognition()
  vi.useRealTimers()
  vi.restoreAllMocks()
  restorePlatform()
})

afterAll(() => {
  restorePlatform()
})

describe('OCR schedule', () => {
  it('stops ticking once there is nothing to recognize and restarts when an image arrives', async () => {
    ocr.startImageTextRecognition()
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(ocr.OCR_TICK_MS)
    expect(vi.getTimerCount()).toBe(0)

    mocks.items = [image('a')]
    ocr.wakeImageTextRecognition()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(ocr.OCR_TICK_MS)
    expect(mocks.jobs).toEqual(['/store/img-a.png'])
    expect(mocks.setOcrText).toHaveBeenCalledWith('a', 'text')
  })

  it('does not tick while the setting is off and starts when it is turned on', async () => {
    mocks.settings = { recognizeImageText: false }
    mocks.items = [image('a')]
    ocr.startImageTextRecognition()
    expect(vi.getTimerCount()).toBe(0)
    ocr.wakeImageTextRecognition()
    expect(vi.getTimerCount()).toBe(0)

    mocks.settings = { recognizeImageText: true }
    ocr.refreshImageTextRecognition()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.jobs).toEqual(['/store/img-a.png'])

    mocks.settings = { recognizeImageText: false }
    ocr.refreshImageTextRecognition()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('forgets attempts for items that left the history', async () => {
    mocks.setOcrText.mockReturnValue(false)
    mocks.items = [image('a')]
    ocr.startImageTextRecognition()
    await vi.advanceTimersByTimeAsync(ocr.OCR_TICK_MS)
    expect(mocks.jobs).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(ocr.OCR_TICK_MS)
    expect(mocks.jobs).toHaveLength(1)

    mocks.items = []
    ocr.wakeImageTextRecognition()
    await vi.advanceTimersByTimeAsync(ocr.OCR_TICK_MS)

    mocks.items = [image('a')]
    ocr.wakeImageTextRecognition()
    await vi.advanceTimersByTimeAsync(ocr.OCR_TICK_MS)
    expect(mocks.jobs).toHaveLength(2)
  })

  it('stays inert off darwin', () => {
    setPlatform('win32')
    ocr.startImageTextRecognition()
    ocr.wakeImageTextRecognition()
    expect(vi.getTimerCount()).toBe(0)
  })
})
