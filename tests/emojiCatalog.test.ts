import { describe, expect, it } from 'vitest'
import {
  applySkin,
  buildCatalog,
  entriesForCategory,
  hasSkinTones,
  isPasteableEmoji,
  pushRecent,
  resolveGlyph,
  searchEmoji,
  skinChoices,
  unifiedToNative,
  type EmojiSourceEntry
} from '../src/lib/emoji/catalog'
import { resolveEmojiAsset, emojiAssetDir } from '../electron/main/imageProtocol'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sample: EmojiSourceEntry[] = [
  {
    unified: '1F600',
    image: '1f600.png',
    category: 'Smileys & Emotion',
    sort_order: 1,
    has_img_twitter: true
  },
  {
    unified: '1F44B',
    image: '1f44b.png',
    category: 'People & Body',
    sort_order: 2,
    has_img_twitter: true,
    skin_variations: {
      '1F3FB': { unified: '1F44B-1F3FB', image: '1f44b-1f3fb.png', has_img_twitter: true },
      '1F3FC': { unified: '1F44B-1F3FC', image: '1f44b-1f3fc.png', has_img_twitter: true }
    }
  },
  {
    unified: '1F3FB',
    image: '1f3fb.png',
    category: 'Component',
    sort_order: 3,
    has_img_twitter: true
  },
  {
    unified: '263A-FE0F',
    image: '263a-fe0f.png',
    category: 'Smileys & Emotion',
    sort_order: 4,
    has_img_twitter: true,
    obsoleted_by: '1F642'
  }
]

describe('emoji catalog', () => {
  it('groups twitter glyphs and skips components and obsolete entries', () => {
    const cat = buildCatalog(sample)
    expect(cat.all.map((e) => e.unified)).toEqual(['1F600', '1F44B'])
    expect(cat.byCategory['Smileys & Emotion']).toHaveLength(1)
    expect(cat.byCategory['Component']).toBeUndefined()
  })

  it('converts unified sequences to native characters', () => {
    expect(unifiedToNative('1F600')).toBe('😀')
    expect(unifiedToNative('1F44B-1F3FB')).toBe('👋🏻')
  })

  it('applies skin tone only when a variant exists', () => {
    const cat = buildCatalog(sample)
    const wave = cat.byUnified.get('1F44B')!
    const grin = cat.byUnified.get('1F600')!
    expect(applySkin(wave, '1F3FB')).toEqual({ unified: '1F44B-1F3FB', file: '1f44b-1f3fb.png' })
    expect(applySkin(grin, '1F3FB')).toEqual({ unified: '1F600', file: '1f600.png' })
    expect(applySkin(wave, null)).toEqual({ unified: '1F44B', file: '1f44b.png' })
  })

  it('resolves a skin-tone unified back to its parent and file', () => {
    const cat = buildCatalog(sample)
    const g = resolveGlyph(cat, '1F44B-1F3FB')
    expect(g?.entry.unified).toBe('1F44B')
    expect(g?.file).toBe('1f44b-1f3fb.png')
    expect(g?.unified).toBe('1F44B-1F3FB')
    expect(resolveGlyph(cat, '1F600')?.file).toBe('1f600.png')
  })

  it('lists default plus available skin choices for the popup', () => {
    const cat = buildCatalog(sample)
    const wave = cat.byUnified.get('1F44B')!
    const grin = cat.byUnified.get('1F600')!
    expect(hasSkinTones(wave)).toBe(true)
    expect(hasSkinTones(grin)).toBe(false)
    expect(skinChoices(grin)).toHaveLength(1)
    expect(skinChoices(wave).map((c) => c.unified)).toEqual(['1F44B', '1F44B-1F3FB', '1F44B-1F3FC'])
  })

  it('caps recents and moves the latest to front', () => {
    const first = pushRecent([], '1F600')
    const second = pushRecent(first, '1F44B')
    const again = pushRecent(second, '1F600')
    expect(again).toEqual(['1F600', '1F44B'])
  })

  it('rejects non-emoji paste payloads', () => {
    expect(isPasteableEmoji('😀')).toBe(true)
    expect(isPasteableEmoji('👋🏻')).toBe(true)
    expect(isPasteableEmoji('')).toBe(false)
    expect(isPasteableEmoji('hello\nworld')).toBe(false)
    expect(isPasteableEmoji('x'.repeat(65))).toBe(false)
  })
})

