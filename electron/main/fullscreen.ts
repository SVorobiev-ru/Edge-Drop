/**
 * Fullscreen Game & Presentation Detection Module.
 *
 * Detects when a Direct3D fullscreen game, full-screen video, or presentation
 * is active in the foreground using Windows API `SHQueryUserNotificationState`.
 *
 * Power optimisation: instead of spawning a new powershell.exe process every
 * second (each cold-start costs ~60–100ms of CPU + disk I/O for CLR/DLL load),
 * we call the Win32 function directly via koffi (already a project dependency).
 * koffi keeps shell32.dll loaded in-process; the call itself takes <1µs.
 *
 * The check interval is also increased from 1s to 5s — fullscreen detection
 * does not need sub-second responsiveness. The worst case is a 5s delay before
 * the panel suppresses itself after a game goes fullscreen, which is fine.
 */
import koffi from 'koffi'
import { systemPreferences, screen } from 'electron'
import { systemPresentationOptions, isFullscreenPresentation, onScreenWindows, fullscreenDisplayId } from './macPresentation'
import { frontmostPid } from './macNative'

// Windows QUERY_USER_NOTIFICATION_STATE enum values:
// 1 = QUNS_NOT_PRESENT        (screen saver / locked)
// 2 = QUNS_BUSY               (fullscreen app / presentation mode / desktop shell focus)
// 3 = QUNS_RUNNING_D3D_FULL_SCREEN (D3D fullscreen game)
// 4 = QUNS_PRESENTATION_MODE  (PowerPoint / Keynote presentation)
// 5 = QUNS_ACCEPTS_NOTIFICATIONS (normal desktop)
// 6 = QUNS_QUIET_TIME         (first-logon quiet time)
// 7 = QUNS_APP                (Windows Store app)
const FULLSCREEN_STATES = new Set([2, 3, 4])

// Windows Desktop & Shell window classes that report QUNS_BUSY (2) when focused
const DESKTOP_SHELL_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'ImmersiveLauncher',
  'MultitaskingViewFrame'
])

/**
 * Load SHQueryUserNotificationState from shell32.dll and GetForegroundWindow/GetClassNameA from user32.dll via koffi.
 * Done once at module load — the DLLs stay resident in-process so every
 * subsequent call is just a direct function pointer invocation (~1 µs), with
 * no process spawning, CLR load, or disk I/O.
 */
type ShQueryFn = (pquns: [number]) => number
type GetForegroundWindowFn = () => number
type GetClassNameFn = (hwnd: number, buf: Buffer, maxCount: number) => number

let shQueryFn: ShQueryFn | null = null
let getForegroundWindowFn: GetForegroundWindowFn | null = null
let getClassNameFn: GetClassNameFn | null = null

if (process.platform === 'win32') {
  try {
    const shell32 = koffi.load('shell32.dll')
    shQueryFn = shell32.func('int SHQueryUserNotificationState(_Out_ int *pquns)') as ShQueryFn
    console.log('[Fullscreen] Loaded SHQueryUserNotificationState via koffi')
  } catch (err) {
    console.error('[Fullscreen] koffi shell32 load failed — fullscreen detection disabled:', err)
  }

  try {
    const user32 = koffi.load('user32.dll')
    getForegroundWindowFn = user32.func('uintptr_t GetForegroundWindow()') as GetForegroundWindowFn
    getClassNameFn = user32.func('int GetClassNameA(uintptr_t hWnd, _Out_ char *lpClassName, int nMaxCount)') as GetClassNameFn
  } catch (err) {
    console.error('[Fullscreen] koffi user32 load failed:', err)
  }
}

let isFullscreenActiveCache = false
let macFullscreenDisplayId: number | null = null
let checkTimer: ReturnType<typeof setInterval> | null = null
let onFullscreenDetectedFn: ((fullscreenDisplayId: number | null) => void) | null = null

export function registerFullscreenActiveListener(fn: (fullscreenDisplayId: number | null) => void): void {
  onFullscreenDetectedFn = fn
}

/** Check if the current foreground window belongs to the Windows Desktop or Shell. */
function isDesktopForeground(): boolean {
  if (!getForegroundWindowFn || !getClassNameFn) return false
  try {
    const hwnd = getForegroundWindowFn()
    if (!hwnd) return false
    const buf = Buffer.alloc(256)
    const len = getClassNameFn(hwnd, buf, 256)
    if (len <= 0) return false
    const className = buf.toString('utf8', 0, len).trim()
    return DESKTOP_SHELL_CLASSES.has(className)
  } catch {
    return false
  }
}

/**
 * Synchronously query the notification state via the loaded koffi function.
 * Returns the QUERY_USER_NOTIFICATION_STATE integer, or -1 on any error.
 */
