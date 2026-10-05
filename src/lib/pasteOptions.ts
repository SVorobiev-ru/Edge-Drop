import type { ClipboardItemDto, PasteOptions, Settings } from '../../shared/types'

export function pastePlainFor(settings: Pick<Settings, 'pastePlainText'>, invert: boolean, platform: string): boolean {
  const flip = platform === 'darwin' && invert
  return !!settings.pastePlainText !== flip
}

export function pasteOptionsFor(
  item: Pick<ClipboardItemDto, 'data'>,
  settings: Pick<Settings, 'pastePlainText'>,
  invert: boolean,
  platform: string
): PasteOptions | undefined {
  if (item.data.kind !== 'text') return undefined
  return { plain: pastePlainFor(settings, invert, platform) }
}
