import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/soundEffects', () => ({
  playToggleSound: vi.fn(),
  playButtonClickSound: vi.fn()
}))

vi.mock('../src/components/icons', () => ({
  RotateCcwIcon: () => null,
  CloseIcon: () => null
}))

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

type Badges = typeof import('../src/components/HotkeyRecorder').parseKeyBadges

async function loadParseKeyBadges(platform: string): Promise<Badges> {
  vi.resetModules()
  vi.stubGlobal('window', { edge: { platform } })
  const mod = await import('../src/components/HotkeyRecorder')
  return mod.parseKeyBadges
}

describe('parseKeyBadges on macOS', () => {
  let parseKeyBadges: Badges

  beforeEach(async () => {
    parseKeyBadges = await loadParseKeyBadges('darwin')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps Alt to the option symbol', () => {
    expect(parseKeyBadges('Alt+C')).toEqual(['⌥', 'C'])
  })

  it('maps CommandOrControl and Shift to command and shift symbols', () => {
    expect(parseKeyBadges('CommandOrControl+Shift+V')).toEqual(['⌘', '⇧', 'V'])
  })

  it('maps Control and Alt to control and option symbols', () => {
    expect(parseKeyBadges('Control+Alt+X')).toEqual(['⌃', '⌥', 'X'])
  })

  it('maps the short aliases Ctrl and Option', () => {
    expect(parseKeyBadges('Ctrl+Option+X')).toEqual(['⌃', '⌥', 'X'])
  })

  it('maps Command, Meta and Super to the command symbol', () => {
    expect(parseKeyBadges('Command+K')).toEqual(['⌘', 'K'])
    expect(parseKeyBadges('Meta+K')).toEqual(['⌘', 'K'])
    expect(parseKeyBadges('Super+K')).toEqual(['⌘', 'K'])
  })

  it('uppercases single-letter keys, trims whitespace and keeps named keys as is', () => {
    expect(parseKeyBadges(' Alt + c ')).toEqual(['⌥', 'C'])
    expect(parseKeyBadges('Alt+F5')).toEqual(['⌥', 'F5'])
    expect(parseKeyBadges('CommandOrControl+Space')).toEqual(['⌘', 'Space'])
  })

  it('shows the default Alt+C fallback with the option symbol for an empty accelerator', () => {
    expect(parseKeyBadges('')).toEqual(['⌥', 'C'])
  })
})

describe('parseKeyBadges on other platforms', () => {
  let parseKeyBadges: Badges

  beforeEach(async () => {
    parseKeyBadges = await loadParseKeyBadges('win32')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps Alt as text', () => {
    expect(parseKeyBadges('Alt+C')).toEqual(['Alt', 'C'])
  })

  it('maps CommandOrControl to Ctrl', () => {
    expect(parseKeyBadges('CommandOrControl+V')).toEqual(['Ctrl', 'V'])
  })

  it('keeps Shift as text', () => {
    expect(parseKeyBadges('Ctrl+Shift+X')).toEqual(['Ctrl', 'Shift', 'X'])
  })

  it('maps Command, Meta and Super to Win', () => {
    expect(parseKeyBadges('Command+K')).toEqual(['Win', 'K'])
    expect(parseKeyBadges('Meta+K')).toEqual(['Win', 'K'])
    expect(parseKeyBadges('Super+K')).toEqual(['Win', 'K'])
  })

  it('falls back to Alt+C for an empty accelerator', () => {
    expect(parseKeyBadges('')).toEqual(['Alt', 'C'])
  })
})

describe('parseKeyBadges platform detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('detects macOS from the bridge platform', async () => {
    vi.resetModules()
    vi.stubGlobal('window', { edge: { platform: 'darwin' } })
    const { parseKeyBadges } = await import('../src/components/HotkeyRecorder')
    expect(parseKeyBadges('Alt+C')).toEqual(['⌥', 'C'])
  })

  it('treats a missing bridge as not macOS', async () => {
    vi.resetModules()
    vi.stubGlobal('window', undefined)
    const { parseKeyBadges } = await import('../src/components/HotkeyRecorder')
    expect(parseKeyBadges('Alt+C')).toEqual(['Alt', 'C'])
  })
})
