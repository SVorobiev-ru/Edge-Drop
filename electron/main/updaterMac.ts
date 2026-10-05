import { app, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pushState } from './state'
import { discardPreparedMacUpdate, launchMacInstaller, prepareMacUpdate, type PreparedMacUpdate } from './macUpdateInstall'
import { _cachedUpdateInfo, setCachedUpdateInfo, checkGitHubReleaseFast } from './updaterShared'

export const MAC_UPDATE_REPO = 'SVorobiev-ru/Edge-Drop'
const MAC_RELEASES_API_URL = `https://api.github.com/repos/${MAC_UPDATE_REPO}/releases?per_page=30`
const MAC_RELEASES_PAGE_URL = `https://github.com/${MAC_UPDATE_REPO}/releases/latest`
const MAC_RELEASES_PATH = `/${MAC_UPDATE_REPO}/releases`

let _macReleaseUrl: string | null = null
let _macRelease: { version: string; assets: unknown } | null = null
let _macDownload: Promise<void> | null = null
let _macPrepared: PreparedMacUpdate | null = null
export let _macInstalling = false

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
  assets?: unknown
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

export function pickLatestMacRelease(releases: unknown): { version: string; htmlUrl: unknown; assets?: unknown } | null {
  if (!Array.isArray(releases)) return null
  let latest: { version: string; htmlUrl: unknown; assets?: unknown } | null = null
  for (const release of releases as Array<MacRelease | null>) {
    if (!release || typeof release.tag_name !== 'string') continue
    if (release.draft === true || release.prerelease === true) continue
    const version = release.tag_name.trim().replace(/^v/i, '')
    if (!/-mac\.\d+$/i.test(version) || !parseMacVersion(version)) continue
    if (!latest || compareMacVersions(version, latest.version) > 0) {
      latest = { version, htmlUrl: release.html_url, assets: release.assets }
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

const MAC_INSTALL_QUIT_TIMEOUT_MS = 10_000

export let _macLastCheckAt = 0

export async function checkMacRelease(): Promise<{ status: string; version?: string; error?: string }> {
  _macLastCheckAt = Date.now()
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
    if (_macPrepared && _macPrepared.version !== latestVersion) {
      discardMacUpdate()
    }
    _macRelease = { version: latestVersion, assets: release.assets }
    if (_macPrepared) {
      setCachedUpdateInfo({ hasUpdate: true, latestVersion, downloaded: true })
      pushState.updateDownloaded({ version: latestVersion })
      return { status: 'available', version: latestVersion }
    }
    setCachedUpdateInfo({ hasUpdate: true, latestVersion, downloaded: false })
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

async function fallBackToMacReleasePage(reason: unknown): Promise<void> {
  console.error('[AutoUpdater] macOS in-app update failed, opening the release page:', reason)
  if (_cachedUpdateInfo) {
    setCachedUpdateInfo({ hasUpdate: true, latestVersion: _cachedUpdateInfo.latestVersion, downloaded: false })
    pushState.updateAvailable({ version: _cachedUpdateInfo.latestVersion })
  }
  pushState.toast('toast.updateInstallFailed', 'error')
  await openMacReleasePage()
}

export function downloadMacUpdate(): Promise<void> {
  if (_macDownload) return _macDownload
  if (_macPrepared) {
    setCachedUpdateInfo({ hasUpdate: true, latestVersion: _macPrepared.version, downloaded: true })
    pushState.updateDownloaded({ version: _macPrepared.version })
    return Promise.resolve()
  }
  const release = _macRelease
  _macDownload = (async () => {
    try {
      if (!release) throw new Error('no release has been checked')
      const prepared = await prepareMacUpdate({
        version: release.version,
        assets: release.assets,
        repo: MAC_UPDATE_REPO,
        arch: process.arch,
        onProgress: (progress) => {
          if (_cachedUpdateInfo) _cachedUpdateInfo.downloadProgress = progress
          pushState.updateProgress(progress)
        }
      })
      _macPrepared = prepared
      setCachedUpdateInfo({ hasUpdate: true, latestVersion: prepared.version, downloaded: true })
      console.log(`[AutoUpdater] macOS update ${prepared.version} downloaded and verified`)
      pushState.updateDownloaded({ version: prepared.version })
    } catch (err) {
      await fallBackToMacReleasePage(err)
      throw err instanceof Error ? err : new Error(String(err))
    } finally {
      _macDownload = null
    }
  })()
  return _macDownload
}

export async function installMacUpdate(): Promise<void> {
  const prepared = _macPrepared
  if (!prepared || _macInstalling) {
    if (!_macInstalling) await fallBackToMacReleasePage('no verified update to install')
    return
  }
  let cancelInstaller: () => void
  try {
    cancelInstaller = launchMacInstaller(prepared)
  } catch (err) {
    await fallBackToMacReleasePage(err)
    return
  }
  _macInstalling = true
  console.log(`[AutoUpdater] macOS installer started for ${prepared.version}, quitting`)
  let quitting = false
  const onWillQuit = (): void => {
    quitting = true
  }
  app.once('will-quit', onWillQuit)
  setTimeout(() => {
    app.removeListener('will-quit', onWillQuit)
    if (quitting) return
    cancelInstaller()
    _macInstalling = false
    void fallBackToMacReleasePage('the quit before the update was cancelled')
  }, MAC_INSTALL_QUIT_TIMEOUT_MS)
  app.quit()
}

export function discardMacUpdate(): void {
  const prepared = _macPrepared
  if (!prepared || _macInstalling) return
  _macPrepared = null
  try {
    discardPreparedMacUpdate(prepared)
  } catch (err) {
    console.warn('[AutoUpdater] could not remove the downloaded update:', err)
  }
}
