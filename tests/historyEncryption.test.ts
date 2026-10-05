import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  userData: '',
  available: true,
  decryptFails: false,
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn()
}))

vi.mock('electron', async () => ({
  app: (await import('./helpers/electronMock')).userDataApp(() => mocks.userData),
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  clipboard: {},
  safeStorage: {
    isEncryptionAvailable: mocks.isEncryptionAvailable,
    encryptString: mocks.encryptString,
    decryptString: mocks.decryptString
  }
}))

vi.mock('koffi', () => import('./helpers/koffiMock'))

import { ItemStore } from '../electron/store/ItemStore'

function indexFile(): string {
  return join(mocks.userData, 'items.json')
}

function plainIndex(...texts: string[]): string {
  return JSON.stringify({
    items: texts.map((text, i) => ({
      id: `id-${i}`,
      data: { kind: 'text', text, isUrl: false },
      capturedAt: 1000 + i,
      hitCount: 1,
      pinned: false
    }))
  })
}

function envelope(plain: string): string {
  return JSON.stringify({ v: 2, encrypted: true, payload: Buffer.from(`enc:${plain}`).toString('base64') })
}

function safeStorageCalls(): number {
  return mocks.isEncryptionAvailable.mock.calls.length + mocks.encryptString.mock.calls.length + mocks.decryptString.mock.calls.length
}

function writeStorageFile(dir: string, name: string, ageSeconds: number): void {
  const file = join(mocks.userData, dir, name)
  writeFileSync(file, 'data')
  const time = Date.now() / 1000 - ageSeconds
  utimesSync(file, time, time)
}

function corruptedCopies(): string[] {
  return readdirSync(mocks.userData).filter((name) => name.startsWith('items.json.corrupted.')).sort()
}

