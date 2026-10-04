export const MAC_KEY_ALIASES: Record<string, string> = {
  'toast.launchBlockedByWindows': 'toast.launchBlockedByMac',
  'footer.reviewOnStore': 'footer.starOnGithub',
  'behaviour.autoUpdatesDescOn': 'behaviour.updateModeNotifyDesc'
}

const MAC_LANGUAGE_RULES: Record<string, Array<[RegExp, string]>> = {
  es: [[/el Explorador/g, 'Finder']],
  fr: [[/l'Explorateur/g, 'le Finder']],
  ru: [[/Проводнике?/g, 'Finder']],
  ja: [[/エクスプローラー/g, 'Finder']],
  ko: [[/탐색기/g, 'Finder']],
  'zh-CN': [[/资源管理器/g, '访达']],
  'zh-TW': [[/檔案總管/g, 'Finder']],
  hi: [[/एक्सप्लोरर/g, 'Finder']],
  ar: [[/المستكشف/g, 'Finder']],
  fa: [[/File Explorer/g, 'Finder']],
  bn: [[/এক্সপ্লোরারে/g, 'Finder-এ']],
  tr: [[/Gezg[iy]n'de/g, "Finder'da"]],
  pl: [[/Eksploratorze/g, 'Finderze']],
  nl: [[/Verkenner/g, 'Finder']],
  sv: [[/Utforskaren/g, 'Finder']],
  uk: [[/в Провіднику/g, 'у Finder']],
  el: [[/στην Εξερεύνηση/g, 'στο Finder']],
  cs: [[/v Průzkumníkovi/g, 've Finderu']],
  hu: [[/az Intézőben/g, 'a Finderben']],
  da: [[/Stifinder/g, 'Finder']],
  fi: [[/Resurssienhallinnassa/g, 'Finderissa']],
  he: [[/בסייר/g, 'ב-Finder']],
  no: [[/Utforsker/g, 'Finder']]
}

export const RTL_LANGUAGES: readonly string[] = ['ar', 'fa', 'he']

const LRI = '\u2066'
const PDI = '\u2069'

function isRtlLanguage(lang?: string): boolean {
  return !!lang && RTL_LANGUAGES.includes(lang)
}

function isolateMacShortcuts(s: string, lang?: string): string {
  if (!isRtlLanguage(lang)) return s
  return s.replace(/(?<![\u2066⌘⌥⌃⇧])[⌘⌥⌃⇧]+(?:[A-Za-z0-9]+|\S)/g, (combo) => `${LRI}${combo}${PDI}`)
}

/** Rewrite Windows-specific wording/shortcuts for macOS users. */
export function macify(s: string, lang?: string): string {
  let out = s
  for (const [pattern, replacement] of (lang && MAC_LANGUAGE_RULES[lang]) || []) {
    out = out.replace(pattern, replacement)
  }
  out = out
    .replace(/(?<![\p{Script=Latin}\p{N}])(?:Ctrl|Strg)\s*\+\s*/gu, '⌘')
    .replace(/(?<![\p{Script=Latin}\p{N}])Alt\s*\+\s*/gu, '⌥')
    .replace(/(?<![\p{Script=Latin}\p{N}])Win\s*\+\s*V/gu, '⌘V')
    .replace(/Explorer/g, 'Finder')
  return isolateMacShortcuts(out, lang)
}

export function formatMacAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => {
      const key = part.trim()
      if (key === 'CommandOrControl' || key === 'CmdOrCtrl' || key === 'Command' || key === 'Cmd' || key === 'Meta' || key === 'Super') return '⌘'
      if (key === 'Control' || key === 'Ctrl') return '⌃'
      if (key === 'Alt' || key === 'Option') return '⌥'
      if (key === 'Shift') return '⇧'
      return key.length === 1 ? key.toUpperCase() : key
    })
    .join('')
}

export function withMacHotkey(s: string, accelerator: string): string {
  return s.replace(/(?<![\p{Script=Latin}\p{N}])Alt\s*\+\s*C/gu, () => formatMacAccelerator(accelerator))
}

function getNestedProp(obj: unknown, path: string): string | undefined {
  let curr = obj as Record<string, unknown> | undefined
  for (const part of path.split('.')) {
    if (!curr || typeof curr !== 'object') return undefined
    curr = curr[part] as Record<string, unknown> | undefined
  }
  return typeof curr === 'string' ? curr : undefined
}

export function resolveText(
  dict: unknown,
  fallback: unknown,
  path: string,
  lang: string,
  mac: boolean,
  params?: Record<string, string | number>
): string {
  const key = (mac && MAC_KEY_ALIASES[path]) || path

  let val = dict ? getNestedProp(dict, key) : undefined
  if (!val) {
    val = getNestedProp(fallback, key) || path
  }
  if (mac) val = macify(val, lang)

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      const text = mac && k === 'shortcut'
        ? (isRtlLanguage(lang) ? `${LRI}${formatMacAccelerator(String(v))}${PDI}` : formatMacAccelerator(String(v)))
        : String(v)
      val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), text)
    }
  }

  return val
}
