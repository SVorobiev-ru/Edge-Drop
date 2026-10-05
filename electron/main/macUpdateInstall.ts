import { app, net } from 'electron'
import { accessSync, closeSync, constants, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export const MAC_UPDATE_CHECKSUM_ASSET = 'SHA256SUMS.txt'
const MAC_UPDATE_MAX_ZIP_BYTES = 600 * 1024 * 1024
const MAC_UPDATE_MAX_CHECKSUM_BYTES = 64 * 1024
const MAC_UPDATE_ARCHES = ['arm64', 'x64']
const MAC_UPDATE_VERSION = /^\d+\.\d+\.\d+-mac\.\d+$/
const IDLE_TIMEOUT_MS = 30_000
const COMMAND_TIMEOUT_MS = 120_000
const LAUNCH_WAIT_SECONDS = 60
const EXIT_WAIT_SECONDS = 60

export interface MacUpdateAsset {
  name: string
  url: string
  size: number
}

export interface MacUpdateAssets {
  zip: MacUpdateAsset
  checksums: MacUpdateAsset
}

export interface MacUpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface PreparedMacUpdate {
  version: string
  target: string
  appPath: string
  workDir: string
}

export type MacSignatureKind = 'adhoc' | 'certificate'

export interface MacInstallScriptInput {
  pid: number
  target: string
  source: string
  stage: string
  backup: string
  workDir: string
  log: string
}

const unfinishedWorkDirs = new Set<string>()

export function removeUnfinishedMacUpdateDirs(): void {
  for (const dir of unfinishedWorkDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  unfinishedWorkDirs.clear()
}

export function macUpdateZipName(version: string, arch: string): string {
  return `Edge-Drop-${version}-mac-${arch}.zip`
}

function trustedAssetUrl(url: unknown, repo: string, name: string): string | null {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return null
    if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) return null
    const prefix = `/${repo}/releases/download/`
    if (!parsed.pathname.startsWith(prefix)) return null
    const rest = parsed.pathname.slice(prefix.length).split('/')
    if (rest.length !== 2 || !rest[0] || decodeURIComponent(rest[1]) !== name) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function findAsset(assets: readonly unknown[], name: string, repo: string, maxBytes: number): MacUpdateAsset | null {
  for (const entry of assets) {
    if (!entry || typeof entry !== 'object') continue
    const asset = entry as { name?: unknown; browser_download_url?: unknown; size?: unknown }
    if (asset.name !== name) continue
    const url = trustedAssetUrl(asset.browser_download_url, repo, name)
    const size = asset.size
    if (!url || typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > maxBytes) return null
    return { name, url, size }
  }
  return null
}

export function selectMacUpdateAssets(assets: unknown, version: string, arch: string, repo: string): MacUpdateAssets | null {
  if (!Array.isArray(assets) || !MAC_UPDATE_VERSION.test(version) || !MAC_UPDATE_ARCHES.includes(arch)) return null
  const zip = findAsset(assets, macUpdateZipName(version, arch), repo, MAC_UPDATE_MAX_ZIP_BYTES)
  const checksums = findAsset(assets, MAC_UPDATE_CHECKSUM_ASSET, repo, MAC_UPDATE_MAX_CHECKSUM_BYTES)
  return zip && checksums ? { zip, checksums } : null
}

export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  const conflicts = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64}) [ *]([^/\\]+)$/.exec(raw.trim())
    if (!match) continue
    const hash = match[1].toLowerCase()
    const name = match[2]
    const known = sums.get(name)
    if (known !== undefined && known !== hash) conflicts.add(name)
    sums.set(name, hash)
  }
  for (const name of conflicts) sums.delete(name)
  return sums
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildMacInstallScript(input: MacInstallScriptInput): string {
  if (!Number.isInteger(input.pid) || input.pid <= 0) throw new Error('invalid pid')
  return [
    '#!/bin/sh',
    `PID=${input.pid}`,
    `TARGET=${shellQuote(input.target)}`,
    `SOURCE=${shellQuote(input.source)}`,
    `STAGE=${shellQuote(input.stage)}`,
    `BACKUP=${shellQuote(input.backup)}`,
    `WORK=${shellQuote(input.workDir)}`,
    `LOG=${shellQuote(input.log)}`,
    'exec >>"$LOG" 2>&1',
    'echo "$(date) update: start"',
    'restore() {',
    '  echo "$(date) update: $1, restoring"',
    '  /bin/rm -rf "$STAGE"',
    '  if [ -d "$BACKUP" ]; then',
    '    /bin/rm -rf "$TARGET"',
    '    /bin/mv "$BACKUP" "$TARGET"',
    '  fi',
    '  /usr/bin/open "$TARGET"',
    '  /bin/rm -rf "$WORK"',
    '  exit 1',
    '}',
    'running() {',
    '  /bin/ps -axo command= | /usr/bin/grep -F -- "$TARGET/Contents/MacOS/" | /usr/bin/grep -v -F -- "/usr/bin/grep" >/dev/null',
    '}',
    'i=0',
    'while /bin/kill -0 "$PID" 2>/dev/null; do',
    '  i=$((i + 1))',
    `  if [ "$i" -gt ${EXIT_WAIT_SECONDS * 10} ]; then echo "$(date) update: app did not exit"; /bin/rm -rf "$WORK"; exit 1; fi`,
    '  /bin/sleep 0.1',
    'done',
    '/bin/rm -rf "$STAGE" "$BACKUP"',
    '/usr/bin/ditto "$SOURCE" "$STAGE" || restore "copy failed"',
    '/usr/bin/xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null',
    '/bin/mv "$TARGET" "$BACKUP" || restore "backup failed"',
    '/bin/mv "$STAGE" "$TARGET" || restore "swap failed"',
    '/usr/bin/open "$TARGET" || restore "launch failed"',
    'i=0',
    'until running; do',
    '  i=$((i + 1))',
    `  if [ "$i" -gt ${LAUNCH_WAIT_SECONDS * 2} ]; then echo "$(date) update: new version not seen running after ${LAUNCH_WAIT_SECONDS}s, keeping it, old copy left at $BACKUP"; /bin/rm -rf "$WORK"; exit 1; fi`,
    '  /bin/sleep 0.5',
    'done',
    '/bin/rm -rf "$BACKUP" "$WORK"',
    'echo "$(date) update: done"',
    ''
  ].join('\n')
}

