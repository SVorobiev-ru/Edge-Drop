import type { BrowserWindow } from 'electron'
import koffi from 'koffi'
import { frontmostPid, activatePid, weAreFrontmost } from './macNative'
import { runtime } from './config'
import { activateForKeyboard, createMacEscapeCapture, waitUntilNotFrontmost } from './macKeyboardFocus'
import { mainWindow, interactive, openedExplicitly, pollPausedForLock, sendToMainWindow } from './windowState'

type RegisterWindowMessageFn = (lpString: string) => number
type SetWindowLongPtrFn = (hWnd: number | bigint, nIndex: number, dwNewLong: number | bigint) => number | bigint
type GetWindowLongPtrFn = (hWnd: number | bigint, nIndex: number) => number | bigint
type ClipboardListenerFn = (hWnd: number | bigint) => number
type GetForegroundWindowFn = () => number | bigint
type SetForegroundWindowFn = (hWnd: number | bigint) => boolean

export let registerWindowMessageFn: RegisterWindowMessageFn | null = null
let setWindowLongPtrFn: SetWindowLongPtrFn | null = null
let getWindowLongPtrFn: GetWindowLongPtrFn | null = null
export let addClipboardFormatListenerFn: ClipboardListenerFn | null = null
export let removeClipboardFormatListenerFn: ClipboardListenerFn | null = null
let getForegroundWindowFn: GetForegroundWindowFn | null = null
let setForegroundWindowFn: SetForegroundWindowFn | null = null

if (process.platform === 'win32') {
  try {
    const user32 = koffi.load('user32.dll')
    registerWindowMessageFn = user32.func('uint32 RegisterWindowMessageA(const char *lpString)') as RegisterWindowMessageFn
    try {
      setWindowLongPtrFn = user32.func('intptr_t SetWindowLongPtrW(uintptr_t hWnd, int nIndex, intptr_t dwNewLong)') as SetWindowLongPtrFn
    } catch {
      setWindowLongPtrFn = user32.func('intptr_t SetWindowLongW(uintptr_t hWnd, int nIndex, intptr_t dwNewLong)') as SetWindowLongPtrFn
    }
    try {
      getWindowLongPtrFn = user32.func('intptr_t GetWindowLongPtrW(uintptr_t hWnd, int nIndex)') as GetWindowLongPtrFn
    } catch {
      getWindowLongPtrFn = user32.func('intptr_t GetWindowLongW(uintptr_t hWnd, int nIndex)') as GetWindowLongPtrFn
    }
    try {
      addClipboardFormatListenerFn = user32.func('bool AddClipboardFormatListener(uintptr_t hWnd)') as ClipboardListenerFn
      removeClipboardFormatListenerFn = user32.func('bool RemoveClipboardFormatListener(uintptr_t hWnd)') as ClipboardListenerFn
    } catch (err) {
      console.error('[Window] Failed to load clipboard listener APIs:', err)
    }
    try {
      getForegroundWindowFn = user32.func('uintptr_t GetForegroundWindow()') as GetForegroundWindowFn
      setForegroundWindowFn = user32.func('bool SetForegroundWindow(uintptr_t hWnd)') as SetForegroundWindowFn
    } catch (err) {
      console.error('[Window] Failed to load foreground-window APIs:', err)
    }
  } catch (err) {
    console.error('[Window] Failed to load user32 functions via koffi:', err)
  }
}

const GWL_EXSTYLE = -20
const WS_EX_NOACTIVATE = 0x08000000

export function getHwnd(win: BrowserWindow | null): number | bigint {
  if (!win || win.isDestroyed()) return 0
  const handleBuf = win.getNativeWindowHandle()
  return process.arch === 'x64' ? handleBuf.readBigUInt64LE(0) : handleBuf.readUInt32LE(0)
}

/**
 * Applies Win32 WS_EX_NOACTIVATE style so clicking anywhere on the panel (buttons, cards, empty space)
 * never steals OS window/keyboard focus from the currently active application.
 */
export function applyNoActivateStyle(win: BrowserWindow | null, enable: boolean): void {
  if (process.platform !== 'win32' || !win || win.isDestroyed() || !getWindowLongPtrFn || !setWindowLongPtrFn) return
  try {
    const hwnd = getHwnd(win)
    if (!hwnd) return
    const currentExStyle = Number(getWindowLongPtrFn(hwnd, GWL_EXSTYLE))
    const newExStyle = enable
      ? (currentExStyle | WS_EX_NOACTIVATE)
      : (currentExStyle & ~WS_EX_NOACTIVATE)
    if (newExStyle !== currentExStyle) {
      setWindowLongPtrFn(hwnd, GWL_EXSTYLE, newExStyle)
    }
  } catch (err) {
    console.error('[Window] Failed to apply WS_EX_NOACTIVATE:', err)
  }
}

