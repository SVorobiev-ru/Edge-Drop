import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { displayedUpdateMode, visibleUpdateModes } from '../src/components/settings/updateMode'

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')

describe('mac update mode selector', () => {
  it('shows two modes on mac and three elsewhere', () => {
    expect(visibleUpdateModes(true)).toEqual(['notify', 'off'])
    expect(visibleUpdateModes(false)).toEqual(['auto', 'notify', 'off'])
  })

  it('shows a stored automatic mode as notify on mac only', () => {
    expect(displayedUpdateMode('auto', true)).toBe('notify')
    expect(displayedUpdateMode('notify', true)).toBe('notify')
    expect(displayedUpdateMode('off', true)).toBe('off')
    expect(displayedUpdateMode('auto', false)).toBe('auto')
  })
})

describe('settings source', () => {
  const src = read('src/components/Settings.tsx')

  it('no longer hardcodes placeholder versions', () => {
    expect(src).not.toMatch(/0\.3\.[12]/)
  })

  it('reads reduce motion through the store selector', () => {
    expect(src).toContain('useStore(selectReduceMotion)')
    expect(src).not.toContain('settings.reduceMotion ?')
  })

  it('labels toggles, sliders and segmented controls by the card title', () => {
    expect(read('src/components/settings/Toggle.tsx')).toContain('aria-labelledby={labelledBy}')
    const layout = read('src/components/settings/layout.tsx')
    expect(layout).toContain('labelledBy={titleId(id)}')
    expect(src).toContain('ariaLabelledBy={titleId(\'thickness\')}')
    expect(layout).toContain('role="group"\n      aria-labelledby={labelId}')
  })

  it('polls accessibility status while open and wires the grant flow', () => {
    const accessibilityCard = read('src/components/settings/AccessibilityCard.tsx')
    expect(accessibilityCard).toContain('window.setInterval(refresh, ACCESSIBILITY_POLL_MS)')
    expect(accessibilityCard).toMatch(/requestAccessibility\(\)[\s\S]*openAccessibilitySettings\(\)/)
  })

  it('lets native horizontal scrolling through on mac', () => {
    expect(src).toContain('if (IS_DARWIN && e.deltaX !== 0) return')
  })

  it('opens the shared support link from both layouts', () => {
    expect(src.split("window.open(SUPPORT_URL, '_blank')")).toHaveLength(3)
    expect(src).not.toContain('edgedrop.app/supportedgedrop')
  })
})

describe('support link url', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is the fork repository on mac and edgedrop.app elsewhere', async () => {
    vi.resetModules()
    vi.stubGlobal('window', { edge: { platform: 'darwin' } })
    expect((await import('../src/lib/links')).SUPPORT_URL).toBe('https://github.com/SVorobiev-ru/Edge-Drop')
    vi.resetModules()
    vi.stubGlobal('window', { edge: { platform: 'win32' } })
    expect((await import('../src/lib/links')).SUPPORT_URL).toBe('https://www.edgedrop.app/supportedgedrop')
  })
})
