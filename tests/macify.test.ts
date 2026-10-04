import { describe, expect, it } from 'vitest'
import { macify } from '../src/i18n'

describe('macify', () => {
  it('rewrites Ctrl+key with and without spaces to the command symbol', () => {
    expect(macify('Ctrl + C')).toBe('⌘C')
    expect(macify('Ctrl+C')).toBe('⌘C')
    expect(macify('Ctrl +C')).toBe('⌘C')
  })

  it('rewrites Alt+key to the option symbol', () => {
    expect(macify('Alt+C')).toBe('⌥C')
    expect(macify('Alt + C')).toBe('⌥C')
  })

  it('rewrites Win+V to command-V', () => {
    expect(macify('Win + V')).toBe('⌘V')
    expect(macify('Win+V')).toBe('⌘V')
  })

  it('rewrites Explorer to Finder', () => {
    expect(macify('Explorer')).toBe('Finder')
    expect(macify('Open in Explorer')).toBe('Open in Finder')
  })

  it('rewrites every occurrence in a longer sentence', () => {
    expect(macify('Press Ctrl+V or Win + V, then Alt+Tab to Explorer and Explorer')).toBe(
      'Press ⌘V or ⌘V, then ⌥Tab to Finder and Finder'
    )
  })

  it('combines several modifiers', () => {
    expect(macify('Ctrl + Alt + X')).toBe('⌘⌥X')
  })

  it('leaves a string without Windows templates unchanged', () => {
    expect(macify('Copy the selected item')).toBe('Copy the selected item')
    expect(macify('')).toBe('')
  })

  it('does not touch bare modifier words without a plus sign', () => {
    expect(macify('Press Ctrl to continue')).toBe('Press Ctrl to continue')
    expect(macify('Hold Alt')).toBe('Hold Alt')
  })
})
