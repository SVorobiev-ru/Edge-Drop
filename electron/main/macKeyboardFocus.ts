import { app, globalShortcut, type BrowserWindow } from 'electron'
import { activateSelf, weAreFrontmost } from './macNative'

const MAC_FOCUS_RETURN_TIMEOUT_MS = 500
const MAC_FOCUS_RETURN_POLL_MS = 25

export async function waitUntilNotFrontmost(timeoutMs = MAC_FOCUS_RETURN_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await new Promise((r) => setTimeout(r, MAC_FOCUS_RETURN_POLL_MS))
    if (!weAreFrontmost()) return true
    if (Date.now() >= deadline) return false
  }
}

const MAC_ESCAPE_ACCELERATOR = 'Escape'

export interface MacEscapeCapture {
  sync(): void
  release(): void
}

export function createMacEscapeCapture(wanted: () => boolean, onEscape: () => void): MacEscapeCapture {
  let captured = false

  function release(): void {
    if (process.platform !== 'darwin') return
    try {
      if (captured || globalShortcut.isRegistered(MAC_ESCAPE_ACCELERATOR)) {
        globalShortcut.unregister(MAC_ESCAPE_ACCELERATOR)
      }
    } catch { /* ignore */ }
    captured = false
  }

  function handleEscape(): void {
    release()
    onEscape()
  }

  function sync(): void {
    if (process.platform !== 'darwin') return
    if (!wanted()) {
      release()
      return
    }
    try {
      if (captured && globalShortcut.isRegistered(MAC_ESCAPE_ACCELERATOR)) return
      captured = globalShortcut.register(MAC_ESCAPE_ACCELERATOR, handleEscape)
    } catch {
      captured = false
    }
  }

  return { sync, release }
}

const MAC_ACTIVATION_CHECK_MS = 150

export function activateForKeyboard(win: BrowserWindow, stillFocusable: () => boolean): void {
  if (!activateSelf()) app.focus({ steal: true })
  win.focus()
  setTimeout(() => {
    if (win.isDestroyed() || !stillFocusable() || weAreFrontmost()) return
    app.focus({ steal: true })
    win.focus()
  }, MAC_ACTIVATION_CHECK_MS)
}
