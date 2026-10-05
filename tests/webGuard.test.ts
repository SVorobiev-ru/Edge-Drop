import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn()
}))

vi.mock('electron', () => ({
  shell: { openExternal: (...args: unknown[]) => mocks.openExternal(...args) }
}))

import { installMacWebGuards, isAllowedExternalUrl, isSameDocumentNavigation, openExternalIfAllowed } from '../electron/main/webGuard'

function fakeContents(url: string) {
  const handlers: Record<string, (...args: any[]) => void> = {}
  let openHandler: ((details: { url: string }) => { action: string }) | null = null
  return {
    contents: {
      setWindowOpenHandler: (fn: (details: { url: string }) => { action: string }) => {
        openHandler = fn
      },
      on: (event: string, fn: (...args: any[]) => void) => {
        handlers[event] = fn
      },
      getURL: () => url
    } as unknown as Electron.WebContents,
    open: (target: string) => openHandler?.({ url: target }),
    navigate: (target: string) => {
      const event = { preventDefault: vi.fn() }
      handlers['will-navigate']?.(event, target)
      return event.preventDefault.mock.calls.length > 0
    },
    hasOpenHandler: () => openHandler !== null,
    hasNavigateHandler: () => 'will-navigate' in handlers
  }
}

beforeEach(() => {
  mocks.openExternal.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  restorePlatform()
})

afterAll(() => {
  restorePlatform()
})

describe('external URL allow-list', () => {
  it.each([
    'https://github.com/SVorobiev-ru/Edge-Drop/releases',
    'HTTPS://example.com/a?b=c#d',
    'mailto:someone@example.com'
  ])('allows %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true)
  })

  it.each([
    'http://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ms-windows-store://review/?ProductId=9P3JMHN9M4NR',
    'x-apple.systempreferences:com.apple.preference.security',
    'smb://server/share',
    'edgelocal://file/%2Fetc%2Fpasswd',
    'data:text/html,<script>1</script>',
    '/Applications/Calculator.app',
    'not a url',
    ''
  ])('rejects %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false)
  })

  it('rejects values that are not strings', () => {
    expect(isAllowedExternalUrl(undefined)).toBe(false)
    expect(isAllowedExternalUrl({ toString: () => 'https://example.com' })).toBe(false)
  })

  it('opens only allowed URLs', () => {
    expect(openExternalIfAllowed('https://example.com/')).toBe(true)
    expect(openExternalIfAllowed('file:///Applications/Calculator.app')).toBe(false)
    expect(mocks.openExternal.mock.calls).toEqual([['https://example.com/']])
  })
})

describe('navigation guard', () => {
  const page = 'file:///Applications/Edge-Drop.app/Contents/Resources/app.asar/out/renderer/index.html'

  it('allows a reload and a hash change of the loaded document', () => {
    expect(isSameDocumentNavigation(page, page)).toBe(true)
    expect(isSameDocumentNavigation(`${page}#onboarding`, `${page}#/other`)).toBe(true)
    expect(isSameDocumentNavigation('http://localhost:5173/', 'http://localhost:5173/#/onboarding')).toBe(true)
  })

  it('rejects any other document', () => {
    expect(isSameDocumentNavigation(page, 'https://example.com/')).toBe(false)
    expect(isSameDocumentNavigation(page, 'file:///etc/passwd')).toBe(false)
    expect(isSameDocumentNavigation('http://localhost:5173/', 'http://localhost:5174/')).toBe(false)
    expect(isSameDocumentNavigation(page, 'garbage')).toBe(false)
    expect(isSameDocumentNavigation('', '')).toBe(false)
  })
})

describe('installMacWebGuards', () => {
  it('denies every new window and forwards only allowed links on macOS', () => {
    setPlatform('darwin')
    const page = fakeContents('file:///app/out/renderer/index.html')
    installMacWebGuards(page.contents)

    expect(page.open('https://example.com/')).toEqual({ action: 'deny' })
    expect(page.open('http://example.com/')).toEqual({ action: 'deny' })
    expect(page.open('file:///etc/passwd')).toEqual({ action: 'deny' })
    expect(mocks.openExternal.mock.calls).toEqual([['https://example.com/']])
  })

  it('blocks navigation away from the loaded document on macOS', () => {
    setPlatform('darwin')
    const page = fakeContents('file:///app/out/renderer/index.html#onboarding')
    installMacWebGuards(page.contents)

    expect(page.navigate('https://example.com/')).toBe(true)
    expect(page.navigate('file:///app/out/renderer/index.html')).toBe(false)
  })

  it('installs nothing on Windows', () => {
    setPlatform('win32')
    const page = fakeContents('file:///C:/app/out/renderer/index.html')
    installMacWebGuards(page.contents)

    expect(page.hasOpenHandler()).toBe(false)
    expect(page.hasNavigateHandler()).toBe(false)
  })
})
