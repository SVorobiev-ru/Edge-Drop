import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

const EMOJI_JSON = /[\\/]emoji-datasource-twitter[\\/]emoji\.json$/
const EMOJI_FIELDS = ['unified', 'name', 'short_name', 'short_names', 'image', 'category', 'sort_order', 'has_img_twitter', 'has_img_apple', 'obsoleted_by'] as const
const EMOJI_SKIN_FIELDS = ['unified', 'image', 'has_img_twitter', 'has_img_apple'] as const

type JsonRecord = Record<string, unknown>

function pick(source: JsonRecord, fields: readonly string[]): JsonRecord {
  const out: JsonRecord = {}
  for (const field of fields) {
    if (source[field] !== undefined) out[field] = source[field]
  }
  return out
}

export function slimEmojiData(raw: JsonRecord[]): JsonRecord[] {
  return raw.map((entry) => {
    const slim = pick(entry, EMOJI_FIELDS)
    const skins = entry.skin_variations as Record<string, JsonRecord> | undefined
    if (skins) {
      slim.skin_variations = Object.fromEntries(Object.entries(skins).map(([key, skin]) => [key, pick(skin, EMOJI_SKIN_FIELDS)]))
    }
    return slim
  })
}

const SLIM_EMOJI_ID = '\0emoji.js'

export function slimEmojiPlugin(): Plugin {
  let sourcePath: string | null = null
  return {
    name: 'edge-drop:slim-emoji',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source !== 'emoji-datasource-twitter/emoji.json') return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved || !EMOJI_JSON.test(resolved.id)) return null
      sourcePath = resolved.id
      return SLIM_EMOJI_ID
    },
    load(id) {
      if (id !== SLIM_EMOJI_ID || !sourcePath) return null
      const raw = JSON.parse(readFileSync(sourcePath, 'utf8')) as JsonRecord[]
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(slimEmojiData(raw)))})`
    }
  }
}

const WOFF_FALLBACK = /,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g

export function stripWoffFallback(css: string): string {
  return css.replace(WOFF_FALLBACK, '')
}

export function woff2OnlyPlugin(): Plugin {
  return {
    name: 'edge-drop:woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]@fontsource[\\/].+\.css$/.test(id)) return null
      return { code: stripWoffFallback(code), map: null }
    }
  }
}
