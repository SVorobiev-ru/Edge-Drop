import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/Documents', focus: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() }
}))

import {
  defaultBackupName,
  exportPinnedHistory,
  importPinnedHistory,
  isBackupShape,
  readBackupFile,
  type BackupDeps
} from '../electron/main/historyBackup'

const dir = mkdtempSync(join(tmpdir(), 'edge-drop-backup-test-'))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function file(name: string, content: string): string {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

const validDoc = { format: 'edge-drop-pinned', version: 1, exportedAt: '2026-10-05T00:00:00.000Z', items: [{ kind: 'text', text: 'hi', isUrl: false, capturedAt: 1 }] }

function deps(overrides: Partial<BackupDeps> = {}) {
  const toast = vi.fn()
  const writes: Array<{ path: string; data: string }> = []
  const d: BackupDeps = {
    exportPinned: () => validDoc,
    importPinned: vi.fn(() => 1),
    afterImport: vi.fn(),
    toast,
    chooseSavePath: vi.fn(async (p: string) => p),
    chooseOpenPath: vi.fn(async () => '/picked.json'),
    documentsDir: () => '/Users/me/Documents',
    writeFile: (path, data) => {
      writes.push({ path, data })
    },
    readFile: vi.fn(async () => ({ ok: true as const, doc: validDoc })),
    ...overrides
  }
  return { d, toast, writes }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('backup file names and shape', () => {
  it('names the export by the local date', () => {
    expect(defaultBackupName(new Date(2026, 0, 7, 23, 59))).toBe('edge-drop-pinned-2026-01-07.json')
  })

  it('accepts only the pinned export format with an items array', () => {
    expect(isBackupShape(validDoc)).toBe(true)
    expect(isBackupShape({ format: 'edge-drop-pinned', items: {} })).toBe(false)
    expect(isBackupShape({ format: 'other', items: [] })).toBe(false)
    expect(isBackupShape([])).toBe(false)
    expect(isBackupShape(null)).toBe(false)
  })
})

describe('readBackupFile', () => {
  it('reads a valid export', async () => {
    const p = file('ok.json', JSON.stringify(validDoc))
    await expect(readBackupFile(p)).resolves.toEqual({ ok: true, doc: validDoc })
  })

  it('refuses a file over the size limit before reading it', async () => {
    const p = file('big.json', JSON.stringify(validDoc))
    await expect(readBackupFile(p, 10)).resolves.toEqual({ ok: false, reason: 'too-large' })
  })

  it('reports broken JSON and foreign documents as invalid', async () => {
    await expect(readBackupFile(file('broken.json', '{"format":'))).resolves.toEqual({ ok: false, reason: 'invalid' })
    await expect(readBackupFile(file('foreign.json', '{"items":[1]}'))).resolves.toEqual({ ok: false, reason: 'invalid' })
  })

  it('reports missing files and directories as unreadable', async () => {
    await expect(readBackupFile(join(dir, 'nope.json'))).resolves.toEqual({ ok: false, reason: 'unreadable' })
    const sub = join(dir, 'folder.json')
    mkdirSync(sub)
    await expect(readBackupFile(sub)).resolves.toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('exportPinnedHistory', () => {
  it('suggests the dated name in Documents, writes JSON and reports the count', async () => {
    const { d, toast, writes } = deps()
    const result = await exportPinnedHistory(d)

    expect(d.chooseSavePath).toHaveBeenCalledTimes(1)
    const suggested = vi.mocked(d.chooseSavePath).mock.calls[0][0]
    expect(suggested.split(sep).join('/')).toMatch(/^\/Users\/me\/Documents\/edge-drop-pinned-\d{4}-\d{2}-\d{2}\.json$/)
    expect(result).toEqual({ ok: true, path: writes[0].path, count: 1 })
    expect(JSON.parse(writes[0].data)).toEqual(validDoc)
    expect(toast).toHaveBeenCalledWith('toast.exported', 'info', { count: 1 })
  })

  it('does nothing when the dialog is cancelled', async () => {
    const { d, toast, writes } = deps({ chooseSavePath: vi.fn(async () => null) })
    await expect(exportPinnedHistory(d)).resolves.toEqual({ ok: false })
    expect(writes).toHaveLength(0)
    expect(toast).not.toHaveBeenCalled()
  })

  it('does not write an export the import would refuse', async () => {
    const { d, writes } = deps()
    await expect(exportPinnedHistory(d, 10)).resolves.toEqual({ ok: false })
    expect(writes).toHaveLength(0)
  })

  it('reports a write failure', async () => {
    const { d, toast } = deps({ writeFile: () => { throw new Error('EACCES') } })
    await expect(exportPinnedHistory(d)).resolves.toEqual({ ok: false })
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('importPinnedHistory', () => {
  it('imports, refreshes state and reports the count', async () => {
    const { d, toast } = deps()
    await expect(importPinnedHistory(d)).resolves.toEqual({ ok: true, count: 1 })
    expect(d.importPinned).toHaveBeenCalledWith(validDoc)
    expect(d.afterImport).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('toast.imported', 'info', { count: 1 })
  })

  it('shows importFailed for an unreadable or invalid file and does not touch the store', async () => {
    const { d, toast } = deps({ readFile: vi.fn(async () => ({ ok: false as const, reason: 'too-large' as const })) })
    await expect(importPinnedHistory(d)).resolves.toEqual({ ok: false })
    expect(d.importPinned).not.toHaveBeenCalled()
    expect(d.afterImport).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('toast.importFailed', 'error')
  })

  it('shows importFailed when the store throws', async () => {
    const { d, toast } = deps({ importPinned: vi.fn(() => { throw new Error('disk full') }) })
    await expect(importPinnedHistory(d)).resolves.toEqual({ ok: false })
    expect(toast).toHaveBeenCalledWith('toast.importFailed', 'error')
  })

  it('does nothing when the dialog is cancelled', async () => {
    const { d, toast } = deps({ chooseOpenPath: vi.fn(async () => null) })
    await expect(importPinnedHistory(d)).resolves.toEqual({ ok: false })
    expect(d.readFile).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })
})
