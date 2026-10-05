import { clipboard } from 'electron'
import type { ClipboardItem, MergeResult, MultiRequest } from '../../shared/types'
import { SELECTION_LIMIT, allStackable, allTextLike, joinTextParts, type TextPart } from '../../shared/selection'
import { getStore, loadSettings, pushState, getWatcher } from './state'
import { setHeartbeatPaused, getMainWindow } from './window'
import { stageSelectionFiles, startMultiDragOut } from './drag'
import { buildSelectionMenuTemplate, popupItemMenu } from './itemMenu'
import { mainText } from './language'
import { handle } from './ipcHandle'
import { toast } from './toast'
import { awaitMacDragEnd, cursorPointInSenderWindow, deleteItems, keepsPanelOpenAfterPaste, markSelfWrite, nextDragGeneration, pasteQueue, promotePasted, promotesOnCopy, sendPasteKeys, serializePaste, settleWatcher, takePasteSlot, writeFileListToClipboard } from './ipc'

type SelectionPayload =
  | { kind: 'text'; text: string; html?: string }
  | { kind: 'files'; paths: string[] }

function selectionItems(ids: unknown): ClipboardItem[] | null {
  if (!Array.isArray(ids)) return null
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string'))]
  if (unique.length > SELECTION_LIMIT) {
    toast('toast.selectionTooLarge', 'error', { max: SELECTION_LIMIT })
    return null
  }
  const items = unique.map((id) => getStore().get(id)).filter((item): item is ClipboardItem => !!item)
  return items.length > 0 ? items : null
}

function selectionTextPart(item: ClipboardItem & { data: { kind: 'text' } }): TextPart {
  const data = item.data
  const rich = getStore().getRichText(item.id)
  const text = rich?.text || (data.hasFullPayload ? getStore().getFullText(item.id) || data.text : data.text)
  const html = rich?.html ?? data.html
  return html ? { text, html } : { text }
}

function buildSelectionPayload(items: readonly ClipboardItem[], plain: boolean): SelectionPayload | null {
  if (allTextLike(items)) {
    return { kind: 'text', ...joinTextParts(items.map(selectionTextPart), plain) }
  }
  const staged = stageSelectionFiles(items)
  if (!staged.ok) {
    toast(staged.error, 'error')
    return null
  }
  return { kind: 'files', paths: staged.paths }
}

async function writeSelectionPayload(payload: SelectionPayload): Promise<boolean> {
  if (payload.kind === 'files') return writeFileListToClipboard(payload.paths)
  clipboard.clear()
  clipboard.write(payload.html ? { text: payload.text, html: payload.html } : { text: payload.text })
  return true
}

function touchOrder(items: readonly ClipboardItem[]): string[] {
  return items.map((item) => item.id).reverse()
}

function touchSelection(items: readonly ClipboardItem[]): void {
  for (const id of touchOrder(items)) getStore().touch(id)
}

async function copySelection(req: MultiRequest): Promise<boolean> {
  const items = selectionItems(req?.ids)
  if (!items) return false
  const payload = buildSelectionPayload(items, req.plain === true)
  if (!payload) return false
  getWatcher().setPaused(true)
  try {
    if (!(await writeSelectionPayload(payload))) {
      toast('toast.fileUnavailable', 'error')
      return false
    }
    markSelfWrite()
    if (promotesOnCopy()) {
      touchSelection(items)
      pushState.items({ reason: 'usage' })
    }
    toast('toast.selectionCopied', 'info', { count: items.length })
    return true
  } finally {
    settleWatcher(200, 'resync')
  }
}

async function pasteSelection(req: MultiRequest): Promise<boolean> {
  if (!takePasteSlot()) {
    console.log('[IPC] items:paste-multi blocked — too soon after last paste')
    return false
  }
  return serializePaste(() => pasteSelectionNow(req))
}

