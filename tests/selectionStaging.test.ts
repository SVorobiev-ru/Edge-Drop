import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ClipboardItem, ItemData } from '../shared/types'

const mocks = vi.hoisted(() => ({
  temp: '',
  store: '',
  fullTexts: new Map<string, string>(),
  recorded: [] as Array<{ data: any; files: string[] }>,
  startDrag: vi.fn()
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
    get: () => undefined,
    getFullText: (id: string) => mocks.fullTexts.get(id) ?? '',
    getImagePath: (imageId: string, ext?: string) => join(mocks.store, `${imageId}.${ext || 'png'}`)
  })
}))

vi.mock('../electron/main/stagedTemp', () => ({
  recordStagedFiles: (data: unknown, files: string[]) => mocks.recorded.push({ data, files })
}))

import { snippetFileName, stageSelectionFiles, startMultiDragOut } from '../electron/main/drag'

function item(id: string, data: ItemData): ClipboardItem {
  return { id, data, capturedAt: new Date(2026, 9, 5, 12, 0, 0).getTime(), hitCount: 1, pinned: false }
}

describe('selection staging', () => {
  beforeEach(() => {
    const root = join(tmpdir(), `ed-sel-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mocks.temp = join(root, 'temp')
    mocks.store = join(root, 'store')
    mkdirSync(mocks.temp, { recursive: true })
    mkdirSync(mocks.store, { recursive: true })
    mocks.fullTexts.clear()
    mocks.recorded.length = 0
  })

  afterEach(() => {
    rmSync(join(mocks.temp, '..'), { recursive: true, force: true })
  })

  it('names text files from the first words', () => {
    expect(snippetFileName('Hello there, this is a long sentence about things')).toBe('Hello there, this is a long.txt')
    expect(snippetFileName('  a/b: c?  ')).toBe('a_b_ c_.txt')
    expect(snippetFileName('   \n ')).toBe('Snippet.txt')
    expect(snippetFileName('x'.repeat(80))).toBe(`${'x'.repeat(40)}.txt`)
  })

  it('avoids reserved Windows names and trailing dots or spaces', () => {
    expect(snippetFileName('CON')).toBe('_CON.txt')
    expect(snippetFileName('nul.tar')).toBe('_nul.tar.txt')
    expect(snippetFileName('com1')).toBe('_com1.txt')
    expect(snippetFileName('Console log')).toBe('Console log.txt')
    expect(snippetFileName('The end...')).toBe('The end.txt')
  })

  it('never hands out a file with other content when every numbered name is taken', () => {
    writeFileSync(join(mocks.temp, 'Busy name.txt'), 'other')
    for (let n = 2; n < 1000; n++) writeFileSync(join(mocks.temp, `Busy name (${n}).txt`), `other ${n}`)
    const result = stageSelectionFiles([item('t1', { kind: 'text', text: 'Busy name', isUrl: false })])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(basename(result.paths[0])).toMatch(/^Snippet_[0-9a-f]{16}\.txt$/)
    expect(readFileSync(result.paths[0], 'utf8')).toBe('Busy name')
  })

  it('stages a new file when the full text of the same item changes', () => {
    mocks.fullTexts.set('t5', 'First full version')
    const data = { kind: 'text' as const, text: 'First', isUrl: false, hasFullPayload: true }
    const first = stageSelectionFiles([item('t5', data)])
    mocks.fullTexts.set('t5', 'Second full version')
    const second = stageSelectionFiles([item('t5', data)])
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(readFileSync(first.paths[0], 'utf8')).toBe('First full version')
    expect(readFileSync(second.paths[0], 'utf8')).toBe('Second full version')
  })

  it('stages files, images and texts in order as one list', () => {
    const userFile = join(mocks.store, 'report.pdf')
    writeFileSync(userFile, 'pdf')
    writeFileSync(join(mocks.store, 'img1.png'), 'png-bytes')
    mocks.fullTexts.set('t1', 'Full meeting notes for Monday')
    const result = stageSelectionFiles([
      item('f1', { kind: 'files', paths: [userFile] }),
      item('t1', { kind: 'text', text: 'Full meeting', isUrl: false, hasFullPayload: true }),
      item('i1', { kind: 'image', imageId: 'img1', width: 1, height: 1, bytes: 9, ext: 'png', source: 'screenshot' })
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.paths).toHaveLength(3)
    expect(result.paths[0]).toBe(userFile)
    expect(basename(result.paths[1])).toBe('Full meeting notes for Monday.txt')
    expect(readFileSync(result.paths[1], 'utf8')).toBe('Full meeting notes for Monday')
    expect(basename(result.paths[2])).toBe('Screenshot 2026-10-05 12.00.00.png')
    expect(result.iconPaths).toEqual([userFile, result.paths[1], 'image.png'])
    expect(mocks.recorded.some((r) => r.files.includes(result.paths[1]))).toBe(true)
  })

  it('gives two different texts with the same first words distinct files', () => {
    const result = stageSelectionFiles([
      item('t1', { kind: 'text', text: 'Same start one', isUrl: false }),
      item('t2', { kind: 'text', text: 'Same start one ', isUrl: false })
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.paths.map((p) => basename(p))).toEqual(['Same start one.txt', 'Same start one (2).txt'])
    expect(readFileSync(result.paths[1], 'utf8')).toBe('Same start one ')
  })

  it('fails as a whole when an image is gone', () => {
    const result = stageSelectionFiles([
      item('t1', { kind: 'text', text: 'note', isUrl: false }),
      item('i9', { kind: 'image', imageId: 'missing', width: 1, height: 1, bytes: 1, ext: 'png' })
    ])
    expect(result).toEqual({ ok: false, error: 'toast.imageUnavailable' })
  })

  it('fails as a whole when every file of a bundle is gone', () => {
    const result = stageSelectionFiles([item('f1', { kind: 'files', paths: [join(mocks.store, 'gone.pdf')] })])
    expect(result).toEqual({ ok: false, error: 'toast.fileUnavailable' })
  })

  it('starts one native drag with the whole list', () => {
    const sender = { startDrag: mocks.startDrag }
    expect(startMultiDragOut(sender as any, ['/a.txt', '/b.png'], ['/a.txt', 'image.png'])).toBe(true)
    expect(mocks.startDrag).toHaveBeenCalledWith(expect.objectContaining({ file: '/a.txt', files: ['/a.txt', '/b.png'] }))
    expect(startMultiDragOut(sender as any, [], [])).toBe(false)
    expect(existsSync(mocks.temp)).toBe(true)
  })
})
