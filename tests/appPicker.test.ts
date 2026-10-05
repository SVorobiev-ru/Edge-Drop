import { afterEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  nativePng: null as Buffer | null,
  fileIcon: vi.fn(),
  appPath: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getFileIcon: mocks.fileIcon },
  dialog: {}
}))

vi.mock('../electron/main/macSourceApp', () => ({
  appIconPng: () => mocks.nativePng,
  appInfoForPath: () => null,
  appPathForBundleId: mocks.appPath,
  listRunningApps: () => [],
  ownBundleId: () => null
}))

afterEach(() => {
  restorePlatform()
  mocks.nativePng = null
  mocks.fileIcon.mockReset()
  mocks.appPath.mockReset()
  vi.resetModules()
})

describe('source app icons', () => {
  it('serves the workspace icon of the app as a png data url', async () => {
    setPlatform('darwin')
    mocks.nativePng = Buffer.from('icon')
    const { appIconDataUrl } = await import('../electron/main/appPicker')

    await expect(appIconDataUrl('com.stablyai.orca')).resolves.toBe(`data:image/png;base64,${Buffer.from('icon').toString('base64')}`)
    expect(mocks.fileIcon).not.toHaveBeenCalled()
  })

  it('falls back to the file icon when the workspace icon is unavailable', async () => {
    setPlatform('darwin')
    mocks.appPath.mockReturnValue('/Applications/Tool.app')
    mocks.fileIcon.mockResolvedValue({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,ZmFsbGJhY2s=' })
    const { appIconDataUrl } = await import('../electron/main/appPicker')

    await expect(appIconDataUrl('com.example.tool')).resolves.toBe('data:image/png;base64,ZmFsbGJhY2s=')
  })
})
