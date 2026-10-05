const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const file = join(__dirname, '..', 'out', 'renderer', 'index.html')

function stripDevCsp(html) {
  return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/, (_all, head, policy, tail) => {
    const directives = policy.split(';').map((directive) => {
      const parts = directive.trim().split(/\s+/)
      if (parts[0] !== 'connect-src') return directive
      const kept = parts.filter((part) => part !== 'ws:' && part !== 'wss:')
      return `${directive.startsWith(' ') ? ' ' : ''}${kept.join(' ')}`
    })
    return `${head}${directives.join(';')}${tail}`
  })
}

module.exports = { stripDevCsp }

if (require.main === module) {
  if (!existsSync(file)) {
    console.error(`${file} is missing. Run "electron-vite build" first.`)
    process.exit(1)
  }
  const html = readFileSync(file, 'utf8')
  const next = stripDevCsp(html)
  if (/connect-src[^;"]*\bwss?:/.test(next) || !next.includes('Content-Security-Policy')) {
    console.error('Failed to remove the dev-only ws: source from the production CSP')
    process.exit(1)
  }
  if (next !== html) writeFileSync(file, next)
}
