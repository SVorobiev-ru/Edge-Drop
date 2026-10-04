import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LANGUAGES, TRANSLATIONS, en } from '../src/i18n/translations'
import {
  MAC_KEY_ALIASES,
  RTL_LANGUAGES,
  formatMacAccelerator,
  macify,
  resolveText,
  withMacHotkey
} from '../shared/platformText'

const WINDOWS_TERMS = [
  /Ctrl/i,
  /Strg/i,
  /Alt\s*\+/,
  /Win\s*\+/i,
  /Windows/i,
  /Microsoft/i,
  /Explorer/i,
  /Task Manager/i,
  /taskbar/i,
  /system tray/i,
  /Explorador/i,
  /Explorateur/i,
  /Проводник/i,
  /Провідник/i,
  /Диспетчер задач/i,
  /панел[ьи] задач/i,
  /трей/i,
  /エクスプローラー/,
  /탐색기/,
  /资源管理器/,
  /檔案總管/,
  /एक्सप्लोरर/,
  /المستكشف/,
  /এক্সপ্লোরার/,
  /Gezg[iy]n/i,
  /Eksplorator/i,
  /Verkenner/i,
  /Utforsk(?:aren|er)(?![a-zåäöæø])/i,
  /Εξερεύνηση/,
  /Průzkumník/i,
  /Intéző/i,
  /Stifinder/i,
  /Resurssienhallin/i,
  /סייר/
]

function collectPaths(obj: unknown, prefix: string, out: Set<string>): void {
  if (!obj || typeof obj !== 'object') return
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === 'string') out.add(prefix + key)
    else collectPaths(value, `${prefix}${key}.`, out)
  }
}

function rawValue(obj: unknown, path: string): string | undefined {
  let curr = obj as Record<string, unknown> | undefined
  for (const part of path.split('.')) {
    if (!curr || typeof curr !== 'object') return undefined
    curr = curr[part] as Record<string, unknown> | undefined
  }
  return typeof curr === 'string' ? curr : undefined
}

function pathsFor(lang: string): string[] {
  const paths = new Set<string>()
  collectPaths(en, '', paths)
  collectPaths(TRANSLATIONS[lang], '', paths)
  return [...paths]
}

const LANGS = Object.keys(TRANSLATIONS)

describe('translations in macOS mode', () => {
  it('covers every language offered in the settings', () => {
    const offered = LANGUAGES.map((l) => l.code).filter((code) => code !== 'system')
    expect(offered.length).toBeGreaterThan(1)
    expect([...LANGS].sort()).toEqual([...offered].sort())
  })

  it.each(LANGS)('%s has no Windows-specific wording in any string', (lang) => {
    const offenders: string[] = []
    for (const path of pathsFor(lang)) {
      const text = resolveText(TRANSLATIONS[lang], en, path, lang, true)
      if (WINDOWS_TERMS.some((re) => re.test(text))) offenders.push(`${path} => ${text}`)
    }
    expect(offenders).toEqual([])
  })

  it.each(LANGS)('%s names Finder in the reveal-location label', (lang) => {
    const text = resolveText(TRANSLATIONS[lang], en, 'flyout.openInExplorer', lang, true)
    expect(text).toMatch(/Finder|访达/)
  })

  it.each(LANGS)('%s shows mac key symbols in the shortcut hints', (lang) => {
    expect(resolveText(TRANSLATIONS[lang], en, 'onboarding.collectDesc', lang, true)).toContain('⌘C')
    expect(resolveText(TRANSLATIONS[lang], en, 'toast.pasteFallback', lang, true)).toContain('⌘V')
    expect(resolveText(TRANSLATIONS[lang], en, 'onboarding.proTip1', lang, true)).toContain('⌥C')
  })

  it('replaces the Windows startup toast with the Login Items wording', () => {
    expect(resolveText(TRANSLATIONS.en, en, 'toast.launchBlockedByWindows', 'en', true)).toBe(en.toast.launchBlockedByMac)
    expect(resolveText(TRANSLATIONS.ru, en, 'toast.launchBlockedByWindows', 'ru', true)).toContain('Объекты входа')
    expect(resolveText(TRANSLATIONS.de, en, 'toast.launchBlockedByWindows', 'de', true)).toBe(en.toast.launchBlockedByMac)
  })

  it('never shows the Microsoft Store review label', () => {
    for (const lang of LANGS) {
      expect(resolveText(TRANSLATIONS[lang], en, 'footer.reviewOnStore', lang, true)).toBe(
        rawValue(TRANSLATIONS[lang], 'footer.starOnGithub')
      )
    }
  })

  it('formats the shortcut parameter in mac notation', () => {
    expect(resolveText(TRANSLATIONS.en, en, 'behaviour.hoverActivationDescOff', 'en', true, { shortcut: 'Alt+C' })).toBe(
      'Hover trigger paused. Use ⌥C to open'
    )
    expect(resolveText(TRANSLATIONS.en, en, 'toast.shortcutUpdated', 'en', true, { shortcut: 'Control+Shift+X' })).toBe(
      'Global shortcut set to ⌃⇧X'
    )
  })

  it('keeps non-shortcut parameters untouched', () => {
    expect(resolveText(TRANSLATIONS.en, en, 'behaviour.updateAvailableTitle', 'en', true, { version: '0.4.0' })).toBe(
      'Edge-Drop v0.4.0 is available!'
    )
  })
})

