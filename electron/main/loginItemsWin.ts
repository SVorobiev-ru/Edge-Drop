import { execFileSync } from 'node:child_process'
import { app } from 'electron'

/** Historical + current Run-key names written by this app. */
export const GITHUB_LOGIN_ITEM_NAMES = [
  'Edge-Drop',
  'com.edgedrop.app',
  'electron.app.Edge-Drop'
] as const

export const CANONICAL_LOGIN_ITEM_NAME = 'Edge-Drop'

export function normalizeLoginPath(p: string): string {
  let s = p.trim().replace(/\//g, '\\').toLowerCase()
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1)
    s = end > 0 ? s.slice(1, end) : s.replace(/"/g, '')
  } else {
    const exe = s.indexOf('.exe')
    if (exe >= 0) s = s.slice(0, exe + 4)
  }
  return s
}

export function isOurLoginExe(candidate: string | undefined, exePath: string): boolean {
  if (!candidate) return false
  return normalizeLoginPath(candidate) === normalizeLoginPath(exePath)
}

/**
 * HKCU Run command. The exe path MUST be quoted so Windows does not split on
 * spaces in the user profile (`C:\Users\Renato Souza\...`). `--hidden` stays
 * outside the quotes. Electron's setLoginItemSettings writes the path bare,
 * which is a 0.3.0 regression vs 0.2.9.
 */
export function formatGithubRunCommand(exePath: string): string {
  const bare = exePath.trim().replace(/^"(.*)"$/, '$1')
  return `"${bare}" --hidden`
}

export function writeQuotedGithubRunCommand(exePath: string): boolean {
  if (process.platform !== 'win32') return true
  try {
    execFileSync(
      'reg',
      [
        'add',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '/v',
        CANONICAL_LOGIN_ITEM_NAME,
        '/t',
        'REG_SZ',
        '/d',
        formatGithubRunCommand(exePath),
        '/f'
      ],
      { windowsHide: true, stdio: 'ignore' }
    )
    return true
  } catch (err) {
    console.error('[LoginItems] Failed to quote Run-key command:', err)
    return false
  }
}

/**
 * Read the raw HKCU Run value for `name` via `reg query`.
 * Returns the command string, or null when missing / unreadable.
 * Best-effort: never throws. Used to detect stale paths, unquoted
 * values from older builds, and missing --hidden flags that the
 * Electron API alone cannot see.
 */
export function getRawGithubRunCommand(name: string): string | null {
  if (process.platform !== 'win32') return null
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', name],
      { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ) as unknown as string
    const text = String(out ?? '')
    // Typical output line: `    Edge-Drop    REG_SZ    "C:\...\Edge-Drop.exe" --hidden`
    const m = text.match(/REG_SZ\s+(.+?)\s*$/m)
    if (!m) return null
    const val = (m[1] ?? '').trim()
    return val ? val : null
  } catch {
    return null
  }
}

/** Delete a raw HKCU Run value. Best-effort, returns true when gone. */
export function deleteRawGithubRunValue(name: string): boolean {
  if (process.platform !== 'win32') return true
  try {
    execFileSync(
      'reg',
      ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', name, '/f'],
      { windowsHide: true, stdio: 'ignore' }
    )
    return true
  } catch {
    // Missing value also throws with exit 1 — treat as already gone.
    return getRawGithubRunCommand(name) === null
  }
}

/**
 * Is the on-disk Run command exactly what this install needs?
 * Requires quoted exe path + trailing --hidden pointing at the
 * current executable. Anything else (unquoted 0.3.0 value, stale
 * folder after update/reinstall, missing flag) needs a heal.
 */
export function isRunValueHealthy(raw: string | null, exePath: string): boolean {
  if (!raw) return false
  const want = formatGithubRunCommand(exePath)
  if (raw.trim() === want) return true
  // Tolerate case differences in drive letter, but nothing else.
  return raw.trim().toLowerCase() === want.toLowerCase()
}

/** Check the canonical Run key health for the current install. */
export function isGithubRunKeyHealthy(exePath?: string): boolean {
  try {
    const exe = exePath ?? app.getPath('exe')
    return isRunValueHealthy(getRawGithubRunCommand(CANONICAL_LOGIN_ITEM_NAME), exe)
  } catch {
    return false
  }
}

export const STARTUP_APPROVED_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'

/**
 * Check whether Windows Task Manager / Windows Settings has disabled this startup item.
 * Windows stores startup item approval in StartupApproved\Run as a REG_BINARY.
 * If the value is missing, the item is approved (enabled).
 * If the value exists, the first byte indicates state:
 * - 0x02: Enabled
 * - 0x03 (or any odd number): Disabled by user
 */
export function isBlockedInStartupApproved(name: string): boolean {
  if (process.platform !== 'win32') return false
  try {
    const out = execFileSync(
      'reg',
      ['query', STARTUP_APPROVED_KEY, '/v', name],
      { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ) as unknown as string
    const m = String(out ?? '').match(/REG_BINARY\s+([0-9a-fA-F]+)/)
    if (!m) return false
    const hex = m[1]
    if (!hex || hex.length < 2) return false
    const firstByte = parseInt(hex.slice(0, 2), 16)
    return firstByte !== 2 && (firstByte & 1) !== 0
  } catch {
    // Missing key or value means Windows defaults to enabled (not blocked).
    return false
  }
}

/**
 * Clear any disabled flag in StartupApproved\Run so Windows allows the item to launch.
 */
export function clearStartupApprovedBlock(name: string): boolean {
  if (process.platform !== 'win32') return true
  try {
    execFileSync(
      'reg',
      ['delete', STARTUP_APPROVED_KEY, '/v', name, '/f'],
      { windowsHide: true, stdio: 'ignore' }
    )
    return true
  } catch {
    return true
  }
}

export function collectGithubLoginNames(exePath: string): Set<string> {
  const names = new Set<string>(GITHUB_LOGIN_ITEM_NAMES)
  try {
    const items = app.getLoginItemSettings({ path: exePath }).launchItems ?? []
    for (const item of items) {
      if (item.name && isOurLoginExe(item.path, exePath)) names.add(item.name)
    }
  } catch {
    /* ignore */
  }
  return names
}
