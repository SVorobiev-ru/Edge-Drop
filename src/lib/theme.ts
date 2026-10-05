/**
 * Theme: writes dynamic CSS properties to :root.
 */
import type { ThemeMode } from '../../shared/types'

type ResolvedTheme = 'dark' | 'light'

/** Apply reduce-motion preference as a data attribute the CSS can key off. */
export function applyReduceMotion(reduce: boolean): void {
  document.documentElement.dataset.motion = reduce ? 'reduce' : 'full'
}

export function resolveTheme(mode: ThemeMode | undefined, systemDark: boolean, platform: string): ResolvedTheme {
  if (platform !== 'darwin') return 'dark'
  if (mode === 'light') return 'light'
  if (mode === 'system') return systemDark ? 'dark' : 'light'
  return 'dark'
}

export function applyTheme(theme: ResolvedTheme, vibrancy: boolean): void {
  const root = document.documentElement
  root.dataset.theme = theme
  if (vibrancy) root.dataset.vibrancy = 'on'
  else delete root.dataset.vibrancy
}
