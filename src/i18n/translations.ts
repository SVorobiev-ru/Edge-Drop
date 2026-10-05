import type { TranslationKeys } from './types'
import en from './locales/en'
import es from './locales/es'
import fr from './locales/fr'
import de from './locales/de'
import it from './locales/it'
import pt from './locales/pt'
import ru from './locales/ru'
import ja from './locales/ja'
import ko from './locales/ko'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'
import hi from './locales/hi'
import ar from './locales/ar'
import fa from './locales/fa'
import bn from './locales/bn'
import tr from './locales/tr'
import vi from './locales/vi'
import pl from './locales/pl'
import nl from './locales/nl'
import sv from './locales/sv'
import id from './locales/id'
import uk from './locales/uk'
import el from './locales/el'
import cs from './locales/cs'
import ro from './locales/ro'
import hu from './locales/hu'
import da from './locales/da'
import fi from './locales/fi'
import th from './locales/th'
import he from './locales/he'
import no from './locales/no'

export type { TranslationKeys, LanguageMeta } from './types'
export { LANGUAGES } from './languages'
export { en, es, fr, de, it, pt, ru, ja, ko, zhCN, zhTW, hi, ar, fa, bn, tr, vi, pl, nl, sv, id, uk, el, cs, ro, hu, da, fi, th, he, no }

export const TRANSLATIONS: Record<string, TranslationKeys> = {
  'en': en,
  'es': es,
  'fr': fr,
  'de': de,
  'it': it,
  'pt': pt,
  'ru': ru,
  'ja': ja,
  'ko': ko,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'hi': hi,
  'ar': ar,
  'fa': fa,
  'bn': bn,
  'tr': tr,
  'vi': vi,
  'pl': pl,
  'nl': nl,
  'sv': sv,
  'id': id,
  'uk': uk,
  'el': el,
  'cs': cs,
  'ro': ro,
  'hu': hu,
  'da': da,
  'fi': fi,
  'th': th,
  'he': he,
  'no': no,
}
