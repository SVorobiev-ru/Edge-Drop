import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/types'

const hooks = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: (fn: () => void | (() => void)) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') hooks.cleanups.push(cleanup)
    },
    useRef: <T,>(value: T) => ({ current: value })
  }
})

import { useStore } from '../src/store/appStore'
import { useEdgeHover, PANEL_ENTER_EVENT, resolvePanelWidth, panelZones } from '../src/hooks/useEdgeHover'
import { closeShelf } from '../src/lib/shelf'

type Listener = (...args: any[]) => void

let windowListeners: Record<string, Listener[]>
let cursorEdge: Listener
let rafEnabled: boolean
let edgeApi: Record<string, any>

const BLADE_BOX = { left: 0, top: 240, right: 270, bottom: 720, width: 270, height: 480 }

function install(platform: string): void {
  windowListeners = {}
  rafEnabled = true
  edgeApi = {
    platform,
    setInteractive: vi.fn(() => Promise.resolve()),
    setPreviewMode: vi.fn(),
    setPanelState: vi.fn(() => Promise.resolve()),
    focusWindow: vi.fn(() => Promise.resolve()),
    pauseHotkey: vi.fn(() => Promise.resolve()),
    onCursorEdge: (cb: Listener) => {
      cursorEdge = cb
      return () => {}
    }
  }
  ;(globalThis as any).window = {
    innerHeight: 957,
    innerWidth: 310,
    screen: { width: 1512, height: 982 },
    edge: edgeApi,
    addEventListener: (type: string, fn: Listener) => {
      ;(windowListeners[type] ||= []).push(fn)
    },
    removeEventListener: (type: string, fn: Listener) => {
      windowListeners[type] = (windowListeners[type] || []).filter((l) => l !== fn)
    },
    setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: any) => globalThis.clearTimeout(id),
    setInterval: (fn: () => void, ms?: number) => globalThis.setInterval(fn, ms),
    clearInterval: (id: any) => globalThis.clearInterval(id),
    requestAnimationFrame: (fn: (t: number) => void) => (rafEnabled ? globalThis.setTimeout(() => fn(Date.now()), 16) : 0),
    cancelAnimationFrame: (id: any) => globalThis.clearTimeout(id)
  }
  ;(globalThis as any).document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: (sel: string) => (sel === '.blade' ? { getBoundingClientRect: () => BLADE_BOX } : null),
    querySelectorAll: () => [],
    documentElement: { style: { setProperty: vi.fn() } }
  }
}

function emit(type: string): void {
  for (const fn of windowListeners[type] || []) fn(new Event(type))
}

function cursor(x: number, y = 478): void {
  cursorEdge({ x, y, inEdge: x <= 3, inZone: true, stickPosition: useStore.getState().settings.stickPosition, displayWidth: 1512, displayHeight: 982 })
}

function interactiveCalls(): boolean[] {
  return edgeApi.setInteractive.mock.calls.map((c: unknown[]) => c[0] as boolean)
}

function openNow(): void {
  useStore.getState().setOpen(true)
  edgeApi.setInteractive(true)
  edgeApi.setInteractive.mockClear()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  install('win32')
  useStore.setState({
    settings: { ...DEFAULT_SETTINGS },
    open: false,
    keyboardMode: false,
    previewItemId: null,
    styleFlyoutOpen: false,
    languageFlyoutOpen: false,
    sliderActive: false,
    sliderReleasedTime: 0,
    edgeTransition: null,
    dragActive: false,
    internalDragReq: null,
    itemMenuOpen: false
  } as any)
})

afterEach(() => {
  for (const cleanup of hooks.cleanups.splice(0)) cleanup()
  vi.useRealTimers()
})

