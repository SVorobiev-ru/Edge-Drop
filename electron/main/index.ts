/**
 * Electron main process entry point.
 *
 * Lifecycle:
 *   1. Single-instance lock (only one Edge-Drop may run).
 *   2. App 'ready' -> ensure dirs, create the edge window + tray, register the
 *      image protocol + IPC handlers, start the clipboard watcher.
 *   3. On 'window-all-closed' we DON'T quit (the panel is hidden, not closed).
 *   4. Quit from the tray menu tears everything down cleanly.
 */
import { app, BrowserWindow, protocol, session } from 'electron'
import { APP_CONFIG, runtime } from './config'
import { ensureDirs, PATHS, getUnpackagedTempDir } from '../store/paths'
import { createWindow, getMainWindow, setInteractive, markExplicitOpen, setVisible, startCursorPoll, stopCursorPoll, stopHeartbeat, setHotZoneWidth, registerTaskbarCreatedListener, registerMacLockScreenHooks, syncMacEscapeCapture, registerPanelStateIpc, registerPanelDragIpc } from './window'
import { createTray, registerIncognitoApplier, refreshTray, openPanelFromShell } from './tray'
import { registerIpc, registerSendListeners } from './ipc'
import { reconcileLaunchAtLoginOnStartup } from './loginItems'
import { isStoreBuild, shouldStartHidden } from './config'
import { prewarmDragIcons } from './drag'
import { initState, getWatcher, loadSettings, saveSettings, pushState, stopStateTimers, getStore, addScreenshotToHistory, setImageAddedListener } from './state'
import { initAutoUpdater, shutdownMacUpdates } from './updater'
import { URL_SCHEME, parseEdgeDropUrl, type UrlCommand } from './urlScheme'
import { startScreenshotWatcher, stopScreenshotWatcher } from './macScreenshots'
import { createOnboardingWindow } from './onboardingWindow'
import { installMacAppMenu } from './macAppMenu'
import { startFullscreenMonitor, stopFullscreenMonitor, triggerFullscreenCheck } from './fullscreen'
import { flushStagedTempRegistry } from './stagedTemp'
import { stopImageTextRecognition, wakeImageTextRecognition } from './ocr'
import { closeQuickLook } from './quickLook'
import { defaultToggleHotkey } from '../../shared/types'
import { extname, normalize, join } from 'node:path'
import { existsSync, createReadStream, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import koffi from 'koffi'
import { pasteboardChangeCount } from './macPasteboard'
import { collectItemFilePaths, isServableLocalPath } from './edgelocalAccess'
import { createHash } from 'node:crypto'
import { resolveStoredImage, resolveEmojiAsset, emojiAssetDir } from './imageProtocol'
import { getThumbnailPayloadAsync, thumbnailCacheControl, isMacHeicPath, getHeicPreviewPng } from './thumbnailCache'

const smokeTestRun = process.platform === 'darwin' && process.argv.includes('--smoke-test')

function runSmokeTest(): void {
  let exitCode = 1
  let profileDir: string | null = null
  try {
    profileDir = mkdtempSync(join(tmpdir(), 'edge-drop-smoke-'))
    app.setPath('userData', profileDir)
    const changeCount = pasteboardChangeCount()
    const ok = Number.isInteger(changeCount) && changeCount >= 0
    process.stdout.write(`${JSON.stringify({ smokeTest: true, ok, changeCount, koffi: koffi.version, arch: process.arch, version: app.getVersion() })}\n`)
    exitCode = ok ? 0 : 1
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ smokeTest: true, ok: false, error: err instanceof Error ? err.message : String(err) })}\n`)
  }
  if (profileDir) {
    try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  app.exit(exitCode)
}

if (smokeTestRun) runSmokeTest()

// Edge-Drop renders a small, mostly static transparent panel. Chromium's GPU
// process costs substantially more memory (~150–250 MB) than the iGPU compositing
// savings are worth for such a simple UI. Software compositing keeps the process
// count and RAM footprint minimal without meaningfully affecting visual quality.
// Electron requires this call before the ready event.
app.disableHardwareAcceleration()

// Restrict the renderer to a single webContents and forbid remote module usage.
app.enableSandbox()

// Keep V8's old-space heap bounded without starving a renderer that is loading
// an existing clipboard history. This deliberately does not restore
// --optimize-for-size: that flag made collections more aggressive and caused
// visible animation hitches. Chromium image/compositor memory is handled by
// the thumbnail path below rather than by this JavaScript heap limit.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512 --expose-gc')

// ---- single instance -------------------------------------------------------
const gotLock = smokeTestRun || app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // If a second copy launches, just reveal the existing panel.
    if (process.platform === 'darwin') {
      openPanelFromShell()
      return
    }
    setVisible(true)
    getMainWindow()?.focus()
  })
  app.on('browser-window-blur', () => {
    triggerFullscreenCheck()
  })
}

let pendingUrlCommand: UrlCommand | null = null
let urlCommandsReady = false

function runUrlCommand(command: UrlCommand): void {
  if (runtime.quitting) return
  console.log(`[Main] URL command ${command.action}`)
  switch (command.action) {
    case 'toggle':
      setVisible(true)
      markExplicitOpen()
      pushState.togglePanel(undefined, { source: 'url' })
      return
    case 'open':
      openPanelFromShell('url')
      return
    case 'search':
      openPanelFromShell('url')
      pushState.search(command.query)
  }
}

function markUrlCommandsReady(): void {
  urlCommandsReady = true
  const command = pendingUrlCommand
  pendingUrlCommand = null
  if (command) setTimeout(() => runUrlCommand(command), 300)
}

if (process.platform === 'darwin' && !smokeTestRun) {
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const command = parseEdgeDropUrl(url)
    if (!command) {
      console.warn('[Main] Ignored an unsupported edgedrop:// URL')
      return
    }
    if (urlCommandsReady) runUrlCommand(command)
    else pendingUrlCommand = command
  })
}

// ---- before ready: register privileged protocol ----------------------------
// Must happen before app is ready so we can declare it as privileged (bypass
// CSP for image loads).
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_CONFIG.imageProtocol,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

// ---- app lifecycle ---------------------------------------------------------
const MAC_QUIT_WATCHDOG_MS = 3_000
let quitWatchdog: ReturnType<typeof setTimeout> | null = null

app.on('before-quit', () => {
  runtime.quitting = true
  stopCursorPoll()
  stopHeartbeat()
  stopStateTimers()
  stopFullscreenMonitor()
  stopScreenshotWatcher()
  getWatcher().stop()
  try {
    getStore().persistSync()
  } catch { /* ignore */ }
  try {
    flushStagedTempRegistry()
  } catch { /* ignore */ }
  if (process.platform === 'darwin') {
    shutdownMacUpdates()
    stopImageTextRecognition()
    closeQuickLook()
  }
  try {
    const { globalShortcut } = require('electron')
    globalShortcut.unregisterAll()
  } catch { /* ignore */ }
  if (process.platform === 'darwin' && !quitWatchdog) {
    quitWatchdog = setTimeout(() => app.exit(0), MAC_QUIT_WATCHDOG_MS)
    quitWatchdog.unref()
  }
})

app.whenReady().then(() => {
  if (smokeTestRun) return
  if (process.platform === 'darwin') { try { app.dock?.hide() } catch { /* ignore */ } }
  installMacAppMenu()
  // GitHub NSIS needs an explicit AUMID. Store packages already have one from
  // the AppX identity; overriding it breaks toasts and taskbar grouping.
  if (!isStoreBuild()) {
    app.setAppUserModelId('com.edgedrop.app')
  }

  ensureDirs()
  // NOTE: temp cleanup is intentionally NOT a blind wipe anymore. Staged drag
  // and paste artifacts are lifecycle-managed (see stagedTemp.ts) and are
  // reconciled against living history inside initState().

  // Lock the renderer session down: block all permission requests by default.
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  // Register the image protocol: edgelocal://<imageId> -> the staged image file.
  registerImageProtocol()

  createWindow()
  startCursorPoll()
  startFullscreenMonitor()
  createTray()
  registerTaskbarCreatedListener(refreshTray)

  // Register global shortcut to toggle panel
  registerGlobalHotkey()
  registerIpc()
  registerPanelStateIpc()
  registerPanelDragIpc()
  registerSendListeners()
  initState()
  registerMacLockScreenHooks()
  prewarmDragIcons()

  // Reflect settings immediately.
  let settings = loadSettings()
  const hiddenLaunch = shouldStartHidden()
  if (hiddenLaunch) {
    console.log('[Main] Login launch detected (--hidden / wasOpenedAtLogin) — starting silently in tray')
  }
  if (!settings.tutorialCompleted && !hiddenLaunch) {
    // When onboarding is active (initial launch or reset tutorial), reset language to system default so onboarding always begins in System Default
    if (settings.language !== 'system') {
      settings = saveSettings({ language: 'system' })
    }
    setTimeout(() => {
      createOnboardingWindow()
    }, 2000)
  }
  setHotZoneWidth(settings.hotZoneWidth || 3)

  void reconcileLaunchAtLoginOnStartup().then((reconciled) => {
    pushState.settings(reconciled)
  }).catch((err) => {
    console.error('[Main] Failed to reconcile launch-at-login with Windows:', err)
  })
  registerIncognitoApplier((v) => getWatcher().setPaused(v))
  getWatcher().setPaused(settings.incognito)
  pushState.settings(settings)
  initAutoUpdater()
  if (process.platform === 'darwin') startScreenshotWatcher(addScreenshotToHistory, () => loadSettings().captureScreenshots !== false)
  if (process.platform === 'darwin') setImageAddedListener(wakeImageTextRecognition)
  if (process.platform === 'darwin') {
    if (app.isPackaged && app.isInApplicationsFolder()) {
      try {
        app.setAsDefaultProtocolClient(URL_SCHEME)
      } catch (err) {
        console.error('[Main] Failed to register the edgedrop:// URL scheme:', err)
      }
    }
    const contents = getMainWindow()?.webContents
    if (contents && !contents.isDestroyed() && contents.isLoadingMainFrame()) contents.once('did-finish-load', markUrlCommandsReady)
    else markUrlCommandsReady()
  }

  // Keep the tray checkmarks in sync after settings change from the UI.
  // (Tray menu is rebuilt on each open, so no extra wiring is needed here.)
})

app.on('window-all-closed', () => {
  // Never quit automatically when panel hides/closes; lifecycle is managed by tray.
})

app.on('activate', () => {
  if (smokeTestRun) return
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
    return
  }
  if (process.platform === 'darwin') openPanelFromShell()
})

function canServeLocalPath(filePath: string): boolean {
  if (process.platform !== 'darwin') return true
  return isServableLocalPath(filePath, {
    itemPaths: collectItemFilePaths(getStore().list()),
    roots: [PATHS.imagesDir(), PATHS.thumbnailsDir(), PATHS.tempDir(), getUnpackagedTempDir()]
  })
}

// ---- image protocol handler ------------------------------------------------
function registerImageProtocol(): void {
  protocol.handle(APP_CONFIG.imageProtocol, async (request) => {
    try {
      if (request.url.startsWith(`${APP_CONFIG.imageProtocol}://emoji/`)) {
        const fileName = decodeURIComponent(request.url.slice(`${APP_CONFIG.imageProtocol}://emoji/`.length).split('?')[0] ?? '')
        const dir = emojiAssetDir({
          packaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
          cwd: process.cwd()
        })
        const filePath = resolveEmojiAsset(dir, fileName)
        if (!filePath) return new Response('Not found', { status: 404 })
        const stream = createReadStream(filePath)
        const body = new Response(stream as unknown as ReadableStream<Uint8Array>).body
        return new Response(body, {
          status: 200,
          headers: new Headers({
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=31536000, immutable'
          })
        })
      }

      // List cards request bounded raster thumbnails.  Do not hand an original
      // multi-megapixel file to Chromium merely to paint a 50–240px card.
      if (request.url.startsWith(`${APP_CONFIG.imageProtocol}://thumb/`)) {
        const rawTarget = request.url.slice(`${APP_CONFIG.imageProtocol}://thumb/`.length)
        const isFileThumb = rawTarget.startsWith('file/')
        const filePath = isFileThumb
          ? normalize(decodeURIComponent(rawTarget.slice('file/'.length)))
          : resolveStoredImage(PATHS.imagesDir(), rawTarget)?.filePath

        if (isFileThumb && filePath && !canServeLocalPath(filePath)) return new Response('Forbidden', { status: 403 })
        if (!filePath || !existsSync(filePath)) return new Response('Not found', { status: 404 })
        return createThumbnailResponse(filePath, !isFileThumb, request)
      }

      // Support streaming full-resolution local image files: edgelocal://file/<encodedPath>
      if (request.url.startsWith(`${APP_CONFIG.imageProtocol}://file/`)) {
        const rawPath = request.url.slice(`${APP_CONFIG.imageProtocol}://file/`.length)
        const filePath = normalize(decodeURIComponent(rawPath))
        if (!canServeLocalPath(filePath)) return new Response('Forbidden', { status: 403 })
        if (existsSync(filePath)) {
          if (isMacHeicPath(filePath)) {
            const png = await getHeicPreviewPng(filePath)
            if (!png) return new Response('Unsupported image', { status: 415 })
            return new Response(new Uint8Array(png), {
              status: 200,
              headers: new Headers({
                'Content-Type': 'image/png',
                'Cache-Control': 'max-age=3600'
              })
            })
          }
          const ext = extname(filePath).toLowerCase()
          let contentType = 'image/png'
          if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg'
          else if (ext === '.gif') contentType = 'image/gif'
          else if (ext === '.webp') contentType = 'image/webp'
          else if (ext === '.svg') contentType = 'image/svg+xml'
          else if (ext === '.bmp') contentType = 'image/bmp'
          else if (ext === '.avif') contentType = 'image/avif'

          const stream = createReadStream(filePath)
          const body = new Response(stream as unknown as ReadableStream<Uint8Array>).body
          return new Response(body, {
            status: 200,
            headers: new Headers({
              'Content-Type': contentType,
              'Cache-Control': 'max-age=3600'
            })
          })
        }
        return new Response('Not found', { status: 404 })
      }

      const imageId = new URL(request.url).hostname
      if (!/^[a-z0-9-]+$/i.test(imageId)) {
        return new Response('Forbidden', { status: 403 })
      }

      const storedImage = resolveStoredImage(PATHS.imagesDir(), imageId)
      if (!storedImage) {
        return new Response('Not found', { status: 404 })
      }

      const stream = createReadStream(storedImage.filePath)
      const body = new Response(stream as unknown as ReadableStream<Uint8Array>).body
      const headers = new Headers({
        'Content-Type': storedImage.contentType,
        'Cache-Control': 'no-cache',
        'ETag': `"${createHash('sha256').update(storedImage.filePath).digest('hex')}"`
      })
      return new Response(body, { status: 200, headers })
    } catch {
      return new Response('Error', { status: 500 })
    }
  })
}

