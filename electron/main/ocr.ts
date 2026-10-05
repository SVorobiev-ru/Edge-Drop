import { powerMonitor } from 'electron'
import { Worker } from 'node:worker_threads'
import type { ClipboardItem } from '../../shared/types'
import { getStore, loadSettings, pushState } from './state'
import { OCR_WORKER_ROLE, joinRecognizedLines, type OcrJob, type OcrReply } from './ocrWorker'

export const OCR_TICK_MS = 4_000
const OCR_FRESH_MS = 2 * 60_000
const OCR_BACKLOG_PER_MINUTE = 6
const OCR_IDLE_SECONDS = 20
const WORKER_IDLE_MS = 60_000
const JOB_TIMEOUT_MS = 30_000
const PUSH_DEBOUNCE_MS = 1_500

type OcrStore = {
  list(): readonly ClipboardItem[]
  resolveStoredImagePath(imageId: string, ext?: string): string | null
  setOcrText(id: string, text: string): boolean
}

export interface OcrPick {
  item: ClipboardItem
  fresh: boolean
}

function isOcrCandidate(item: ClipboardItem): boolean {
  return (item.data.kind === 'image' || item.data.kind === 'image-collection') && item.ocrText === undefined
}

export function selectNextOcrItem(items: readonly ClipboardItem[], attempted: ReadonlySet<string>, now: number, freshMs = OCR_FRESH_MS): OcrPick | null {
  let backlog: ClipboardItem | null = null
  for (const item of items) {
    if (attempted.has(item.id) || !isOcrCandidate(item)) continue
    if (now - item.capturedAt <= freshMs) return { item, fresh: true }
    if (!backlog || item.capturedAt > backlog.capturedAt) backlog = item
  }
  return backlog ? { item: backlog, fresh: false } : null
}

export function takeBacklogSlot(history: number[], now: number, perMinute = OCR_BACKLOG_PER_MINUTE): boolean {
  while (history.length > 0 && now - history[0] >= 60_000) history.shift()
  if (history.length >= perMinute) return false
  history.push(now)
  return true
}

export function ocrImagePaths(item: ClipboardItem, resolve: (imageId: string, ext?: string) => string | null): string[] {
  const images = item.data.kind === 'image' ? [item.data] : item.data.kind === 'image-collection' ? item.data.images : []
  return images.map((img) => resolve(img.imageId, img.ext)).filter((p): p is string => !!p)
}

let worker: Worker | null = null
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
let started = false
let pushTimer: ReturnType<typeof setTimeout> | null = null
let nextJobId = 1
let busy = false
let disabledForSession = false
const pending = new Map<number, (text: string | null) => void>()
const attempted = new Set<string>()
const backlogHistory: number[] = []

function ocrStore(): OcrStore {
  return getStore()
}

function ocrEnabled(): boolean {
  return process.platform === 'darwin' && !disabledForSession && loadSettings().recognizeImageText === true
}

function settleAll(): void {
  for (const resolve of pending.values()) resolve(null)
  pending.clear()
}

function stopWorker(): void {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer)
    workerIdleTimer = null
  }
  const current = worker
  worker = null
  settleAll()
  if (current) void current.terminate().catch(() => {})
}

function scheduleWorkerShutdown(): void {
  if (workerIdleTimer) clearTimeout(workerIdleTimer)
  workerIdleTimer = setTimeout(stopWorker, WORKER_IDLE_MS)
  workerIdleTimer.unref?.()
}

async function ensureWorker(): Promise<Worker | null> {
  if (worker) return worker
  try {
    const { default: workerPath } = await import('./ocrWorker?modulePath')
    const created = new Worker(workerPath, { workerData: { role: OCR_WORKER_ROLE } })
    created.on('message', (reply: OcrReply) => {
      const resolve = pending.get(reply.id)
      if (!resolve) return
      pending.delete(reply.id)
      if (!reply.ok) console.error('[OCR] recognition failed:', reply.error)
      resolve(reply.ok ? reply.text : null)
    })
    created.on('error', (err) => {
      console.error('[OCR] worker error:', err)
      if (worker === created) stopWorker()
    })
    created.on('exit', () => {
      if (worker === created) {
        worker = null
        settleAll()
      }
    })
    worker = created
    return created
  } catch (err) {
    console.error('[OCR] worker unavailable, text recognition disabled for this session:', err)
    disabledForSession = true
    return null
  }
}

async function recognizeFile(path: string): Promise<string | null> {
  const w = await ensureWorker()
  if (!w) return null
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer)
    workerIdleTimer = null
  }
  const id = nextJobId++
  return new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => {
      if (!pending.has(id)) return
      console.error('[OCR] recognition timed out:', path)
      stopWorker()
    }, JOB_TIMEOUT_MS)
    pending.set(id, (text) => {
      clearTimeout(timeout)
      resolve(text)
    })
    w.postMessage({ id, path } satisfies OcrJob)
  })
}

function schedulePush(): void {
  if (pushTimer) return
  pushTimer = setTimeout(() => {
    pushTimer = null
    pushState.items({ reason: 'usage' })
  }, PUSH_DEBOUNCE_MS)
}

async function processItem(item: ClipboardItem): Promise<void> {
  const store = ocrStore()
  const texts: string[] = []
  let recognized = false
  for (const path of ocrImagePaths(item, (imageId, ext) => store.resolveStoredImagePath(imageId, ext))) {
    const text = await recognizeFile(path)
    if (text === null) continue
    recognized = true
    if (text) texts.push(text)
  }
  if (!recognized) return
  if (store.setOcrText(item.id, joinRecognizedLines(texts))) schedulePush()
}

function startTicking(): void {
  if (tickTimer || !started) return
  tickTimer = setInterval(() => void tick(), OCR_TICK_MS)
  tickTimer.unref?.()
}

function stopTicking(): void {
  if (!tickTimer) return
  clearInterval(tickTimer)
  tickTimer = null
}

function forgetRemovedAttempts(items: readonly ClipboardItem[]): void {
  if (attempted.size === 0) return
  const ids = new Set(items.map((item) => item.id))
  for (const id of attempted) {
    if (!ids.has(id)) attempted.delete(id)
  }
}

async function tick(): Promise<void> {
  if (busy) return
  if (!ocrEnabled()) {
    stopTicking()
    return
  }
  const now = Date.now()
  const items = ocrStore().list()
  forgetRemovedAttempts(items)
  const pick = selectNextOcrItem(items, attempted, now)
  if (!pick) {
    stopTicking()
    if (worker && !workerIdleTimer) scheduleWorkerShutdown()
    return
  }
  if (!pick.fresh) {
    if (powerMonitor.getSystemIdleTime() < OCR_IDLE_SECONDS) return
    if (!takeBacklogSlot(backlogHistory, now)) return
  }
  busy = true
  attempted.add(pick.item.id)
  try {
    await processItem(pick.item)
  } catch (err) {
    console.error('[OCR] failed to process item:', err)
  } finally {
    busy = false
    scheduleWorkerShutdown()
  }
}

export function startImageTextRecognition(): void {
  if (process.platform !== 'darwin' || started) return
  started = true
  if (ocrEnabled()) startTicking()
}

export function wakeImageTextRecognition(): void {
  if (process.platform !== 'darwin' || !ocrEnabled()) return
  startTicking()
}

export function refreshImageTextRecognition(): void {
  if (process.platform !== 'darwin') return
  if (!ocrEnabled()) {
    stopTicking()
    stopWorker()
    return
  }
  startTicking()
  void tick()
}

export function stopImageTextRecognition(): void {
  started = false
  stopTicking()
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  stopWorker()
}
