import { app, dialog } from 'electron'
import type { AppInfo } from '../../shared/types'
import { appIconPng, appInfoForPath, appPathForBundleId, listRunningApps, ownBundleId } from './macSourceApp'

const ICON_POINTS = 32

const iconCache = new Map<string, string>()

function runningAppsExcept(apps: readonly AppInfo[], ownId: string | null): AppInfo[] {
  return apps.filter((info) => info.bundleId !== ownId)
}

export function listOtherRunningApps(): AppInfo[] {
  if (process.platform !== 'darwin') return []
  return runningAppsExcept(listRunningApps(), ownBundleId())
}

export async function pickApplication(): Promise<AppInfo | null> {
  if (process.platform !== 'darwin') return null
  try {
    app.focus({ steal: true })
  } catch { /* ignore */ }
  const result = await dialog.showOpenDialog({
    defaultPath: '/Applications',
    properties: ['openFile'],
    filters: [{ name: 'Applications', extensions: ['app'] }]
  })
  const picked = result.canceled ? undefined : result.filePaths[0]
  return picked ? appInfoForPath(picked) : null
}

export async function appIconDataUrl(bundleId: string): Promise<string | null> {
  if (process.platform !== 'darwin' || typeof bundleId !== 'string' || !bundleId) return null
  const cached = iconCache.get(bundleId)
  if (cached) return cached
  const png = appIconPng(bundleId, ICON_POINTS)
  if (png) {
    const url = `data:image/png;base64,${png.toString('base64')}`
    iconCache.set(bundleId, url)
    return url
  }
  const appPath = appPathForBundleId(bundleId)
  if (!appPath) return null
  try {
    const icon = await app.getFileIcon(appPath, { size: 'normal' })
    if (icon.isEmpty()) return null
    const url = icon.toDataURL()
    iconCache.set(bundleId, url)
    return url
  } catch (err) {
    console.error('[AppPicker] could not load the app icon:', err)
    return null
  }
}
