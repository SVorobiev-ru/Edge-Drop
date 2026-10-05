import { app, powerMonitor } from 'electron'
import { isStoreBuild } from './config'
import { pushState } from './state'
import { loadSettings } from '../store/settings'
import { resolveUpdateMode } from '../../shared/types'
import { removeUnfinishedMacUpdateDirs } from './macUpdateInstall'
import { _cachedUpdateInfo, setCachedUpdateInfo, checkGitHubReleaseFast } from './updaterShared'
import { _macInstalling, _macLastCheckAt, checkMacRelease, discardMacUpdate, downloadMacUpdate, installMacUpdate } from './updaterMac'

export { getCachedUpdateState, type CachedUpdateInfo } from './updaterShared'
export { MAC_UPDATE_REPO, parseMacVersion, compareMacVersions, pickLatestMacRelease, discardMacUpdate } from './updaterMac'

// Module-level reference to the single autoUpdater instance and cached update state.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _autoUpdater: any = null

/**
 * Called from ipc.ts when the renderer clicks "Restart to Update".
 */
export function quitAndInstallUpdate(): void {
  if (isStoreBuild()) return
  if (process.platform === 'darwin') {
    void installMacUpdate()
    return
  }
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
  const mode = resolveUpdateMode(loadSettings())
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
    mode = resolveUpdateMode(loadSettings())
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

export const MAC_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const MAC_UPDATE_RESUME_MIN_GAP_MS = 6 * 60 * 60 * 1000
const MAC_UPDATE_SCHEDULE_TICK_MS = 10 * 60 * 1000

let _macScheduleTimer: ReturnType<typeof setInterval> | null = null

export function isMacScheduledCheckDue(input: {
  mode: ReturnType<typeof resolveUpdateMode>
  now: number
  lastCheckAt: number
  minGapMs: number
}): boolean {
  if (input.mode === 'off') return false
  if (input.lastCheckAt <= 0) return true
  const elapsed = input.now - input.lastCheckAt
  return elapsed < 0 || elapsed >= input.minGapMs
}

function runMacScheduledCheck(minGapMs: number): void {
  let mode: ReturnType<typeof resolveUpdateMode>
  try {
    mode = resolveUpdateMode(loadSettings())
  } catch {
    return
  }
  if (!isMacScheduledCheckDue({ mode, now: Date.now(), lastCheckAt: _macLastCheckAt, minGapMs })) return
  triggerBackgroundCheck(0)
}

const onMacResume = (): void => runMacScheduledCheck(MAC_UPDATE_RESUME_MIN_GAP_MS)

function startMacUpdateSchedule(): void {
  if (_macScheduleTimer !== null) return
  _macScheduleTimer = setInterval(() => runMacScheduledCheck(MAC_UPDATE_CHECK_INTERVAL_MS), MAC_UPDATE_SCHEDULE_TICK_MS)
  powerMonitor.on('resume', onMacResume)
}

function stopMacUpdateSchedule(): void {
  if (_macScheduleTimer === null) return
  clearInterval(_macScheduleTimer)
  _macScheduleTimer = null
  powerMonitor.removeListener('resume', onMacResume)
}

export function shutdownMacUpdates(): void {
  stopMacUpdateSchedule()
  if (_macInstalling) return
  discardMacUpdate()
  removeUnfinishedMacUpdateDirs()
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
      setCachedUpdateInfo({ hasUpdate: true, latestVersion, downloaded: false })
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
        setCachedUpdateInfo({ hasUpdate: true, latestVersion: result.updateInfo.version, downloaded: false })
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
    await downloadMacUpdate()
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
    startMacUpdateSchedule()
    return
  }

  try {
    const { autoUpdater } = require('electron-updater')
    _autoUpdater = autoUpdater

    const settings = loadSettings()
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
      setCachedUpdateInfo({ hasUpdate: true, latestVersion: info.version, downloaded: false })
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
      setCachedUpdateInfo({ hasUpdate: true, latestVersion: info.version, downloaded: true })
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
