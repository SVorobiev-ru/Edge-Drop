import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const fsRoots = vi.hoisted(() => ({
  userData: ''
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => join(fsRoots.userData, 'app'),
    getPath: (name: string) => (name === 'userData' ? fsRoots.userData : join(fsRoots.userData, name))
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true })
  },
  safeStorage: {
    isEncryptionAvailable: () => false
  }
}))

vi.mock('koffi', () => ({
  default: { load: () => ({ func: () => () => null }) }
}))

import { ItemStore } from '../electron/store/ItemStore'

const realPlatform = process.platform

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

describe('file entries for macOS app bundles', () => {
  let work = ''

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    fsRoots.userData = join(tmpdir(), `ed-entry-ud-${suffix}`)
    work = join(tmpdir(), `ed-entry-work-${suffix}`)
    mkdirSync(fsRoots.userData, { recursive: true })
    mkdirSync(work, { recursive: true })
  })

  afterEach(() => {
    setPlatform(realPlatform)
    rmSync(fsRoots.userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  afterAll(() => {
    setPlatform(realPlatform)
  })

  function entriesFor(paths: string[]) {
    const store = new ItemStore()
    store.add({ kind: 'files', paths }, 50)
    const dto = store.toDto()[0]
    if (dto.data.kind !== 'files') throw new Error('expected files item')
    return dto.data.entries ?? []
  }

  it('shows a .app bundle as an application on darwin', () => {
    setPlatform('darwin')
    const bundle = join(work, 'Safari.app')
    const upper = join(work, 'Legacy.APP')
    mkdirSync(join(bundle, 'Contents'), { recursive: true })
    mkdirSync(upper, { recursive: true })

    const [entry, upperEntry] = entriesFor([bundle, upper])

    expect(entry).toMatchObject({ name: 'Safari.app', ext: 'app', isDirectory: false, isImage: false, size: 0 })
    expect(upperEntry).toMatchObject({ name: 'Legacy.APP', ext: 'app', isDirectory: false })
  })

  it('keeps ordinary folders and files as they were on darwin', () => {
    setPlatform('darwin')
    const folder = join(work, 'Projects')
    const dotted = join(work, 'my.application')
    const file = join(work, 'notes.app')
    mkdirSync(folder, { recursive: true })
    mkdirSync(dotted, { recursive: true })
    writeFileSync(file, 'plain file')

    const [folderEntry, dottedEntry, fileEntry] = entriesFor([folder, dotted, file])

    expect(folderEntry).toMatchObject({ name: 'Projects', ext: '', isDirectory: true })
    expect(dottedEntry).toMatchObject({ name: 'my.application', ext: '', isDirectory: true })
    expect(fileEntry).toMatchObject({ name: 'notes.app', ext: 'app', isDirectory: false, size: 10 })
  })

  it('still treats a directory named *.app as a folder on win32', () => {
    setPlatform('win32')
    const bundle = join(work, 'Portable.app')
    mkdirSync(bundle, { recursive: true })

    const [entry] = entriesFor([bundle])

    expect(entry).toMatchObject({ name: 'Portable.app', ext: '', isDirectory: true })
  })

  it.each(['IMG_1.heic', 'IMG_2.HEIF'])('gives %s an image preview on darwin', (name) => {
    setPlatform('darwin')
    const file = join(work, name)
    writeFileSync(file, 'heic bytes')

    const [entry] = entriesFor([file])

    expect(entry).toMatchObject({ name, isImage: true, isDirectory: false })
    expect(entry.preview).toBe(`edgelocal://thumb/file/${encodeURIComponent(file)}`)
  })

  it('keeps a HEIC file a plain file without a preview on win32', () => {
    setPlatform('win32')
    const file = join(work, 'IMG_3.heic')
    writeFileSync(file, 'heic bytes')

    const [entry] = entriesFor([file])

    expect(entry).toMatchObject({ name: 'IMG_3.heic', ext: 'heic', isImage: false })
    expect(entry.preview).toBeUndefined()
  })

  it('does not treat a folder named *.heic as an image on darwin', () => {
    setPlatform('darwin')
    const folder = join(work, 'album.heic')
    mkdirSync(folder, { recursive: true })

    const [entry] = entriesFor([folder])

    expect(entry).toMatchObject({ isDirectory: true, isImage: false })
    expect(entry.preview).toBeUndefined()
  })
})
