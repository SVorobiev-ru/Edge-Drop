import type { LanguageMeta } from './types'

export const LANGUAGES: LanguageMeta[] = [
  {
    "code": "system",
    "name": "System Default",
    "nativeName": "System Default (Auto)"
  },
  {
    "code": "en",
    "name": "English",
    "nativeName": "English (US)"
  },
  {
    "code": "es",
    "name": "Spanish",
    "nativeName": "Español"
  },
  {
    "code": "fr",
    "name": "French",
    "nativeName": "Français"
  },
  {
    "code": "de",
    "name": "German",
    "nativeName": "Deutsch"
  },
  {
    "code": "it",
    "name": "Italian",
    "nativeName": "Italiano"
  },
  {
    "code": "pt",
    "name": "Portuguese",
    "nativeName": "Português"
  },
  {
    "code": "ru",
    "name": "Russian",
    "nativeName": "Русский"
  },
  {
    "code": "ja",
    "name": "Japanese",
    "nativeName": "日本語"
  },
  {
    "code": "ko",
    "name": "Korean",
    "nativeName": "한국어"
  },
  {
    "code": "zh-CN",
    "name": "Chinese (Simplified)",
    "nativeName": "简体中文"
  },
  {
    "code": "zh-TW",
    "name": "Chinese (Traditional)",
    "nativeName": "繁體中文"
  },
  {
    "code": "hi",
    "name": "Hindi",
    "nativeName": "हिन्दी"
  },
  {
    "code": "ar",
    "name": "Arabic",
    "nativeName": "العربية",
    "rtl": true
  },
  {
    "code": "fa",
    "name": "Persian",
    "nativeName": "فارسی",
    "rtl": true
  },
  {
    "code": "bn",
    "name": "Bengali",
    "nativeName": "বাংলা"
  },
  {
    "code": "tr",
    "name": "Turkish",
    "nativeName": "Türkçe"
  },
  {
    "code": "vi",
    "name": "Vietnamese",
    "nativeName": "Tiếng Việt"
  },
  {
    "code": "pl",
    "name": "Polish",
    "nativeName": "Polski"
  },
  {
    "code": "nl",
    "name": "Dutch",
    "nativeName": "Nederlands"
  },
  {
    "code": "sv",
    "name": "Swedish",
    "nativeName": "Svenska"
  },
  {
    "code": "id",
    "name": "Indonesian",
    "nativeName": "Bahasa Indonesia"
  },
  {
    "code": "uk",
    "name": "Ukrainian",
    "nativeName": "Українська"
  },
  {
    "code": "el",
    "name": "Greek",
    "nativeName": "Ελληνικά"
  },
  {
    "code": "cs",
    "name": "Czech",
    "nativeName": "Čeština"
  },
  {
    "code": "ro",
    "name": "Romanian",
    "nativeName": "Română"
  },
  {
    "code": "hu",
    "name": "Hungarian",
    "nativeName": "Magyar"
  },
  {
    "code": "da",
    "name": "Danish",
    "nativeName": "Dansk"
  },
  {
    "code": "fi",
    "name": "Finnish",
    "nativeName": "Suomi"
  },
  {
    "code": "th",
    "name": "Thai",
    "nativeName": "ไทย"
  },
  {
    "code": "he",
    "name": "Hebrew",
    "nativeName": "עברית",
    "rtl": true
  },
  {
    "code": "no",
    "name": "Norwegian",
    "nativeName": "Norsk"
  }
];

export function getLangLabel(l: LanguageMeta): string {
  return l.code === 'system' || l.nativeName.includes('(') ? l.nativeName : `${l.nativeName} (${l.name})`
}