async function pasteSelectionNow(req: MultiRequest): Promise<boolean> {
  const items = selectionItems(req?.ids)
  if (!items) return false
  const payload = buildSelectionPayload(items, req.plain === true)
  if (!payload) return false

  getWatcher().setPaused(true)
  try {
    if (!(await writeSelectionPayload(payload))) {
      toast('toast.fileUnavailable', 'error')
      return false
    }
    markSelfWrite()
    if (!keepsPanelOpenAfterPaste()) pushState.togglePanel(false)
    const promotedNow = loadSettings().movePastedToTop !== false && !promotePasted(touchOrder(items))
    await sendPasteKeys()
    if (promotedNow) {
      setTimeout(() => {
        pushState.items()
      }, 250)
    }
  } finally {
    settleWatcher(350, 'resync')
  }
  return true
}

function stackSelection(ids: string[]): MergeResult {
  const items = selectionItems(ids)
  if (!items || items.length < 2) return { ok: false, reason: 'notfound' }
  const target = items[0].id
  let merged = 0
  let result: MergeResult = { ok: true }
  for (const item of items.slice(1)) {
    result = getStore().merge(item.id, target)
    if (!result.ok) {
      if (result.reason === 'full' || result.reason === 'incompatible') {
        toast(result.message || 'toast.mergeIncompatible', 'info')
      }
      break
    }
    merged++
  }
  if (merged > 0) {
    pasteQueue.prune()
    pushState.items()
  }
  return result
}

function pinSelection(ids: string[], pinned: boolean): void {
  const items = selectionItems(ids)
  if (!items) return
  for (const item of items) getStore().setPinned(item.id, pinned)
  pushState.items()
}

export function showSelectionMenu(ids: unknown): Promise<void> {
  const items = selectionItems(ids)
  if (!items) return Promise.resolve()
  const settings = loadSettings()
  const selected = items.map((item) => item.id)
  const allPinned = items.every((item) => item.pinned)
  const t = (key: string, params?: Record<string, string | number>) => mainText(settings.language, key, params)
  const template = buildSelectionMenuTemplate(
    { allText: allTextLike(items), stackable: allStackable(items), allPinned },
    {
      paste: () => void pasteSelection({ ids: selected, plain: false }),
      pastePlain: () => void pasteSelection({ ids: selected, plain: true }),
      copy: () => void copySelection({ ids: selected }),
      stack: () => {
        stackSelection(selected)
      },
      togglePin: () => pinSelection(selected, !allPinned),
      remove: () => deleteItems(selected)
    },
    t
  )
  return popupItemMenu(template, getMainWindow())
}

export function startSelectionDrag(sender: Electron.WebContents, ids: string[]): void {
  const items = selectionItems(ids)
  const staged = items ? stageSelectionFiles(items) : null
  if (!items || !staged || !staged.ok) {
    if (staged && !staged.ok) toast(staged.error, 'error')
    sender.send('item:drag-end')
    return
  }
  const isMac = process.platform === 'darwin'
  if (!isMac) setHeartbeatPaused(true)
  const generation = nextDragGeneration()
  const dragStarted = startMultiDragOut(sender, staged.paths, staged.iconPaths)
  if (!isMac || !dragStarted) {
    finishMultiDragOut(sender, items, dragStarted)
    return
  }
  awaitMacDragEnd(sender, generation, () => finishMultiDragOut(sender, items, dragStarted), { tag: 'start-drag-multi', verbose: false })
}

function finishMultiDragOut(sender: Electron.WebContents, items: readonly ClipboardItem[], dragStarted: boolean): void {
  sender.send('item:drag-end')
  if (process.platform !== 'darwin') setHeartbeatPaused(false)
  const inside = cursorPointInSenderWindow(sender) !== null
  if (!dragStarted || inside) return
  if (loadSettings().movePastedToTop !== false) {
    touchSelection(items.filter((item) => !!getStore().get(item.id)))
  }
  pushState.items({ reason: 'usage' })
}

export function registerSelectionIpc(): void {
  handle('items:copy-multi', (req) => copySelection(req))

  handle('items:paste-multi', (req) => pasteSelection(req))

  handle('items:stack-multi', (ids) => stackSelection(ids))

  handle('items:pin-multi', (ids, pinned) => {
    pinSelection(ids, pinned)
    return getStore().toDto()
  })
}