describe('translations outside macOS mode', () => {
  it.each(LANGS)('%s strings are returned exactly as written', (lang) => {
    for (const path of pathsFor(lang)) {
      const expected = rawValue(TRANSLATIONS[lang], path) || rawValue(en, path)
      expect(resolveText(TRANSLATIONS[lang], en, path, lang, false)).toBe(expected)
    }
  })

  it('does not follow mac aliases', () => {
    for (const path of Object.keys(MAC_KEY_ALIASES)) {
      expect(resolveText(TRANSLATIONS.en, en, path, 'en', false)).toBe(rawValue(en, path))
    }
  })

  it('substitutes parameters without mac formatting', () => {
    expect(resolveText(TRANSLATIONS.en, en, 'behaviour.hoverActivationDescOff', 'en', false, { shortcut: 'Alt+C' })).toBe(
      'Hover trigger paused. Use Alt+C to open'
    )
    expect(resolveText(TRANSLATIONS.ru, en, 'onboarding.collectDesc', 'ru', false)).toContain('Ctrl+C')
  })

  it('falls back to English, then to the path itself', () => {
    expect(resolveText(undefined, en, 'header.searchPlaceholder', 'xx', false)).toBe(en.header.searchPlaceholder)
    expect(resolveText(TRANSLATIONS.en, en, 'missing.key', 'en', false)).toBe('missing.key')
  })
})

describe('macify language rules', () => {
  it('rewrites the German Strg key', () => {
    expect(macify('Strg+C drücken', 'de')).toBe('⌘C drücken')
  })

  it('rewrites localized Explorer names', () => {
    expect(macify('Открыть расположение в Проводнике', 'ru')).toBe('Открыть расположение в Finder')
    expect(macify("Ouvrir l'emplacement dans l'Explorateur", 'fr')).toBe("Ouvrir l'emplacement dans le Finder")
    expect(macify('在资源管理器中打开位置', 'zh-CN')).toBe('在访达中打开位置')
  })

  it('leaves words that only look like the Alt key', () => {
    expect(macify('Alt Kenar', 'tr')).toBe('Alt Kenar')
    expect(macify('Saml alt', 'da')).toBe('Saml alt')
  })

  it('does not rewrite a key name at the end of a longer word', () => {
    expect(macify('BasAlt + C')).toBe('BasAlt + C')
    expect(macify('ÉtéAlt+C')).toBe('ÉtéAlt+C')
    expect(macify('XCtrl+C')).toBe('XCtrl+C')
    expect(macify('NachStrg+C')).toBe('NachStrg+C')
    expect(macify('DarWin+V')).toBe('DarWin+V')
    expect(withMacHotkey('BasAlt+C', 'Control+Shift+X')).toBe('BasAlt+C')
  })

  it('still rewrites key names after punctuation and other modifiers', () => {
    expect(macify('(Ctrl+C)')).toBe('(⌘C)')
    expect(macify('Ctrl+Alt+X')).toBe('⌘⌥X')
    expect(macify('«Alt + C»')).toBe('«⌥C»')
    expect(macify('Win+V')).toBe('⌘V')
    expect(macify('アプリをクリックしてCtrl+Vで貼り付け', 'ja')).toBe('アプリをクリックして⌘Vで貼り付け')
  })
})

