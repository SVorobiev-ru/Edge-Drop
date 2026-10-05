import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const spawn = vi.hoisted(() =>
  vi.fn(() => ({
    stdout: { on: vi.fn() },
    stdin: { write: vi.fn() },
    on: vi.fn(),
    kill: vi.fn()
  }))
)

vi.mock('node:child_process', () => ({
  spawn,
  execFile: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/mock/app',
    getPath: () => '/mock/userData'
  }
}))

vi.mock('../electron/main/config', () => ({
  isStoreBuild: () => false
}))

async function loadHost(): Promise<typeof import('../electron/main/powershell')> {
  vi.resetModules()
  return import('../electron/main/powershell')
}

describe('psHost.run outside Windows', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    spawn.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    restorePlatform()
  })

  afterAll(() => {
    restorePlatform()
  })

  for (const platform of ['darwin', 'linux']) {
    it(`rejects immediately on ${platform} without queueing or arming the timeout`, async () => {
      setPlatform(platform)
      const { psHost } = await loadHost()

      let error: unknown = null
      void psHost.run('Write-Host 1', 3000).catch((err) => {
        error = err
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).not.toBe('TIMEOUT')
      expect(vi.getTimerCount()).toBe(0)
      expect(spawn).not.toHaveBeenCalled()
    })
  }

  it('still queues the script and arms the fallback timeout on win32', async () => {
    setPlatform('win32')
    const { psHost } = await loadHost()
    expect(spawn).toHaveBeenCalledTimes(1)
    const proc = spawn.mock.results[0].value

    let error: unknown = null
    void psHost.run('Write-Host 1', 3000).catch((err) => {
      error = err
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(error).toBeNull()
    expect(proc.stdin.write).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(3000)
    expect((error as unknown as Error).message).toBe('TIMEOUT')
  })
})
