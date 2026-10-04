import { app, net, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isStoreBuild } from './config'
import { pushState } from './state'
import { getSettings } from '../store/settings'
import { resolveUpdateMode } from '../../shared/types'

export const MAC_UPDATE_REPO = 'SVorobiev-ru/Edge-Drop'
const MAC_RELEASES_API_URL = `https://api.github.com/repos/${MAC_UPDATE_REPO}/releases?per_page=30`
const MAC_RELEASES_PAGE_URL = `https://github.com/${MAC_UPDATE_REPO}/releases/latest`
const MAC_RELEASES_PATH = `/${MAC_UPDATE_REPO}/releases`

export interface CachedUpdateInfo {
  hasUpdate: boolean
  latestVersion: string
  downloaded: boolean
  downloadProgress?: { percent: number; bytesPerSecond?: number; transferred?: number; total?: number }
}

// Module-level reference to the single autoUpdater instance and cached update state.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _autoUpdater: any = null
let _cachedUpdateInfo: CachedUpdateInfo | null = null
let _macReleaseUrl: string | null = null

export function getCachedUpdateState(): CachedUpdateInfo | null {
  return _cachedUpdateInfo
}

export function clearCachedUpdateState(): void {
  _cachedUpdateInfo = null
}

/**
 * Called from ipc.ts when the renderer clicks "Restart to Update".
 */
export function quitAndInstallUpdate(): void {
  if (isStoreBuild() || process.platform === 'darwin') return
  if (!_autoUpdater) {
    console.error('[AutoUpdater] quitAndInstall requested but autoUpdater is not initialized.')
    return
  }
  if (!app.isPackaged) {
    console.log('[AutoUpdater] Dev mode — quitAndInstall is a no-op here. Works in packaged builds.')
    return
  }
  console.log('[AutoUpdater] quitAndInstall triggered by renderer button.')
  _autoUpdater.quitAndInstall(false, true)
}

/**
 * Syncs the download flags on electron-updater whenever user changes settings.
 * Only 'auto' mode downloads; 'notify' checks without downloading.
 */
export function syncAutoUpdaterState(): void {
  if (isStoreBuild() || !_autoUpdater) return
  const mode = resolveUpdateMode(getSettings())
  const autoDownload = mode === 'auto'
  _autoUpdater.autoDownload = autoDownload
  _autoUpdater.autoInstallOnAppQuit = autoDownload
  console.log('[AutoUpdater] Synced mode =', mode, 'autoDownload =', autoDownload)
}

let bgCheckTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Run a background check outside startup — e.g. right after the user switches
 * into 'auto' or 'notify' mode. Previously switching modes only flipped flags
 * and nothing happened until the next restart, which read as "notify never
 * shows anything". Debounced; switching to 'off' cancels a pending check so
 * off stays fully network-silent.
 */
export function triggerBackgroundCheck(delayMs = 3000): void {
  if (isStoreBuild()) return
  if (bgCheckTimer !== null) {
    clearTimeout(bgCheckTimer)
    bgCheckTimer = null
  }
  let mode: ReturnType<typeof resolveUpdateMode>
  try {
    mode = resolveUpdateMode(getSettings())
  } catch {
    return
  }
  if (process.platform === 'darwin') {
    if (mode === 'off') return
    bgCheckTimer = setTimeout(() => {
      bgCheckTimer = null
      void checkMacRelease().then((result) => {
        if (result.status === 'error') console.warn('[AutoUpdater] macOS release check failed:', result.error)
      })
    }, Math.max(0, delayMs))
    return
  }
  if (mode === 'off' || !_autoUpdater) return
  console.log('[AutoUpdater] Background check scheduled (mode switch).')
  bgCheckTimer = setTimeout(() => {
    bgCheckTimer = null
    try {
      const r = _autoUpdater.checkForUpdates() as unknown
      const p = r as Promise<unknown> | undefined
      if (p && typeof p.catch === 'function') {
        p.catch((err: unknown) => {
          const msg = typeof err === 'string' ? err : (err as { message?: string })?.message
          console.warn('[AutoUpdater] triggered check failed:', msg)
        })
      }
    } catch (err) {
      console.warn('[AutoUpdater] triggered check threw:', err)
    }
  }, Math.max(0, delayMs))
}

