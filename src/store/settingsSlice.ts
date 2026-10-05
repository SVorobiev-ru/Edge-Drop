import { edge } from '../lib/edge'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { structuralEqual } from '../lib/structuralEqual'
import type { AppState, StoreGet, StoreSet } from './types'

export const createSettingsSlice = (set: StoreSet, get: StoreGet) => ({
  settings: { ...DEFAULT_SETTINGS },

  systemReduceMotion: false,
  setSystemReduceMotion: (systemReduceMotion) => {
    if (get().systemReduceMotion !== systemReduceMotion) set({ systemReduceMotion })
  },

  setSettings: (next) => set((s) => s.liveEdge
    ? { liveBaseEdge: next.stickPosition, settings: { ...next, stickPosition: s.liveEdge } }
    : { settings: next }),
  liveEdge: null,
  liveBaseEdge: DEFAULT_SETTINGS.stickPosition,
  setLiveEdge: (liveEdge) => set((s) => {
    if (liveEdge === s.liveEdge) return {}
    const base = s.liveEdge ? s.liveBaseEdge : s.settings.stickPosition
    const stickPosition = liveEdge ?? base
    return {
      liveEdge,
      liveBaseEdge: base,
      settings: s.settings.stickPosition === stickPosition ? s.settings : { ...s.settings, stickPosition }
    }
  }),

  async patchSettings(patch) {
    const next = await edge.updateSettings(patch)
    set({ settings: next })
  },

  async refreshLaunchAtLogin() {
    try {
      const next = await edge.refreshLaunchAtLogin()
      if (next && !structuralEqual(get().settings, next)) set({ settings: next })
    } catch {
      /* ignore */
    }
  },

  setLaunchAtLogin(value) {
    set((s) => ({
      settings: { ...s.settings, launchAtLogin: value }
    }))
    void get().patchSettings({ launchAtLogin: value })
  }
}) satisfies Partial<AppState>
