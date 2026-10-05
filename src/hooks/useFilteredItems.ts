/**
 * useFilteredItems — derives the visible, grouped item list from raw state.
 *
 * Split into Pinned (favorites) and Recent (everything else), then apply the
 * search query. Kept as a selector so components stay presentational.
 */
import { useMemo } from 'react'
import { useStore } from '../store/appStore'
import type { ClipboardItemDto, TypeFilter } from '../../shared/types'
import { basename, formatImageDisplayName, imageItemDisplayName, isImagePath } from '../lib/format'
import { parseColor } from '../lib/colorUtils'
import { IS_DARWIN } from '../lib/edge'
import { getResolvedLanguage, isLanguageLoaded } from '../i18n'

const MAX_CACHED_TEXT_LENGTH = 100_000

interface ItemSearchIndex {
  plain?: string[]
  rich?: string[]
  richLocale?: string
  color?: boolean
  imageOnly?: boolean
}

const searchIndexCache = new WeakMap<ClipboardItemDto, ItemSearchIndex>()

function searchIndex(it: ClipboardItemDto): ItemSearchIndex {
  let index = searchIndexCache.get(it)
  if (!index) {
    index = {}
    searchIndexCache.set(it, index)
  }
  return index
}

function localeKey(): string {
  const lang = getResolvedLanguage()
  return isLanguageLoaded(lang) ? lang : `${lang}?`
}

function hasLocalizedName(it: ClipboardItemDto): boolean {
  const data = it.data
  switch (data.kind) {
    case 'text':
      return false
    case 'files':
      return data.paths.some((p) => isImagePath(p))
    case 'image':
    case 'image-collection':
      return true
  }
}

function isCachedText(text: string): boolean {
  return text.length <= MAX_CACHED_TEXT_LENGTH
}

function plainHaystack(it: ClipboardItemDto): string[] {
  const index = searchIndex(it)
  if (index.plain) return index.plain
  const data = it.data
  let parts: string[] = []
  if (data.kind === 'text') {
    if (isCachedText(data.text)) parts = [data.text.toLowerCase()]
  } else if (data.kind === 'files') {
    parts = data.paths.map((p) => basename(p).toLowerCase())
  }
  index.plain = parts
  return parts
}

function richHaystack(it: ClipboardItemDto): string[] {
  const index = searchIndex(it)
  const locale = hasLocalizedName(it) ? localeKey() : ''
  if (index.rich && index.richLocale === locale) return index.rich
  const parts: string[] = []
  const add = (value: string | undefined): void => {
    if (value) parts.push(value.toLowerCase())
  }
  add(it.title)
  add(it.ocrText)
  add(it.sourceApp?.name)
  const data = it.data
  switch (data.kind) {
    case 'text':
      if (isCachedText(data.text)) add(data.text)
      break
    case 'files':
      data.paths.forEach((p, i) => {
        add(basename(p))
        add(data.entries?.[i]?.name)
        if (isImagePath(p)) add(formatImageDisplayName(p, it.capturedAt))
      })
      break
    case 'image':
      add(data.fileName)
      add(imageItemDisplayName(data, it.capturedAt))
      break
    case 'image-collection':
      for (const img of data.images) {
        add(img.fileName)
        add(imageItemDisplayName(img, it.capturedAt))
      }
      break
  }
  index.rich = parts
  index.richLocale = locale
  return parts
}

export function itemMatchesQuery(it: ClipboardItemDto, q: string, rich = true): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  const parts = rich ? richHaystack(it) : plainHaystack(it)
  for (const part of parts) {
    if (part.includes(needle)) return true
  }
  return it.data.kind === 'text' && !isCachedText(it.data.text) && it.data.text.toLowerCase().includes(needle)
}

/**
 * Explorer-copied photos are stored as `files` but belong in Images, not Files.
 * Mixed stacks (photo + PDF) stay in Files only.
 */
export function isImageOnlyFileItem(it: ClipboardItemDto): boolean {
  if (it.data.kind !== 'files') return false
  const index = searchIndex(it)
  if (index.imageOnly !== undefined) return index.imageOnly
  const paths = it.data.paths
  const imageOnly = paths.length > 0 && !it.data.entries?.some((en) => en.isDirectory) && paths.every((p) => isImagePath(p))
  index.imageOnly = imageOnly
  return imageOnly
}

function isColorTextItem(it: ClipboardItemDto): boolean {
  if (it.data.kind !== 'text') return false
  const index = searchIndex(it)
  if (index.color !== undefined) return index.color
  const color = !!it.data.isColor || !!parseColor(it.data.text)
  index.color = color
  return color
}

export function itemMatchesTypeFilter(it: ClipboardItemDto, filter: TypeFilter): boolean {
  if (filter === 'all') return true
  switch (filter) {
    case 'text':
      return it.data.kind === 'text' && !it.data.isUrl && !isColorTextItem(it)
    case 'links':
      return it.data.kind === 'text' && !!it.data.isUrl
    case 'images':
      if (it.data.kind === 'image' || it.data.kind === 'image-collection') return true
      return isImageOnlyFileItem(it)
    case 'files':
      return it.data.kind === 'files' && !isImageOnlyFileItem(it)
    case 'colors':
      return isColorTextItem(it)
  }
}

export interface GroupedItems {
  pinned: ClipboardItemDto[]
  recent: ClipboardItemDto[]
  /** Search hits outside the active tab, ranked after the tab's own hits. */
  others: ClipboardItemDto[]
}

/** Every listed item, including the hits from other tabs. */
export function groupedCount(groups: GroupedItems): number {
  return groups.pinned.length + groups.recent.length + groups.others.length
}

export function groupItems(
  items: readonly ClipboardItemDto[],
  query: string,
  typeFilter: TypeFilter,
  opts: { rich: boolean; acrossTabs: boolean }
): GroupedItems {
  const pinned: ClipboardItemDto[] = []
  const recent: ClipboardItemDto[] = []
  const otherPinned: ClipboardItemDto[] = []
  const otherRecent: ClipboardItemDto[] = []
  const q = query.trim()
  const acrossTabs = opts.acrossTabs && q.length > 0
  for (const it of items) {
    if (!itemMatchesQuery(it, q, opts.rich)) continue
    if (itemMatchesTypeFilter(it, typeFilter)) (it.pinned ? pinned : recent).push(it)
    else if (acrossTabs) (it.pinned ? otherPinned : otherRecent).push(it)
  }
  return { pinned, recent, others: [...otherPinned, ...otherRecent] }
}

export function useFilteredItems(): GroupedItems {
  const items = useStore((s) => s.items)
  const query = useStore((s) => s.query)
  const typeFilter = useStore((s) => s.typeFilter)
  const tutorialStep = useStore((s) => s.tutorialStep)

  return useMemo(() => {
    const filteredByTutorial = tutorialStep <= 0 ? items : items.filter((it) => {
      switch (tutorialStep) {
        case 1:
          return it.id === 'onboarding-welcome'
        case 2:
          return false
        case 3:
          return it.id === 'onboarding-image' || !it.id.startsWith('onboarding-')
        case 4:
          return it.id === 'onboarding-files'
        case 5:
          return true
        default:
          return true
      }
    })

    return groupItems(filteredByTutorial, query, typeFilter, { rich: IS_DARWIN, acrossTabs: IS_DARWIN })
  }, [items, query, typeFilter, tutorialStep])
}