describe('closing always releases the window (S1)', () => {
  it('still sends interactive=false when the cursor enters the blade during the close animation', () => {
    useEdgeHover()
    openNow()
    cursor(700)
    vi.advanceTimersByTime(260)
    expect(useStore.getState().open).toBe(false)

    vi.advanceTimersByTime(100)
    emit(PANEL_ENTER_EVENT)
    vi.advanceTimersByTime(400)

    expect(interactiveCalls().at(-1)).toBe(false)
  })

  it('still sends interactive=false when a panel leave inside the blade cancels during the close', () => {
    useEdgeHover()
    openNow()
    cursor(700)
    vi.advanceTimersByTime(260)
    cursor(100)
    emit('panel:leave')
    vi.advanceTimersByTime(400)
    expect(useStore.getState().open).toBe(false)
    expect(interactiveCalls().at(-1)).toBe(false)
  })

  it('keeps the window interactive when the panel opens again before the release', () => {
    useEdgeHover()
    openNow()
    cursor(700)
    vi.advanceTimersByTime(260)
    vi.advanceTimersByTime(100)
    cursor(0)
    vi.advanceTimersByTime(80)
    expect(useStore.getState().open).toBe(true)
    vi.advanceTimersByTime(400)
    expect(interactiveCalls().includes(false)).toBe(false)
    expect(interactiveCalls().at(-1)).toBe(true)
  })
})

describe('closing with the preview open (S2)', () => {
  it('ends with interactive=false and never re-asserts true after the close started', () => {
    useEdgeHover()
    openNow()
    useStore.setState({ previewItemId: 'item-1' })
    closeShelf()
    expect(interactiveCalls()).toEqual([false])

    for (let i = 0; i < 10; i++) {
      cursor(100)
      vi.advanceTimersByTime(20)
    }
    vi.advanceTimersByTime(240)
    expect(useStore.getState().open).toBe(false)
    vi.advanceTimersByTime(400)

    expect(interactiveCalls().includes(true)).toBe(false)
    expect(interactiveCalls().at(-1)).toBe(false)
  })

  it('still self-heals interactive=true while the panel stays open', () => {
    useEdgeHover()
    openNow()
    cursor(100)
    expect(interactiveCalls()).toEqual([true])
  })
})

describe('an open that never commits (S3)', () => {
  it('sends interactive=false when the animation frame never comes', () => {
    useEdgeHover()
    rafEnabled = false
    cursor(0)
    vi.advanceTimersByTime(60)
    expect(interactiveCalls()).toEqual([true])
    vi.advanceTimersByTime(300)
    expect(useStore.getState().open).toBe(false)
    expect(interactiveCalls()).toEqual([true, false])
  })

  it('does not release after a normal commit', () => {
    useEdgeHover()
    cursor(0)
    vi.advanceTimersByTime(400)
    expect(useStore.getState().open).toBe(true)
    expect(interactiveCalls()).toEqual([true])
  })
})

describe('panel state reports (macOS)', () => {
  function reports(): Array<{ open: boolean; rects: unknown[] }> {
    return edgeApi.setPanelState.mock.calls.map((c: unknown[]) => c[0] as { open: boolean; rects: unknown[] })
  }

  it('reports open with the blade rect, closed immediately, and renews while open', () => {
    install('darwin')
    useEdgeHover()
    vi.advanceTimersByTime(600)
    expect(reports().at(-1)).toEqual({ open: false, rects: [], edge: 'left' })

    useStore.getState().setOpen(true)
    vi.advanceTimersByTime(40)
    expect(reports().at(-1)).toEqual({ open: true, rects: [{ x: 0, y: 240, width: 270, height: 480 }], edge: 'left' })

    edgeApi.setPanelState.mockClear()
    vi.advanceTimersByTime(3100)
    expect(reports().length).toBeGreaterThanOrEqual(2)
    expect(reports().every((r) => r.open)).toBe(true)

    edgeApi.setPanelState.mockClear()
    useStore.getState().setOpen(false)
    expect(reports()).toEqual([{ open: false, rects: [], edge: 'left' }])

    edgeApi.setPanelState.mockClear()
    vi.advanceTimersByTime(5000)
    expect(reports().every((r) => !r.open)).toBe(true)
    expect(reports().length).toBeLessThanOrEqual(1)
  })

  it('does not report on Windows', () => {
    useEdgeHover()
    useStore.getState().setOpen(true)
    vi.advanceTimersByTime(2000)
    expect(edgeApi.setPanelState).not.toHaveBeenCalled()
  })
})

