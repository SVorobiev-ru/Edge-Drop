import { screen, BrowserWindow } from 'electron'
import { pressedMouseButtons, mouseButtonsAvailable } from './macNative'
import { waitForMouseRelease } from './macDrag'

export function cursorPointInSenderWindow(sender: Electron.WebContents): { x: number; y: number } | null {
  const point = screen.getCursorScreenPoint()
  const win = BrowserWindow.fromWebContents(sender)
  if (!win || win.isDestroyed()) return null
  const bounds = win.getBounds()
  const inside = point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
                 point.y >= bounds.y && point.y <= bounds.y + bounds.height
  return inside ? { x: point.x - bounds.x, y: point.y - bounds.y } : null
}

let dragGeneration = 0
let mouseBridgeWarned = false

export function nextDragGeneration(): number {
  return ++dragGeneration
}

interface MacDragEndOptions {
  tag: string
  verbose: boolean
}

export function awaitMacDragEnd(sender: Electron.WebContents, generation: number, finish: () => void, { tag, verbose }: MacDragEndOptions): void {
  if (!mouseButtonsAvailable()) {
    if (verbose && !mouseBridgeWarned) {
      mouseBridgeWarned = true
      console.warn(`[IPC] ${tag}: mouse button state is unavailable (ObjC bridge not loaded), sending drag-end only`)
    }
    sender.send('item:drag-end')
    return
  }
  waitForMouseRelease(pressedMouseButtons).then((result) => {
    if (generation !== dragGeneration || sender.isDestroyed()) return
    if (result === 'timeout') {
      if (verbose) console.warn(`[IPC] ${tag}: mouse release wait timed out, sending drag-end only`)
      sender.send('item:drag-end')
      return
    }
    finish()
  }).catch((err) => {
    console.error(`[IPC] ${tag}: drag completion failed:`, err)
    if (generation !== dragGeneration) return
    try {
      if (!sender.isDestroyed()) sender.send('item:drag-end')
    } catch (sendErr) {
      if (verbose) console.error(`[IPC] ${tag}: could not send drag-end after failure:`, sendErr)
    }
  })
}
