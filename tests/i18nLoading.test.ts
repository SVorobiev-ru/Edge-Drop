import { describe, expect, it } from 'vitest'
import { isLanguageLoaded, loadLanguage, t } from '../src/i18n'
import { useStore } from '../src/store/appStore'

describe('lazy locale loading', () => {
  it('falls back to English until the active language is loaded, then switches without restart', async () => {
    useStore.setState((s) => ({ settings: { ...s.settings, language: 'de' } }))
    if (!isLanguageLoaded('de')) expect(t('header.settings')).toBe('Settings')
    await loadLanguage('de')
    expect(isLanguageLoaded('de')).toBe(true)
    expect(t('header.settings')).toBe('Einstellungen')

    useStore.setState((s) => ({ settings: { ...s.settings, language: 'ru' } }))
    await loadLanguage('ru')
    expect(t('header.settings')).toBe('Настройки')
  })

  it('keeps English loaded and ignores unknown codes', async () => {
    expect(isLanguageLoaded('en')).toBe(true)
    await loadLanguage('xx')
    expect(isLanguageLoaded('xx')).toBe(false)
  })
})
