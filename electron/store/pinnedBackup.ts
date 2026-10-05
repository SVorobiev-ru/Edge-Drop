import { statSync, realpathSync } from 'node:fs'
import { nativeImage } from 'electron'
import { type ItemData, type SourceApp, type ClipboardImageFields, MAX_STACK } from '../../shared/types'
import { createId } from './ids'
import { MAX_PAYLOAD_CHARS, MAX_ORIGINAL_IMAGE_BYTES, isPngBytes } from '../clipboard/formats'
import { isValidFilePath } from '../main/pathValidation'

export const MAX_TITLE_CHARS = 120
export const MAX_IMPORT_ITEMS = 5000
export const MAX_IMPORT_TEXT_CHARS = 10_000_000
export const MAX_IMPORT_PATHS = 1000
export const MAX_IMPORT_DIMENSION = 100_000
export const PINNED_EXPORT_FORMAT = 'edge-drop-pinned'
export const PINNED_EXPORT_VERSION = 1

export interface PinnedExportCommon {
  capturedAt: number
  title?: string
  sourceApp?: SourceApp
}

export interface PinnedExportImage {
  width: number
  height: number
  bytes: number
  source?: ClipboardImageFields['source']
  fileName?: string
  png: string
}

export type PinnedExportItem = PinnedExportCommon &
  (
    | { kind: 'text'; text: string; html?: string; rtf?: string; isUrl: boolean; isColor?: boolean }
    | ({ kind: 'image' } & PinnedExportImage)
    | { kind: 'image-collection'; images: PinnedExportImage[] }
    | { kind: 'files'; paths: string[] }
  )

export interface PinnedExport {
  format: typeof PINNED_EXPORT_FORMAT
  version: typeof PINNED_EXPORT_VERSION
  exportedAt: string
  items: PinnedExportItem[]
}

export function resolveImportedPath(p: string): string | null {
  try {
    const real = realpathSync.native(p)
    const st = statSync(real)
    return st.isFile() || st.isDirectory() ? real : null
  } catch {
    return null
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cleanTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TITLE_CHARS) : ''
}

export function cleanSourceApp(value: unknown): SourceApp | undefined {
  if (!isRecord(value)) return undefined
  const { bundleId, name } = value
  if (typeof bundleId !== 'string' || !bundleId || bundleId.length > 255) return undefined
  return typeof name === 'string' && name && name.length <= 255 ? { bundleId, name } : { bundleId }
}

export function isDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_IMPORT_DIMENSION
}


export function importImage(raw: unknown): { fields: ClipboardImageFields; png: Buffer } | null {
  if (!isRecord(raw)) return null
  const { width, height, bytes, source, fileName, png } = raw
  if (!isDimension(width) || !isDimension(height)) return null
  if (typeof png !== 'string' || !png || png.length > Math.ceil(MAX_ORIGINAL_IMAGE_BYTES / 3) * 4) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(png)) return null
  const buffer = Buffer.from(png, 'base64')
  if (!isPngBytes(buffer)) return null
  try {
    if (nativeImage.createFromBuffer(buffer).isEmpty()) return null
  } catch {
    return null
  }
  const fields: ClipboardImageFields = {
    imageId: createId(),
    width,
    height,
    bytes: typeof bytes === 'number' && Number.isInteger(bytes) && bytes > 0 ? bytes : buffer.length,
    ext: 'png'
  }
  if (source === 'screenshot' || source === 'image') fields.source = source
  if (typeof fileName === 'string' && fileName && fileName.length <= 255 && !/[\\/\x00-\x1f]/.test(fileName)) {
    fields.fileName = fileName
  }
  return { fields, png: buffer }
}

export function importItem(raw: unknown): { data: ItemData; images: Array<{ imageId: string; png: Buffer }>; html?: string; rtf?: string } | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'text') {
    const { text, html, rtf } = raw
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_IMPORT_TEXT_CHARS) return null
    return {
      data: { kind: 'text', text, isUrl: raw.isUrl === true, ...(raw.isColor === true ? { isColor: true } : {}) },
      images: [],
      html: typeof html === 'string' && html && html.length <= MAX_PAYLOAD_CHARS ? html : undefined,
      rtf: typeof rtf === 'string' && rtf && rtf.length <= MAX_PAYLOAD_CHARS ? rtf : undefined
    }
  }
  if (raw.kind === 'image') {
    const image = importImage(raw)
    return image ? { data: { kind: 'image', ...image.fields }, images: [{ imageId: image.fields.imageId, png: image.png }] } : null
  }
  if (raw.kind === 'image-collection') {
    if (!Array.isArray(raw.images) || raw.images.length === 0 || raw.images.length > MAX_STACK) return null
    const images = raw.images.map((img) => importImage(img))
    if (images.some((img) => img === null)) return null
    const valid = images as Array<{ fields: ClipboardImageFields; png: Buffer }>
    return {
      data: { kind: 'image-collection', images: valid.map((img) => img.fields) },
      images: valid.map((img) => ({ imageId: img.fields.imageId, png: img.png }))
    }
  }
  if (raw.kind === 'files') {
    const { paths } = raw
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_IMPORT_PATHS) return null
    if (!paths.every((p) => isValidFilePath(p))) return null
    const resolved = (paths as string[]).map(resolveImportedPath).filter((p): p is string => p !== null)
    if (resolved.length === 0) return null
    return { data: { kind: 'files', paths: [...new Set(resolved)] }, images: [] }
  }
  return null
}