function queryNotificationState(): number {
  if (!shQueryFn) return -1
  try {
    const out: [number] = [0]
    const hr = shQueryFn(out)
    // hr === 0 means S_OK
    return hr === 0 ? out[0] : -1
  } catch {
    return -1
  }
}

export function isFullscreenAppActive(panelDisplayId?: number): boolean {
  if (!isFullscreenActiveCache) return false
  if (process.platform !== 'darwin' || panelDisplayId === undefined || macFullscreenDisplayId === null) return true
  return macFullscreenDisplayId === panelDisplayId
}

function resolveMacFullscreenDisplay(): number | null {
  try {
    const pid = frontmostPid()
    if (!pid || pid === process.pid) return null
    const displays = screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds }))
    if (displays.length < 2) return null
    const windows = onScreenWindows()
    if (!windows) return null
    return fullscreenDisplayId(windows, pid, displays)
  } catch {
    return null
  }
}

function triggerMacFullscreenCheck(): void {
  const options = systemPresentationOptions()
  if (options === null) return

  const isNowFullscreen = isFullscreenPresentation(options)
  macFullscreenDisplayId = isNowFullscreen ? resolveMacFullscreenDisplay() : null
  isFullscreenActiveCache = isNowFullscreen
  if (isNowFullscreen) {
    onFullscreenDetectedFn?.(macFullscreenDisplayId)
  }
}

export function triggerFullscreenCheck(): void {
  if (process.platform === 'darwin') {
    triggerMacFullscreenCheck()
    return
  }
  if (process.platform !== 'win32') return
  const state = queryNotificationState()
  if (state < 0) return   // koffi unavailable or call failed

  let isNowFullscreen = FULLSCREEN_STATES.has(state)
  // Windows Shell/Desktop focus reports QUNS_BUSY (2) when no app window is focused.
  // Exclude Windows Home Screen / Desktop from game fullscreen suppression.
  if (isNowFullscreen && state === 2 && isDesktopForeground()) {
    isNowFullscreen = false
  }

  isFullscreenActiveCache = isNowFullscreen
  if (isNowFullscreen) {
    onFullscreenDetectedFn?.(null)
  }
}

/**
 * Start the periodic fullscreen monitor.
 *
 * 5 000 ms interval — plenty fast enough for fullscreen detection (user
 * rarely exits a game in under 5s), and negligible on battery compared to
 * the old 1s PowerShell spawn loop.
 *
 * The `triggerFullscreenCheck()` call on 'browser-window-blur' in index.ts
 * still fires immediately whenever the OS focus changes, so the effective
 * detection latency for Alt+Tab scenarios is still ~0ms.
 */
const FULLSCREEN_CHECK_INTERVAL_MS = 800
const MAC_SPACE_CHANGE_RECHECK_MS = 300

let macSpaceSubscriptionId: number | null = null
let macSpaceRecheckTimer: ReturnType<typeof setTimeout> | null = null

function subscribeMacSpaceChange(): void {
  if (macSpaceSubscriptionId !== null) return
  try {
    macSpaceSubscriptionId = systemPreferences.subscribeWorkspaceNotification(
      'NSWorkspaceActiveSpaceDidChangeNotification',
      () => {
        triggerFullscreenCheck()
        if (macSpaceRecheckTimer !== null) clearTimeout(macSpaceRecheckTimer)
        macSpaceRecheckTimer = setTimeout(() => {
          macSpaceRecheckTimer = null
          triggerFullscreenCheck()
        }, MAC_SPACE_CHANGE_RECHECK_MS)
      }
    )
  } catch (err) {
    console.error('[Fullscreen] workspace notification subscribe failed:', err)
  }
}

function unsubscribeMacSpaceChange(): void {
  if (macSpaceRecheckTimer !== null) {
    clearTimeout(macSpaceRecheckTimer)
    macSpaceRecheckTimer = null
  }
  if (macSpaceSubscriptionId === null) return
  try {
    systemPreferences.unsubscribeWorkspaceNotification(macSpaceSubscriptionId)
  } catch (err) {
    console.error('[Fullscreen] workspace notification unsubscribe failed:', err)
  }
  macSpaceSubscriptionId = null
}

export function startFullscreenMonitor(): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return
  if (checkTimer !== null) return

  if (process.platform === 'darwin') subscribeMacSpaceChange()

  triggerFullscreenCheck()  // seed cache immediately
  checkTimer = setInterval(triggerFullscreenCheck, FULLSCREEN_CHECK_INTERVAL_MS)
}

export function stopFullscreenMonitor(): void {
  if (checkTimer !== null) {
    clearInterval(checkTimer)
    checkTimer = null
  }
  unsubscribeMacSpaceChange()
  isFullscreenActiveCache = false
  macFullscreenDisplayId = null
}