function semverCompare(v1: string, v2: string): number {
  const p1 = v1.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const p2 = v2.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0
    const n2 = p2[i] || 0
    if (n1 > n2) return 1
    if (n1 < n2) return -1
  }
  return 0
}

/**
 * Fast direct check against GitHub Releases API (< 0.5s) with a 4s max timeout.
 */
function checkGitHubReleaseFast<T = { tag_name?: string; html_url?: string }>(
  url = 'https://api.github.com/repos/Deepender25/Edge-Drop/releases/latest'
): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const request = net.request({
        method: 'GET',
        url
      })
      request.setHeader('User-Agent', 'Edge-Drop-App')
      request.setHeader('Accept', 'application/vnd.github.v3+json')

      const timer = setTimeout(() => {
        try { request.abort() } catch { /* ignore */ }
        resolve(null)
      }, 4000)

      request.on('response', (response) => {
        let body = ''
        response.on('data', (chunk) => { body += chunk })
        response.on('end', () => {
          clearTimeout(timer)
          try {
            if (response.statusCode === 200) {
              resolve(JSON.parse(body))
            } else {
              resolve(null)
            }
          } catch {
            resolve(null)
          }
        })
      })

      request.on('error', () => {
        clearTimeout(timer)
        resolve(null)
      })

      request.end()
    } catch {
      resolve(null)
    }
  })
}

function normalizeMacReleaseUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return null
    if (parsed.username || parsed.password || parsed.port) return null
    if (parsed.pathname !== MAC_RELEASES_PATH && !parsed.pathname.startsWith(`${MAC_RELEASES_PATH}/`)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

interface MacVersion {
  base: [number, number, number]
  revision: number
}

interface MacRelease {
  tag_name?: unknown
  html_url?: unknown
  draft?: unknown
  prerelease?: unknown
}

export function parseMacVersion(version: string): MacVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-mac\.(\d+))?$/i.exec(version.trim())
  if (!match) return null
  return {
    base: [Number(match[1]), Number(match[2]), Number(match[3])],
    revision: match[4] === undefined ? 0 : Number(match[4])
  }
}

export function compareMacVersions(v1: string, v2: string): number {
  const a = parseMacVersion(v1)
  const b = parseMacVersion(v2)
  if (!a || !b) return a ? 1 : b ? -1 : 0
  for (let i = 0; i < 3; i++) {
    if (a.base[i] !== b.base[i]) return a.base[i] > b.base[i] ? 1 : -1
  }
  if (a.revision !== b.revision) return a.revision > b.revision ? 1 : -1
  return 0
}

export function pickLatestMacRelease(releases: unknown): { version: string; htmlUrl: unknown } | null {
  if (!Array.isArray(releases)) return null
  let latest: { version: string; htmlUrl: unknown } | null = null
  for (const release of releases as Array<MacRelease | null>) {
    if (!release || typeof release.tag_name !== 'string') continue
    if (release.draft === true || release.prerelease === true) continue
    const version = release.tag_name.trim().replace(/^v/i, '')
    if (!/-mac\.\d+$/i.test(version) || !parseMacVersion(version)) continue
    if (!latest || compareMacVersions(version, latest.version) > 0) {
      latest = { version, htmlUrl: release.html_url }
    }
  }
  return latest
}

function macCurrentVersion(): string | null {
  const version = app.getVersion()
  const parsed = parseMacVersion(version)
  if (!parsed || parsed.revision > 0) return version
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { macRevision?: unknown }
    const revision = pkg.macRevision
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) return null
    return `${version}-mac.${revision}`
  } catch {
    return null
  }
}

async function checkMacRelease(): Promise<{ status: string; version?: string; error?: string }> {
  const releases = await checkGitHubReleaseFast<unknown>(MAC_RELEASES_API_URL)
  if (!Array.isArray(releases)) {
    return { status: 'error', error: 'Failed to check for updates' }
  }
  const release = pickLatestMacRelease(releases)
  const currentVersion = macCurrentVersion()
  if (currentVersion === null) {
    console.warn('[AutoUpdater] macOS build without the -mac.N suffix has no readable macRevision — skipping update comparison.')
    return { status: 'up-to-date', version: app.getVersion() }
  }
  const latestVersion = release ? release.version : currentVersion
  if (release && compareMacVersions(latestVersion, currentVersion) > 0) {
    console.log(`[AutoUpdater] macOS check found new version: v${latestVersion} (current: v${currentVersion})`)
    _macReleaseUrl = normalizeMacReleaseUrl(release.htmlUrl) ?? MAC_RELEASES_PAGE_URL
    _cachedUpdateInfo = { hasUpdate: true, latestVersion, downloaded: false }
    pushState.updateAvailable({ version: latestVersion })
    return { status: 'available', version: latestVersion }
  }
  console.log(`[AutoUpdater] macOS check confirms app is up to date: v${currentVersion}`)
  return { status: 'up-to-date', version: currentVersion }
}

