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

import { languageFromSystemLocale, resolveUiLanguage } from '../electron/main/language'
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