/**
 * Foreground memory for shelf search + paste.
 *
 * The shelf normally never takes OS focus, so paste (Ctrl+V to "whatever is
 * focused") just works. Typing in search REQUIRES focus, which moves the
 * foreground to Edge-Drop. To keep the user's flow (click item -> lands in
 * their app), the main process notes which window was in front at open time
 * and again at search-engage time (when WE cannot yet be foreground, so the
 * reading is guaranteed correct), and hands focus back — verified — before
 * any paste or release. Proven rule from trace diagnosis: native
 * style/focusability writes disturb the foreground, so the verified handoff
 * is always the LAST focus-affecting act, and redundant native writes are
 * skipped via focusabilityApplied.
 */
let lastExternalForeground: number | bigint = 0
/** Last focusability actually applied via native calls (avoids redundant writes). */
let focusabilityApplied: boolean | null = null

function hwndNumber(h: number | bigint): number {
  try {
    return Number(h)
  } catch {
    return 0
  }
}

function hwndHex(h: number | bigint): string {
  try {
    return `0x${Number(h).toString(16)}`
  } catch {
    return '0x0'
  }
}

/** Diagnostic probe: logs the foreground window at a named checkpoint. */
export function traceFg(tag: string): void {
  try {
    if (process.platform !== 'win32' || !getForegroundWindowFn) return
    const fg = getForegroundWindowFn()
    console.log(`[FocusTrace] ${tag} fg=${fg ? hwndHex(fg) : 'none'}`)
  } catch { /* ignore */ }
}

/** Record the foreground window unless it is our own. Last-wins. */
let lastExternalPid = 0
export function captureExternalForeground(): void {
  if (process.platform === 'darwin') {
    const pid = frontmostPid()
    if (pid && pid !== process.pid) lastExternalPid = pid
    return
  }
  if (process.platform !== 'win32' || !getForegroundWindowFn) return
  try {
    const fg = getForegroundWindowFn()
    if (!fg || hwndNumber(fg) === 0) return
    const self = getHwnd(mainWindow)
    if (self && hwndNumber(fg) === hwndNumber(self)) return
    lastExternalForeground = fg
    console.log(`[Focus] captured external foreground=${hwndHex(fg)} (self=${self ? hwndHex(self) : 'none'})`)
  } catch { /* ignore */ }
}

/** True when OUR window currently holds the OS foreground (search typing). */
export function holdsOwnForeground(): boolean {
  if (process.platform === 'darwin') return weAreFrontmost()
  if (process.platform !== 'win32' || !getForegroundWindowFn) return false
  if (!mainWindow || mainWindow.isDestroyed()) return false
  try {
    const fg = getForegroundWindowFn()
    const self = getHwnd(mainWindow)
    return !!fg && !!self && hwndNumber(fg) === hwndNumber(self)
  } catch {
    return false
  }
}

/** Read the current foreground window (0 when none). */
function currentFg(): number | bigint {
  try {
    if (process.platform !== 'win32' || !getForegroundWindowFn) return 0
    return getForegroundWindowFn() ?? 0
  } catch {
    return 0
  }
}

/** True for a usable (non-zero) window handle. */
function usableHwnd(h: number | bigint): boolean {
  return !!h && hwndNumber(h) !== 0
}

/**
 * Verified handoff to an explicit target: attempt SetForegroundWindow, then
 * CONFIRM the foreground actually moved (Windows can refuse transiently).
 * Retries with small sleeps. Resolves true only when the target is
 * foreground afterwards.
 */
export async function restoreFgAwaited(target: number | bigint, tag: string): Promise<boolean> {
  if (process.platform !== 'win32' || !setForegroundWindowFn || !getForegroundWindowFn) {
    return false
  }
  if (!usableHwnd(target)) {
    console.log(`[Focus] ${tag}: no target to restore`)
    return false
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const before = getForegroundWindowFn()
      const ok = !!setForegroundWindowFn(target)
      await new Promise((r) => setTimeout(r, 30))
      const fg = getForegroundWindowFn()
      const verified = !!fg && hwndNumber(fg) === hwndNumber(target)
      console.log(
        `[Focus] ${tag} attempt ${attempt}: setFg=${ok} verified=${verified} ` +
        `before=${before ? hwndHex(before) : 'none'} after=${fg ? hwndHex(fg) : 'none'} ` +
        `target=${hwndHex(target)}`
      )
      if (verified) return true
    } catch (err) {
      console.error(`[Focus] ${tag} attempt ${attempt} threw:`, err)
    }
  }
  console.log(`[Focus] ${tag} FAILED all attempts`)
  return false
}

