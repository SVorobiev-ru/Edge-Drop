import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mocks = vi.hoisted(() => ({
  userData: '',
  svgKinds: [] as string[][]
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => `${mocks.userData}/app`,
    getPath: () => mocks.userData,
    getFileIcon: vi.fn(() => Promise.resolve({ isEmpty: () => true }))
  },
  nativeImage: {
    createFromBuffer: vi.fn(() => ({ isEmpty: () => false }))
  }
}))

vi.mock('@resvg/resvg-js', () => ({
  Resvg: class {
    render() {
      return { asPng: () => Buffer.from('png') }
    }
  }
}))

vi.mock('../electron/main/fileSvg', () => ({
  buildFileDragSvg: (kinds: string[]) => {
    mocks.svgKinds.push(kinds)
    return '<svg/>'
  }
}))

vi.mock('../electron/main/state', () => ({
  getStore: () => ({ get: () => null, getImagePath: () => '' })
}))

const realPlatform = process.platform

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

describe('drag icon kind for macOS app bundles', () => {
  let work = ''
  let appPath = ''
  let folderPath = ''

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    mocks.userData = join(tmpdir(), `ed-dragapp-ud-${suffix}`)
    work = join(tmpdir(), `ed-dragapp-work-${suffix}`)
    appPath = join(work, 'Sample.app')
    folderPath = join(work, 'Docs')
    mkdirSync(mocks.userData, { recursive: true })
    mkdirSync(join(appPath, 'Contents'), { recursive: true })
    mkdirSync(folderPath, { recursive: true })
    writeFileSync(join(work, 'note.txt'), 'x')
    mocks.svgKinds.length = 0
  })

  afterEach(() => {
    setPlatform(realPlatform)
    rmSync(mocks.userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  afterAll(() => {
    setPlatform(realPlatform)
  })

  async function dragKinds(platform: string, paths: string[], entries?: Array<{ name: string; ext: string; size: number; isImage: boolean; isDirectory?: boolean }>): Promise<string[]> {
    setPlatform(platform)
    vi.resetModules()
    const { startDragOut } = await import('../electron/main/drag')
    const sender = { startDrag: vi.fn() }
    expect(startDragOut(sender as any, { kind: 'files', paths, entries })).toBe(true)
    expect(sender.startDrag).toHaveBeenCalledTimes(1)
    return mocks.svgKinds[mocks.svgKinds.length - 1]
  }

  it('on darwin draws an .app bundle as an application and a plain folder as a folder', async () => {
    expect(await dragKinds('darwin', [appPath, folderPath, join(work, 'note.txt')])).toEqual(['executable', 'folder', 'text'])
  })

  it('on darwin ignores a stale isDirectory flag stored for an .app bundle', async () => {
    const entries = [{ name: 'Sample.app', ext: 'app', size: 0, isImage: false, isDirectory: true }]
    expect(await dragKinds('darwin', [appPath], entries)).toEqual(['executable'])
  })

  it('on darwin resolves a sub-item drag of an .app bundle as an application', async () => {
    setPlatform('darwin')
    vi.resetModules()
    const state = await import('../electron/main/state')
    vi.spyOn(state, 'getStore').mockReturnValue({
      get: () => ({ id: 'p', data: { kind: 'files', paths: [appPath, folderPath], entries: [] } })
    } as any)
    const { resolveDragData } = await import('../electron/main/drag')

    const resolved = resolveDragData({ id: 'p', paths: [appPath, folderPath] })

    expect(resolved?.data).toMatchObject({
      kind: 'files',
      entries: [{ name: appPath, isDirectory: false }, { name: folderPath, isDirectory: true }]
    })
    vi.restoreAllMocks()
  })

  it('on win32 a directory named *.app stays a folder', async () => {
    expect(await dragKinds('win32', [appPath])).toEqual(['folder'])
  })
})

describe('screenshot capture setting', () => {
  it('defaults to enabled', async () => {
    const { DEFAULT_SETTINGS } = await import('../shared/types')
    expect(DEFAULT_SETTINGS.captureScreenshots).toBe(true)
  })

  it('has en and ru texts that name the screenshot shortcuts', async () => {
    const { en, ru } = await import('../src/i18n/translations')
    for (const dict of [en, ru]) {
      expect(dict.behaviour.captureScreenshotsTitle).toBeTruthy()
      expect(dict.behaviour.captureScreenshotsDesc).toContain('⌘⇧3')
      expect(dict.behaviour.captureScreenshotsDesc).toContain('⌘⇧5')
    }
  })
})
