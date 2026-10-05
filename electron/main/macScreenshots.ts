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
import { nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, rmSync, statSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join, extname, basename } from 'node:path'
import { convertHeicToPng } from './macHeic'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.heic', '.tiff', '.tif', '.gif', '.bmp', '.webp'])
const NATIVE_EXTS = new Set(['.png', '.jpg', '.jpeg'])
const DIR_POLL_MS = 180_000
const CAPTURE_ATTEMPTS = 3
const CAPTURE_RETRY_MS = 250

export type ScreenshotHandler = (png: Buffer, fileName: string) => void

let watcher: FSWatcher | null = null
let watchedDir = ''
const seen = new Map<string, number>()
const inFlight = new Set<string>()
let dirTimer: NodeJS.Timeout | null = null
let attaching = false
let handler: ScreenshotHandler | null = null
let enabled: () => boolean = () => true

/** Folder macOS saves screenshots to. */
export function screenshotDir(): Promise<string> {
  return new Promise((resolve) => {
    const fallback = join(homedir(), 'Desktop')
    execFile('/usr/bin/defaults', ['read', 'com.apple.screencapture', 'location'], { encoding: 'utf8', timeout: 5000 }, (err, stdout) => {
      if (err) {
        /* not set → Desktop */
        resolve(fallback)
        return
      }
      const out = String(stdout).trim()
      if (out) {
        const p = out.replace(/^~(?=$|\/)/, homedir())
        if (existsSync(p)) {
          resolve(p)
          return
        }
      }
      resolve(fallback)
    })
  })
}

function isScreenCapture(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('xattr', ['-p', 'com.apple.metadata:kMDItemIsScreenCapture', file], (err) => resolve(!err))
  })
}

async function loadScreenshot(file: string): Promise<Electron.NativeImage | null> {
  if (NATIVE_EXTS.has(extname(file).toLowerCase())) return nativeImage.createFromPath(file)
  const tmp = await convertHeicToPng(file)
  if (!tmp) return null
  try {
    return nativeImage.createFromPath(tmp)
  } finally {
    try {
      rmSync(tmp, { force: true })
    } catch {}
  }
}

async function handleCandidate(file: string, onScreenshot: ScreenshotHandler, isEnabled: () => boolean): Promise<void> {
  if (!isEnabled()) return
  const name = basename(file)
  if (name.startsWith('.')) return
  if (!IMAGE_EXTS.has(extname(name).toLowerCase())) return
  if (seen.has(file) || inFlight.has(file)) return
  let st
  try {
    st = statSync(file)
  } catch {
    return
  }
  if (!st.isFile() || st.size === 0) return
  // Only brand-new files (rename from the hidden temp file happens instantly).
  if (Date.now() - st.birthtimeMs > 15_000) return
  inFlight.add(file)
  try {
    let flagged = false
    for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt++) {
      // Give macOS a beat to finish writing + stamping attributes.
      await new Promise((r) => setTimeout(r, CAPTURE_RETRY_MS))
      if (!isEnabled()) return
      if (!(await isScreenCapture(file))) continue
      flagged = true
      try {
        const img = await loadScreenshot(file)
        if (!img) continue
        if (img.isEmpty()) {
          console.error('[Screenshots] empty image after loading', file)
          continue
        }
        markSeen(file)
        onScreenshot(img.toPNG(), name.replace(/\.[^.]+$/, '.png'))
        console.log('[Screenshots] captured', name)
        return
      } catch (err) {
        console.error('[Screenshots] failed to load', file, err)
      }
    }
    if (!flagged) markSeen(file)
  } finally {
    inFlight.delete(file)
  }
}

function markSeen(file: string): void {
  seen.set(file, Date.now())
  // Prune memory.
  if (seen.size > 200) {
    const cutoff = Date.now() - 60_000
    for (const [k, v] of seen) if (v < cutoff) seen.delete(k)
  }
}

async function attach(): Promise<void> {
  const onScreenshot = handler
  if (attaching || !onScreenshot) return
  attaching = true
  try {
    const dir = await screenshotDir()
    if (!dirTimer) return
    if (dir === watchedDir && watcher) return
    watcher?.close()
    watcher = null
    watchedDir = dir
    try {
      const w = watch(dir, { persistent: false }, (_evt, fname) => {
        if (!fname) return
        void handleCandidate(join(dir, fname.toString()), onScreenshot, enabled)
      })
      w.on('error', (err) => {
        console.error('[Screenshots] watcher error', dir, err)
        try {
          w.close()
        } catch {}
        if (watcher === w) watcher = null
      })
      watcher = w
      console.log('[Screenshots] watching', dir)
    } catch (err) {
      console.error('[Screenshots] cannot watch', dir, err)
    }
  } finally {
    attaching = false
  }
}

function detach(): void {
  watcher?.close()
  watcher = null
  watchedDir = ''
  if (dirTimer) clearInterval(dirTimer)
  dirTimer = null
}

export function refreshScreenshotWatcher(): void {
  if (process.platform !== 'darwin' || !handler) return
  if (!enabled()) {
    detach()
    return
  }
  if (dirTimer) return
  // The user can change the save location at any time (⌘⇧5 → Options).
  dirTimer = setInterval(() => void attach(), DIR_POLL_MS)
  void attach()
}

export function startScreenshotWatcher(onScreenshot: ScreenshotHandler, isEnabled: () => boolean = () => true): void {
  if (process.platform !== 'darwin') return
  if (handler) return
  handler = onScreenshot
  enabled = isEnabled
  refreshScreenshotWatcher()
}

export function stopScreenshotWatcher(): void {
  detach()
  seen.clear()
  inFlight.clear()
  handler = null
}
