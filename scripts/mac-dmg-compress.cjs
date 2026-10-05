const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const DIST = join(__dirname, '..', 'dist')
const FORMAT = 'ULMO'

function imageFormat(file) {
  const info = execFileSync('hdiutil', ['imageinfo', file], { encoding: 'utf8' })
  return (info.match(/^Format:\s*(\S+)/m) || [])[1] || ''
}

function updateManifest(manifest, name, file) {
  const sha512 = createHash('sha512').update(readFileSync(file)).digest('base64')
  const size = statSync(file).size
  const lines = manifest.split('\n')
  const start = lines.findIndex((line) => line.trim() === `- url: ${name}`)
  if (start === -1) return manifest
  for (let i = start + 1; i < lines.length && !lines[i].trim().startsWith('- url:') && /^\s/.test(lines[i]); i++) {
    lines[i] = lines[i].replace(/^(\s*sha512:\s*).*$/, `$1${sha512}`).replace(/^(\s*size:\s*).*$/, `$1${size}`)
  }
  return lines.join('\n')
}

function main() {
  if (process.platform !== 'darwin') {
    console.error('mac-dmg-compress.cjs runs on macOS only')
    process.exit(1)
  }
  const images = existsSync(DIST) ? readdirSync(DIST).filter((name) => name.endsWith('.dmg') && !name.includes('.tmp')) : []
  const manifestPath = join(DIST, 'latest-mac.yml')
  let manifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null
  for (const name of images) {
    const file = join(DIST, name)
    if (imageFormat(file) === FORMAT) continue
    const before = statSync(file).size
    const tmp = join(DIST, `${name}.${FORMAT}.tmp`)
    rmSync(tmp, { force: true })
    execFileSync('hdiutil', ['convert', file, '-format', FORMAT, '-o', tmp, '-quiet'], { stdio: 'inherit' })
    renameSync(existsSync(tmp) ? tmp : `${tmp}.dmg`, file)
    rmSync(`${file}.blockmap`, { force: true })
    if (manifest !== null) manifest = updateManifest(manifest, name, file)
    console.log(`${name}: ${before} -> ${statSync(file).size} bytes (${FORMAT})`)
  }
  if (manifest !== null) writeFileSync(manifestPath, manifest)
}

main()