export function currentAppBundle(exePath: string = app.getPath('exe')): string | null {
  const bundle = resolve(exePath, '..', '..', '..')
  return bundle.endsWith('.app') && basename(dirname(exePath)) === 'MacOS' ? bundle : null
}

function canReplaceBundle(bundle: string): boolean {
  try {
    accessSync(dirname(bundle), constants.W_OK)
    accessSync(bundle, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function runCommand(file: string, args: string[], withStderr = false): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${basename(file)} failed: ${String(stderr || err.message).trim()}`))
      else resolvePromise(withStderr ? `${String(stdout ?? '')}\n${String(stderr ?? '')}` : String(stdout ?? ''))
    })
  })
}

export function macSignatureKind(details: string): MacSignatureKind | null {
  if (/^Signature=adhoc$/m.test(details)) return 'adhoc'
  const team = /^TeamIdentifier=(.+)$/m.exec(details)?.[1]?.trim()
  if (/^Authority=.+$/m.test(details) || (team && team !== 'not set')) return 'certificate'
  return null
}

export function parseDesignatedRequirement(output: string): string | null {
  const match = /^(?:#\s*)?designated => (.+)$/m.exec(output)
  const requirement = match?.[1]?.trim()
  return requirement ? requirement : null
}

export async function verifyMacUpdateSignature(target: string, appPath: string): Promise<MacSignatureKind> {
  await runCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
  const kind = macSignatureKind(await runCommand('/usr/bin/codesign', ['-dv', '--verbose=2', target], true))
  if (!kind) throw new Error('cannot read the signature of the running app')
  if (kind === 'adhoc') return kind
  const requirement = parseDesignatedRequirement(await runCommand('/usr/bin/codesign', ['-d', '-r-', target], true))
  if (!requirement) throw new Error('the running app has no designated requirement')
  try {
    await runCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=${requirement}`, appPath])
  } catch (err) {
    throw new Error(`the update is not signed like the running app: ${err instanceof Error ? err.message : String(err)}`)
  }
  return kind
}

async function bundleIdentifier(bundle: string): Promise<string> {
  const out = await runCommand('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(bundle, 'Contents', 'Info.plist')])
  return out.trim()
}

function fetchToSink(url: string, maxBytes: number, onChunk: (chunk: Buffer, total: number) => void): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    let settled = false
    let received = 0
    const request = net.request({ method: 'GET', url, redirect: 'follow' })
    let idle: ReturnType<typeof setTimeout> | null = null
    const finish = (err: Error | null): void => {
      if (settled) return
      settled = true
      if (idle) clearTimeout(idle)
      if (err) {
        try { request.abort() } catch { /* ignore */ }
        reject(err)
      } else {
        resolvePromise(received)
      }
    }
    const armIdle = (): void => {
      if (idle) clearTimeout(idle)
      idle = setTimeout(() => finish(new Error('download stalled')), IDLE_TIMEOUT_MS)
    }
    request.setHeader('User-Agent', 'Edge-Drop-App')
    request.setHeader('Accept', 'application/octet-stream')
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        finish(new Error(`HTTP ${response.statusCode}`))
        return
      }
      const header = response.headers['content-length']
      const total = Number(Array.isArray(header) ? header[0] : header) || maxBytes
      if (total > maxBytes) {
        finish(new Error('download is larger than expected'))
        return
      }
      armIdle()
      response.on('data', (chunk: Buffer) => {
        if (settled) return
        received += chunk.length
        if (received > maxBytes) {
          finish(new Error('download is larger than expected'))
          return
        }
        try {
          onChunk(chunk, total)
        } catch (err) {
          finish(err instanceof Error ? err : new Error(String(err)))
          return
        }
        armIdle()
      })
      response.on('end', () => finish(null))
      response.on('error', (err: Error) => finish(err))
      response.on('aborted', () => finish(new Error('download aborted')))
    })
    request.on('error', (err) => finish(err))
    armIdle()
    request.end()
  })
}

