import { shell } from 'electron'
import type { ItemMenuRequest } from '../../shared/types'
import { getStore, loadSettings, saveSettings, pushState, getWatcher } from './state'
import { sendToMainWindow, getMainWindow } from './window'
import { buildItemMenuTemplate, popupItemMenu } from './itemMenu'
import { mainText } from './language'
import { openQuickLook, quickLookTarget } from './quickLook'
import { appIconDataUrl, listOtherRunningApps, pickApplication } from './appPicker'
import { electronBackupIo, exportPinnedHistory, importPinnedHistory, type BackupDeps } from './historyBackup'
import { wakeImageTextRecognition } from './ocr'
import { handle } from './ipcHandle'
import { toast } from './toast'
import { copyItem, copySubitem, deleteItem, pasteItem, pasteQueue, pasteSubitem, removeSubitem } from './ipc'
import { showSelectionMenu } from './selectionOps'

function storedImagePath(imageId: string, ext?: string): string | null {
  return getStore().resolveStoredImagePath(imageId, ext)
}

function showItemContextMenu(id: string, sub?: ItemMenuRequest): Promise<void> {
  const selection = sub?.selection
  if (Array.isArray(selection) && selection.length > 0) return showSelectionMenu(selection)
  const item = getStore().get(id)
  if (!item) return Promise.resolve()
  const settings = loadSettings()
  const subReq = sub && ((sub.paths && sub.paths.length > 0) || sub.imageId) ? { ...sub, id } : undefined
  const target = quickLookTarget(item, subReq?.paths?.[0] ?? subReq?.imageId, storedImagePath)
  const source = item.sourceApp
  const ignoreApp = source && !(settings.ignoredApps ?? []).includes(source.bundleId) ? source : undefined
  const t = (key: string, params?: Record<string, string | number>) => mainText(settings.language, key, params)
  const template = buildItemMenuTemplate(
    { kind: item.data.kind, pinned: item.pinned, sub: !!subReq, canPreview: !!target, canReveal: !!target, ignoreApp },
    {
      paste: () => void (subReq ? pasteSubitem(subReq) : pasteItem(id, { plain: false })),
      pastePlain: () => void pasteItem(id, { plain: true }),
      copy: () => void (subReq ? copySubitem(subReq) : copyItem(id)),
      togglePin: () => {
        getStore().setPinned(id, !item.pinned)
        pushState.items()
      },
      rename: () => {
        sendToMainWindow('item:menu-action', { id, action: 'rename' })
      },
      preview: () => {
        sendToMainWindow('item:menu-action', { id, action: 'preview' })
      },
      reveal: () => {
        if (target) shell.showItemInFolder(target)
      },
      addToQueue: () => {
        pasteQueue.add(id)
      },
      ignoreApp: () => {
        if (!ignoreApp) return
        const current = loadSettings().ignoredApps ?? []
        if (current.includes(ignoreApp.bundleId)) return
        pushState.settings(saveSettings({ ignoredApps: [...current, ignoreApp.bundleId] }))
      },
      remove: () => {
        if (subReq) removeSubitem(subReq)
        else deleteItem(id)
      }
    },
    t
  )
  return popupItemMenu(template, getMainWindow())
}

function backupDeps(): BackupDeps {
  return {
    ...electronBackupIo,
    exportPinned: () => getStore().exportPinned(),
    importPinned: (doc) => getStore().importPinned(doc),
    afterImport: () => {
      getWatcher().resyncSignature()
      pushState.items()
      wakeImageTextRecognition()
    },
    toast
  }
}

export function registerItemContextMenuIpc(): void {
  handle('item:context-menu', (id, sub) => {
    if (process.platform !== 'darwin') return
    return showItemContextMenu(id, sub)
  })

  handle('item:quick-look', (id, path) => {
    if (process.platform !== 'darwin') return false
    const item = getStore().get(id)
    return item ? openQuickLook(quickLookTarget(item, path, storedImagePath)) : false
  })

  handle('item:set-title', (id, title) => {
    if (getStore().setTitle(id, title)) pushState.items()
    return getStore().toDto()
  })

  handle('apps:list-running', () => listOtherRunningApps())

  handle('apps:pick', () => pickApplication())

  handle('apps:icon', (bundleId) => appIconDataUrl(bundleId))

  handle('history:export', () => exportPinnedHistory(backupDeps()))

  handle('history:import', () => importPinnedHistory(backupDeps()))

  handle('queue:add', (id) => {
    if (process.platform !== 'darwin') return []
    return pasteQueue.add(id)
  })

  handle('queue:clear', () => {
    pasteQueue.clear()
  })
}
