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

export function itemMatchesQuery(it: ClipboardItemDto, q: string, rich = true): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  if (!rich) {
    switch (it.data.kind) {
      case 'text':
        return it.data.text.toLowerCase().includes(needle)
      case 'files':
        return it.data.paths.some((p) => basename(p).toLowerCase().includes(needle))
      case 'image':
      case 'image-collection':
        return false
    }
  }
  const hit = (value: string | undefined): boolean => !!value && value.toLowerCase().includes(needle)
  if (hit(it.title) || hit(it.ocrText) || hit(it.sourceApp?.name)) return true
  const data = it.data
  switch (data.kind) {
    case 'text':
      return data.text.toLowerCase().includes(needle)
    case 'files':
      return data.paths.some((p, i) => {
        if (hit(basename(p)) || hit(data.entries?.[i]?.name)) return true
        return isImagePath(p) && hit(formatImageDisplayName(p, it.capturedAt))
      })
    case 'image':
      return hit(data.fileName) || hit(imageItemDisplayName(data, it.capturedAt))
    case 'image-collection':
      return data.images.some((img) => hit(img.fileName) || hit(imageItemDisplayName(img, it.capturedAt)))
  }
}

/**
 * Explorer-copied photos are stored as `files` but belong in Images, not Files.
 * Mixed stacks (photo + PDF) stay in Files only.
 */
export function isImageOnlyFileItem(it: ClipboardItemDto): boolean {
  if (it.data.kind !== 'files') return false
  const paths = it.data.paths
  if (paths.length === 0) return false
  if (it.data.entries?.some((en) => en.isDirectory)) return false
  return paths.every((p) => isImagePath(p))
}

export function itemMatchesTypeFilter(it: ClipboardItemDto, filter: TypeFilter): boolean {
  if (filter === 'all') return true
  switch (filter) {
    case 'text':
      return it.data.kind === 'text' && !it.data.isUrl && !it.data.isColor && !parseColor(it.data.text)
    case 'links':
      return it.data.kind === 'text' && !!it.data.isUrl
    case 'images':
      if (it.data.kind === 'image' || it.data.kind === 'image-collection') return true
      return isImageOnlyFileItem(it)
    case 'files':
      return it.data.kind === 'files' && !isImageOnlyFileItem(it)
    case 'colors':
      return it.data.kind === 'text' && (!!it.data.isColor || !!parseColor(it.data.text))
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
    const filteredByTutorial = items.filter((it) => {
      if (tutorialStep <= 0) return true
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
