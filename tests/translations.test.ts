import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { LANGUAGES, TRANSLATIONS, en } from '../src/i18n/translations'
import { MAC_KEY_ALIASES, resolveText } from '../shared/platformText'

const root = join(__dirname, '..')
const LANGS = Object.keys(TRANSLATIONS)

function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value && typeof value === 'object') flatten(value, `${prefix}${key}.`, out)
    else out[prefix + key] = value as string
  }
  return out
}

const EN = flatten(en)
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

const CONTRACT_KEYS = [
  'behaviour.accessibilityTitle', 'behaviour.accessibilityGranted', 'behaviour.accessibilityMissing',
  'behaviour.accessibilityOpenSettings', 'behaviour.accessibilityRepairHint', 'behaviour.themeTitle', 'behaviour.themeDesc',
  'behaviour.themeSystem', 'behaviour.themeDark', 'behaviour.themeLight', 'behaviour.vibrancyTitle', 'behaviour.vibrancyDesc',
  'behaviour.hideFromCaptureTitle', 'behaviour.hideFromCaptureDesc', 'behaviour.pastePlainTitle', 'behaviour.pastePlainDesc',
  'behaviour.ignoredAppsTitle', 'behaviour.ignoredAppsDesc', 'behaviour.ignoredAppsAdd', 'behaviour.ignoredAppsEmpty',
  'behaviour.ignoredAppsRemove', 'behaviour.ignoreRemoteTitle', 'behaviour.ignoreRemoteDesc', 'behaviour.recognizeTextTitle',
  'behaviour.recognizeTextDesc', 'behaviour.pasteQueueTitle', 'behaviour.pasteQueueDesc', 'behaviour.backupTitle',
  'behaviour.backupDesc', 'behaviour.exportPinned', 'behaviour.importPinned', 'behaviour.updateCheckTitle',
  'behaviour.installUpdate', 'toast.shortcutReserved', 'toast.shortcutTaken', 'toast.exported', 'toast.imported',
  'toast.importFailed', 'toast.queueAdded', 'toast.queueEmpty', 'menu.paste', 'menu.pastePlain',
  'menu.copy', 'menu.pin', 'menu.unpin', 'menu.rename', 'menu.preview', 'menu.revealInFinder', 'menu.addToQueue',
  'menu.ignoreApp', 'menu.delete', 'appMenu.settings', 'appMenu.quit', 'onboarding.permissionsTitle',
  'onboarding.permissionsDesc', 'onboarding.launchAtLogin', 'onboarding.menuBarTip', 'emoji.searchPlaceholder',
  'item.sourceApp', 'item.untitled', 'queue.title', 'queue.clear', 'item.colorItem', 'item.renderFailed',
  'behaviour.hotkeyConflictHint', 'appMenu.edit', 'appMenu.window', 'appMenu.undo', 'appMenu.redo', 'appMenu.cut',
  'appMenu.paste', 'appMenu.selectAll', 'appMenu.close', 'emptyState.noTextFound',
  'emptyState.noLinksFound', 'emptyState.noImagesFound', 'emptyState.noFilesFound', 'emptyState.noColorsFound',
  'emptyState.copyTextHint', 'emptyState.copyLinksHint', 'emptyState.copyImagesHint', 'emptyState.copyFilesHint',
  'emptyState.copyColorsHint'
]

describe('translation completeness', () => {
  it('has a dictionary for every offered language', () => {
    const offered = LANGUAGES.map((l) => l.code).filter((code) => code !== 'system')
    expect([...LANGS].sort()).toEqual([...offered].sort())
  })

  it('English contains every key of the macOS contract', () => {
    for (const key of CONTRACT_KEYS) expect(EN[key], key).toBeTruthy()
  })

  it.each(LANGS)('%s has every English key, non-empty, with the same placeholders', (lang) => {
    const dict = flatten(TRANSLATIONS[lang])
    const missing = Object.keys(EN).filter((key) => typeof dict[key] !== 'string' || dict[key].trim() === '')
    expect(missing).toEqual([])
    const extra = Object.keys(dict).filter((key) => !(key in EN))
    expect(extra).toEqual([])
    const wrongParams = Object.keys(EN).filter((key) => placeholders(dict[key]).join() !== placeholders(EN[key]).join())
    expect(wrongParams).toEqual([])
  })

  it('fixes the Russian recent header', () => {
    expect(TRANSLATIONS.ru.item.recent).toBe('НЕДАВНИЕ')
  })
})

