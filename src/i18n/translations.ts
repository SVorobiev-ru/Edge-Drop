import type { TranslationKeys } from './types'
import en from '../../edge-drop-translations/en.json'
import es from '../../edge-drop-translations/es.json'
import fr from '../../edge-drop-translations/fr.json'
import de from '../../edge-drop-translations/de.json'
import it from '../../edge-drop-translations/it.json'
import pt from '../../edge-drop-translations/pt.json'
import ru from '../../edge-drop-translations/ru.json'
import ja from '../../edge-drop-translations/ja.json'
import ko from '../../edge-drop-translations/ko.json'
import zhCN from '../../edge-drop-translations/zh-CN.json'
import zhTW from '../../edge-drop-translations/zh-TW.json'
import hi from '../../edge-drop-translations/hi.json'
import ar from '../../edge-drop-translations/ar.json'
import fa from '../../edge-drop-translations/fa.json'
import bn from '../../edge-drop-translations/bn.json'
import tr from '../../edge-drop-translations/tr.json'
import vi from '../../edge-drop-translations/vi.json'
import pl from '../../edge-drop-translations/pl.json'
import nl from '../../edge-drop-translations/nl.json'
import sv from '../../edge-drop-translations/sv.json'
import id from '../../edge-drop-translations/id.json'
import uk from '../../edge-drop-translations/uk.json'
import el from '../../edge-drop-translations/el.json'
import cs from '../../edge-drop-translations/cs.json'
import ro from '../../edge-drop-translations/ro.json'
import hu from '../../edge-drop-translations/hu.json'
import da from '../../edge-drop-translations/da.json'
import fi from '../../edge-drop-translations/fi.json'
import th from '../../edge-drop-translations/th.json'
import he from '../../edge-drop-translations/he.json'
import no from '../../edge-drop-translations/no.json'

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
