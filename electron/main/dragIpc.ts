import { ipcMain } from 'electron'
import { type SendMap, type SendChannel } from '../../shared/ipc'
import { getStore, loadSettings, pushState } from './state'
import { setHeartbeatPaused } from './window'
import { startDragOut, resolveDragData, prestageDrag } from './drag'
import type { DragRequest } from '../../shared/types'
import { startSelectionDrag } from './selectionOps'
import { awaitMacDragEnd, cursorPointInSenderWindow, nextDragGeneration } from './dragEnd'

/**
 * Register fire-and-forget (send) listeners.
 *
 * These use `ipcMain.on` + `event.sender` instead of `ipcMain.handle` because
 * the drag-out gesture must be synchronous — `event.sender.startDrag(...)` only
 * works correctly when called from the same event-loop turn as the renderer's
 * `dragstart` event.
 */
function on<C extends SendChannel>(
  channel: C,
  fn: (sender: Electron.WebContents, ...args: SendMap[C]['args']) => void
): void {
  ipcMain.on(channel, (event, ...args) => fn(event.sender, ...(args as SendMap[C]['args'])))
}

function finishDragOut(sender: Electron.WebContents, req: DragRequest, dragStarted: boolean, isWholeItemDrag: boolean): void {
  const isMac = process.platform === 'darwin'
  console.log(isMac ? '[IPC] drag finished, sending drag-end' : '[IPC] start-drag returned, sending drag-end')
  sender.send('item:drag-end')

  // Re-enable the heartbeat now that the drag is over.
  if (!isMac) setHeartbeatPaused(false)

  // Check if the user dropped the item back onto our window!
  const drop = cursorPointInSenderWindow(sender)
  if (drop) {
    console.log(`[IPC] Drag ended inside window! Triggering internal-drop at x=${drop.x}, y=${drop.y}`)
    sender.send('item:internal-drop', drop)
  }

  if (dragStarted && isWholeItemDrag && !drop) {
    // Usage accounting parity with click-to-paste: a whole-item drag counts
    // as a use ONLY when successfully dropped outside into another application.
    // Dropping back onto the shelf or cancelling does not bump hitCount.
    if (loadSettings().movePastedToTop !== false && getStore().get(req.id)) {
      getStore().touch(req.id)
    }
    // 'usage' reason: this push is bookkeeping from a manual drag-out, so
    // the renderer must NOT flash the capture copy-indicator for it.
    pushState.items({ reason: 'usage' })
  }
}

export function registerSendListeners(): void {
  on('item:start-drag', (sender, req) => {
    console.log('[IPC] item:start-drag req=', JSON.stringify(req))
    const resolved = resolveDragData(req)
    if (!resolved) {
      console.log('[IPC] start-drag: no data resolved')
      return
    }
    const { data, capturedAt, subIndex } = resolved
    console.log('[IPC] start-drag: kind=', data.kind)

    // Usage accounting parity with click-to-paste: a whole-item drag counts
    // as a use. Bumps hitCount and moves unpinned items to the top, gated
    // behind the same movePastedToTop setting paste uses. Sub-item drags
    // (one file out of a bundle, one image out of a collection) deliberately
    // do not reorder history - same rule as item:paste-subitem.
    const isWholeItemDrag = !(req.paths && req.paths.length > 0) && !req.imageId
    const isMac = process.platform === 'darwin'

    // Pause the always-on-top heartbeat for the duration of the drag.
    // The heartbeat fires SetWindowPos(HWND_TOPMOST) every 500 ms, which
    // pushes our window in front of the DWM drag-ghost image — making the
    // dragged item appear to vanish ~0.5 s into any drag gesture.
    if (!isMac) setHeartbeatPaused(true)

    const generation = nextDragGeneration()
    const dragStarted = startDragOut(sender, data, capturedAt, subIndex)
    if (!isMac || !dragStarted) {
      finishDragOut(sender, req, dragStarted, isWholeItemDrag)
      return
    }
    awaitMacDragEnd(sender, generation, () => finishDragOut(sender, req, dragStarted, isWholeItemDrag), { tag: 'start-drag', verbose: true })
  })

  on('item:prestage-drag', (_sender, req) => {
    prestageDrag(req)
  })

  on('items:start-drag-multi', (sender, ids) => {
    startSelectionDrag(sender, ids)
  })
}
