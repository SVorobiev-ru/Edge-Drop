import { edge } from '../lib/edge'
import { t } from '../i18n'
import { handOffKeyboardForPaste, isUsageOnlyUpdate, resumeKeyboardAfterPaste, sameItemMeta } from './storeHelpers'
import type { AppState, StoreGet, StoreSet } from './types'

const HYDRATE_RETRY_DELAYS_MS = [200, 500, 1200, 2500]
const HYDRATE_BACKGROUND_RETRY_MS = 10_000

let hydrateRetryTimer: ReturnType<typeof setTimeout> | null = null

const appIconRequests = new Set<string>()

export const createItemsSlice = (set: StoreSet, get: StoreGet) => ({
  items: [],
  itemsUsageOnly: false,

  hydrated: false,

  appIcons: {},
  requestAppIcon: (bundleId) => {
    if (!bundleId || bundleId in get().appIcons || appIconRequests.has(bundleId)) return
    appIconRequests.add(bundleId)
    let request: Promise<string | null>
    try {
      request = Promise.resolve(edge.getAppIcon(bundleId))
    } catch {
      request = Promise.resolve(null)
    }
    void request
      .then((icon) => (typeof icon === 'string' && icon ? icon : null))
      .catch(() => null)
      .then((icon) => {
        appIconRequests.delete(bundleId)
        set({ appIcons: { ...get().appIcons, [bundleId]: icon } })
      })
  },

  itemMenuOpen: false,
  showItemMenu: (id, sub) => {
    set({ itemMenuOpen: true })
    let request: Promise<void>
    try {
      request = Promise.resolve(sub ? edge.showItemMenu(id, sub) : edge.showItemMenu(id))
    } catch {
      request = Promise.resolve()
    }
    void request.catch(() => {}).then(() => set({ itemMenuOpen: false }))
  },

  renamingId: null,
  setRenamingId: (renamingId) => set({ renamingId }),
  async renameItem(id, title) {
    set({ renamingId: null })
    try {
      const items = await edge.setItemTitle(id, title.trim())
      if (Array.isArray(items)) get().setItems(items)
    } catch { /* ignore */ }
  },

  async hydrate() {
    let lastError: unknown = null
    const load = async (): Promise<boolean> => {
      try {
        const { items, settings, version, isStoreBuild, updateInfo } = await edge.loadState()
        if (!Array.isArray(items) || !settings) throw new Error('state:load returned no state')
        const skipped = settings?.skippedUpdateVersion
        const validUpdateInfo = (updateInfo && (!skipped || updateInfo.latestVersion !== skipped)) ? updateInfo : null
        set({ 
          items, 
          settings, 
          currentVersion: version,
          isStoreBuild: isStoreBuild ?? false,
          updateInfo: validUpdateInfo ?? get().updateInfo,
          hydrated: true
        })
        return true
      } catch (err) {
        lastError = err
        return false
      }
    }
    if (hydrateRetryTimer) {
      clearTimeout(hydrateRetryTimer)
      hydrateRetryTimer = null
    }
    for (let attempt = 0; ; attempt++) {
      if (await load()) return
      const delay = HYDRATE_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    console.error('[hydrate] state:load keeps failing, retrying in the background', lastError)
    set({ hydrated: true })
    get().pushToast({ id: `load-failed-${Date.now()}`, message: 'toast.loadFailed', tone: 'error' })
    const retry = (): void => {
      hydrateRetryTimer = setTimeout(() => {
        hydrateRetryTimer = null
        void load().then((ok) => {
          if (!ok) retry()
        })
      }, HYDRATE_BACKGROUND_RETRY_MS)
    }
    retry()
  },

  setItems: (items, meta) => {
    const prevItems = get().items
    if (
      prevItems.length === items.length &&
      prevItems.every((it, i) => it.id === items[i]?.id && it.pinned === items[i]?.pinned && it.hitCount === items[i]?.hitCount && it.capturedAt === items[i]?.capturedAt && sameItemMeta(it, items[i]))
    ) {
      return
    }
    // Copy confirmation is owned by `ui:copy-flare` (App.tsx). Firing it again
    // here replayed the indicator after a slow capture (large spreadsheet)
    // finished — the hint already showed it ~780ms earlier.
    set({ items, itemsUsageOnly: isUsageOnlyUpdate(prevItems, items, meta?.reason) })
  },

  async togglePin(id, pinned) {
    // Optimistic: flip locally, then let the pushed list confirm.
    set({
      items: get().items.map((it) => (it.id === id ? { ...it, pinned } : it))
    })
    const items = await edge.setPinned(id, pinned)
    const current = get().items
    if (items.length !== current.length || items.some((it, i) => it.id !== current[i]?.id || it.pinned !== current[i]?.pinned)) {
      set({ items })
    }
  },

  async remove(id) {
    const previousItems = get().items
    set({ items: previousItems.filter((it) => it.id !== id) })
    try {
      const items = await edge.deleteItem(id)
      const current = get().items
      if (items.length !== current.length || items.some((it, i) => it.id !== current[i]?.id)) {
        set({ items })
      }
    } catch {
      // Do not leave the UI claiming an item was deleted when the main-process
      // persistence request failed (for example during a renderer reload).
      set({ items: previousItems })
      get().pushToast({ id: `delete-${Date.now()}`, message: t('toast.deleteFailed'), tone: 'error' })
    }
  },

  async clear(ids?: string[]) {
    if (!ids || ids.length === 0) {
      const previousItems = get().items
      set({ items: previousItems.filter((it) => it.pinned) })
      try {
        const items = await edge.clearItems()
        const current = get().items
        if (items.length !== current.length || items.some((it, i) => it.id !== current[i]?.id)) {
          set({ items })
        }
      } catch {
        set({ items: previousItems })
        get().pushToast({ id: `clear-${Date.now()}`, message: t('toast.clearFailed'), tone: 'error' })
      }
    } else {
      const previousItems = get().items
      const idSet = new Set(ids)
      set({ items: previousItems.filter((it) => !idSet.has(it.id)) })
      try {
        const items = await edge.deleteBatchItems(ids)
        const current = get().items
        if (items.length !== current.length || items.some((it, i) => it.id !== current[i]?.id)) {
          set({ items })
        }
      } catch {
        set({ items: previousItems })
        get().pushToast({ id: `clear-${Date.now()}`, message: t('toast.clearFailed'), tone: 'error' })
      }
    }
  },

  async copy(id) {
    // Internal copy from the clipboard: write to OS clipboard with internal copy
    // guard active so the external edge copy indicator flare does not appear.
    set({ isInternalCopying: true })
    try {
      await edge.copyItem(id)
    } finally {
      setTimeout(() => set({ isInternalCopying: false }), 400)
    }
  },

  async copySubitem(req) {
    set({ isInternalCopying: true })
    try {
      await edge.copySubitem(req)
    } finally {
      setTimeout(() => set({ isInternalCopying: false }), 400)
    }
  },

  async paste(id, opts, fromKeyboard) {
    if (!fromKeyboard) handOffKeyboardForPaste(get, set)
    set({ isInternalCopying: true })
    try {
      await (opts ? edge.pasteItem(id, opts) : edge.pasteItem(id))
    } finally {
      setTimeout(() => set({ isInternalCopying: false }), 600)
    }
    if (fromKeyboard) resumeKeyboardAfterPaste(get)
  },

  async pasteSubitem(req) {
    handOffKeyboardForPaste(get, set)
    set({ isInternalCopying: true })
    try {
      await edge.pasteSubitem(req)
    } finally {
      setTimeout(() => set({ isInternalCopying: false }), 600)
    }
  },

  async pasteEmoji(text) {
    handOffKeyboardForPaste(get, set)
    set({ isInternalCopying: true })
    try {
      await edge.pasteEmoji(text)
    } finally {
      setTimeout(() => set({ isInternalCopying: false }), 400)
    }
  }
}) satisfies Partial<AppState>
