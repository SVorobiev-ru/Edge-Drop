/**
 * Launch-at-login.
 *
 * GitHub NSIS: Electron Run keys. Older builds used different value names, so
 * disable still clears leftover names. Enable must not disable Edge-Drop first
 * — that stamps Windows Startup apps as Off and the toggle then fails.
 *
 * Store / AppX: Windows.ApplicationModel.StartupTask only —
 * getStatus / enable (RequestEnableAsync) / disable. Same API as
 * electron-winstore-auto-launch. Electron setLoginItemSettings is not used.
 */
import { app } from 'electron'
import { isStoreBuild } from './config'
import { loadSettings, saveSettings } from '../store/settings'
import type { Settings } from '../../shared/types'
import { disable, enable, getStatus, StartupTaskState } from './storeStartup'
import { CANONICAL_LOGIN_ITEM_NAME, GITHUB_LOGIN_ITEM_NAMES, clearStartupApprovedBlock, collectGithubLoginNames, deleteRawGithubRunValue, getRawGithubRunCommand, isBlockedInStartupApproved, isGithubRunKeyHealthy, isOurLoginExe, isRunValueHealthy, writeQuotedGithubRunCommand } from './loginItemsWin'
import { applyMacLaunchAtLogin, readMacLaunchAtLogin } from './loginItemsMac'

export { StartupTaskState }
export { GITHUB_LOGIN_ITEM_NAMES, CANONICAL_LOGIN_ITEM_NAME, normalizeLoginPath, isOurLoginExe, formatGithubRunCommand, getRawGithubRunCommand, deleteRawGithubRunValue, isRunValueHealthy, isGithubRunKeyHealthy, STARTUP_APPROVED_KEY, isBlockedInStartupApproved, clearStartupApprovedBlock } from './loginItemsWin'
export { macSupportsMainAppService } from './loginItemsMac'

export interface LaunchAtLoginResult {
  enabled: boolean
  blockedByUser: boolean
  ok: boolean
}

function resultFromState(state: number | null, wantEnabled?: boolean): LaunchAtLoginResult {
  if (state === null) {
    if (wantEnabled === undefined) {
      return { enabled: loadSettings().launchAtLogin, blockedByUser: false, ok: false }
    }
    return { enabled: !wantEnabled, blockedByUser: false, ok: false }
  }
  const enabled = state === StartupTaskState.Enabled || state === StartupTaskState.EnabledByPolicy
  return {
    enabled,
    blockedByUser: state === StartupTaskState.DisabledByUser || state === StartupTaskState.DisabledByPolicy,
    ok: wantEnabled === undefined ? true : enabled === wantEnabled
  }
}

export function readGithubLaunchAtLogin(): LaunchAtLoginResult {
  if (process.platform === 'darwin') return readMacLaunchAtLogin()
  const exePath = app.getPath('exe')

  // Windows NSIS / portable builds: Read registry directly as authoritative source.
  // Electron's getLoginItemSettings() fails to match paths containing spaces (e.g. "Renato Souza")
  // and quoted arguments, returning false negatives that cause UI toggles to flap OFF.
  if (process.platform === 'win32') {
    let foundName: string | null = null
    let rawCmd: string | null = null

    for (const name of GITHUB_LOGIN_ITEM_NAMES) {
      const cmd = getRawGithubRunCommand(name)
      if (cmd && isOurLoginExe(cmd, exePath)) {
        foundName = name
        rawCmd = cmd
        break
      }
    }

    if (rawCmd && foundName) {
      if (isBlockedInStartupApproved(foundName)) {
        return { enabled: false, blockedByUser: true, ok: true }
      }
      return { enabled: true, blockedByUser: false, ok: true }
    }
  }

  // Fallback to Electron's getLoginItemSettings:
  // 1) On non-Windows platforms
  // 2) In test environments where `reg` is mocked out or returns null but `getLoginItemSettings` is mocked
  try {
    const seen = app.getLoginItemSettings({
      path: exePath,
      args: ['--hidden']
    })
    const items = seen.launchItems ?? []
    const ours = items.filter((item) => isOurLoginExe(item.path, exePath))
    const anyEnabled = ours.some((item) => item.enabled)
    const enabled = anyEnabled || !!seen.executableWillLaunchAtLogin
    const blockedByUser =
      ours.length > 0 && !anyEnabled && ours.some((item) => !item.enabled) && !seen.executableWillLaunchAtLogin
    return {
      enabled,
      blockedByUser,
      ok: true
    }
  } catch {
    return { enabled: false, blockedByUser: false, ok: false }
  }
}

