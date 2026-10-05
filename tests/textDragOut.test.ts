import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ClipboardItem, ItemData } from '../shared/types'

const mocks = vi.hoisted(() => ({
  temp: '',
  items: new Map<string, any>(),
  fullTexts: new Map<string, string>(),
  recorded: [] as Array<{ data: any; files: string[] }>
}))

vi.mock('electron', () => ({
  app: { getFileIcon: () => Promise.resolve(null) },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }
}))

vi.mock('@resvg/resvg-js', () => ({ Resvg: class { render() { return { asPng: () => Buffer.alloc(0) } } } }))

vi.mock('../electron/store/paths', () => ({
  getUnpackagedTempDir: () => mocks.temp,
  toUnpackagedFilePaths: (ps: string[]) => ps
}))

vi.mock('../electron/main/state', () => ({
  getStore: () => ({
    get: (id: string) => mocks.items.get(id),
    getFullText: (id: string) => mocks.fullTexts.get(id) ?? ''
  })
}))

vi.mock('../electron/main/stagedTemp', () => ({
  recordStagedFiles: (data: unknown, files: string[]) => mocks.recorded.push({ data, files })
}))

import { resolveDragData, stageDragFile } from '../electron/main/drag'

function addText(id: string, full: string): ClipboardItem {
  const long = full.length > 300
  const data: ItemData = long
    ? { kind: 'text', text: full.slice(0, 300), previewText: full.slice(0, 300), hasFullPayload: true, isUrl: false }
    : { kind: 'text', text: full, isUrl: false }
  const item: ClipboardItem = { id, data, capturedAt: 1, hitCount: 1, pinned: false }
  mocks.items.set(id, item)
  if (long) mocks.fullTexts.set(id, full)
  return item
}

function stage(id: string): string {
  const resolved = resolveDragData({ id })!
  return stageDragFile(resolved.data, resolved.capturedAt)!.file
}

describe('text drag-out', () => {
  beforeEach(() => {
    mocks.temp = join(tmpdir(), `ed-drag-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(mocks.temp, { recursive: true })
    mocks.items.clear()
    mocks.fullTexts.clear()
    mocks.recorded.length = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(mocks.temp, { recursive: true, force: true })
  })

  it('writes the full text of a long item, not its 300-char preview', () => {
    const full = `${'long text '.repeat(200)}THE END`
    addText('long-1', full)

    expect(readFileSync(stage('long-1'), 'utf8')).toBe(full)
  })

  it('gives texts with the same beginning their own files', () => {
    const head = 'same beginning '.repeat(20)
    addText('a', `${head}first`)
    addText('b', `${head}second`)

    const fileA = stage('a')
    vi.advanceTimersByTime(5)
    const fileB = stage('b')

    expect(fileB).not.toBe(fileA)
    expect(readFileSync(fileA, 'utf8')).toBe(`${head}first`)
    expect(readFileSync(fileB, 'utf8')).toBe(`${head}second`)
  })

  it('reuses the staged file of the same item', () => {
    addText('short', 'short note')
    const first = stage('short')
    vi.advanceTimersByTime(5)
    expect(stage('short')).toBe(first)
    expect(readFileSync(first, 'utf8')).toBe('short note')
  })

  it('keeps registering the artifact under the stored item data', () => {
    const item = addText('long-2', 'z'.repeat(1000))
    stage('long-2')
    expect(mocks.recorded).toHaveLength(1)
    expect(mocks.recorded[0].data).toBe(item.data)
  })

  it('separates unowned text payloads that share their first 100 characters', () => {
    const head = 'p'.repeat(150)
    const first = stageDragFile({ kind: 'text', text: `${head}1`, isUrl: false })!.file
    vi.advanceTimersByTime(5)
    const second = stageDragFile({ kind: 'text', text: `${head}2`, isUrl: false })!.file

    expect(second).not.toBe(first)
    expect(readFileSync(second, 'utf8')).toBe(`${head}2`)
  })
})
