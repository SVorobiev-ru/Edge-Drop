import type { BrowserWindow } from 'electron'

export let mainWindow: BrowserWindow | null = null
export let interactive = false
export let openedExplicitly = false
export let explicitOpenMarkedAt = 0
export let pollPausedForLock = false

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** Send only while the panel has a live, settled renderer frame. */
export function sendToMainWindow(channel: string, ...args: unknown[]): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const contents = mainWindow.webContents
  if (contents.isDestroyed() || contents.isLoadingMainFrame()) return false
  try {
    contents.send(channel, ...args)
    return true
  } catch {
    // A frame can be disposed between the checks above and send(). Renderer
    // hydration obtains the current state once its replacement frame is ready.
    return false
  }
}

/** True when the window currently accepts mouse clicks (blade is "open"). */
export function isInteractive(): boolean {
  return interactive
}

export function assignMainWindow(_current: BrowserWindow | null, win: BrowserWindow): asserts _current is BrowserWindow {
  mainWindow = win
}

export function assignInteractive(value: boolean): void {
  interactive = value
}

export function assignOpenedExplicitly(value: boolean): void {
  openedExplicitly = value
}

export function assignExplicitOpenMarkedAt(value: number): void {
  explicitOpenMarkedAt = value
}

export function assignPollPausedForLock(value: boolean): void {
  pollPausedForLock = value
}
