import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

type ExecCallback = (err: Error | null) => void

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  readFileSync: vi.fn(),
  createFromPath: vi.fn(),
  sipsFails: false,
  pending: [] as Array<() => void>,
  deferSips: false
}))

vi.mock('electron', () => ({
  nativeImage: { createFromPath: (p: string) => mocks.createFromPath(p) }
}))

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mocks.execFile(...args)
}))

vi.mock('node:fs', () => ({
  statSync: (p: string) => mocks.statSync(p),
  mkdirSync: (...args: unknown[]) => mocks.mkdirSync(...args),
  rmSync: (...args: unknown[]) => mocks.rmSync(...args),
  readFileSync: (p: string) => mocks.readFileSync(p)
}))

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>()
  return { ...actual.posix, default: actual.posix }
})

vi.mock('../electron/store/paths', () => ({
  PATHS: { tempDir: () => '/mock/userData/temp' }
}))

import { clearThumbnailCache, getHeicPreviewPng, getThumbnailPayload, getThumbnailPayloadAsync, isMacHeicPath } from '../electron/main/thumbnailCache'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

function sipsCalls(): unknown[][] {
  return mocks.execFile.mock.calls.filter((c) => c[0] === 'sips')
}

describe('HEIC thumbnails', () => {
  beforeEach(() => {
    setPlatform('darwin')
    clearThumbnailCache()
    mocks.sipsFails = false
    mocks.deferSips = false
    mocks.pending.length = 0
    for (const fn of [mocks.execFile, mocks.statSync, mocks.mkdirSync, mocks.rmSync, mocks.readFileSync, mocks.createFromPath]) fn.mockReset()
    mocks.readFileSync.mockImplementation(() => PNG)
    mocks.statSync.mockImplementation(() => ({ isFile: () => true, mtimeMs: 1000, size: 2048 }))
    mocks.createFromPath.mockImplementation((p: string) => ({
      isEmpty: () => p.toLowerCase().endsWith('.heic'),
      getSize: () => ({ width: 240, height: 135 }),
      resize: () => ({ toPNG: () => PNG }),
      toPNG: () => PNG
    }))
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
      const done = () => cb(mocks.sipsFails ? new Error('sips failed') : null)
      if (mocks.deferSips) mocks.pending.push(done)
      else done()
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restorePlatform()
  })

  afterAll(() => {
    restorePlatform()
  })

  it('nativeImage alone cannot produce a HEIC thumbnail', () => {
    expect(getThumbnailPayload('/Users/tester/Photos/IMG_1.HEIC')).toBeNull()
  })

  it('converts through sips into the app temp dir, bounded to the thumbnail size', async () => {
    const payload = await getThumbnailPayloadAsync('/Users/tester/Photos/IMG_1.HEIC')
    expect(payload).not.toBeNull()
    expect(payload!.contentType).toBe('image/png')
    expect(payload!.body).toEqual(PNG)
    expect(payload!.etag).toMatch(/^"[0-9a-f]{64}"$/)

    expect(sipsCalls()).toHaveLength(1)
    const args = sipsCalls()[0][1] as string[]
    expect(args.slice(0, 7)).toEqual(['-s', 'format', 'png', '-Z', '240', '/Users/tester/Photos/IMG_1.HEIC', '--out'])
    const tmp = args[7]
    expect(tmp.startsWith('/mock/userData/temp/')).toBe(true)
    expect(tmp.endsWith('.png')).toBe(true)
    expect(mocks.mkdirSync).toHaveBeenCalledWith('/mock/userData/temp', { recursive: true })
    expect(mocks.createFromPath).toHaveBeenCalledWith(tmp)
  })

  it('removes the temp file after encoding', async () => {
    await getThumbnailPayloadAsync('/Users/tester/Photos/IMG_1.heic')
    const tmp = (sipsCalls()[0][1] as string[])[7]
    expect(mocks.rmSync).toHaveBeenCalledTimes(1)
    expect(mocks.rmSync).toHaveBeenCalledWith(tmp, { force: true })
  })

  it('removes the temp file even when decoding the converted image throws', async () => {
    mocks.createFromPath.mockImplementation(() => {
      throw new Error('decode failed')
    })
    await expect(getThumbnailPayloadAsync('/Users/tester/Photos/IMG_1.heic')).resolves.toBeNull()
    expect(mocks.rmSync).toHaveBeenCalledTimes(1)
  })

  it('returns null and cleans up when sips fails', async () => {
    mocks.sipsFails = true
    await expect(getThumbnailPayloadAsync('/Users/tester/Photos/IMG_1.heic')).resolves.toBeNull()
    expect(mocks.createFromPath).not.toHaveBeenCalled()
    expect(mocks.rmSync).toHaveBeenCalledTimes(1)
  })

  it('still resolves when removing the leftover temp file throws after a sips failure', async () => {
    mocks.sipsFails = true
    mocks.rmSync.mockImplementation(() => {
      throw new Error('EPERM')
    })
    await expect(getThumbnailPayloadAsync('/Users/tester/Photos/IMG_1.heic')).resolves.toBeNull()
    expect(console.error).toHaveBeenCalledWith('[Heic] cannot remove', expect.stringContaining('/mock/userData/temp/'), expect.any(Error))
  })

  it('does not block: the conversion runs through the async execFile', async () => {
    mocks.deferSips = true
    let settled = false
    const job = getThumbnailPayloadAsync('/Users/tester/Photos/IMG_1.heic').then((p) => {
      settled = true
      return p
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    mocks.pending.shift()!()
    await expect(job).resolves.not.toBeNull()
  })

  it('shares one conversion between concurrent requests and caches the result', async () => {
    mocks.deferSips = true
    const a = getThumbnailPayloadAsync('/Users/tester/Photos/IMG_1.heic')
    const b = getThumbnailPayloadAsync('/Users/tester/Photos/IMG_1.heic')
    expect(sipsCalls()).toHaveLength(1)
    mocks.pending.shift()!()
    const [first, second] = await Promise.all([a, b])
    expect(second).toBe(first)

    await expect(getThumbnailPayloadAsync('/Users/tester/Photos/IMG_1.heic')).resolves.toBe(first)
    expect(sipsCalls()).toHaveLength(1)
  })

  it('converts again when the source file changes', async () => {
    await getThumbnailPayloadAsync('/Users/tester/Photos/IMG_1.heic')
    mocks.statSync.mockImplementation(() => ({ isFile: () => true, mtimeMs: 2000, size: 4096 }))
    await getThumbnailPayloadAsync('/Users/tester/Photos/IMG_1.heic')
    expect(sipsCalls()).toHaveLength(2)
  })

  it('returns null for a missing file without calling sips', async () => {
    mocks.statSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    await expect(getThumbnailPayloadAsync('/Users/tester/Photos/gone.heic')).resolves.toBeNull()
    expect(sipsCalls()).toHaveLength(0)
  })

  it('does not call sips for formats nativeImage can read', async () => {
    await expect(getThumbnailPayloadAsync('/Users/tester/Photos/shot.png')).resolves.not.toBeNull()
    expect(sipsCalls()).toHaveLength(0)
  })

  it('does not call sips outside macOS', async () => {
    setPlatform('win32')
    await expect(getThumbnailPayloadAsync('C:/Photos/IMG_1.heic')).resolves.toBeNull()
    expect(sipsCalls()).toHaveLength(0)
  })

  describe('full preview for the flyout', () => {
    it('recognises HEIC and HEIF files only on macOS', () => {
      expect(isMacHeicPath('/Users/tester/Photos/IMG_1.HEIC')).toBe(true)
      expect(isMacHeicPath('/Users/tester/Photos/IMG_1.heif')).toBe(true)
      expect(isMacHeicPath('/Users/tester/Photos/shot.png')).toBe(false)
      setPlatform('win32')
      expect(isMacHeicPath('C:/Photos/IMG_1.heic')).toBe(false)
    })

    it('converts through sips with a larger bound and returns the PNG bytes', async () => {
      await expect(getHeicPreviewPng('/Users/tester/Photos/IMG_1.HEIC')).resolves.toEqual(PNG)

      expect(sipsCalls()).toHaveLength(1)
      const args = sipsCalls()[0][1] as string[]
      expect(args.slice(0, 7)).toEqual(['-s', 'format', 'png', '-Z', '2048', '/Users/tester/Photos/IMG_1.HEIC', '--out'])
      expect(args[7].startsWith('/mock/userData/temp/preview-')).toBe(true)
      expect(mocks.readFileSync).toHaveBeenCalledWith(args[7])
      expect(mocks.rmSync).toHaveBeenCalledWith(args[7], { force: true })
    })

    it('returns null when sips fails', async () => {
      mocks.sipsFails = true
      await expect(getHeicPreviewPng('/Users/tester/Photos/IMG_1.heic')).resolves.toBeNull()
      expect(mocks.readFileSync).not.toHaveBeenCalled()
    })

    it('returns null and still removes the temp file when it cannot be read', async () => {
      mocks.readFileSync.mockImplementation(() => {
        throw new Error('EIO')
      })
      await expect(getHeicPreviewPng('/Users/tester/Photos/IMG_1.heic')).resolves.toBeNull()
      expect(mocks.rmSync).toHaveBeenCalledTimes(1)
    })

    it('does nothing for other formats and outside macOS', async () => {
      await expect(getHeicPreviewPng('/Users/tester/Photos/shot.png')).resolves.toBeNull()
      setPlatform('win32')
      await expect(getHeicPreviewPng('C:/Photos/IMG_1.heic')).resolves.toBeNull()
      expect(sipsCalls()).toHaveLength(0)
    })
  })
})
