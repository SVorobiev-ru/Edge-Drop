/**
 * Stable, content-based key used for item deduplication and for correlating
 * staged temp artifacts with the history entries that own them.
 *
 * Single source of truth: the ItemStore dedup index and the staged-temp
 * registry MUST agree on identity, otherwise lifecycle cleanup would either
 * delete files that are still owned (data loss) or leak them forever.
 */
import { createHash } from 'node:crypto'
import type { ItemData } from '../../shared/types'

const TEXT_SIGNATURE_RE = /^text\|sha256:[0-9a-f]{64}$/

export function textSignature(text: string): string {
  return `text|sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

export function isCurrentSignature(sig: string): boolean {
  return !sig.startsWith('text|') || TEXT_SIGNATURE_RE.test(sig)
}

export function contentSignature(data: ItemData): string {
  switch (data.kind) {
    case 'text':
      return textSignature(data.text)
    case 'image':
      return data.bytes && data.bytes > 0 ? `image|${data.width}x${data.height}|${data.bytes}` : `image|${data.imageId}`
    case 'image-collection':
      return `image-collection|${data.images.map((i) => `${i.width}x${i.height}|${i.bytes || i.imageId}`).join(',')}`
    case 'files':
      return `files|${data.paths.join('\n')}`
  }
}
