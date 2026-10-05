const { existsSync } = require('node:fs')
const { join } = require('node:path')

const ALLOWED_TOP_LEVEL = ['node_modules', 'out', 'package.json', 'resources']
const FORBIDDEN_MODULES = ['electron-updater', 'builder-util-runtime']

function topLevelEntries(files) {
  const entries = new Set()
  for (const file of files) {
    const name = file.split(/[\\/]/).filter(Boolean)[0]
    if (name) entries.add(name)
  }
  return [...entries].sort()
}

function checkAsarEntries(files) {
  const problems = []
  for (const entry of topLevelEntries(files)) {
    if (!ALLOWED_TOP_LEVEL.includes(entry)) problems.push(`unexpected top-level entry: ${entry}`)
  }
  for (const name of FORBIDDEN_MODULES) {
    const marker = `/node_modules/${name}/`
    if (files.some((file) => `${file.replace(/\\/g, '/')}/`.includes(marker))) {
      problems.push(`module must not be packed on macOS: ${name}`)
    }
  }
  for (const required of ['out', 'package.json', 'resources']) {
    if (!topLevelEntries(files).includes(required)) problems.push(`missing top-level entry: ${required}`)
  }
  return problems
}

module.exports = { ALLOWED_TOP_LEVEL, topLevelEntries, checkAsarEntries }

if (require.main === module) {
  const target = process.argv[2]
  if (!target) {
    console.error('Usage: node scripts/check-mac-asar.cjs <Edge-Drop.app | app.asar>')
    process.exit(2)
  }
  const asarPath = target.endsWith('.asar') ? target : join(target, 'Contents', 'Resources', 'app.asar')
  if (!existsSync(asarPath)) {
    console.error(`${asarPath} is missing`)
    process.exit(1)
  }
  const { listPackage } = require('@electron/asar')
  const files = listPackage(asarPath, { isPack: false })
  const problems = checkAsarEntries(files)
  console.log(`app.asar top level: ${topLevelEntries(files).join(', ')}`)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL: ${problem}`)
    process.exit(1)
  }
}
