import { app } from 'electron'
import { resolveText, type ResolveTextOptions } from '../../shared/platformText'
import { TRANSLATIONS, en } from '../../src/i18n/translations'

const SYSTEM_LANGUAGE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['zh-tw', 'zh-TW'],
  ['zh-hk', 'zh-TW'],
  ['zh', 'zh-CN'],
  ['es', 'es'],
  ['fr', 'fr'],
  ['de', 'de'],
  ['hi', 'hi'],
  ['ja', 'ja'],
  ['ru', 'ru'],
  ['it', 'it'],
  ['pt', 'pt'],
  ['ko', 'ko'],
  ['ar', 'ar'],
  ['fa', 'fa'],
  ['bn', 'bn'],
  ['tr', 'tr'],
  ['vi', 'vi'],
  ['pl', 'pl'],
  ['nl', 'nl'],
  ['sv', 'sv'],
  ['id', 'id'],
  ['uk', 'uk'],
  ['el', 'el'],
  ['cs', 'cs'],
  ['ro', 'ro'],
  ['hu', 'hu'],
  ['da', 'da'],
  ['fi', 'fi'],
  ['th', 'th'],
  ['he', 'he'],
  ['no', 'no'],
  ['nb', 'no'],
  ['nn', 'no']
]

export function languageFromSystemLocale(locale: string | undefined): string {
  const first = (locale || '').toLowerCase()
  for (const [prefix, code] of SYSTEM_LANGUAGE_PREFIXES) {
    if (first.startsWith(prefix)) return code
  }
  return 'en'
}

export function resolveUiLanguage(settingsLang: string | undefined): string {
  const langCode = settingsLang || 'system'
  if (langCode !== 'system') return langCode
  let first: string | undefined
  try {
    first = app.getPreferredSystemLanguages()[0]
  } catch (err) {
    console.error('[Main] could not read the system language:', err)
  }
  return languageFromSystemLocale(first)
}

export interface MainTextOptions extends ResolveTextOptions {
  mac?: boolean
}

export function mainText(language: string | undefined, key: string, params?: Record<string, string | number>, options: MainTextOptions = {}): string {
  const lang = resolveUiLanguage(language)
  return resolveText(TRANSLATIONS[lang], en, key, lang, options.mac ?? process.platform === 'darwin', params, options)
}
