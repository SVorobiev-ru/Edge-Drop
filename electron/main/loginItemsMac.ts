import { release } from 'node:os'
import { app } from 'electron'
import type { LaunchAtLoginResult } from './loginItems'

const DARWIN_MAJOR_WITH_SM_APP_SERVICE = 22

export function macSupportsMainAppService(osRelease: string = release()): boolean {
  const major = Number.parseInt(osRelease.split('.')[0] ?? '', 10)
  return Number.isFinite(major) && major >= DARWIN_MAJOR_WITH_SM_APP_SERVICE
}

/** macOS: Login Items via SMAppService (macOS 13+) with legacy fallback. */
export function readMacLaunchAtLogin(): LaunchAtLoginResult {
  try {
    if (!macSupportsMainAppService()) {
      return { enabled: !!app.getLoginItemSettings().openAtLogin, blockedByUser: false, ok: true }
    }
    const s = app.getLoginItemSettings({ type: 'mainAppService' } as Electron.LoginItemSettingsOptions) as Electron.LoginItemSettings & { status?: string }
    if (s.status) {
      return { enabled: s.status === 'enabled', blockedByUser: s.status === 'requires-approval', ok: true }
    }
    return { enabled: !!s.openAtLogin, blockedByUser: false, ok: true }
  } catch {
    return { enabled: false, blockedByUser: false, ok: false }
  }
}

export function applyMacLaunchAtLogin(wantLaunch: boolean): LaunchAtLoginResult {
  try {
    if (macSupportsMainAppService()) {
      app.setLoginItemSettings({ openAtLogin: wantLaunch, type: 'mainAppService' } as Electron.Settings)
    } else {
      app.setLoginItemSettings({ openAtLogin: wantLaunch })
    }
  } catch (err) {
    console.error('[LoginItems] macOS setLoginItemSettings failed:', err)
  }
  const read = readMacLaunchAtLogin()
  return { ...read, ok: read.ok && (read.enabled === wantLaunch || read.blockedByUser) }
}
