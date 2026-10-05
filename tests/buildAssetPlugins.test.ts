import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { slimEmojiData, stripWoffFallback } from '../scripts/viteAssetPlugins'
import { buildCatalog, type EmojiSourceEntry } from '../src/lib/emoji/catalog'

const require = createRequire(import.meta.url)

describe('build asset plugins', () => {
  it('slim emoji data builds the same catalog as the full datasource', () => {
    const full = require('emoji-datasource-twitter/emoji.json') as EmojiSourceEntry[]
    const slim = slimEmojiData(full as unknown as Record<string, unknown>[]) as unknown as EmojiSourceEntry[]
    for (const native of [true, false]) {
      expect(buildCatalog(slim, { native })).toEqual(buildCatalog(full, { native }))
    }
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(full).length / 1.5)
  })

  it('drops only the woff fallback from fontsource faces', () => {
    const css = "src: url(./files/a-400.woff2) format('woff2'), url(./files/a-400.woff) format('woff');"
    expect(stripWoffFallback(css)).toBe("src: url(./files/a-400.woff2) format('woff2');")
    expect(stripWoffFallback("src: url(./b.woff2) format('woff2');")).toBe("src: url(./b.woff2) format('woff2');")
  })
})
