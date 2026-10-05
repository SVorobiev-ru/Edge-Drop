import { clipboard } from 'electron'
import { getStore, loadSettings, pushState, getWatcher } from './state'
import type { ClipboardItem, DragRequest } from '../../shared/types'
import { clipboardMatchesItem } from './clipboardWrite'
import { pasteQueue } from './pastePipeline'

export function deleteItem(id: string): void {
  const item = getStore().get(id)
  const watcher = getWatcher()
  // Pause first: an in-flight settle timer from the copy that created this
  // item would otherwise readClipboard() after we splice and put it back.
  watcher.setPaused(true)
  try {
    // Resolve clipboard ownership BEFORE mutating the store: if this exact
    // content still sits on the system clipboard it must be cleared first so
    // (a) the staged-temp cleanup inside delete() can never yank a file from
    // under a live OS clipboard reference, and (b) resyncSignature() below
    // locks onto an EMPTY clipboard, making an immediate re-copy of the same
    // content a detectable change instead of an invisible no-op.
    if (item && clipboardMatchesItem(item)) {
      clipboard.clear()
    }
    getStore().delete(id)
  } finally {
    watcher.resyncSignature()
    watcher.setPaused(loadSettings().incognito)
  }
  pasteQueue.prune()
  pushState.items()
}

export function deleteItems(ids: string[]): void {
  if (!ids || ids.length === 0) return
  const items = ids.map((id) => getStore().get(id)).filter((item): item is ClipboardItem => !!item)
  const watcher = getWatcher()
  watcher.setPaused(true)
  try {
    if (items.some((item) => clipboardMatchesItem(item))) {
      clipboard.clear()
    }
    getStore().deleteBatch(ids)
  } finally {
    watcher.resyncSignature()
    watcher.setPaused(loadSettings().incognito)
  }
  pasteQueue.prune()
  pushState.items()
}

export function removeSubitem(req: DragRequest): boolean {
  const success = getStore().removeSubitem(req)
  if (success) pushState.items()
  return success
}
