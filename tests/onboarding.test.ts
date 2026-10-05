import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Element = { type: unknown; props: Record<string, any> }

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }))

const store = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  patchSettings: vi.fn(),
  hydrate: vi.fn(),
  setSettings: vi.fn(),
  setLaunchAtLogin: vi.fn()
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: () => {},
    useState: <T,>(initial: T) => {
      const index = hooks.cursor++
      if (!(index in hooks.states)) hooks.states[index] = initial
      return [hooks.states[index], (next: T) => {
        hooks.states[index] = next
      }]
    }
  }
})

vi.mock('framer-motion', () => ({
  motion: { div: 'div' },
  AnimatePresence: ({ children }: { children: unknown }) => children
}))

vi.mock('../src/components/Settings', () => ({ Settings: () => null }))
vi.mock('../src/hooks/useSystemDark', () => ({ useSystemDark: () => false }))
vi.mock('../src/lib/theme', () => ({ applyTheme: vi.fn(), resolveTheme: vi.fn() }))

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key)
  })
}))

vi.mock('../src/store/appStore', () => ({
  useStore: Object.assign((select: (state: typeof store) => unknown) => select(store), { getState: () => store })
}))

let close: ReturnType<typeof vi.fn>
let Onboarding: () => unknown

async function load(platform: string, settings: Record<string, unknown> = {}): Promise<void> {
  vi.resetModules()
  close = vi.fn()
  vi.stubGlobal('window', { edge: { platform }, close })
  store.settings = settings
  hooks.states = []
  ;({ Onboarding } = await import('../src/Onboarding'))
}

function render(): Element {
  hooks.cursor = 0
  return Onboarding() as Element
}

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as Element
  return [element, ...elements(element.props.children)]
}

function title(): string {
  return elements(render()).find((el) => el.type === 'h1')!.props.children
}

function button(label: string): Element {
  return elements(render()).find((el) => el.type === 'button' && el.props.children === label)!
}

function slideTitles(): string[] {
  const titles = [title()]
  while (button('onboarding.getStarted') === undefined) {
    button('onboarding.next').props.onClick()
    titles.push(title())
  }
  return titles
}

function listItems(): string[] {
  return elements(render()).filter((el) => el.type === 'li').map((el) => el.props.children)
}

beforeEach(() => {
  for (const fn of [store.patchSettings, store.hydrate, store.setSettings, store.setLaunchAtLogin]) fn.mockReset()
  store.patchSettings.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('onboarding slides', () => {
  it('shows the permissions slide second on mac', async () => {
    await load('darwin')
    expect(slideTitles().slice(0, 3)).toEqual(['onboarding.welcomeTitle', 'onboarding.permissionsTitle', 'onboarding.collectTitle'])
  })

  it('has no permissions slide elsewhere', async () => {
    await load('win32')
    const titles = slideTitles()
    expect(titles.slice(0, 2)).toEqual(['onboarding.welcomeTitle', 'onboarding.collectTitle'])
    expect(titles).not.toContain('onboarding.permissionsTitle')
  })

  it('skip lands on the permissions slide first on mac and finishes from there', async () => {
    await load('darwin')
    await button('onboarding.skip').props.onClick()
    expect(title()).toBe('onboarding.permissionsTitle')
    expect(store.patchSettings).not.toHaveBeenCalled()

    await button('onboarding.skip').props.onClick()
    expect(store.patchSettings).toHaveBeenCalledWith({ tutorialCompleted: true })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('skip finishes at once elsewhere', async () => {
    await load('win32')
    await button('onboarding.skip').props.onClick()
    expect(store.patchSettings).toHaveBeenCalledWith({ tutorialCompleted: true })
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('onboarding permissions slide', () => {
  it('turns launch at login on through the store', async () => {
    await load('darwin')
    button('onboarding.next').props.onClick()
    expect(title()).toBe('onboarding.permissionsTitle')
    const toggle = elements(render()).find((el) => el.props.labelledBy === 'onboarding-launch-at-login')!
    toggle.props.onChange(true)
    expect(store.setLaunchAtLogin).toHaveBeenCalledTimes(1)
    expect(store.setLaunchAtLogin).toHaveBeenCalledWith(true)
  })
})

describe('onboarding last slide', () => {
  it('fills the mac shortcut and adds the menu bar tip on mac', async () => {
    await load('darwin')
    slideTitles()
    const items = listItems()
    expect(items[0]).toBe('onboarding.proTip1 {"shortcut":"Command+Shift+V"}')
    expect(items).toContain('onboarding.menuBarTip')
  })

  it('uses the saved shortcut and leaves the menu bar tip out elsewhere', async () => {
    await load('win32', { toggleHotkey: 'Alt+C' })
    slideTitles()
    const items = listItems()
    expect(items[0]).toBe('onboarding.proTip1 {"shortcut":"Alt+C"}')
    expect(items).not.toContain('onboarding.menuBarTip')
  })

  it.each([
    ['darwin', "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Plus Jakarta Sans', sans-serif"],
    ['win32', 'Plus Jakarta Sans, Segoe UI, sans-serif']
  ])('uses the platform font stack on %s', async (platform, font) => {
    await load(platform)
    expect(render().props.style.fontFamily).toBe(font)
  })
})
