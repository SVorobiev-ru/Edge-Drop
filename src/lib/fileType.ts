/**
 * File-type awareness for non-image files.
 *
 * Maps a file path (by extension) to a stable category used for icon tinting,
 * labels, and kind badges. Kept dependency-free: one small lookup table plus a
 * tinted-file-icon renderer, no per-format rendering libs.
 */

import { t } from '../i18n'
import { IS_MAC } from './format'
import { KIND_INFO, extOf, kindOfExt as sharedKindOfExt, type FileKind, type FileKindInfo } from '../../shared/fileKind'

export { extOf }
export type { FileKind, FileKindInfo }

function kindOfExt(ext: string): FileKind {
  return sharedKindOfExt(ext, IS_MAC)
}

const KEY_MAP: Record<FileKind, any> = {
  pdf: 'fileKinds.pdf',
  word: 'fileKinds.word',
  excel: 'fileKinds.excel',
  powerpoint: 'fileKinds.powerpoint',
  archive: 'fileKinds.archive',
  text: 'fileKinds.text',
  code: 'fileKinds.code',
  audio: 'fileKinds.audio',
  video: 'fileKinds.video',
  image: 'fileKinds.image',
  executable: 'fileKinds.file',
  folder: 'fileKinds.folder',
  file: 'fileKinds.file'
}

function translateKind(key: string, fallback: string): string {
  const val = t(key)
  if (!val || val.startsWith('fileKinds.') || val === key) return fallback
  return val
}

/** Resolve a file path to its display metadata (kind / label / color). */
export function getFileKind(path: string, isDirectory?: boolean): FileKindInfo {
  if (isDirectory) {
    const base = KIND_INFO.folder
    return {
      ...base,
      label: translateKind('fileKinds.folder', base.label)
    }
  }
  const ext = extOf(path)
  const kind = kindOfExt(ext)
  const base = KIND_INFO[kind]
  return {
    ...base,
    label: translateKind(KEY_MAP[kind], base.label)
  }
}

/** Resolve from an already-extracted extension string. */
export function getFileKindByExt(ext: string, isDirectory?: boolean): FileKindInfo {
  if (isDirectory || ext.toLowerCase() === 'folder') {
    const base = KIND_INFO.folder
    return {
      ...base,
      label: translateKind('fileKinds.folder', base.label)
    }
  }
  const kind = kindOfExt(ext.toLowerCase())
  const base = KIND_INFO[kind]
  return {
    ...base,
    label: translateKind(KEY_MAP[kind], base.label)
  }
}
