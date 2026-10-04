import { execFile } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS } from '../store/paths'
import { createId } from '../store/ids'

export function convertHeicToPng(file: string, maxEdgePx?: number, prefix = 'screenshot'): Promise<string | null> {
  return new Promise((resolve) => {
    let out = ''
    try {
      const dir = PATHS.tempDir()
      mkdirSync(dir, { recursive: true })
      out = join(dir, `${prefix}-${createId()}.png`)
    } catch (err) {
      console.error('[Heic] cannot prepare temp dir', err)
      resolve(null)
      return
    }
    const resize = maxEdgePx ? ['-Z', String(maxEdgePx)] : []
    execFile('sips', ['-s', 'format', 'png', ...resize, file, '--out', out], { timeout: 15_000 }, (err) => {
      if (err) {
        console.error('[Heic] sips failed for', file, err)
        try {
          rmSync(out, { force: true })
        } catch (rmErr) {
          console.error('[Heic] cannot remove', out, rmErr)
        }
        resolve(null)
        return
      }
      resolve(out)
    })
  })
}
