import { buildCatalog, type EmojiCatalog, type EmojiSourceEntry } from './catalog'
import { edge } from '../edge'

let pending: Promise<EmojiCatalog> | null = null

export function loadEmojiCatalog(): Promise<EmojiCatalog> {
  if (!pending) {
    pending = import('emoji-datasource-twitter/emoji.json').then((mod) => {
      const raw = (mod as { default?: EmojiSourceEntry[] }).default ?? (mod as unknown as EmojiSourceEntry[])
      // Measured ~14ms total on real data: runs inline, no staging needed.
      const catalog = buildCatalog(Array.isArray(raw) ? raw : [], { native: edge.platform === 'darwin' })
      return catalog
    })
  }
  return pending
}
