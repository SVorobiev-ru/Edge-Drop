import { describe, expect, it } from 'vitest'
import { resolveTheme } from '../src/lib/theme'

describe('theme resolution', () => {
  it('keeps Windows dark whatever the setting says', () => {
    expect(resolveTheme('light', false, 'win32')).toBe('dark')
    expect(resolveTheme('system', false, 'win32')).toBe('dark')
  })

  it('follows the system appearance on macOS', () => {
    expect(resolveTheme('system', true, 'darwin')).toBe('dark')
    expect(resolveTheme('system', false, 'darwin')).toBe('light')
  })

  it('honours an explicit choice on macOS', () => {
    expect(resolveTheme('light', true, 'darwin')).toBe('light')
    expect(resolveTheme('dark', false, 'darwin')).toBe('dark')
  })

  it('falls back to dark when the setting is missing', () => {
    expect(resolveTheme(undefined, false, 'darwin')).toBe('dark')
  })
})