/**
 * Verified handoff to the captured app. Thin wrapper over restoreFgAwaited.
 */
export function restoreExternalFocusAwaited(): Promise<boolean> {
  if (process.platform === 'darwin') return Promise.resolve(activatePid(lastExternalPid))
  return restoreFgAwaited(lastExternalForeground, 'restore')
}

/**
 * Uniform pre-send rule for every paste path (search or normal).
 *
 * Clipboard content is ALWAYS written before this runs, so nothing is lost.
 * Returns a settle delay in ms when Ctrl+V may be sent, or -1 when the
 * foreground is unrecoverably ours — the caller must then toast instead of
 * firing blind (silent mis-paste is the only unforgivable outcome).
 * - Foreground already correct (normal flow, or user moved on themselves):
 *   return the standard delay, zero focus work.
 * - Foreground is us (search flow): drop focusability, verified handoff,
 *   longer settle on success, -1 on failure.
 */
export async function resolvePasteTarget(normalDelayMs: number): Promise<number> {
  if (process.platform === 'darwin') {
    try {
      if (!weAreFrontmost()) return normalDelayMs
      setWindowFocusable(false)
      return (await waitUntilNotFrontmost()) ? 80 : -1
    } catch {
      return normalDelayMs
    }
  }
  if (process.platform !== 'win32') return normalDelayMs
  try {
    if (!holdsOwnForeground()) return normalDelayMs
    setWindowFocusable(false)
    const restored = await restoreExternalFocusAwaited()
    console.log(`[Focus] paste resolve restored=${restored}`)
    return restored ? 140 : -1
  } catch {
    return normalDelayMs
  }
}

export const macEscape = createMacEscapeCapture(
  () => interactive && openedExplicitly && focusabilityApplied !== true && !runtime.quitting && !pollPausedForLock,
  () => {
    if (interactive) sendToMainWindow('window:toggle', false)
  }
)

export const syncMacEscapeCapture = macEscape.sync

export function setWindowFocusable(focusable: boolean): void {
  if (process.platform === 'darwin' && mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (focusable) {
        const pid = frontmostPid()
        if (pid && pid !== process.pid) lastExternalPid = pid
        mainWindow.setFocusable(true)
        focusabilityApplied = true
        activateForKeyboard(mainWindow, () => focusabilityApplied === true)
      } else {
        mainWindow.setFocusable(false)
        focusabilityApplied = false
        if (weAreFrontmost() && lastExternalPid) activatePid(lastExternalPid)
      }
    } catch { /* ignore */ }
    syncMacEscapeCapture()
    return
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      // Skip redundant native writes: even "no-op" style/focusability calls
      // have disturbed the foreground in traces, so never repeat them.
      if (focusabilityApplied === focusable) {
        if (focusable) {
          try { mainWindow.focus() } catch { /* ignore */ }
        }
        return
      }
      if (!focusable) {
        // Trace-proven: these native writes can drop or move the foreground
        // (observed: target -> NONE), and any guard read AFTER the writes
        // then sees "not us" and skips recovery. So snapshot the foreground
        // BEFORE, write, then repair AFTER based on fresh readings:
        // - after==us or after==none: the writes broke it. Restore `before`
        //   when it was a healthy other window (exact truth just observed),
        //   else the captured app. Verified with retries; nothing native
        //   runs after the handoff.
        // - after==healthy other window: untouched, leave it alone (covers
        //   Alt+Tab-away: never yanks the user back).
        const self = getHwnd(mainWindow)
        const isSelf = (h: number | bigint): boolean => !!self && !!h && hwndNumber(h) === hwndNumber(self)
        const before = currentFg()
        const beforeHealthy = usableHwnd(before) && !isSelf(before)
        applyNoActivateStyle(mainWindow, true)
        traceFg('setWindowFocusable(false) after NOACTIVATE')
        mainWindow.setFocusable(false)
        traceFg('setWindowFocusable(false) after setFocusable')
        focusabilityApplied = false
        const after = currentFg()
        if (!usableHwnd(after) || isSelf(after)) {
          const target = beforeHealthy ? before : lastExternalForeground
          console.log(
            `[Focus] release repair: before=${before ? hwndHex(before) : 'none'} ` +
            `after=${after ? hwndHex(after) : 'none'} target=${usableHwnd(target) ? hwndHex(target) : 'none'}`
          )
          if (usableHwnd(target)) {
            void restoreFgAwaited(target, 'release-repair').catch(() => {})
          }
        }
        return
      }
      applyNoActivateStyle(mainWindow, false)
      mainWindow.setFocusable(true)
      focusabilityApplied = true
      mainWindow.focus()
      traceFg('setWindowFocusable(true) exit')
    } catch {}
  }
}
