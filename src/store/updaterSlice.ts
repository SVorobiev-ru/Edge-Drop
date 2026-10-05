import { edge } from '../lib/edge'
import type { AppState, StoreGet, StoreSet } from './types'

/**
 * Version dismissed this run. Session-only (never persisted): quitting and
 * relaunching clears it, so a skipped update prompts again next launch —
 * the "remind me next restart" contract. Manual checks bypass it entirely.
 */
let sessionSkippedVersion: string | null = null

export const createUpdaterSlice = (set: StoreSet, get: StoreGet) => ({
  currentVersion: '',
  isStoreBuild: false,
  updateInfo: null,

  manualCheckState: { status: 'idle' },
  manualUpdateActive: false,

  startManualCheck: async () => {
    set({ manualCheckState: { status: 'checking' }, manualUpdateActive: true })
    try {
      const res = await edge.checkForUpdatesManual()
      if (res.status === 'available') {
        set({
          manualCheckState: { status: 'available', version: res.version },
          updateInfo: { hasUpdate: true, latestVersion: res.version || '', downloaded: false },
          manualUpdateActive: true
        })
      } else if (res.status === 'up-to-date') {
        set({
          manualCheckState: { status: 'up-to-date', version: res.version },
          manualUpdateActive: false
        })
      } else {
        set({
          manualCheckState: { status: 'error', error: res.error || 'Check failed' },
          manualUpdateActive: false
        })
      }
    } catch (err: any) {
      set({
        manualCheckState: { status: 'error', error: err?.message || 'Check failed' },
        manualUpdateActive: false
      })
    }
  },

  startManualDownload: async () => {
    set({ manualCheckState: { status: 'downloading' }, manualUpdateActive: true })
    try {
      await edge.startUpdateDownload()
    } catch {
      set({ manualCheckState: { status: 'error', error: 'Download failed' } })
    }
  },

  resetManualCheck: () => set({ manualCheckState: { status: 'idle' } }),

  setUpdateAvailable: (info) => {
    // Session skip: a version dismissed this run is not re-prompted by
    // background pushes, but WILL prompt again after the next launch (the
    // "remind me next restart" contract). A different version clears the
    // session skip and surfaces normally. Manual checks bypass this.
    if (sessionSkippedVersion && info.version === sessionSkippedVersion) {
      return
    }
    if (sessionSkippedVersion && info.version !== sessionSkippedVersion) {
      sessionSkippedVersion = null
    }
    // A background find arriving while no manual flow owns the UI resets the
    // manual marker, so placement below keys off fresh truth, not stale flags.
    if (get().manualCheckState.status === 'idle') {
      set({ manualUpdateActive: false })
    }
    // A background find for a DIFFERENT version than a settled manual result
    // retires the stale manual result — the top card then shows the newer
    // version instead of two disagreeing prompts.
    const mc = get().manualCheckState
    if ((mc.status === 'available' || mc.status === 'up-to-date' || mc.status === 'error') && mc.version && mc.version !== info.version) {
      set({ manualCheckState: { status: 'idle' }, manualUpdateActive: false })
    }
    set({
      updateInfo: {
        hasUpdate: true,
        latestVersion: info.version,
        downloaded: false
      }
    })
  },

  setUpdateProgress: (progress) => {
    const current = get().updateInfo
    if (!current) {
      set({
        updateInfo: {
          hasUpdate: true,
          latestVersion: '',
          downloaded: false,
          downloadProgress: progress
        }
      })
      return
    }
    set({
      updateInfo: {
        ...current,
        downloadProgress: progress
      }
    })
  },

  setUpdateDownloaded: (info) => {
    set({
      updateInfo: {
        hasUpdate: true,
        latestVersion: info.version,
        downloaded: true,
        downloadProgress: undefined
      },
      manualCheckState: { status: 'idle' }
    })
  },

  dismissUpdate: () => {
    // Skip = "not now": remember for this session only. The next launch
    // re-prompts (nothing persisted), a newer version always surfaces.
    const skipped = get().updateInfo?.latestVersion || get().manualCheckState.version
    sessionSkippedVersion = skipped || null
    set({ updateInfo: null, manualCheckState: { status: 'idle' }, manualUpdateActive: false })
  },

  async installUpdate() {
    await edge.installUpdate()
  }
}) satisfies Partial<AppState>