/**
 * Serve a bounded thumbnail with proper HTTP caching: long immutable freshness
 * for content-addressed captures, short freshness + ETag/304 for external
 * files. Payloads come from the LRU thumbnail engine so repeated requests do
 * zero decode work in the main process.
 */
async function createThumbnailResponse(filePath: string, isStoredCapture: boolean, request?: Request): Promise<Response> {
  const ext = extname(filePath).toLowerCase()
  // SVG files are vector XML documents; stream them directly with correct MIME type
  // rather than failing inside nativeImage.createFromPath (which only supports raster bitmaps).
  if (ext === '.svg') {
    const stream = createReadStream(filePath)
    const body = new Response(stream as unknown as ReadableStream<Uint8Array>).body
    return new Response(body, {
      status: 200,
      headers: new Headers({
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-cache'
      })
    })
  }

  const payload = await getThumbnailPayloadAsync(filePath)
  if (!payload) return new Response('Unsupported image', { status: 415 })

  const headers = new Headers({
    'Content-Type': payload.contentType,
    'Cache-Control': thumbnailCacheControl(isStoredCapture),
    'ETag': payload.etag
  })

  const inm = request?.headers.get('if-none-match')
  if (inm && inm === payload.etag) {
    return new Response(null, { status: 304, headers })
  }

  return new Response(new Uint8Array(payload.body), { status: 200, headers })
}

