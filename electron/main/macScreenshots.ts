/**
 * macOS: capture screenshots taken with ⌘⇧3 / ⌘⇧4 / ⌘⇧5.
 *
 * macOS saves those to a folder (Desktop by default, or whatever the user set
 * in the Screenshot app → Options). We watch that folder and, when a new
 * screen capture lands, put the image on the system clipboard. The normal
 * ClipboardWatcher then records it in history like any other copy — so the
 * screenshot shows up in Edge-Drop AND is ready to paste with ⌘V.
 *
 * Screen captures are recognised by the `kMDItemIsScreenCapture` extended
 * attribute macOS stamps on them, so ordinary images dropped into the folder
 * are ignored.
 */
import { clipboard, nativeImage } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join, extname, basename } from 'node:path'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.heic', '.tiff', '.tif', '.gif', '.bmp', '.webp'])

let watcher: FSWatcher | null = null
let watchedDir = ''
const seen = new Map<string, number>()
let dirTimer: NodeJS.Timeout | null = null

/** Folder macOS saves screenshots to. */
export function screenshotDir(): string {
  try {
    const out = execFileSync('defaults', ['read', 'com.apple.screencapture', 'location'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (out) {
      const p = out.replace(/^~(?=$|\/)/, homedir())
      if (existsSync(p)) return p
    }
  } catch {
    /* not set → Desktop */
  }
  return join(homedir(), 'Desktop')
}

function isScreenCapture(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('xattr', ['-p', 'com.apple.metadata:kMDItemIsScreenCapture', file], (err) => resolve(!err))
  })
}

async function handleCandidate(file: string, onCaptured?: (file: string) => void): Promise<void> {
  const name = basename(file)
  if (name.startsWith('.')) return
  if (!IMAGE_EXTS.has(extname(name).toLowerCase())) return
  if (seen.has(file)) return
  let st
  try {
    st = statSync(file)
  } catch {
    return
  }
  if (!st.isFile() || st.size === 0) return
  // Only brand-new files (rename from the hidden temp file happens instantly).
  if (Date.now() - st.birthtimeMs > 15_000) return
  seen.set(file, Date.now())
  // Prune memory.
  if (seen.size > 200) {
    const cutoff = Date.now() - 60_000
    for (const [k, v] of seen) if (v < cutoff) seen.delete(k)
  }
  // Give macOS a beat to finish writing + stamping attributes.
  await new Promise((r) => setTimeout(r, 250))
  if (!(await isScreenCapture(file))) return
  try {
    const img = nativeImage.createFromPath(file)
    if (img.isEmpty()) return
    clipboard.clear()
    clipboard.writeImage(img)
    console.log('[Screenshots] captured', name)
    onCaptured?.(file)
  } catch (err) {
    console.error('[Screenshots] failed to load', file, err)
  }
}

export function startScreenshotWatcher(onCaptured?: (file: string) => void): void {
  if (process.platform !== 'darwin') return
  const attach = (): void => {
    const dir = screenshotDir()
    if (dir === watchedDir && watcher) return
    watcher?.close()
    watcher = null
    watchedDir = dir
    try {
      watcher = watch(dir, { persistent: false }, (_evt, fname) => {
        if (!fname) return
        void handleCandidate(join(dir, fname.toString()), onCaptured)
      })
      console.log('[Screenshots] watching', dir)
    } catch (err) {
      console.error('[Screenshots] cannot watch', dir, err)
    }
  }
  attach()
  // The user can change the save location at any time (⌘⇧5 → Options).
  dirTimer = setInterval(attach, 30_000)
}

export function stopScreenshotWatcher(): void {
  watcher?.close()
  watcher = null
  if (dirTimer) clearInterval(dirTimer)
  dirTimer = null
}
