import { app, dialog } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomicSync } from '../store/atomicWrite'

const MAX_BACKUP_BYTES = 200 * 1024 * 1024
const BACKUP_FORMAT = 'edge-drop-pinned'

export type BackupReadResult = { ok: true; doc: unknown } | { ok: false; reason: 'too-large' | 'unreadable' | 'invalid' }

export interface BackupDeps {
  exportPinned(): { items: unknown[] }
  importPinned(doc: unknown): number
  afterImport(): void
  toast(message: string, tone: 'info' | 'error', params?: Record<string, string | number>): void
  chooseSavePath(defaultPath: string): Promise<string | null>
  chooseOpenPath(defaultDir: string): Promise<string | null>
  documentsDir(): string
  writeFile(path: string, data: string): void
  readFile(path: string): Promise<BackupReadResult>
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function defaultBackupName(date = new Date()): string {
  return `edge-drop-pinned-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`
}

export function isBackupShape(doc: unknown): boolean {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return false
  const record = doc as Record<string, unknown>
  return record.format === BACKUP_FORMAT && Array.isArray(record.items)
}

export async function readBackupFile(path: string, maxBytes = MAX_BACKUP_BYTES): Promise<BackupReadResult> {
  let raw: string
  try {
    const info = await stat(path)
    if (!info.isFile()) return { ok: false, reason: 'unreadable' }
    if (info.size > maxBytes) return { ok: false, reason: 'too-large' }
    raw = await readFile(path, 'utf8')
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  return isBackupShape(doc) ? { ok: true, doc } : { ok: false, reason: 'invalid' }
}

export async function exportPinnedHistory(deps: BackupDeps, maxBytes = MAX_BACKUP_BYTES): Promise<{ ok: boolean; path?: string; count?: number }> {
  const target = await deps.chooseSavePath(join(deps.documentsDir(), defaultBackupName()))
  if (!target) return { ok: false }
  const doc = deps.exportPinned()
  const json = JSON.stringify(doc, null, 2)
  if (Buffer.byteLength(json, 'utf8') > maxBytes) {
    console.error('[Backup] export is larger than the import limit, not written')
    return { ok: false }
  }
  try {
    deps.writeFile(target, json)
  } catch (err) {
    console.error('[Backup] could not write the export file:', err)
    return { ok: false }
  }
  const count = doc.items.length
  deps.toast('toast.exported', 'info', { count })
  return { ok: true, path: target, count }
}

export async function importPinnedHistory(deps: BackupDeps): Promise<{ ok: boolean; count?: number }> {
  const source = await deps.chooseOpenPath(deps.documentsDir())
  if (!source) return { ok: false }
  const read = await deps.readFile(source)
  if (!read.ok) {
    console.error('[Backup] import rejected:', read.reason)
    deps.toast('toast.importFailed', 'error')
    return { ok: false }
  }
  let count: number
  try {
    count = deps.importPinned(read.doc)
  } catch (err) {
    console.error('[Backup] import failed:', err)
    deps.toast('toast.importFailed', 'error')
    return { ok: false }
  }
  deps.afterImport()
  deps.toast('toast.imported', 'info', { count })
  return { ok: true, count }
}

const JSON_FILTERS = [{ name: 'JSON', extensions: ['json'] }]

function focusApp(): void {
  if (process.platform !== 'darwin') return
  try {
    app.focus({ steal: true })
  } catch { /* ignore */ }
}

export const electronBackupIo: Pick<BackupDeps, 'chooseSavePath' | 'chooseOpenPath' | 'documentsDir' | 'writeFile' | 'readFile'> = {
  async chooseSavePath(defaultPath) {
    focusApp()
    const result = await dialog.showSaveDialog({ defaultPath, filters: JSON_FILTERS, properties: ['createDirectory', 'showOverwriteConfirmation'] })
    return result.canceled || !result.filePath ? null : result.filePath
  },
  async chooseOpenPath(defaultDir) {
    focusApp()
    const result = await dialog.showOpenDialog({ defaultPath: defaultDir, filters: JSON_FILTERS, properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  },
  documentsDir: () => app.getPath('documents'),
  writeFile: (path, data) => writeFileAtomicSync(path, data),
  readFile: (path) => readBackupFile(path)
}
