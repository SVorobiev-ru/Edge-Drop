import { vi } from 'vitest'

type AnyRecord = Record<string, any>

export function windowMock(overrides: AnyRecord = {}): AnyRecord {
  return {
    applyMacWindowOptions: vi.fn(),
    sendToMainWindow: vi.fn(),
    setInteractive: vi.fn(),
    setHeartbeatPaused: vi.fn(),
    setHotZoneWidth: vi.fn(),
    repositionWindow: vi.fn(),
    getDisplayListOptions: vi.fn(() => []),
    popUpAndRetract: vi.fn(),
    setWindowFocusable: vi.fn(),
    captureExternalForeground: vi.fn(),
    traceFg: vi.fn(),
    resolvePasteTarget: vi.fn(async () => 50),
    isInteractive: vi.fn(() => false),
    getMainWindow: () => null,
    ...overrides
  }
}

export function powershellMock(overrides: AnyRecord = {}): AnyRecord {
  return {
    psHost: { run: vi.fn(() => Promise.resolve()) },
    getSystemPowerShellPath: () => 'powershell.exe',
    getWritableCwd: () => '/tmp',
    ...overrides
  }
}

export function pathValidationMock(): AnyRecord {
  return { filterValidPaths: (paths: string[]) => paths, isExistingFilePath: () => true }
}

export function indexMock(overrides: AnyRecord = {}): AnyRecord {
  return { registerGlobalHotkey: vi.fn(), onToggleHotkey: vi.fn(), ...overrides }
}

export function onboardingWindowMock(): AnyRecord {
  return { getOnboardingWindow: () => null }
}

export function trayMock(): AnyRecord {
  return { rebuildTrayMenu: vi.fn() }
}

export function dragMock(overrides: AnyRecord = {}): AnyRecord {
  return { startDragOut: vi.fn(), resolveDragData: vi.fn(), prestageDrag: vi.fn(), stageDragFile: vi.fn(), ...overrides }
}

export function formatsMock(overrides: AnyRecord = {}): AnyRecord {
  return {
    clipboardSignature: vi.fn(() => ''),
    formatTabularDataForClipboard: (text: string, html?: string) => ({ text, html }),
    signatureMatchesItem: vi.fn(() => false),
    localPathFromFileUrl: vi.fn(),
    writeRichTextToClipboard: vi.fn(),
    ...overrides
  }
}

export function updaterMock(): AnyRecord {
  return {
    quitAndInstallUpdate: vi.fn(),
    checkForUpdatesManual: vi.fn(),
    startUpdateDownload: vi.fn(),
    syncAutoUpdaterState: vi.fn(),
    getCachedUpdateState: vi.fn(),
    triggerBackgroundCheck: vi.fn()
  }
}

export function configMock(): AnyRecord {
  return { isStoreBuild: () => false }
}

export function loginItemsMock(): AnyRecord {
  return { applyLaunchAtLogin: vi.fn(), refreshLaunchAtLoginFromOs: vi.fn() }
}

export function macNativeMock(overrides: AnyRecord = {}): AnyRecord {
  return {
    pressedMouseButtons: () => 0,
    postCommandV: () => true,
    mouseButtonsAvailable: () => true,
    canPostEvents: () => true,
    requestPostEvents: () => true,
    ...overrides
  }
}

export function macPasteboardMock(overrides: AnyRecord = {}): AnyRecord {
  return {
    writeFileUrls: () => true,
    addFileUrlToCurrentItem: vi.fn(),
    addImageDataToFirstItem: vi.fn(),
    pasteboardChangeCount: () => 1,
    ...overrides
  }
}

export function macScreenshotsMock(overrides: AnyRecord = {}): AnyRecord {
  return { refreshScreenshotWatcher: vi.fn(), ...overrides }
}

export function macSourceAppMock(): AnyRecord {
  return { listRunningApps: () => [], appPathForBundleId: () => null, appInfoForPath: () => null, ownBundleId: () => null }
}

export function ocrMock(): AnyRecord {
  return { startImageTextRecognition: vi.fn(), refreshImageTextRecognition: vi.fn(), wakeImageTextRecognition: vi.fn() }
}