async function openMacReleasePage(): Promise<void> {
  const url = normalizeMacReleaseUrl(_macReleaseUrl) ?? MAC_RELEASES_PAGE_URL
  try {
    await shell.openExternal(url)
  } catch (err) {
    console.error('[AutoUpdater] Failed to open release page:', err)
  }
}

/**
 * Manually check for updates on user click with instant fast-path resolution.
 */
export async function checkForUpdatesManual(): Promise<{ status: string; version?: string; error?: string }> {
  if (isStoreBuild()) {
    return { status: 'up-to-date', version: app.getVersion() }
  }
  if (process.platform === 'darwin') {
    return checkMacRelease()
  }

  // Ensure autoUpdater reference is initialized for subsequent download calls
  if (!_autoUpdater) {
    try {
      const { autoUpdater } = require('electron-updater')
      _autoUpdater = autoUpdater
      _autoUpdater.autoDownload = false
      _autoUpdater.autoInstallOnAppQuit = false
      if (!app.isPackaged) {
        _autoUpdater.forceDevUpdateConfig = true
      }
    } catch {
      /* ignore */
    }
  } else {
    _autoUpdater.autoDownload = false
    _autoUpdater.autoInstallOnAppQuit = false
  }

  // 1. Fast path: Direct GitHub API query (returns in ~300ms)
  const fastResult = await checkGitHubReleaseFast()
  if (fastResult && fastResult.tag_name) {
    const latestVersion = fastResult.tag_name.replace(/^v/i, '')
    const currentVersion = app.getVersion()
    if (semverCompare(latestVersion, currentVersion) > 0) {
      console.log(`[AutoUpdater] Fast check found new version: v${latestVersion} (current: v${currentVersion})`)
      _cachedUpdateInfo = { hasUpdate: true, latestVersion, downloaded: false }
      pushState.updateAvailable({ version: latestVersion })
      return { status: 'available', version: latestVersion }
    } else {
      console.log(`[AutoUpdater] Fast check confirms app is up to date: v${currentVersion}`)
      return { status: 'up-to-date', version: currentVersion }
    }
  }

  // 2. Fallback path: electron-updater check with 5-second race timeout
  if (_autoUpdater) {
    try {
      const checkPromise = _autoUpdater.checkForUpdates()
      const timeoutPromise = new Promise<{ updateInfo?: { version: string } }>((_, reject) =>
        setTimeout(() => reject(new Error('Update check timeout')), 5000)
      )
      const result = await Promise.race([checkPromise, timeoutPromise])
      if (result && result.updateInfo && semverCompare(result.updateInfo.version, app.getVersion()) > 0) {
        _cachedUpdateInfo = { hasUpdate: true, latestVersion: result.updateInfo.version, downloaded: false }
        return { status: 'available', version: result.updateInfo.version }
      }
      return { status: 'up-to-date', version: app.getVersion() }
    } catch (err: any) {
      return { status: 'error', error: typeof err === 'string' ? err : err?.message || 'Failed to check for updates' }
    }
  }

  return { status: 'error', error: 'Failed to check for updates' }
}

/**
 * Trigger download of the update when user clicks "Download & Update" in manual mode.
 */
export async function startUpdateDownload(): Promise<void> {
  if (isStoreBuild()) return
  if (process.platform === 'darwin') {
    await openMacReleasePage()
    return
  }
  if (!_autoUpdater) {
    try {
      const { autoUpdater } = require('electron-updater')
      _autoUpdater = autoUpdater
      // Match manual-check semantics: never auto-download as a side effect.
      // An explicit downloadUpdate() call below is unaffected by these flags.
      _autoUpdater.autoDownload = false
      _autoUpdater.autoInstallOnAppQuit = false
      if (!app.isPackaged) {
        _autoUpdater.forceDevUpdateConfig = true
      }
    } catch {
      return
    }
  }
  try {
    await _autoUpdater.downloadUpdate()
  } catch (err) {
    console.warn('[AutoUpdater] downloadUpdate failed, retrying with checkForUpdates first:', err)
    try {
      await _autoUpdater.checkForUpdates()
      await _autoUpdater.downloadUpdate()
    } catch (retryErr) {
      console.error('[AutoUpdater] downloadUpdate retry failed:', retryErr)
    }
  }
}

