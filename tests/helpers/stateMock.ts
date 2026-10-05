import { vi } from 'vitest'

type AnyRecord = Record<string, any>

export function pushStateMock(overrides: AnyRecord = {}): AnyRecord {
  return {
    items: vi.fn(),
    settings: vi.fn(),
    togglePanel: vi.fn(),
    search: vi.fn(),
    openSettings: vi.fn(),
    updateAvailable: vi.fn(),
    updateProgress: vi.fn(),
    updateDownloaded: vi.fn(),
    toast: vi.fn(),
    ...overrides
  }
}

export function fakeWatcher(): AnyRecord {
  return { setPaused: vi.fn(), resyncSignature: vi.fn(), invalidateSignature: vi.fn(), noteSelfWrite: vi.fn() }
}

export interface StateMockOptions {
  store?: AnyRecord
  settings?: () => AnyRecord
  saveSettings?: (patch: AnyRecord) => unknown
  pushState?: AnyRecord
  watcher?: AnyRecord
  [extra: string]: unknown
}

export function stateModuleMock(o: StateMockOptions = {}): AnyRecord {
  const { store, settings, saveSettings, pushState, watcher, ...extra } = o
  const fallbackWatcher = fakeWatcher()
  return {
    getStore: () => store ?? {},
    loadSettings: () => settings?.() ?? {},
    saveSettings: saveSettings ?? vi.fn(),
    pushState: pushStateMock(pushState),
    addFiles: vi.fn(),
    getWatcher: () => watcher ?? fallbackWatcher,
    writeStoredImageToPasteboard: () => false,
    ...extra
  }
}
