import { DEFAULT_PASTE_QUEUE_HOTKEY, defaultToggleHotkey, type HotkeyResult } from '../../shared/types'
import { loadSettings, saveSettings, pushState } from './state'
import { registerGlobalHotkey, onToggleHotkey } from './index'
import { rebuildTrayMenu } from './tray'
import { validateAccelerator, sameAccelerator, trySwapGlobalShortcut } from './hotkeys'
import { handle } from './ipcHandle'
import { pasteQueue } from './pastePipeline'

export function reregisterGlobalShortcuts(hotkey?: string): boolean {
  const registered = registerGlobalHotkey(hotkey)
  pasteQueue.syncShortcut()
  return registered
}

export function pasteQueueHotkeyRejection(accelerator: unknown, toggleHotkey: string): string | null {
  if (typeof accelerator !== 'string') return 'toast.shortcutReserved'
  const check = validateAccelerator(accelerator, process.platform)
  if (!check.ok) return 'toast.shortcutReserved'
  if (sameAccelerator(accelerator, toggleHotkey)) return 'toast.shortcutTaken'
  return null
}

function setToggleHotkey(accelerator: string): HotkeyResult {
  if (process.platform !== 'darwin') {
    const saved = saveSettings({ toggleHotkey: accelerator })
    const registered = reregisterGlobalShortcuts(accelerator)
    pushState.settings(saved)
    rebuildTrayMenu()
    return registered ? { ok: true, settings: saved } : { ok: false, reason: 'taken', settings: saved }
  }
  const settings = loadSettings()
  const check = validateAccelerator(accelerator, process.platform)
  if (!check.ok) return { ok: false, reason: check.reason, settings }
  if (sameAccelerator(accelerator, settings.pasteQueueHotkey || DEFAULT_PASTE_QUEUE_HOTKEY)) {
    return { ok: false, reason: 'taken', settings }
  }
  const prev = settings.toggleHotkey || defaultToggleHotkey(process.platform === 'darwin')
  if (!trySwapGlobalShortcut(prev, accelerator, onToggleHotkey)) {
    reregisterGlobalShortcuts(prev)
    return { ok: false, reason: 'taken', settings }
  }
  const next = saveSettings({ toggleHotkey: accelerator })
  reregisterGlobalShortcuts(accelerator)
  pushState.settings(next)
  rebuildTrayMenu()
  return { ok: true, settings: next }
}

export function registerSettingsIpc(): void {
  handle('hotkey:set', (accelerator) => setToggleHotkey(accelerator))
}
