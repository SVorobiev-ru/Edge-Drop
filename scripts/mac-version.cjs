const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
  console.error(`package.json version "${pkg.version}" is not a plain X.Y.Z version`)
  process.exit(1)
}
if (!Number.isInteger(pkg.macRevision) || pkg.macRevision < 1) {
  console.error(`package.json macRevision "${pkg.macRevision}" is not a positive integer`)
  process.exit(1)
}

console.log(`${pkg.version}-mac.${pkg.macRevision}`)
