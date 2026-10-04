import { useStore } from '../store/appStore'
import { LANGUAGES, TRANSLATIONS, en } from './translations'
import { RTL_LANGUAGES, macify, resolveText } from '../../shared/platformText'

/**
 * Resolves the active language code.
 * If 'system', automatically matches navigator.language (e.g. 'es-ES' -> 'es').
 */
export function getResolvedLanguage(settingLang?: string): string {
  const code = settingLang || useStore.getState().settings.language || 'system'
  if (code !== 'system') return code

  const g = globalThis as any
  if (!g.window || !g.window.navigator) return 'en'
  const navLang = ((g.window.navigator.language as string) || '').toLowerCase()

  if (navLang.startsWith('zh-tw') || navLang.startsWith('zh-hk')) return 'zh-TW'
  if (navLang.startsWith('zh')) return 'zh-CN'
  if (navLang.startsWith('es')) return 'es'
  if (navLang.startsWith('fr')) return 'fr'
  if (navLang.startsWith('de')) return 'de'
  if (navLang.startsWith('hi')) return 'hi'
  if (navLang.startsWith('ja')) return 'ja'
  if (navLang.startsWith('ru')) return 'ru'
  if (navLang.startsWith('it')) return 'it'
  if (navLang.startsWith('pt')) return 'pt'
  if (navLang.startsWith('ko')) return 'ko'
  if (navLang.startsWith('ar')) return 'ar'
  if (navLang.startsWith('fa')) return 'fa'
  if (navLang.startsWith('bn')) return 'bn'
  if (navLang.startsWith('tr')) return 'tr'
  if (navLang.startsWith('vi')) return 'vi'
  if (navLang.startsWith('pl')) return 'pl'
  if (navLang.startsWith('nl')) return 'nl'
  if (navLang.startsWith('sv')) return 'sv'
  if (navLang.startsWith('id')) return 'id'
  if (navLang.startsWith('uk')) return 'uk'
  if (navLang.startsWith('el')) return 'el'
  if (navLang.startsWith('cs')) return 'cs'
  if (navLang.startsWith('ro')) return 'ro'
  if (navLang.startsWith('hu')) return 'hu'
  if (navLang.startsWith('da')) return 'da'
  if (navLang.startsWith('fi')) return 'fi'
  if (navLang.startsWith('th')) return 'th'
  if (navLang.startsWith('he')) return 'he'
  if (navLang.startsWith('no') || navLang.startsWith('nb') || navLang.startsWith('nn')) return 'no'

  return 'en'
}

/**
 * Main translation function.
 * E.g., t('header.searchPlaceholder')
 * E.g., t('behaviour.updateAvailableTitle', { version: '0.3.1' })
 */
export function t(path: string, params?: Record<string, string | number>): string {
  const settingsLang = useStore.getState().settings.language
  const langCode = getResolvedLanguage(settingsLang)
  return resolveText(TRANSLATIONS[langCode], en, path, langCode, IS_MAC, params)
}

const IS_MAC = (() => {
  const g = globalThis as any
  if (g.process && g.process.platform) return g.process.platform === 'darwin'
  const nav = g.navigator
  return !!nav && /Mac/i.test(nav.platform || nav.userAgent || '')
})()

export { macify, RTL_LANGUAGES }

/**
 * Hook that subscribes to settings.language changes and returns the translation function t.
 */
export function useTranslation() {
  const language = useStore((s) => s.settings.language)
  const resolvedLang = getResolvedLanguage(language)

  // Update text direction for RTL languages like Arabic, Persian & Hebrew
  const g = globalThis as any
  if (g.document && g.document.documentElement) {
    const isRtl = RTL_LANGUAGES.includes(resolvedLang)
    g.document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
  }

  return {
    t,
    language,
    resolvedLang,
    languages: LANGUAGES
  }
}
