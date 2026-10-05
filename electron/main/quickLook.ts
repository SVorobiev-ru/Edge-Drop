import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { ClipboardItem } from '../../shared/types'

const QLMANAGE = '/usr/bin/qlmanage'

let preview: ChildProcess | null = null

export function quickLookTarget(
  item: ClipboardItem,
  requested: string | undefined,
  resolveImage: (imageId: string, ext?: string) => string | null
): string | null {
  const data = item.data
  if (data.kind === 'files') {
    if (requested) return data.paths.includes(requested) ? requested : null
    return data.paths[0] ?? null
  }
  if (data.kind === 'image') return resolveImage(data.imageId, data.ext)
  if (data.kind === 'image-collection') {
    const image = requested ? data.images.find((img) => img.imageId === requested) : data.images[0]
    return image ? resolveImage(image.imageId, image.ext) : null
  }
  return null
}

export function closeQuickLook(): void {
  const current = preview
  preview = null
  if (current && current.exitCode === null && !current.killed) {
    try {
      current.kill()
    } catch { /* ignore */ }
  }
}

export function openQuickLook(path: string | null): boolean {
  if (process.platform !== 'darwin' || !path || !path.startsWith('/') || !existsSync(path)) return false
  closeQuickLook()
  try {
    const child = spawn(QLMANAGE, ['-p', path], { detached: true, stdio: 'ignore' })
    child.on('error', (err) => {
      console.error('[QuickLook] qlmanage failed:', err)
      if (preview === child) preview = null
    })
    child.on('exit', () => {
      if (preview === child) preview = null
    })
    child.unref()
    preview = child
    return true
  } catch (err) {
    console.error('[QuickLook] could not start qlmanage:', err)
    return false
  }
}
