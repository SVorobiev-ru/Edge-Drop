import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  systemLanguages: ['en-US'] as string[],
  throws: false
}))

vi.mock('electron', () => ({
  app: {
    getPreferredSystemLanguages: () => {
      if (mocks.throws) throw new Error('no locale')
      return mocks.systemLanguages
    }
  }
}))

import { getMainLocale, isMainLanguageLoaded, languageFromSystemLocale, loadMainLanguage, mainText, onMainLanguageLoaded, resolveUiLanguage, warmMainLanguage } from '../electron/main/language'
import { getResolvedLanguage } from '../src/i18n'
import { LANGUAGES, TRANSLATIONS } from '../src/i18n/translations'

beforeEach(() => {
  mocks.systemLanguages = ['en-US']
  mocks.throws = false
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('languageFromSystemLocale', () => {
  it.each([
    ['zh-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-Hans-CN', 'zh-CN'],
    ['es-ES', 'es'],
    ['fr-CA', 'fr'],
    ['de-DE', 'de'],
    ['hi-IN', 'hi'],
    ['ja-JP', 'ja'],
    ['ru-RU', 'ru'],
    ['it-IT', 'it'],
    ['pt-BR', 'pt'],
    ['ko-KR', 'ko'],
    ['ar-SA', 'ar'],
    ['fa-IR', 'fa'],
    ['bn-BD', 'bn'],
    ['tr-TR', 'tr'],
    ['vi-VN', 'vi'],
    ['pl-PL', 'pl'],
    ['nl-NL', 'nl'],
    ['sv-SE', 'sv'],
    ['id-ID', 'id'],
    ['uk-UA', 'uk'],
    ['el-GR', 'el'],
    ['cs-CZ', 'cs'],
    ['ro-RO', 'ro'],
    ['hu-HU', 'hu'],
    ['da-DK', 'da'],
    ['fi-FI', 'fi'],
    ['th-TH', 'th'],
    ['he-IL', 'he'],
    ['no-NO', 'no'],
    ['nb-NO', 'no'],
    ['nn-NO', 'no'],
    ['en-GB', 'en'],
    ['xx-YY', 'en'],
    ['', 'en']
  ])('maps %s to %s', (locale, code) => {
    expect(languageFromSystemLocale(locale)).toBe(code)
    expect(TRANSLATIONS[code]).toBeDefined()
  })

  it('falls back to English without a locale', () => {
    expect(languageFromSystemLocale(undefined)).toBe('en')
  })

  it('agrees with the renderer for every language the app ships', () => {
    const g = globalThis as any
    const previous = g.window
    try {
      for (const { code } of LANGUAGES as ReadonlyArray<{ code: string }>) {
        if (code === 'system') continue
        g.window = { navigator: { language: code } }
        expect(languageFromSystemLocale(code)).toBe(getResolvedLanguage('system'))
      }
    } finally {
      g.window = previous
    }
  })
})

describe('resolveUiLanguage', () => {
  it('returns an explicit setting untouched', () => {
    mocks.systemLanguages = ['ru-RU']
    expect(resolveUiLanguage('de')).toBe('de')
    expect(resolveUiLanguage('zh-TW')).toBe('zh-TW')
  })

  it('follows the first preferred system language for "system" and for a missing setting', () => {
    mocks.systemLanguages = ['it-IT', 'ru-RU']
    expect(resolveUiLanguage('system')).toBe('it')
    expect(resolveUiLanguage(undefined)).toBe('it')
  })

  it('falls back to English when the system has no preferred language or cannot report it', () => {
    mocks.systemLanguages = []
    expect(resolveUiLanguage('system')).toBe('en')
    mocks.throws = true
    expect(resolveUiLanguage('system')).toBe('en')
    expect(console.error).toHaveBeenCalled()
  })
})

describe('lazy main locales', () => {
  it('serves English until the locale chunk arrives, then the localized text', async () => {
    const loaded = vi.fn()
    const off = onMainLanguageLoaded(loaded)
    expect(isMainLanguageLoaded('de')).toBe(false)
    expect(getMainLocale('de')).toBeUndefined()
    expect(mainText('de', 'tray.settings', undefined, { mac: false })).toBe(TRANSLATIONS.en.tray.settings)
    await warmMainLanguage('de')
    off()
    expect(loaded).toHaveBeenCalledTimes(1)
    expect(isMainLanguageLoaded('de')).toBe(true)
    expect(getMainLocale('de')).toEqual(TRANSLATIONS.de)
    expect(mainText('de', 'tray.settings', undefined, { mac: false })).toBe(TRANSLATIONS.de.tray.settings)
  })

  it('warms the locale the system setting resolves to', async () => {
    mocks.systemLanguages = ['it-IT']
    expect(isMainLanguageLoaded('system')).toBe(false)
    await warmMainLanguage('system')
    expect(getMainLocale('it')).toEqual(TRANSLATIONS.it)
  })

  it.each(Object.keys(TRANSLATIONS))('loads %s with the same strings as the static table', async (code) => {
    await loadMainLanguage(code)
    expect(getMainLocale(code)).toEqual(TRANSLATIONS[code])
  })

  it('treats English and unknown codes as ready', async () => {
    expect(isMainLanguageLoaded('en')).toBe(true)
    expect(isMainLanguageLoaded('xx')).toBe(true)
    await loadMainLanguage('xx')
    expect(mainText('xx', 'tray.settings', undefined, { mac: false })).toBe(TRANSLATIONS.en.tray.settings)
  })
})
