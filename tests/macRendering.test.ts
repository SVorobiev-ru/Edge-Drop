import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')

describe('rendering on macOS', () => {
  it('puts the system face first and keeps the default font smoothing', () => {
    const darwin = read('src/styles/darwin.css')
    expect(darwin).toContain("--font-ui: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Plus Jakarta Sans', 'Segoe UI', sans-serif;")
    expect(darwin).not.toContain('font-smoothing')
    expect(read('src/styles/tokens.css')).toContain("--font-ui: 'Plus Jakarta Sans', 'Segoe UI', sans-serif;")
  })
})

describe('narrow header', () => {
  it('lets the filter track shrink below its natural width', () => {
    const header = read('src/components/Header.tsx')
    expect(header).toContain("gridTemplate: '1fr / minmax(0, 1fr)'")
    expect(header).toContain('className="header-filters"')
    expect(header).toContain("'--filter-slots': FILTERS.length")
    const panel = read('src/styles/panel.css')
    expect(panel).toContain('width: calc(var(--rs-min) * var(--filter-slots) + var(--rs-inset) * 2 + 2px);')
  })
})