describe('emoji asset protocol', () => {
  it('only serves hex-named pngs inside the asset directory', () => {
    const dir = join(tmpdir(), `ed-emoji-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(join(dir, '1f600.png'), 'png')
      writeFileSync(join(dir, 'secret.txt'), 'no')
      expect(resolveEmojiAsset(dir, '1f600.png')?.endsWith('1f600.png')).toBe(true)
      expect(resolveEmojiAsset(dir, '1F600.PNG')).toBeTruthy()
      expect(resolveEmojiAsset(dir, '../secret.txt')).toBeNull()
      expect(resolveEmojiAsset(dir, 'secret.txt')).toBeNull()
      expect(resolveEmojiAsset(dir, '1f600.png.exe')).toBeNull()
      expect(resolveEmojiAsset(dir, '')).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('points packaged builds at extraResources', () => {
    const dir = emojiAssetDir({
      packaged: true,
      resourcesPath: 'C:\\res',
      appPath: 'C:\\app',
      cwd: 'C:\\cwd'
    })
    expect(dir.replace(/\\/g, '/')).toBe('C:/res/emoji/64')
  })
})

describe('horizontal emoji picker layout calculations', () => {
  it('entriesForCategory matches the grid memo for every category', () => {
    const cat = buildCatalog(sample)
    // smileys merges two source categories in sort order
    const smileys = entriesForCategory(cat, 'smileys', [])
    expect(smileys.map((e) => e.key)).toEqual(['1F600', '1F44B'])
    expect(smileys[0]).toMatchObject({ file: '1f600.png' })
    // recents resolve through glyphs, unknown codes dropped
    const recents = entriesForCategory(cat, 'recents', ['1F44B', 'NOPE'])
    expect(recents.map((e) => e.key)).toEqual(['1F44B'])
    // null catalog and empty recents are safe
    expect(entriesForCategory(null, 'smileys', [])).toEqual([])
    expect(entriesForCategory(cat, 'recents', [])).toEqual([])
  })

  it('calculates responsive columns matching horizontal viewport width', () => {
    const calcCols = (viewW: number, isHorizontal: boolean) => {
      if (!isHorizontal) return 7
      if (viewW <= 0) return 24
      return Math.max(8, Math.floor((viewW - 16) / 36))
    }

    expect(calcCols(0, false)).toBe(7)
    expect(calcCols(300, false)).toBe(7)
    expect(calcCols(0, true)).toBe(24)
    expect(calcCols(1000, true)).toBe(27)
    expect(calcCols(720, true)).toBe(19)
    expect(calcCols(1440, true)).toBe(39)
  })
})

const searchSample: EmojiSourceEntry[] = [
  { unified: '1F44D', name: 'THUMBS UP SIGN', short_name: '+1', short_names: ['+1', 'thumbsup'], category: 'People & Body', sort_order: 3, has_img_twitter: true, has_img_apple: true },
  { unified: '1F600', name: 'GRINNING FACE', short_name: 'grinning', short_names: ['grinning'], category: 'Smileys & Emotion', sort_order: 1, has_img_twitter: true, has_img_apple: true },
  { unified: '1F601', name: 'GRINNING FACE WITH SMILING EYES', short_name: 'grin', short_names: ['grin'], category: 'Smileys & Emotion', sort_order: 2, has_img_twitter: true, has_img_apple: true },
  { unified: '1F431', name: 'CAT FACE', short_name: 'cat', short_names: ['cat'], category: 'Animals & Nature', sort_order: 4, has_img_twitter: true, has_img_apple: true },
  { unified: '1FAE8', name: 'SHAKING FACE', short_name: 'shaking_face', short_names: ['shaking_face'], category: 'Smileys & Emotion', sort_order: 5, has_img_twitter: false, has_img_apple: true },
  { unified: '1F977', name: 'NINJA', short_name: 'ninja', short_names: ['ninja'], category: 'People & Body', sort_order: 6, has_img_twitter: true, has_img_apple: false }
]

const keys = (list: ReturnType<typeof searchEmoji>) => list.map((it) => it.key)

describe('emoji search', () => {
  const catalog = buildCatalog(searchSample)

  it('ranks an exact short name first', () => {
    expect(keys(searchEmoji(catalog, 'grin'))).toEqual(['1F601', '1F600'])
  })

  it('matches any short name, with or without colons', () => {
    expect(keys(searchEmoji(catalog, 'thumbsup'))).toEqual(['1F44D'])
    expect(keys(searchEmoji(catalog, ':+1:'))).toEqual(['1F44D'])
  })

  it('matches words of the full name in any order', () => {
    expect(keys(searchEmoji(catalog, 'face cat'))).toEqual(['1F431'])
    expect(keys(searchEmoji(catalog, 'smiling eyes'))).toEqual(['1F601'])
  })

  it('returns nothing for an empty query or a missing catalog', () => {
    expect(searchEmoji(catalog, '  ')).toEqual([])
    expect(searchEmoji(null, 'cat')).toEqual([])
    expect(searchEmoji(catalog, 'zebra')).toEqual([])
  })

  it('respects the limit', () => {
    expect(searchEmoji(catalog, 'face', 1)).toHaveLength(1)
  })
})

describe('glyph set per platform', () => {
  it('uses Twemoji availability by default', () => {
    const catalog = buildCatalog(searchSample)
    expect(catalog.byUnified.has('1FAE8')).toBe(false)
    expect(catalog.byUnified.has('1F977')).toBe(true)
  })

  it('uses Apple availability for native glyphs', () => {
    const catalog = buildCatalog(searchSample, { native: true })
    expect(catalog.byUnified.has('1FAE8')).toBe(true)
    expect(catalog.byUnified.has('1F977')).toBe(false)
  })
})