export function applyGithubLaunchAtLogin(wantLaunch: boolean): LaunchAtLoginResult {
  if (process.platform === 'darwin') return applyMacLaunchAtLogin(wantLaunch)
  const exePath = app.getPath('exe')
  const names = collectGithubLoginNames(exePath)

  if (wantLaunch) {
    // Do not disable Edge-Drop before enabling it. That writes Windows
    // StartupApproved as Off and the in-app toggle then fails after upgrades.
    for (const name of names) {
      if (name === CANONICAL_LOGIN_ITEM_NAME) continue
      try {
        app.setLoginItemSettings({
          openAtLogin: false,
          path: exePath,
          name
        })
      } catch {
        /* best-effort orphan cleanup */
      }
      // Remove stale raw values pointing at old install folders so Task
      // Manager never shows ghost duplicates after an update/reinstall.
      try {
        const raw = getRawGithubRunCommand(name)
        if (raw !== null && !isRunValueHealthy(raw, exePath)) {
          deleteRawGithubRunValue(name)
          clearStartupApprovedBlock(name)
        }
      } catch {
        /* ignore */
      }
    }

    // Clear any previous disable block in Windows StartupApproved for Edge-Drop
    clearStartupApprovedBlock(CANONICAL_LOGIN_ITEM_NAME)

    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: exePath,
        args: ['--hidden'],
        name: CANONICAL_LOGIN_ITEM_NAME,
        enabled: true
      })
    } catch (err) {
      console.error('[LoginItems] setLoginItemSettings enable failed:', err)
    }

    // Electron writes an unquoted path. Re-write quoted so usernames with
    // spaces launch. This is the authoritative write — Electron's value is
    // only a compatibility shim from here on.
    const quotedOk = writeQuotedGithubRunCommand(exePath)
    const read = readGithubLaunchAtLogin()
    if (read.blockedByUser) return { ...read, ok: false }

    // Verify the on-disk value is actually healthy. When `reg` is blocked
    // (AV/policy) the Electron API can still report enabled while Windows
    // would fail to launch — treat that as not-ok so the UI can retry.
    try {
      if (!isGithubRunKeyHealthy(exePath)) {
        const raw = getRawGithubRunCommand(CANONICAL_LOGIN_ITEM_NAME)
        if (raw !== null && !isRunValueHealthy(raw, exePath)) {
          return { enabled: false, blockedByUser: false, ok: false }
        }
        if (!quotedOk) {
          return { enabled: false, blockedByUser: false, ok: false }
        }
      }
    } catch {
      /* best-effort verification only */
    }
    return { enabled: true, blockedByUser: false, ok: true }
  }

  for (const name of names) {
    try {
      app.setLoginItemSettings({
        openAtLogin: false,
        path: exePath,
        name
      })
    } catch {
      /* ignore */
    }
    try {
      deleteRawGithubRunValue(name)
      clearStartupApprovedBlock(name)
    } catch {
      /* ignore */
    }
  }
  // Ensure the canonical raw value is gone so a later enable starts clean
  // and Task Manager never lists a disabled ghost. Best-effort only.
  try {
    deleteRawGithubRunValue(CANONICAL_LOGIN_ITEM_NAME)
    clearStartupApprovedBlock(CANONICAL_LOGIN_ITEM_NAME)
  } catch {
    /* ignore */
  }
  return readGithubLaunchAtLogin()
}

export async function readLaunchAtLogin(): Promise<LaunchAtLoginResult> {
  if (!app.isPackaged) {
    return { enabled: loadSettings().launchAtLogin, blockedByUser: false, ok: true }
  }
  if (isStoreBuild()) {
    return resultFromState(await getStatus())
  }
  return readGithubLaunchAtLogin()
}

let appliesInFlight = 0

