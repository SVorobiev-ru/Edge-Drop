import { vi } from 'vitest'

type AnyRecord = Record<string, any>

export interface SettingsState {
  settings: AnyRecord
  saveSettings?: (patch: AnyRecord) => unknown
  saved?: unknown[]
}

export function settingsModuleMock(state: SettingsState): AnyRecord {
  return {
    loadSettings: () => state.settings,
    getSettings: () => state.settings,
    saveSettings: (patch: AnyRecord) => {
      state.saveSettings?.(patch)
      state.saved?.push(patch)
      state.settings = { ...state.settings, ...patch }
      return state.settings
    },
    resetSettingsCache: vi.fn()
  }
}