async function fetchText(asset: MacUpdateAsset): Promise<string> {
  const chunks: Buffer[] = []
  await fetchToSink(asset.url, asset.size, (chunk) => {
    chunks.push(chunk)
  })
  return Buffer.concat(chunks).toString('utf8')
}

async function downloadFile(asset: MacUpdateAsset, file: string, onProgress: (p: MacUpdateProgress) => void): Promise<string> {
  const hash = createHash('sha256')
  const fd = openSync(file, 'w', 0o600)
  const started = Date.now()
  let transferred = 0
  let lastPercent = -1
  try {
    const received = await fetchToSink(asset.url, asset.size, (chunk) => {
      writeSync(fd, chunk)
      hash.update(chunk)
      transferred += chunk.length
      const percent = Math.min(100, Math.floor((transferred / asset.size) * 100))
      if (percent === lastPercent) return
      lastPercent = percent
      const seconds = Math.max(0.001, (Date.now() - started) / 1000)
      onProgress({ percent, bytesPerSecond: Math.round(transferred / seconds), transferred, total: asset.size })
    })
    if (received !== asset.size) throw new Error(`size mismatch: ${received} of ${asset.size}`)
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

export async function prepareMacUpdate(input: {
  version: string
  assets: unknown
  repo: string
  arch: string
  onProgress: (p: MacUpdateProgress) => void
}): Promise<PreparedMacUpdate> {
  if (!app.isPackaged) throw new Error('not a packaged app')
  const target = currentAppBundle()
  if (!target) throw new Error('app bundle not found')
  if (!canReplaceBundle(target)) throw new Error(`app bundle is not writable: ${target}`)
  const assets = selectMacUpdateAssets(input.assets, input.version, input.arch, input.repo)
  if (!assets) throw new Error(`release ${input.version} has no ${input.arch} ZIP with checksums`)

  const workDir = mkdtempSync(join(tmpdir(), 'edge-drop-update-'))
  unfinishedWorkDirs.add(workDir)
  try {
    const expected = parseSha256Sums(await fetchText(assets.checksums)).get(assets.zip.name)
    if (!expected) throw new Error(`no checksum for ${assets.zip.name}`)
    const zipPath = join(workDir, assets.zip.name)
    const actual = await downloadFile(assets.zip, zipPath, input.onProgress)
    if (actual !== expected) throw new Error(`checksum mismatch for ${assets.zip.name}`)

    const extractDir = join(workDir, 'app')
    mkdirSync(extractDir)
    await runCommand('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir])
    rmSync(zipPath, { force: true })
    const bundles = readdirSync(extractDir).filter((name) => name.endsWith('.app'))
    if (bundles.length !== 1) throw new Error('the ZIP does not hold exactly one app')
    const appPath = join(extractDir, bundles[0])

    const [currentId, nextId] = await Promise.all([bundleIdentifier(target), bundleIdentifier(appPath)])
    if (!currentId || currentId !== nextId) throw new Error(`bundle identifier mismatch: ${nextId}`)
    await verifyMacUpdateSignature(target, appPath)
    return { version: input.version, target, appPath, workDir }
  } catch (err) {
    rmSync(workDir, { recursive: true, force: true })
    throw err
  } finally {
    unfinishedWorkDirs.delete(workDir)
  }
}

export function launchMacInstaller(prepared: PreparedMacUpdate): () => void {
  const parent = dirname(prepared.target)
  const name = basename(prepared.target)
  const tag = randomBytes(4).toString('hex')
  const script = join(prepared.workDir, 'install.sh')
  writeFileSync(script, buildMacInstallScript({
    pid: process.pid,
    target: prepared.target,
    source: prepared.appPath,
    stage: join(parent, `.${name}.update-${tag}`),
    backup: join(parent, `.${name}.backup-${tag}`),
    workDir: prepared.workDir,
    log: join(app.getPath('logs'), 'update.log')
  }), { mode: 0o700 })
  mkdirSync(app.getPath('logs'), { recursive: true })
  const child = spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' })
  child.unref()
  return () => {
    if (child.pid === undefined || child.exitCode !== null) return
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* ignore */ }
  }
}

export function discardPreparedMacUpdate(prepared: PreparedMacUpdate): void {
  rmSync(prepared.workDir, { recursive: true, force: true })
}