beforeEach(() => {
  mocks.userData = join(tmpdir(), `ed-enc-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(join(mocks.userData, 'payloads'), { recursive: true })
  mkdirSync(join(mocks.userData, 'images'), { recursive: true })
  mkdirSync(join(mocks.userData, 'thumbnails'), { recursive: true })
  mocks.available = true
  mocks.decryptFails = false
  mocks.isEncryptionAvailable.mockReset().mockImplementation(() => mocks.available)
  mocks.encryptString.mockReset().mockImplementation((plain: string) => Buffer.from(`enc:${plain}`))
  mocks.decryptString.mockReset().mockImplementation((buf: Buffer) => {
    if (mocks.decryptFails) throw new Error('keychain denied')
    return buf.toString('utf8').replace(/^enc:/, '')
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  setPlatform('darwin')
})

afterEach(() => {
  vi.restoreAllMocks()
  restorePlatform()
  rmSync(mocks.userData, { recursive: true, force: true })
})

afterAll(() => {
  restorePlatform()
})

describe('items.json on darwin', () => {
  it('loads a plain file and saves plain JSON without touching safeStorage', () => {
    writeFileSync(indexFile(), plainIndex('alpha', 'beta'))
    const store = new ItemStore()
    store.load()

    expect(store.list().map((it) => it.data.kind === 'text' && it.data.text)).toEqual(['alpha', 'beta'])

    store.add({ kind: 'text', text: 'gamma', isUrl: false }, 50)
    store.persistSync()

    const saved = JSON.parse(readFileSync(indexFile(), 'utf8'))
    expect(saved.encrypted).toBeUndefined()
    expect(saved.items).toHaveLength(3)
    expect(safeStorageCalls()).toBe(0)
    expect(existsSync(`${indexFile()}.v1.bak`)).toBe(false)
    expect(existsSync(`${indexFile()}.tmp`)).toBe(false)
  })

  it('does not touch safeStorage when there is no index file yet', () => {
    const store = new ItemStore()
    store.load()
    store.add({ kind: 'text', text: 'first', isUrl: false }, 50)
    store.persistSync()

    expect(JSON.parse(readFileSync(indexFile(), 'utf8')).items).toHaveLength(1)
    expect(safeStorageCalls()).toBe(0)
  })

  it('decrypts an encrypted file and rewrites it as plain JSON on the next save', () => {
    writeFileSync(indexFile(), envelope(plainIndex('secret')))
    const store = new ItemStore()
    store.load()

    expect(store.list()).toHaveLength(1)
    expect(mocks.decryptString).toHaveBeenCalledTimes(1)

    store.persistSync()

    const saved = JSON.parse(readFileSync(indexFile(), 'utf8'))
    expect(saved.encrypted).toBeUndefined()
    expect(saved.items[0].data.text).toBe('secret')
    expect(mocks.encryptString).not.toHaveBeenCalled()
    expect(existsSync(`${indexFile()}.encrypted-backup`)).toBe(false)

    mocks.isEncryptionAvailable.mockClear()
    mocks.decryptString.mockClear()
    const reopened = new ItemStore()
    reopened.load()
    expect(reopened.list()).toHaveLength(1)
    expect(safeStorageCalls()).toBe(0)
  })

  it('schedules the plain rewrite by itself after a successful decryption', () => {
    vi.useFakeTimers()
    try {
      writeFileSync(indexFile(), envelope(plainIndex('secret')))
      new ItemStore().load()
      vi.advanceTimersByTime(200)
      expect(JSON.parse(readFileSync(indexFile(), 'utf8')).encrypted).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts empty and moves an undecryptable file aside once', () => {
    const encrypted = envelope(plainIndex('locked'))
    writeFileSync(indexFile(), encrypted)
    writeFileSync(join(mocks.userData, 'payloads', 'id-0.txt'), 'long text of the locked history')
    mocks.decryptFails = true

    const store = new ItemStore()
    store.load()

    expect(store.list()).toHaveLength(0)
    expect(existsSync(indexFile())).toBe(false)
    expect(readFileSync(`${indexFile()}.encrypted-backup`, 'utf8')).toBe(encrypted)
    expect(corruptedCopies()).toEqual([])
    expect(existsSync(join(mocks.userData, 'payloads', 'id-0.txt'))).toBe(true)

    store.add({ kind: 'text', text: 'new life', isUrl: false }, 50)
    store.persistSync()
    expect(JSON.parse(readFileSync(indexFile(), 'utf8')).items).toHaveLength(1)
    expect(readFileSync(`${indexFile()}.encrypted-backup`, 'utf8')).toBe(encrypted)
  })

  it('treats an unavailable keychain like a failed decryption', () => {
    writeFileSync(indexFile(), envelope(plainIndex('locked')))
    mocks.available = false

    const store = new ItemStore()
    store.load()

    expect(store.list()).toHaveLength(0)
    expect(mocks.decryptString).not.toHaveBeenCalled()
    expect(existsSync(`${indexFile()}.encrypted-backup`)).toBe(true)
  })

  it('never retries the backup and keeps its storage after later launches', () => {
    writeFileSync(indexFile(), envelope(plainIndex('locked')))
    writeFileSync(join(mocks.userData, 'payloads', 'id-0.txt'), 'kept for a manual restore')
    mocks.decryptFails = true
    const first = new ItemStore()
    first.load()
    first.add({ kind: 'text', text: 'after denial', isUrl: false }, 50)
    first.persistSync()

    mocks.decryptFails = false
    mocks.isEncryptionAvailable.mockClear()
    mocks.decryptString.mockClear()
    const second = new ItemStore()
    second.load()

    expect(second.list().map((it) => it.data.kind === 'text' && it.data.text)).toEqual(['after denial'])
    expect(safeStorageCalls()).toBe(0)
    expect(existsSync(join(mocks.userData, 'payloads', 'id-0.txt'))).toBe(true)
  })

  it('does not overwrite an existing backup with a newer failure and keeps three corrupted copies', () => {
    const backup = `${indexFile()}.encrypted-backup`
    writeFileSync(backup, 'the first backup')
    for (const ts of [100, 200, 300, 400]) writeFileSync(`${indexFile()}.corrupted.${ts}`, `old ${ts}`)
    const newer = envelope(plainIndex('newer'))
    writeFileSync(indexFile(), newer)
    mocks.decryptFails = true

    const store = new ItemStore()
    store.load()

    expect(store.list()).toHaveLength(0)
    expect(readFileSync(backup, 'utf8')).toBe('the first backup')
    expect(existsSync(indexFile())).toBe(false)
    const copies = corruptedCopies()
    expect(copies).toHaveLength(3)
    expect(copies).not.toContain('items.json.corrupted.100')
    expect(copies).not.toContain('items.json.corrupted.200')
    expect(copies.some((name) => readFileSync(join(mocks.userData, name), 'utf8') === newer)).toBe(true)
  })

  it('keeps at most three corrupted copies of an unreadable file and does not reconcile storage', () => {
    for (const ts of [100, 200, 300]) writeFileSync(`${indexFile()}.corrupted.${ts}`, `old ${ts}`)
    writeFileSync(indexFile(), 'not json at all')
    writeFileSync(join(mocks.userData, 'payloads', 'orphan.txt'), 'must survive a failed load')

    const store = new ItemStore()
    store.load()

    expect(store.list()).toHaveLength(0)
    const copies = corruptedCopies()
    expect(copies).toHaveLength(3)
    expect(copies).not.toContain('items.json.corrupted.100')
    expect(existsSync(join(mocks.userData, 'payloads', 'orphan.txt'))).toBe(true)
    expect(safeStorageCalls()).toBe(0)
  })

  it('still reconciles storage after a successful plain load', () => {
    writeFileSync(indexFile(), plainIndex('alpha'))
    writeStorageFile('payloads', 'orphan.txt', 120)
    writeStorageFile('images', 'gone.png', 120)
    writeStorageFile('thumbnails', 'gone.png', 120)
    new ItemStore().load()
    expect(existsSync(join(mocks.userData, 'payloads', 'orphan.txt'))).toBe(false)
    expect(existsSync(join(mocks.userData, 'images', 'gone.png'))).toBe(false)
    expect(existsSync(join(mocks.userData, 'thumbnails', 'gone.png'))).toBe(false)
  })

  it('keeps unreferenced files written during the last minute', () => {
    writeFileSync(indexFile(), plainIndex('alpha'))
    writeStorageFile('payloads', 'stale.txt', 120)
    writeStorageFile('images', 'fresh.png', 10)
    writeStorageFile('thumbnails', 'fresh.png', 10)
    new ItemStore().load()
    expect(existsSync(join(mocks.userData, 'payloads', 'stale.txt'))).toBe(false)
    expect(existsSync(join(mocks.userData, 'images', 'fresh.png'))).toBe(true)
    expect(existsSync(join(mocks.userData, 'thumbnails', 'fresh.png'))).toBe(true)
  })

  it('does not reconcile storage when the index had malformed entries', () => {
    const index = JSON.parse(plainIndex('alpha'))
    index.items.push(null, { id: 42, data: { kind: 'image', imageId: 'kept' } }, { id: 'no-data' })
    writeFileSync(indexFile(), JSON.stringify(index))
    writeStorageFile('payloads', 'orphan.txt', 120)
    writeStorageFile('images', 'kept.png', 120)

    const store = new ItemStore()
    store.load()

    expect(store.list()).toHaveLength(1)
    expect(existsSync(join(mocks.userData, 'payloads', 'orphan.txt'))).toBe(true)
    expect(existsSync(join(mocks.userData, 'images', 'kept.png'))).toBe(true)
  })

  it('keeps the full text of a very long item', () => {
    const store = new ItemStore()
    store.load()
    store.add({ kind: 'text', text: 'x'.repeat(500_010), isUrl: false }, 50)
    expect(store.getFullText(store.list()[0].id)).toHaveLength(500_010)
  })
})

describe('storage on win32 stays as upstream', () => {
  beforeEach(() => setPlatform('win32'))

  it('does not delete unreferenced files on load', () => {
    writeFileSync(indexFile(), plainIndex('alpha'))
    writeStorageFile('payloads', 'orphan.txt', 120)
    writeStorageFile('images', 'gone.png', 120)
    new ItemStore().load()
    expect(existsSync(join(mocks.userData, 'payloads', 'orphan.txt'))).toBe(true)
    expect(existsSync(join(mocks.userData, 'images', 'gone.png'))).toBe(true)
  })

  it('truncates text longer than 500 000 characters', () => {
    const store = new ItemStore()
    store.load()
    store.add({ kind: 'text', text: 'x'.repeat(500_010), isUrl: false }, 50)
    expect(store.getFullText(store.list()[0].id)).toHaveLength(500_000)
  })
})

describe('items.json on win32 keeps encryption', () => {
  beforeEach(() => setPlatform('win32'))

  it('saves an encrypted envelope and reads it back', () => {
    const store = new ItemStore()
    store.load()
    store.add({ kind: 'text', text: 'dpapi', isUrl: false }, 50)
    store.persistSync()

    const saved = JSON.parse(readFileSync(indexFile(), 'utf8'))
    expect(saved).toMatchObject({ v: 2, encrypted: true })
    expect(mocks.encryptString).toHaveBeenCalled()

    const reopened = new ItemStore()
    reopened.load()
    expect(reopened.list()).toHaveLength(1)
    expect(mocks.decryptString).toHaveBeenCalledTimes(1)
  })

  it('migrates a legacy plain file to the encrypted envelope with a v1 backup', () => {
    const legacy = plainIndex('legacy')
    writeFileSync(indexFile(), legacy)
    const store = new ItemStore()
    store.load()
    store.persistSync()

    expect(readFileSync(`${indexFile()}.v1.bak`, 'utf8')).toBe(legacy)
    expect(JSON.parse(readFileSync(indexFile(), 'utf8')).encrypted).toBe(true)
  })

  it('leaves an undecryptable file in place with a corrupted copy, as before', () => {
    const encrypted = envelope(plainIndex('locked'))
    writeFileSync(indexFile(), encrypted)
    for (const ts of [100, 200, 300, 400]) writeFileSync(`${indexFile()}.corrupted.${ts}`, `old ${ts}`)
    mocks.decryptFails = true

    const store = new ItemStore()
    store.load()

    expect(store.list()).toHaveLength(0)
    expect(readFileSync(indexFile(), 'utf8')).toBe(encrypted)
    expect(existsSync(`${indexFile()}.encrypted-backup`)).toBe(false)
    expect(corruptedCopies()).toHaveLength(5)
  })
})
