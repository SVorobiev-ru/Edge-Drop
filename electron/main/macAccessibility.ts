import { Notification, shell, systemPreferences } from 'electron'
import { execFile } from 'node:child_process'
import { loadSettings } from './state'
import { PATHS } from '../store/paths'
import { canPostEvents, postCommandV, requestPostEvents } from './macNative'
import { mainText } from './language'
import { handle } from './ipcHandle'
import { toast } from './toast'

const ACCESSIBILITY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
let accessibilityNoticeShown = false
const accessibilityNotifications = new Set<Notification>()
let accessibilityPrompted = false

function openAccessibilitySettings(): void {
  shell.openExternal(ACCESSIBILITY_SETTINGS_URL).catch((err) => {
    console.error('[Main] could not open Accessibility settings:', err)
  })
}

function pasteAccessGranted(): boolean {
  return systemPreferences.isTrustedAccessibilityClient(false) && canPostEvents()
}

function promptAccessibility(): boolean {
  accessibilityPrompted = true
  const trusted = systemPreferences.isTrustedAccessibilityClient(true)
  const canPost = requestPostEvents()
  return trusted && canPost
}

function accessibilityDialogText(key: 'title' | 'body'): string {
  return mainText(loadSettings().language, `accessibilityDialog.${key}`, undefined, { mac: false, missing: key })
}

function showAccessibilityNotification(): boolean {
  try {
    if (!Notification.isSupported()) return false
    const notification = new Notification({
      title: accessibilityDialogText('title'),
      body: accessibilityDialogText('body'),
      icon: PATHS.icon()
    })
    notification.on('click', () => {
      openAccessibilitySettings()
    })
    notification.on('close', () => {
      accessibilityNotifications.delete(notification)
    })
    accessibilityNotifications.add(notification)
    notification.show()
    return true
  } catch (err) {
    console.error('[Main] accessibility notification failed:', err)
    return false
  }
}

export function simulateMacPaste(): void {
  if (!pasteAccessGranted()) {
    toast('toast.pasteNeedsAccessibility', 'info')
    if (accessibilityNoticeShown) return
    accessibilityNoticeShown = true
    promptAccessibility()
    showAccessibilityNotification()
    return
  }
  if (postCommandV()) return
  execFile('osascript', ['-e', 'tell application "System Events" to key code 9 using command down'], (err) => {
    if (err) {
      console.error('[Main] simulatePaste (macOS) failed — grant Accessibility permission:', err)
      toast('toast.pasteNeedsAccessibility', 'info')
    }
  })
}

export function registerAccessibilityIpc(): void {
  handle('accessibility:status', () => {
    if (process.platform !== 'darwin') return null
    return pasteAccessGranted()
  })

  handle('accessibility:request', () => {
    if (process.platform !== 'darwin') return null
    if (!accessibilityPrompted) {
      const granted = promptAccessibility()
      if (!granted) openAccessibilitySettings()
      return granted
    }
    const granted = pasteAccessGranted()
    if (!granted) {
      requestPostEvents()
      openAccessibilitySettings()
    }
    return granted
  })

  handle('accessibility:open-settings', () => {
    if (process.platform !== 'darwin') return
    openAccessibilitySettings()
  })
}