describe('mac shortcuts in right-to-left languages', () => {
  const LRI = '\u2066'
  const PDI = '\u2069'
  const LTR_LANGS = LANGS.filter((lang) => !RTL_LANGUAGES.includes(lang))

  it('uses the same language list as the renderer text direction', () => {
    expect([...RTL_LANGUAGES]).toEqual(['ar', 'fa', 'he'])
    const index = readFileSync(join(process.cwd(), 'src/i18n/index.ts'), 'utf8')
    expect(index).toContain('const isRtl = RTL_LANGUAGES.includes(resolvedLang)')
    expect(index).not.toMatch(/resolvedLang === '(ar|fa|he)'/)
  })

  it.each([...RTL_LANGUAGES])('%s isolates the rewritten shortcuts', (lang) => {
    expect(resolveText(TRANSLATIONS[lang], en, 'onboarding.collectDesc', lang, true)).toContain(`${LRI}⌘C${PDI}`)
    expect(resolveText(TRANSLATIONS[lang], en, 'toast.pasteFallback', lang, true)).toContain(`${LRI}⌘V${PDI}`)
    expect(resolveText(TRANSLATIONS[lang], en, 'onboarding.proTip1', lang, true)).toContain(`${LRI}⌥C${PDI}`)
  })

  it.each([...RTL_LANGUAGES])('%s isolates the shortcut parameter once', (lang) => {
    const text = resolveText(TRANSLATIONS[lang], en, 'toast.shortcutUpdated', lang, true, { shortcut: 'Control+Shift+X' })
    expect(text).toContain(`${LRI}⌃⇧X${PDI}`)
    expect(text.split(LRI)).toHaveLength(2)
    expect(text.split(PDI)).toHaveLength(2)
  })

  it.each([...RTL_LANGUAGES])('%s isolates a configured hotkey in tray text once', (lang) => {
    const text = macify(withMacHotkey('press Alt+C', 'Control+Shift+X'), lang)
    expect(text).toBe(`press ${LRI}⌃⇧X${PDI}`)
    expect(macify(text, lang)).toBe(text)
  })

  it.each([...RTL_LANGUAGES])('%s keeps non-shortcut parameters and Windows-mode strings free of isolates', (lang) => {
    expect(resolveText(TRANSLATIONS[lang], en, 'behaviour.updateAvailableTitle', lang, true, { version: '0.4.0' })).not.toMatch(/[\u2066\u2069]/)
    for (const path of pathsFor(lang)) {
      expect(resolveText(TRANSLATIONS[lang], en, path, lang, false, { shortcut: 'Alt+C' })).not.toMatch(/[\u2066\u2069]/)
    }
  })

  it.each(LTR_LANGS)('%s strings carry no direction isolates', (lang) => {
    for (const path of pathsFor(lang)) {
      expect(resolveText(TRANSLATIONS[lang], en, path, lang, true, { shortcut: 'Control+Shift+X' })).not.toMatch(/[\u2066\u2069]/)
    }
    expect(macify('Ctrl+C / Alt + C', lang)).toBe('⌘C / ⌥C')
  })

  it('leaves text alone when no language is given', () => {
    expect(macify('Ctrl+C')).toBe('⌘C')
  })
})

describe('formatMacAccelerator', () => {
  it('maps modifiers to mac symbols', () => {
    expect(formatMacAccelerator('Alt+C')).toBe('⌥C')
    expect(formatMacAccelerator('CommandOrControl+Shift+V')).toBe('⌘⇧V')
    expect(formatMacAccelerator('Control+Alt+X')).toBe('⌃⌥X')
    expect(formatMacAccelerator('Ctrl+Option+x')).toBe('⌃⌥X')
    expect(formatMacAccelerator('Super+K')).toBe('⌘K')
    expect(formatMacAccelerator('Alt+Space')).toBe('⌥Space')
  })
})

describe('withMacHotkey', () => {
  it('replaces the default hotkey text with the configured accelerator', () => {
    expect(withMacHotkey('press Alt+C to open', 'Alt+C')).toBe('press ⌥C to open')
    expect(withMacHotkey('press Alt + C to open', 'Control+Shift+X')).toBe('press ⌃⇧X to open')
    expect(withMacHotkey('no hotkey here', 'Alt+C')).toBe('no hotkey here')
  })
})