describe('translation pipeline', () => {
  it.each(LANGS)('%s locale module matches its JSON source', (lang) => {
    const json = JSON.parse(readFileSync(join(root, 'edge-drop-translations', `${lang}.json`), 'utf8'))
    expect(json).toEqual(TRANSLATIONS[lang])
  })

  it('has one locale module per language', () => {
    const files = readdirSync(join(root, 'src/i18n/locales')).map((f) => f.replace(/\.ts$/, '')).sort()
    expect(files).toEqual([...LANGS].sort())
  })

  it('renderer loads only English statically', () => {
    const index = readFileSync(join(root, 'src/i18n/index.ts'), 'utf8')
    expect(index).not.toMatch(/from '\.\/translations'/)
    expect(index).toContain("import en from './locales/en'")
    expect(index).toContain("import.meta.glob<TranslationKeys>(['./locales/*.ts', '!./locales/en.ts']")
  })
})

describe('{shortcut} parameter', () => {
  it.each(LANGS)('%s takes the configured hotkey in the hover and pro tip texts', (lang) => {
    for (const key of ['behaviour.hoverActivationDescOff', 'onboarding.proTip1']) {
      const raw = flatten(TRANSLATIONS[lang])[key]
      expect(raw).toContain('{shortcut}')
      expect(raw).not.toMatch(/Alt\s*\+\s*C/)
      expect(resolveText(TRANSLATIONS[lang], en, key, lang, false, { shortcut: 'Ctrl+Shift+X' })).toContain('Ctrl+Shift+X')
      expect(resolveText(TRANSLATIONS[lang], en, key, lang, true, { shortcut: 'Command+Shift+V' })).toContain('⌘⇧V')
    }
  })
})

describe('mac wording aliases', () => {
  const REWORDED = [
    'onboarding.welcomeDesc',
    'onboarding.ungroupDesc',
    'onboarding.proTip3',
    'tray.welcomeBody',
    'behaviour.launchAtLoginDesc',
    'behaviour.fullscreenProtectionDesc',
    'flyout.openInExplorer',
    'footer.supportOnKofi'
  ]
  const LEFT_WORDS: Record<string, RegExp> = {
    en: /left/i,
    ru: /лев/i,
    de: /link/i,
    ja: /左/
  }

  it('alias every reworded key', () => {
    for (const key of REWORDED) expect(MAC_KEY_ALIASES[key]).toBeTruthy()
  })

  it.each(LANGS)('%s keeps Windows text and has a different mac text for each reworded key', (lang) => {
    const dict = flatten(TRANSLATIONS[lang])
    for (const key of REWORDED) {
      expect(resolveText(TRANSLATIONS[lang], en, key, lang, false)).toBe(dict[key])
      expect(dict[MAC_KEY_ALIASES[key]]).toBeTruthy()
    }
  })

  it.each(['en', 'ru', 'de', 'ja'])('%s names no screen side on mac', (lang) => {
    for (const key of ['onboarding.welcomeDesc', 'onboarding.ungroupDesc', 'onboarding.proTip3', 'tray.welcomeBody']) {
      const raw = flatten(TRANSLATIONS[lang])[key]
      const mac = resolveText(TRANSLATIONS[lang], en, key, lang, true)
      expect(raw).toMatch(LEFT_WORDS[lang])
      expect(mac).not.toMatch(LEFT_WORDS[lang])
    }
  })

  it('uses mac wording in en/ru/de/ja', () => {
    const mac = (lang: string, key: string) => resolveText(TRANSLATIONS[lang], en, key, lang, true)
    expect(mac('en', 'flyout.openInExplorer')).toBe('Show in Finder')
    expect(mac('ru', 'flyout.openInExplorer')).toBe('Показать в Finder')
    expect(mac('de', 'flyout.openInExplorer')).toBe('Im Finder zeigen')
    expect(mac('ja', 'flyout.openInExplorer')).toBe('Finder に表示')
    expect(mac('en', 'behaviour.launchAtLoginDesc')).toBe('Start silently in background at login')
    expect(mac('ru', 'behaviour.launchAtLoginDesc')).toContain('при входе в систему')
    expect(mac('de', 'behaviour.launchAtLoginDesc')).toContain('Anmeldung')
    expect(mac('ja', 'behaviour.launchAtLoginDesc')).not.toContain('PC')
    expect(mac('en', 'behaviour.fullscreenProtectionDesc')).toContain('in full-screen apps')
    expect(mac('ru', 'behaviour.fullscreenProtectionDesc')).toContain('полноэкранных приложениях')
    expect(mac('en', 'footer.supportOnKofi')).toBe('Project on GitHub')
    expect(mac('ru', 'footer.supportOnKofi')).toBe('Проект на GitHub')
    expect(mac('en', 'tray.welcomeBody')).toContain('⌥C')
  })
})
