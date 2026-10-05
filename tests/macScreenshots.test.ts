import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

type ExecCallback = (err: Error | null, stdout?: string, stderr?: string) => void
type WatchListener = (event: string, fileName: string | null) => void

interface FakeWatcher {
  dir: string
  listener: WatchListener
  handlers: Record<string, (err: Error) => void>
  on: (event: string, fn: (err: Error) => void) => FakeWatcher
  close: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  watch: vi.fn(),
  statSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  createFromPath: vi.fn(),
  clipboardClear: vi.fn(),
  clipboardWriteImage: vi.fn(),
  location: '',
  screenCapture: true,
  sipsFails: false,
  watchers: [] as FakeWatcher[]
}))

vi.mock('electron', () => ({
  nativeImage: { createFromPath: (p: string) => mocks.createFromPath(p) },
  clipboard: {
    clear: () => mocks.clipboardClear(),
    writeImage: (img: unknown) => mocks.clipboardWriteImage(img)
  }
}))

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mocks.execFile(...args),
  execFileSync: (...args: unknown[]) => mocks.execFileSync(...args)
}))

vi.mock('node:fs', () => ({
  existsSync: (p: string) => mocks.existsSync(p),
  statSync: (p: string) => mocks.statSync(p),
  mkdirSync: (...args: unknown[]) => mocks.mkdirSync(...args),
  rmSync: (...args: unknown[]) => mocks.rmSync(...args),
  watch: (...args: unknown[]) => mocks.watch(...args)
}))

vi.mock('node:os', () => ({ homedir: () => '/Users/tester' }))

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>()
  return { ...actual.posix, default: actual.posix }
})

vi.mock('../electron/store/paths', () => ({
  PATHS: { tempDir: () => '/mock/userData/temp' }
}))

import { refreshScreenshotWatcher, screenshotDir, startScreenshotWatcher, stopScreenshotWatcher } from '../electron/main/macScreenshots'

const PNG = Buffer.from('png-bytes')

function commandCalls(cmd: string): unknown[][] {
  return mocks.execFile.mock.calls.filter((c) => c[0] === cmd)
}

async function emit(fileName: string, watcherIndex = mocks.watchers.length - 1): Promise<void> {
  mocks.watchers[watcherIndex].listener('rename', fileName)
  await vi.advanceTimersByTimeAsync(300)
}

