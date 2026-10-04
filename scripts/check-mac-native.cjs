const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const SUPPORTED = ['arm64', 'x64']

const NATIVE = [
  { owner: 'koffi', scope: '@koromix', prefix: 'koffi-darwin-' },
  { owner: '@resvg/resvg-js', scope: '@resvg', prefix: 'resvg-js-darwin-' }
]

function ownerVersion(owner) {
  const file = join(root, 'node_modules', owner, 'package.json')
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')).version
}

const archs = process.argv.slice(2)
if (archs.length === 0 || archs.some((arch) => !SUPPORTED.includes(arch))) {
  console.error(`Usage: node scripts/check-mac-native.cjs <${SUPPORTED.join('|')}>...`)
  process.exit(2)
}

const missing = []
for (const arch of archs) {
  for (const { owner, scope, prefix } of NATIVE) {
    const version = ownerVersion(owner)
    if (!version) {
      console.error(`${owner} is not installed. Run "npm install" first.`)
      process.exit(1)
    }
    const name = `${scope}/${prefix}${arch}`
    if (!existsSync(join(root, 'node_modules', name, 'package.json'))) {
      missing.push(`${name}@${version}`)
    }
  }
}

if (missing.length > 0) {
  console.error('Native modules for the requested macOS architecture are not installed:')
  for (const spec of missing) console.error(`  ${spec}`)
  console.error('')
  console.error('npm only installs the binaries of the host architecture. Add the missing ones without touching package.json or the lock file:')
  console.error(`  npm install --no-save --force ${missing.join(' ')}`)
  console.error('')
  console.error('A later "npm install" or "npm ci" removes them again.')
  process.exit(1)
}