describe('panel width zones', () => {
  it('resolves the width for side positions and keeps the top dock unchanged', () => {
    expect(resolvePanelWidth({ panelWidth: 420, stickPosition: 'left' })).toBe(420)
    expect(resolvePanelWidth({ panelWidth: 999, stickPosition: 'right' })).toBe(420)
    expect(resolvePanelWidth({ panelWidth: 200, stickPosition: 'left' })).toBe(240)
    expect(resolvePanelWidth({ panelWidth: 420, stickPosition: 'top' })).toBe(270)
    expect(panelZones({ panelWidth: 270, stickPosition: 'left' })).toEqual({ wide: 270, keepOpen: 255, startClose: 290, previewWide: 740 })
  })

  it.each([
    [240, 250, 270],
    [420, 430, 450]
  ])('a %ipx panel stays open at x=%i and starts closing at x=%i', (panelWidth, keep, close) => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, panelWidth } })
    useEdgeHover()
    openNow()
    cursor(keep)
    vi.advanceTimersByTime(600)
    expect(useStore.getState().open).toBe(true)
    cursor(close)
    vi.advanceTimersByTime(300)
    expect(useStore.getState().open).toBe(false)
  })

  it('treats the right blade in display coordinates on darwin', () => {
    install('darwin')
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, stickPosition: 'right', panelWidth: 300 } })
    useEdgeHover()
    openNow()
    cursor(1512 - 100)
    emit('panel:leave')
    vi.advanceTimersByTime(600)
    expect(useStore.getState().open).toBe(true)
  })

  it('keeps the window width for the right blade on win32', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, stickPosition: 'right', panelWidth: 300 } })
    useEdgeHover()
    openNow()
    cursor(1512 - 100)
    emit('panel:leave')
    vi.advanceTimersByTime(600)
    expect(useStore.getState().open).toBe(false)
  })
})

describe('bottom dock (macOS)', () => {
  beforeEach(() => {
    install('darwin')
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, stickPosition: 'bottom', horizontalOffset: 0.5, dockHeight: 260 } } as any)
  })

  it('opens when the cursor rests on the bottom edge under the dock', () => {
    useEdgeHover()
    cursor(756, 981)
    vi.advanceTimersByTime(80)
    expect(useStore.getState().open).toBe(true)
  })

  it('does not open at the bottom edge beside the trigger or above it', () => {
    useEdgeHover()
    cursor(100, 981)
    vi.advanceTimersByTime(80)
    cursor(756, 960)
    vi.advanceTimersByTime(80)
    expect(useStore.getState().open).toBe(false)
  })

  it('stays open over the resized dock and closes once the cursor leaves it upwards', () => {
    useEdgeHover()
    openNow()
    cursor(756, 982 - 250)
    vi.advanceTimersByTime(400)
    expect(useStore.getState().open).toBe(true)
    cursor(756, 982 - 320)
    vi.advanceTimersByTime(400)
    expect(useStore.getState().open).toBe(false)
  })

  it('reports the drawn edge and leaves the blade out of the solid rects while it morphs', () => {
    const doc = (globalThis as any).document
    doc.querySelector = (sel: string) => (sel === '.blade' ? { getBoundingClientRect: () => BLADE_BOX } : sel === '.blade-container.is-morphing' ? {} : null)
    useEdgeHover()
    useStore.getState().setOpen(true)
    vi.advanceTimersByTime(40)
    expect(edgeApi.setPanelState.mock.calls.at(-1)[0]).toEqual({ open: true, rects: [], edge: 'bottom' })
  })
})
