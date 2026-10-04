import { app } from 'electron'

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