// Silence unused import in environments where setVisible isn't referenced
// after the refactor (kept for second-instance wiring above).
void setInteractive

let _lastHotkeyToggleTime = 0
let _registeredToggleHotkey: string | null = null

export function onToggleHotkey(): void {
  if (runtime.quitting) return
  const now = Date.now()
  if (now - _lastHotkeyToggleTime < 500) return
  _lastHotkeyToggleTime = now
  markExplicitOpen()
  pushState.togglePanel(undefined, { source: 'hotkey' })
}

export function registerGlobalHotkey(targetHotkey?: string): boolean {
  try {
    const { globalShortcut } = require('electron')
    const settings = loadSettings()
    const fallback = defaultToggleHotkey(process.platform === 'darwin')
    const hotkey = targetHotkey || settings.toggleHotkey || fallback
    if (process.platform === 'darwin') {
      for (const accelerator of new Set([_registeredToggleHotkey, hotkey])) {
        if (!accelerator) continue
        try {
          if (globalShortcut.isRegistered(accelerator)) globalShortcut.unregister(accelerator)
        } catch { /* ignore */ }
      }
    } else {
      globalShortcut.unregisterAll()
    }
    _registeredToggleHotkey = null

    const success = globalShortcut.register(hotkey, onToggleHotkey)
    if (success) _registeredToggleHotkey = hotkey

    console.log(`[Main] global hotkey ${hotkey} registered=${success}`)
    if (!success && hotkey !== fallback) {
      console.warn(`[Main] Failed to register global shortcut ${hotkey}, falling back to ${fallback}`)
      try {
        if (globalShortcut.isRegistered(fallback)) globalShortcut.unregister(fallback)
      } catch { /* ignore */ }
      if (globalShortcut.register(fallback, onToggleHotkey)) _registeredToggleHotkey = fallback
      syncMacEscapeCapture()
      return false
    }
    syncMacEscapeCapture()
    return success
  } catch (err) {
    console.error('[Main] Failed to register global shortcut:', err)
    return false
  }
}
