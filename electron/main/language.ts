import { app } from 'electron'
import { resolveText, type ResolveTextOptions } from '../../shared/platformText'
import type { TranslationKeys } from '../../src/i18n/types'
import enJson from '../../edge-drop-translations/en.json'

export const en: TranslationKeys = enJson

const localeLoaders = import.meta.glob<TranslationKeys>(['../../edge-drop-translations/*.json', '!../../edge-drop-translations/en.json'], { import: 'default' })
const loadedLocales: Record<string, TranslationKeys> = { en }
const pendingLocales = new Map<string, Promise<void>>()
const localeListeners = new Set<() => void>()

export function onMainLanguageLoaded(listener: () => void): () => void {
  localeListeners.add(listener)
  return () => {
    localeListeners.delete(listener)
  }
}

export function getMainLocale(code: string): TranslationKeys | undefined {
  const dict = loadedLocales[code]
  if (!dict) void loadMainLanguage(code)
  return dict
}

export function loadMainLanguage(code: string): Promise<void> {
  if (loadedLocales[code]) return Promise.resolve()
  const pending = pendingLocales.get(code)
  if (pending) return pending
  const loader = localeLoaders[`../../edge-drop-translations/${code}.json`]
  if (!loader) return Promise.resolve()
  const loading = loader()
    .then((dict) => {
      loadedLocales[code] = dict
      localeListeners.forEach((listener) => {
        try {
          listener()
        } catch (err) {
          console.error('[Main] locale listener failed:', err)
        }
      })
    })
    .catch((err) => {
      console.error(`[Main] could not load the ${code} locale:`, err)
    })
    .finally(() => {
      pendingLocales.delete(code)
    })
  pendingLocales.set(code, loading)
  return loading
}

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

export function isMainLanguageLoaded(settingsLang: string | undefined): boolean {
  const code = resolveUiLanguage(settingsLang)
  return !!loadedLocales[code] || !localeLoaders[`../../edge-drop-translations/${code}.json`]
}

export function warmMainLanguage(settingsLang: string | undefined): Promise<void> {
  return loadMainLanguage(resolveUiLanguage(settingsLang))
}

export interface MainTextOptions extends ResolveTextOptions {
  mac?: boolean
}

export function mainText(language: string | undefined, key: string, params?: Record<string, string | number>, options: MainTextOptions = {}): string {
  const lang = resolveUiLanguage(language)
  return resolveText(getMainLocale(lang), en, key, lang, options.mac ?? process.platform === 'darwin', params, options)
}