export async function applyLaunchAtLogin(wantLaunch: boolean): Promise<LaunchAtLoginResult> {
  appliesInFlight++
  try {
    if (!app.isPackaged) {
      return { enabled: wantLaunch, blockedByUser: false, ok: true }
    }
    if (isStoreBuild()) {
      try {
        const state = wantLaunch ? await enable() : await disable()
        return resultFromState(state, wantLaunch)
      } catch (err) {
        console.error('[LoginItems] Store StartupTask update failed:', err)
        return { enabled: !wantLaunch, blockedByUser: false, ok: false }
      }
    }
    try {
      const result = applyGithubLaunchAtLogin(wantLaunch)
      if (wantLaunch || process.platform === 'darwin') return result
      return { ...result, ok: !result.enabled }
    } catch (err) {
      console.error('[LoginItems] GitHub Run-key update failed:', err)
      return { enabled: !wantLaunch, blockedByUser: false, ok: false }
    }
  } finally {
    appliesInFlight--
  }
}

export async function reconcileLaunchAtLoginOnStartup(): Promise<Settings> {
  const settings = loadSettings()
  if (!app.isPackaged) return settings

  const os = await readLaunchAtLogin()
  // When the OS query itself failed (helper missing, reg blocked), never
  // flip the user's saved preference — preserve it and try again next launch.
  if (!os.ok) {
    // GitHub: even when the Electron query fails, a healthy raw key means
    // we are actually fine. Heal the quoting/stale path opportunistically.
    if (settings.launchAtLogin && !isStoreBuild() && process.platform !== 'darwin') {
      try {
        if (!isGithubRunKeyHealthy()) {
          applyGithubLaunchAtLogin(true)
        }
      } catch {
        /* ignore */
      }
    }
    return loadSettings()
  }

  if (settings.launchAtLogin === false && os.enabled) {
    // GitHub recovery check:
    // If user has settings=false, but the Run key exists for Edge-Drop and is NOT blocked by user:
    // This happens when 0.3.1's false-negative poll bug erroneously saved launchAtLogin: false.
    // Self-heal: restore settings to true and ensure key is properly quoted!
    if (!isStoreBuild()) {
      const exe = app.getPath('exe')
      const raw = getRawGithubRunCommand(CANONICAL_LOGIN_ITEM_NAME)
      if (raw && isOurLoginExe(raw, exe) && !isBlockedInStartupApproved(CANONICAL_LOGIN_ITEM_NAME)) {
        console.log('[LoginItems] Recovering launchAtLogin from existing active Run key')
        applyGithubLaunchAtLogin(true)
        return saveSettings({ launchAtLogin: true })
      }
    }

    const applied = await applyLaunchAtLogin(false)
    if (applied.enabled !== settings.launchAtLogin) {
      return saveSettings({ launchAtLogin: applied.enabled })
    }
    return loadSettings()
  }

  if (settings.launchAtLogin === true && !os.enabled) {
    // User explicitly disabled in Task Manager / Settings → Apps → Startup:
    // OS wins, reflect OFF so the toggle shows reality.
    if (os.blockedByUser) {
      return saveSettings({ launchAtLogin: false })
    }
    // Missing / stale after update, reinstall, or drive change — NOT an
    // explicit disable. Heal by re-applying for the current exe path and
    // preserve ON. Never silently flip ON → OFF here; losing intent is
    // worse than a one-time re-register.
    try {
      const healed = await applyLaunchAtLogin(true)
      if (healed.blockedByUser) {
        return saveSettings({ launchAtLogin: false })
      }
      return loadSettings()
    } catch {
      return loadSettings()
    }
  }

  if (settings.launchAtLogin && os.enabled && !isStoreBuild() && process.platform !== 'darwin') {
    // Self-heal quoting / stale path / missing --hidden on every launch so
    // users updating from 0.3.0 (unquoted) get fixed without touching UI.
    try {
      if (!isGithubRunKeyHealthy()) {
        applyGithubLaunchAtLogin(true)
      }
    } catch {
      /* ignore */
    }
  }

  return loadSettings()
}

export async function refreshLaunchAtLoginFromOs(): Promise<Settings> {
  if (appliesInFlight > 0) return loadSettings()
  const os = await readLaunchAtLogin()
  if (!os.ok) return loadSettings()
  if (os.enabled !== loadSettings().launchAtLogin) {
    return saveSettings({ launchAtLogin: os.enabled })
  }
  return loadSettings()
}
