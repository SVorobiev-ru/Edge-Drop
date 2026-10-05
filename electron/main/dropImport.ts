import { nativeImage, net } from 'electron'
import { existsSync } from 'node:fs'
import { getStore, loadSettings, pushState, addFiles } from './state'
import { localPathFromFileUrl } from '../clipboard/formats'
import { createId } from '../store/ids'
import { wakeImageTextRecognition } from './ocr'
import { handle } from './ipcHandle'
import { toast } from './toast'

export function registerDropImportIpc(): void {
  handle('item:add-data', async (data) => {
    if (!data) return getStore().toDto()

    if (data.kind === 'files' && data.paths && data.paths.length > 0) {
      const result = addFiles(data.paths)
      if (result.stacksCreated > 1) {
        toast('toast.splitStacks', 'info', { count: result.stacksCreated })
      }
      return getStore().toDto()
    }

    if (data.kind === 'image' && (data as any).imageUrl) {
      const imageUrl = (data as any).imageUrl as string
      if (/^file:/i.test(imageUrl) && process.platform !== 'win32') {
        const posixPath = localPathFromFileUrl(imageUrl)
        if (posixPath) {
          addFiles([posixPath])
          return getStore().toDto()
        }
      } else if (/^file:/i.test(imageUrl)) {
        const local = imageUrl.replace(/^file:\/\//i, '').replace(/^\/([a-zA-Z]:)/, '$1')
        try {
          const decoded = decodeURIComponent(local).replace(/\//g, '\\')
          if (existsSync(decoded)) {
            addFiles([decoded])
            return getStore().toDto()
          }
        } catch { /* fall through to bitmap import */ }
      }
      try {
        let img = nativeImage.createFromDataURL(imageUrl)
        if (img.isEmpty() && /^https?:\/\//i.test(imageUrl)) {
          const bytes = await fetchDroppedImage(imageUrl)
          img = bytes ? nativeImage.createFromBuffer(bytes) : img
          if (img.isEmpty()) {
            toast('toast.imageUnavailable', 'error')
            return getStore().toDto()
          }
        }
        if (!img.isEmpty()) {
          let png: Buffer | null = img.toPNG()
          const size = img.getSize()
          data.imageId = createId()
          data.bytes = png.length
          data.width = size.width
          data.height = size.height
          data.ext = 'png'
          data.source = 'image'
          const fromUrl = imageUrl.split(/[\\/]/).pop()?.split('?')[0]
          if (fromUrl && /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(fromUrl)) {
            data.fileName = decodeURIComponent(fromUrl)
          }
          getStore().stageImageBytes(data.imageId, png)
          png = null
          img = null as any
        }
      } catch (err) {
        console.error('[IPC] Failed to process dropped web image URL:', err)
      }
    }

    getStore().add(data, loadSettings().historyLimit)
    // Manual drag-in import (text/URL/web image dropped onto the shelf):
    // bookkeeping, not a capture — suppress the copy indicator.
    pushState.items({ reason: 'usage' })
    if (data.kind === 'image') wakeImageTextRecognition()
    return getStore().toDto()
  })
}

const IMAGE_URL_TIMEOUT_MS = 15_000
const IMAGE_URL_MAX_BYTES = 25 * 1024 * 1024

export async function fetchDroppedImage(url: string, fetcher: typeof net.fetch = (input, init) => net.fetch(input, init)): Promise<Buffer | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const allowed = process.platform === 'darwin' ? ['https:'] : ['http:', 'https:']
  if (!allowed.includes(parsed.protocol)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_URL_TIMEOUT_MS)
  try {
    const res = await fetcher(parsed.toString(), { signal: controller.signal })
    if (!res.ok || !res.body) return null
    const type = (res.headers.get('content-type') || '').trim().toLowerCase()
    if (!type.startsWith('image/')) return null
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > IMAGE_URL_MAX_BYTES) return null
    const reader = res.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > IMAGE_URL_MAX_BYTES) {
        controller.abort()
        void reader.cancel().catch(() => {})
        return null
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  } catch (err) {
    console.error('[IPC] dropped image URL fetch failed:', err)
    return null
  } finally {
    clearTimeout(timer)
  }
}