describe('macOS screenshot watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setPlatform('darwin')
    mocks.location = ''
    mocks.screenCapture = true
    mocks.sipsFails = false
    mocks.watchers.length = 0
    for (const fn of [
      mocks.execFile, mocks.execFileSync, mocks.watch, mocks.statSync, mocks.existsSync, mocks.mkdirSync,
      mocks.rmSync, mocks.createFromPath, mocks.clipboardClear, mocks.clipboardWriteImage
    ]) fn.mockReset()

    mocks.execFile.mockImplementation((cmd: string, _args: string[], ...rest: unknown[]) => {
      const cb = rest[rest.length - 1] as ExecCallback
      if (cmd === '/usr/bin/defaults') {
        if (mocks.location) cb(null, `${mocks.location}\n`, '')
        else cb(new Error('The domain/default pair does not exist'))
      } else if (cmd === 'xattr') {
        cb(mocks.screenCapture ? null : new Error('No such xattr'))
      } else if (cmd === 'sips') {
        cb(mocks.sipsFails ? new Error('sips failed') : null)
      } else {
        cb(new Error(`unexpected ${cmd}`))
      }
    })
    mocks.existsSync.mockReturnValue(true)
    mocks.statSync.mockImplementation(() => ({ isFile: () => true, size: 1024, birthtimeMs: Date.now() }))
    mocks.createFromPath.mockImplementation(() => ({ isEmpty: () => false, toPNG: () => PNG }))
    mocks.watch.mockImplementation((dir: string, _opts: unknown, listener: WatchListener) => {
      const w: FakeWatcher = {
        dir,
        listener,
        handlers: {},
        on(event, fn) {
          w.handlers[event] = fn
          return w
        },
        close: vi.fn()
      }
      mocks.watchers.push(w)
      return w
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    stopScreenshotWatcher()
    vi.useRealTimers()
    vi.restoreAllMocks()
    restorePlatform()
  })

  afterAll(() => {
    restorePlatform()
  })

  async function start(onScreenshot = vi.fn(), isEnabled?: () => boolean) {
    startScreenshotWatcher(onScreenshot, isEnabled)
    await vi.advanceTimersByTimeAsync(0)
    return onScreenshot
  }

  it('does nothing on non-darwin platforms', async () => {
    for (const platform of ['win32', 'linux']) {
      setPlatform(platform)
      await start()
    }
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.watch).not.toHaveBeenCalled()
  })

  it('resolves the screenshot folder asynchronously and falls back to Desktop', async () => {
    await expect(screenshotDir()).resolves.toBe('/Users/tester/Desktop')
    mocks.location = '~/Pictures/Shots'
    await expect(screenshotDir()).resolves.toBe('/Users/tester/Pictures/Shots')
    mocks.existsSync.mockReturnValue(false)
    await expect(screenshotDir()).resolves.toBe('/Users/tester/Desktop')
    expect(mocks.execFileSync).not.toHaveBeenCalled()
  })

  it('hands a new screenshot to the handler without touching the clipboard', async () => {
    const onScreenshot = await start()
    expect(mocks.watchers).toHaveLength(1)
    expect(mocks.watchers[0].dir).toBe('/Users/tester/Desktop')

    await emit('Screenshot 2026-10-04 at 12.00.00.png')

    expect(mocks.createFromPath).toHaveBeenCalledWith('/Users/tester/Desktop/Screenshot 2026-10-04 at 12.00.00.png')
    expect(onScreenshot).toHaveBeenCalledTimes(1)
    expect(onScreenshot).toHaveBeenCalledWith(PNG, 'Screenshot 2026-10-04 at 12.00.00.png')
    expect(mocks.clipboardClear).not.toHaveBeenCalled()
    expect(mocks.clipboardWriteImage).not.toHaveBeenCalled()
  })

  it('reports the same file only once', async () => {
    const onScreenshot = await start()
    await emit('Shot.png')
    await emit('Shot.png')
    expect(onScreenshot).toHaveBeenCalledTimes(1)
  })

  it('ignores images that are not screen captures, old files, hidden files and other extensions', async () => {
    const onScreenshot = await start()
    mocks.screenCapture = false
    await emit('photo.png')
    await vi.advanceTimersByTimeAsync(1000)
    mocks.screenCapture = true
    await emit('photo.png')
    await emit('.Screenshot.png')
    await emit('notes.txt')
    mocks.statSync.mockImplementation(() => ({ isFile: () => true, size: 1024, birthtimeMs: Date.now() - 60_000 }))
    await emit('old.png')
    expect(onScreenshot).not.toHaveBeenCalled()
  })

  it('captures a screenshot whose screen-capture attribute is stamped late', async () => {
    const onScreenshot = await start()
    mocks.screenCapture = false
    await emit('Late.png')
    expect(onScreenshot).not.toHaveBeenCalled()

    mocks.screenCapture = true
    await vi.advanceTimersByTimeAsync(300)
    expect(onScreenshot).toHaveBeenCalledTimes(1)
    expect(onScreenshot).toHaveBeenCalledWith(PNG, 'Late.png')
    expect(commandCalls('xattr')).toHaveLength(2)
  })

  it('gives up on a file without the attribute after three checks', async () => {
    const onScreenshot = await start()
    mocks.screenCapture = false
    await emit('photo.png')
    await vi.advanceTimersByTimeAsync(2000)
    expect(commandCalls('xattr')).toHaveLength(3)

    mocks.screenCapture = true
    await emit('photo.png')
    await vi.advanceTimersByTimeAsync(2000)
    expect(commandCalls('xattr')).toHaveLength(3)
    expect(onScreenshot).not.toHaveBeenCalled()
  })

  it('retries a flagged screenshot whose image is not readable yet and does not blacklist it', async () => {
    let empty = true
    mocks.createFromPath.mockImplementation(() => ({ isEmpty: () => empty, toPNG: () => PNG }))
    const onScreenshot = await start()
    await emit('Slow.png')
    expect(onScreenshot).not.toHaveBeenCalled()

    empty = false
    await vi.advanceTimersByTimeAsync(300)
    expect(onScreenshot).toHaveBeenCalledTimes(1)

    empty = true
    await emit('Never.png')
    await vi.advanceTimersByTimeAsync(2000)
    empty = false
    await emit('Never.png')
    expect(onScreenshot).toHaveBeenCalledTimes(2)
    expect(onScreenshot).toHaveBeenLastCalledWith(PNG, 'Never.png')
  })

  it('handles duplicate watcher events for one file only once while it is being checked', async () => {
    const onScreenshot = await start()
    mocks.watchers[0].listener('rename', 'Burst.png')
    mocks.watchers[0].listener('change', 'Burst.png')
    await vi.advanceTimersByTimeAsync(300)
    expect(onScreenshot).toHaveBeenCalledTimes(1)
    expect(commandCalls('xattr')).toHaveLength(1)
  })

  it('does not watch the folder or poll defaults while the setting is off', async () => {
    await start(vi.fn(), () => false)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(mocks.watch).not.toHaveBeenCalled()
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts watching when the setting is turned on later', async () => {
    let enabled = false
    const onScreenshot = await start(vi.fn(), () => enabled)

    enabled = true
    refreshScreenshotWatcher()
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.watchers).toHaveLength(1)
    await emit('Shot.png')
    expect(onScreenshot).toHaveBeenCalledTimes(1)
  })

  it('closes the watcher and stops polling when the setting is turned off, and resumes on the next turn on', async () => {
    let enabled = true
    const onScreenshot = await start(vi.fn(), () => enabled)
    expect(mocks.watchers).toHaveLength(1)

    enabled = false
    refreshScreenshotWatcher()
    expect(mocks.watchers[0].close).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(commandCalls('/usr/bin/defaults')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)

    enabled = true
    refreshScreenshotWatcher()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.watchers).toHaveLength(2)
    await emit('Shot.png')
    expect(onScreenshot).toHaveBeenCalledTimes(1)
  })

  it('does not start a second poll when refreshed while already running', async () => {
    await start()
    refreshScreenshotWatcher()
    refreshScreenshotWatcher()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.watchers).toHaveLength(1)
    expect(commandCalls('/usr/bin/defaults')).toHaveLength(1)
  })

  it('does not attach when the setting is turned off while the folder is still being resolved', async () => {
    let enabled = true
    let answer: (() => void) | null = null
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], ...rest: unknown[]) => {
      const cb = rest[rest.length - 1] as ExecCallback
      answer = () => cb(new Error('not set'))
    })
    startScreenshotWatcher(vi.fn(), () => enabled)

    enabled = false
    refreshScreenshotWatcher()
    answer!()
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.watch).not.toHaveBeenCalled()
  })

  it('does nothing on refresh before the watcher was started or after it was stopped', async () => {
    refreshScreenshotWatcher()
    await start()
    stopScreenshotWatcher()
    mocks.execFile.mockClear()
    refreshScreenshotWatcher()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.watchers).toHaveLength(1)
  })

  it('ignores a file that lands right after the setting was turned off', async () => {
    let enabled = true
    const onScreenshot = await start(vi.fn(), () => enabled)
    enabled = false
    await emit('Shot.png')
    expect(onScreenshot).not.toHaveBeenCalled()
    expect(commandCalls('xattr')).toHaveLength(0)
  })

  it('converts HEIC through sips into the app temp dir and removes the temp file', async () => {
    const onScreenshot = await start()
    await emit('Shot.heic')

    const sips = commandCalls('sips')
    expect(sips).toHaveLength(1)
    const args = sips[0][1] as string[]
    expect(args.slice(0, 5)).toEqual(['-s', 'format', 'png', '/Users/tester/Desktop/Shot.heic', '--out'])
    const tmp = args[5]
    expect(tmp.startsWith('/mock/userData/temp/')).toBe(true)
    expect(tmp.endsWith('.png')).toBe(true)
    expect(mocks.mkdirSync).toHaveBeenCalledWith('/mock/userData/temp', { recursive: true })
    expect(mocks.createFromPath).toHaveBeenCalledTimes(1)
    expect(mocks.createFromPath).toHaveBeenCalledWith(tmp)
    expect(mocks.rmSync).toHaveBeenCalledWith(tmp, { force: true })
    expect(onScreenshot).toHaveBeenCalledWith(PNG, 'Shot.png')
  })

  it('drops a HEIC screenshot when sips fails and still cleans up', async () => {
    mocks.sipsFails = true
    const onScreenshot = await start()
    await emit('Shot.heic')
    expect(onScreenshot).not.toHaveBeenCalled()
    expect(mocks.createFromPath).not.toHaveBeenCalled()
    expect(mocks.rmSync).toHaveBeenCalledTimes(1)
  })

  it.each(['Shot.png', 'Shot.jpg', 'Shot.JPEG'])('does not call sips for %s, which nativeImage can read', async (name) => {
    const onScreenshot = await start()
    await emit(name)
    expect(commandCalls('sips')).toHaveLength(0)
    expect(onScreenshot).toHaveBeenCalledTimes(1)
  })

  it.each(['Shot.tiff', 'Shot.tif', 'Shot.gif', 'Shot.bmp', 'Shot.webp', 'Shot.HEIC'])('converts %s through sips before loading it', async (name) => {
    const onScreenshot = await start()
    await emit(name)

    const sips = commandCalls('sips')
    expect(sips).toHaveLength(1)
    const args = sips[0][1] as string[]
    expect(args[3]).toBe(`/Users/tester/Desktop/${name}`)
    expect(mocks.createFromPath).toHaveBeenCalledTimes(1)
    expect(mocks.createFromPath).toHaveBeenCalledWith(args[5])
    expect(mocks.rmSync).toHaveBeenCalledWith(args[5], { force: true })
    expect(onScreenshot).toHaveBeenCalledWith(PNG, name.replace(/\.[^.]+$/, '.png'))
  })

  it('logs and drops a screenshot whose image is still empty after loading', async () => {
    mocks.createFromPath.mockImplementation(() => ({ isEmpty: () => true, toPNG: () => PNG }))
    const onScreenshot = await start()
    await emit('Shot.tiff')
    await emit('Other.png')

    expect(onScreenshot).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith('[Screenshots] empty image after loading', '/Users/tester/Desktop/Shot.tiff')
    expect(console.error).toHaveBeenCalledWith('[Screenshots] empty image after loading', '/Users/tester/Desktop/Other.png')
  })

  it('still settles when removing the temp file throws after sips failed', async () => {
    mocks.sipsFails = true
    mocks.rmSync.mockImplementation(() => {
      throw new Error('EPERM')
    })
    const onScreenshot = await start()
    await emit('Shot.heic')
    await emit('Next.png')

    expect(onScreenshot).toHaveBeenCalledTimes(1)
    expect(onScreenshot).toHaveBeenCalledWith(PNG, 'Next.png')
  })

  it('survives an FSWatcher error and re-attaches on the next poll', async () => {
    const onScreenshot = await start()
    const first = mocks.watchers[0]
    expect(first.handlers.error).toBeTypeOf('function')

    expect(() => first.handlers.error(new Error('EPERM'))).not.toThrow()
    expect(first.close).toHaveBeenCalled()
    expect(mocks.watchers).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(180_000)
    expect(mocks.watchers).toHaveLength(2)
    await emit('After.png')
    expect(onScreenshot).toHaveBeenCalledWith(PNG, 'After.png')
  })

  it('polls the save location no more often than every two minutes and follows a change', async () => {
    await start()
    expect(commandCalls('/usr/bin/defaults')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(119_000)
    expect(commandCalls('/usr/bin/defaults')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(61_000)
    expect(commandCalls('/usr/bin/defaults')).toHaveLength(2)
    expect(mocks.watchers).toHaveLength(1)

    mocks.location = '/Users/tester/Shots'
    await vi.advanceTimersByTimeAsync(180_000)
    expect(mocks.watchers).toHaveLength(2)
    expect(mocks.watchers[0].close).toHaveBeenCalled()
    expect(mocks.watchers[1].dir).toBe('/Users/tester/Shots')
    expect(mocks.execFileSync).not.toHaveBeenCalled()
  })

  it('keeps running when the folder cannot be watched', async () => {
    mocks.watch.mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })
    await start()
    expect(mocks.watchers).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(180_000)
    expect(mocks.watchers).toHaveLength(1)
  })

  it('stops polling and closes the watcher on stop', async () => {
    await start()
    stopScreenshotWatcher()
    expect(mocks.watchers[0].close).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(commandCalls('/usr/bin/defaults')).toHaveLength(1)
  })
})