/**
 * Initializes electron-updater for GitHub release auto-updates.
 * Completely disabled on Microsoft Store (MSIX) builds to comply with Store policies.
 */
export function initAutoUpdater(): void {
  if (isStoreBuild()) {
    console.log('[AutoUpdater] Store build detected — auto-updater disabled.')
    return
  }
  if (process.platform === 'darwin') {
    triggerBackgroundCheck(3000)
    return
  }

  try {
    const { autoUpdater } = require('electron-updater')
    _autoUpdater = autoUpdater

    const settings = getSettings()
    const mode = resolveUpdateMode(settings)
    const autoDownload = mode === 'auto'
    // 'notify' still checks at launch (tiny version query) but never downloads
    // on its own; 'off' stays fully network-silent.
    const shouldCheck = mode !== 'off'

    autoUpdater.logger = console
    autoUpdater.autoDownload = autoDownload
    autoUpdater.autoInstallOnAppQuit = autoDownload

    if (!app.isPackaged) {
      console.log('[AutoUpdater] Unpackaged dev build detected — enabling forceDevUpdateConfig')
      autoUpdater.forceDevUpdateConfig = true
    }

    autoUpdater.on('checking-for-update', () => {
      console.log('[AutoUpdater] Checking for update... Current version:', app.getVersion())
    })

    autoUpdater.on('update-available', (info: { version: string }) => {
      console.log('[AutoUpdater] New update available on GitHub:', info.version)
      _cachedUpdateInfo = { hasUpdate: true, latestVersion: info.version, downloaded: false }
      pushState.updateAvailable({ version: info.version })
    })

    autoUpdater.on('update-not-available', (info: { version: string }) => {
      console.log('[AutoUpdater] App is up to date. Latest release:', info.version, 'Current:', app.getVersion())
    })

    autoUpdater.on('download-progress', (progressObj: { percent: number; bytesPerSecond?: number; transferred?: number; total?: number }) => {
      const percent = Math.min(100, Math.max(0, Math.round(progressObj.percent || 0)))
      console.log(`[AutoUpdater] Download progress: ${percent}%`)
      if (_cachedUpdateInfo) {
        _cachedUpdateInfo.downloadProgress = {
          percent,
          bytesPerSecond: progressObj.bytesPerSecond,
          transferred: progressObj.transferred,
          total: progressObj.total
        }
      }
      pushState.updateProgress({
        percent,
        bytesPerSecond: progressObj.bytesPerSecond,
        transferred: progressObj.transferred,
        total: progressObj.total
      })
    })

    autoUpdater.on('update-downloaded', (info: { version: string }) => {
      console.log('[AutoUpdater] Update downloaded and ready to install:', info.version)
      _cachedUpdateInfo = { hasUpdate: true, latestVersion: info.version, downloaded: true }
      pushState.updateDownloaded({ version: info.version })
    })

    autoUpdater.on('error', (err: Error | string) => {
      const msg = typeof err === 'string' ? err : err?.message
      console.warn('[AutoUpdater] Update check error:', msg)
    })

    // Background check runs in 'auto' and 'notify' modes; only 'off' stays
    // fully network-silent. In 'notify' mode autoDownload is off, so a found
    // update only surfaces the Download/Skip prompt — nothing downloads.
    if (shouldCheck) {
      if (!autoDownload) {
        console.log('[AutoUpdater] Notify mode: background check without auto-download.')
      }
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err: Error | string) => {
          const msg = typeof err === 'string' ? err : err?.message
          console.warn('[AutoUpdater] checkForUpdates failed:', msg)
        })
      }, 3000)
    } else {
      console.log('[AutoUpdater] Updates disabled by user setting. Staying network-silent on startup.')
    }
  } catch (err) {
    console.error('[AutoUpdater] Initialization failed:', err)
  }
}
