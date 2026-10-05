import { nativeTheme, type BrowserWindow } from 'electron'
import type { Settings } from '../../shared/types'

function macThemeSource(theme: unknown): 'system' | 'dark' | 'light' {
  return theme === 'dark' || theme === 'light' ? theme : 'system'
}

export function applyMacWindowOptionsTo(win: BrowserWindow | null, settings: Pick<Settings, 'theme' | 'hideFromScreenCapture'>): void {
  if (process.platform !== 'darwin') return
  try {
    nativeTheme.themeSource = macThemeSource(settings.theme)
  } catch (err) {
    console.error('[Window] Failed to apply the theme:', err)
  }
  if (!win || win.isDestroyed()) return
  try {
    win.setContentProtection(settings.hideFromScreenCapture === true)
  } catch (err) {
    console.error('[Window] Failed to apply screen capture protection:', err)
  }
}
