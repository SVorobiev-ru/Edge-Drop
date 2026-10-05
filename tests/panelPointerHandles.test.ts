import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/types'

const mocks = vi.hoisted(() => ({ expandSound: vi.fn() }))

vi.mock('../src/lib/soundEffects', () => ({ playEdgeExpandSound: mocks.expandSound }))

import { useStore } from '../src/store/appStore'
import { onPanelDragPointerDown } from '../src/hooks/usePanelDrag'
import { currentPanelLiveWidth, onPanelResizePointerDown, panelResizeGripProps, releasePanelCursor } from '../src/hooks/usePanelResize'
import {
  currentLivePlacement,
  currentMorphPhase,
  currentSizePatch,
  morphAfterTimer,
  morphOnEdgeChange,
  noteEdgeChange,
  panelRadius,
  panelRect,
  resizeGripStyle,
  MORPH_REVEAL_MS,
  MORPH_SHAPE_MS
} from '../src/lib/panelPosition'

const g = globalThis as { window?: unknown }
const originalWindow = g.window

type Listener = (ev: Record<string, unknown>) => void

function fakeElement(contains: (node: unknown) => boolean = () => true) {
  const listeners: Record<string, Listener> = {}
  const blade = { getBoundingClientRect: () => ({ left: 0, top: 200, width: 270, height: 600 }) }
  const el = {
    listeners,
    addEventListener: (type: string, fn: Listener) => { listeners[type] = fn },
    removeEventListener: (type: string, fn: Listener) => { if (listeners[type] === fn) delete listeners[type] },
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    contains,
    closest: (selector: string) => (selector === '.blade' ? blade : null)
  }
  return el
}

const emptySpot = { closest: () => null }

function pointerDown(el: ReturnType<typeof fakeElement>, target: unknown = emptySpot, extra: Record<string, unknown> = {}): void {
  const event = { button: 0, target, currentTarget: el, pointerId: 1, screenX: 100, screenY: 300, clientX: 100, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra }
  onPanelDragPointerDown(event as any)
}

function installEdge(api: Record<string, unknown>): void {
  g.window = { edge: api, requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0) }
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.expandSound.mockClear()
  useStore.setState({ open: true, sliderActive: false, edgeTransition: null as any, liveEdge: null, settings: { ...DEFAULT_SETTINGS, stickPosition: 'left', panelWidth: 270 } })
})

afterEach(() => {
  vi.useRealTimers()
  g.window = originalWindow
})

describe('header drag handle', () => {
  it('ignores presses that bubble in from a portal menu outside the header', () => {
    installEdge({ panelDragStart: vi.fn() })
    const el = fakeElement((node) => node !== emptySpot)
    pointerDown(el)
    expect(Object.keys(el.listeners)).toEqual([])
    expect(el.setPointerCapture).not.toHaveBeenCalled()
  })

  it('plays the snap sound when the main process finished the drag first', async () => {
    const panelDragEnd = vi.fn().mockResolvedValue({ moved: true, settings: { ...DEFAULT_SETTINGS, stickPosition: 'right' } })
    installEdge({ panelDragStart: vi.fn().mockResolvedValue(true), panelDragEnd, panelDragReveal: vi.fn().mockResolvedValue(undefined) })
    const el = fakeElement()
    pointerDown(el)
    el.listeners.pointermove({ pointerId: 1, screenX: 140, screenY: 300 })
    el.listeners.pointerup({ pointerId: 1 })
    await vi.runAllTimersAsync()
    expect(panelDragEnd).toHaveBeenCalledWith(true)
    expect(useStore.getState().settings.stickPosition).toBe('right')
    expect(mocks.expandSound).toHaveBeenCalledTimes(1)
    expect(useStore.getState().sliderActive).toBe(false)
  })

  it('does not start a second drag between the release and the snap', async () => {
    let finishEnd: (value: unknown) => void = () => {}
    const panelDragStart = vi.fn().mockResolvedValue(true)
    installEdge({
      panelDragStart,
      panelDragEnd: vi.fn(() => new Promise((resolve) => { finishEnd = resolve })),
      panelDragReveal: vi.fn().mockResolvedValue(undefined)
    })
    const first = fakeElement()
    pointerDown(first)
    first.listeners.pointermove({ pointerId: 1, screenX: 140, screenY: 300 })
    first.listeners.pointerup({ pointerId: 1 })

    const second = fakeElement()
    pointerDown(second)
    expect(Object.keys(second.listeners)).toEqual([])
    expect(useStore.getState().sliderActive).toBe(true)

    await vi.advanceTimersByTimeAsync(0)
    finishEnd({ moved: false, settings: useStore.getState().settings })
    await vi.runAllTimersAsync()
    expect(useStore.getState().sliderActive).toBe(false)
    const third = fakeElement()
    pointerDown(third)
    expect(Object.keys(third.listeners)).toContain('pointermove')
    third.listeners.pointercancel({ pointerId: 1 })
  })
})

describe('inner edge resize handle', () => {
  function startResize() {
    const el = fakeElement()
    onPanelResizePointerDown({ button: 0, currentTarget: el, pointerId: 1, clientX: 270, preventDefault: vi.fn(), stopPropagation: vi.fn() } as any)
    return el
  }

  it('keeps the live width through a settings push and commits it on release', async () => {
    const patchSettings = vi.fn().mockResolvedValue(undefined)
    useStore.setState({ patchSettings })
    const el = startResize()
    el.listeners.pointermove({ pointerId: 1, clientX: 330 })
    expect(currentPanelLiveWidth()).toBe(330)
    useStore.setState({ settings: { ...useStore.getState().settings } })
    expect(currentPanelLiveWidth()).toBe(330)
    expect(useStore.getState().settings.panelWidth).toBe(270)
    el.listeners.pointerup({ pointerId: 1 })
    expect(patchSettings).toHaveBeenCalledWith({ panelWidth: 330 })
    await vi.runAllTimersAsync()
    expect(currentPanelLiveWidth()).toBeNull()
  })

  it('reverts on pointercancel without saving', () => {
    const patchSettings = vi.fn().mockResolvedValue(undefined)
    useStore.setState({ patchSettings })
    const el = startResize()
    el.listeners.pointermove({ pointerId: 1, clientX: 330 })
    el.listeners.pointercancel({ pointerId: 1 })
    expect(patchSettings).not.toHaveBeenCalled()
    expect(currentPanelLiveWidth()).toBeNull()
    expect(useStore.getState().sliderActive).toBe(false)
  })
})

describe('live placement while the header is dragged', () => {
  async function dragTo(placements: Array<Record<string, unknown>>, end: Record<string, unknown> | null, commit = true) {
    let push: (p: unknown) => void = () => {}
    const panelDragEnd = vi.fn().mockResolvedValue(end)
    installEdge({
      panelDragStart: vi.fn().mockResolvedValue(true),
      panelDragEnd,
      panelDragReveal: vi.fn().mockResolvedValue(undefined),
      onPanelDragPlacement: (cb: (p: unknown) => void) => {
        push = cb
        return () => { push = () => {} }
      }
    })
    const el = fakeElement()
    pointerDown(el)
    el.listeners.pointermove({ pointerId: 1, screenX: 140, screenY: 300 })
    for (const p of placements) push(p)
    const during = { ...useStore.getState().settings }
    if (commit) el.listeners.pointerup({ pointerId: 1 })
    else el.listeners.pointercancel({ pointerId: 1 })
    await vi.runAllTimersAsync()
    return { during, panelDragEnd }
  }

  const area = { width: 1728, height: 1080 }

  it('lays the panel out for the edge it is dragged to and keeps that edge through a settings push', async () => {
    let push: (p: unknown) => void = () => {}
    installEdge({
      panelDragStart: vi.fn().mockResolvedValue(true),
      panelDragEnd: vi.fn().mockResolvedValue({ moved: true, settings: { ...DEFAULT_SETTINGS, stickPosition: 'bottom', horizontalOffset: 0.3 } }),
      panelDragReveal: vi.fn().mockResolvedValue(undefined),
      onPanelDragPlacement: (cb: (p: unknown) => void) => { push = cb; return () => {} }
    })
    const el = fakeElement()
    pointerDown(el)
    el.listeners.pointermove({ pointerId: 1, screenX: 140, screenY: 300 })
    push({ displayId: 1, edge: 'bottom', offset: 0.3, area })
    expect(useStore.getState().settings.stickPosition).toBe('bottom')
    expect(currentLivePlacement()).toMatchObject({ edge: 'bottom', offset: 0.3 })
    useStore.getState().setSettings({ ...DEFAULT_SETTINGS, stickPosition: 'left', theme: 'light' })
    expect(useStore.getState().settings).toMatchObject({ stickPosition: 'bottom', theme: 'light' })
    el.listeners.pointerup({ pointerId: 1 })
    await vi.runAllTimersAsync()
    expect(currentLivePlacement()).toBeNull()
    expect(useStore.getState().liveEdge).toBeNull()
    expect(useStore.getState().settings).toMatchObject({ stickPosition: 'bottom', horizontalOffset: 0.3 })
    expect(mocks.expandSound).toHaveBeenCalledTimes(1)
  })

  it('plays no sound and returns to the saved edge when the drag is cancelled', async () => {
    const { during } = await dragTo(
      [{ displayId: 1, edge: 'top', offset: 0.5, area }, { displayId: 1, edge: 'right', offset: 0.4, area }],
      { moved: false, settings: { ...DEFAULT_SETTINGS, stickPosition: 'left' } },
      false
    )
    expect(during.stickPosition).toBe('right')
    expect(useStore.getState().settings.stickPosition).toBe('left')
    expect(mocks.expandSound).not.toHaveBeenCalled()
  })

  it('restores the saved edge when the main process does not answer', async () => {
    await dragTo([{ displayId: 1, edge: 'top', offset: 0.5, area }], null)
    expect(useStore.getState().settings.stickPosition).toBe('left')
    expect(useStore.getState().liveEdge).toBeNull()
    expect(mocks.expandSound).not.toHaveBeenCalled()
  })

  it('plays the snap sound once for a drag across several edges', async () => {
    await dragTo(
      ['top', 'right', 'bottom', 'left', 'bottom'].map((edge, i) => ({ displayId: 1, edge, offset: i / 10, area })),
      { moved: true, settings: { ...DEFAULT_SETTINGS, stickPosition: 'bottom' } }
    )
    expect(mocks.expandSound).toHaveBeenCalledTimes(1)
  })

  it('morphs an edge change on the same display and skips it on another display', async () => {
    let push: (p: unknown) => void = () => {}
    installEdge({
      panelDragStart: vi.fn().mockResolvedValue(true),
      panelDragEnd: vi.fn().mockResolvedValue({ moved: true, settings: { ...DEFAULT_SETTINGS, stickPosition: 'left' } }),
      panelDragReveal: vi.fn().mockResolvedValue(undefined),
      onPanelDragPlacement: (cb: (p: unknown) => void) => { push = cb; return () => {} }
    })
    ;(g.window as Record<string, unknown>).innerWidth = 1728
    ;(g.window as Record<string, unknown>).innerHeight = 1080
    const el = fakeElement()
    pointerDown(el)
    el.listeners.pointermove({ pointerId: 1, screenX: 140, screenY: 300 })
    push({ displayId: 1, edge: 'left', offset: 0.6, area })
    expect(currentMorphPhase()).toBe('idle')
    push({ displayId: 1, edge: 'bottom', offset: 0.5, area })
    expect(currentMorphPhase()).toBe('shape')
    push({ displayId: 2, edge: 'right', offset: 0.5, area: { width: 2560, height: 1415 } })
    expect(currentMorphPhase()).toBe('idle')
    el.listeners.pointerup({ pointerId: 1 })
    await vi.runAllTimersAsync()
  })
})

describe('panel morph', () => {
  it('animates an edge change on the same display unless motion is reduced', () => {
    expect(morphOnEdgeChange({ from: 'left', to: 'bottom', sameDisplay: true, reduceMotion: false }, 'idle')).toBe('shape')
    expect(morphOnEdgeChange({ from: 'left', to: 'bottom', sameDisplay: true, reduceMotion: true }, 'idle')).toBe('idle')
    expect(morphOnEdgeChange({ from: 'left', to: 'right', sameDisplay: false, reduceMotion: false }, 'shape')).toBe('idle')
    expect(morphOnEdgeChange({ from: 'left', to: 'left', sameDisplay: true, reduceMotion: false }, 'reveal')).toBe('reveal')
    expect(morphOnEdgeChange({ from: 'top', to: 'right', sameDisplay: true, reduceMotion: false }, 'reveal')).toBe('shape')
  })

  it('reshapes, then fades the content in, then ends', () => {
    expect(morphAfterTimer('shape')).toBe('reveal')
    expect(morphAfterTimer('reveal')).toBe('idle')
    noteEdgeChange('left', 'top', true)
    expect(currentMorphPhase()).toBe('shape')
    vi.advanceTimersByTime(MORPH_SHAPE_MS - 10)
    noteEdgeChange('top', 'right', true)
    vi.advanceTimersByTime(MORPH_SHAPE_MS - 10)
    expect(currentMorphPhase()).toBe('shape')
    vi.advanceTimersByTime(10)
    expect(currentMorphPhase()).toBe('reveal')
    vi.advanceTimersByTime(MORPH_REVEAL_MS)
    expect(currentMorphPhase()).toBe('idle')
  })

  it('switches at once with reduced motion', () => {
    useStore.setState({ settings: { ...useStore.getState().settings, reduceMotion: true } })
    noteEdgeChange('left', 'bottom', true)
    expect(currentMorphPhase()).toBe('idle')
  })

  it('draws the live placement and the live sizes over the settings', () => {
    const settings = { ...DEFAULT_SETTINGS, stickPosition: 'left' as const, verticalOffset: 0.5 }
    const view = { width: 1728, height: 1000 }
    expect(panelRect(settings, view, { edge: 'bottom', offset: 0 }, null)).toMatchObject({ edge: 'bottom', x: 30, y: 790, width: 1080, height: 210 })
    expect(panelRect(settings, view, null, { panelWidth: 330, panelHeight: 0.5, verticalOffset: 0 })).toMatchObject({ edge: 'left', x: 0, y: 0, width: 330, height: 500 })
    expect(panelRadius('bottom')).toBe('24px 24px 0 0')
    expect(panelRadius('right')).toBe('24px 0 0 24px')
  })

  it('places the resize grips on the inner edge and the two ends', () => {
    expect(resizeGripStyle('inner', 'left')).toEqual({ left: 'calc(100% - 3px)', width: 6, top: 24, bottom: 24 })
    expect(resizeGripStyle('inner', 'bottom')).toEqual({ bottom: 'calc(100% - 3px)', height: 6, left: 24, right: 24 })
    expect(resizeGripStyle('start', 'right')).toEqual({ top: -3, height: 6, right: 0, left: 24 })
    expect(resizeGripStyle('end', 'top')).toEqual({ right: -3, width: 6, top: 0, bottom: 24 })
  })
})

describe('resize on both axes', () => {
  function grip(side: 'inner' | 'start' | 'end', stick: 'left' | 'right' | 'top' | 'bottom', at: { x: number; y: number }) {
    const el = fakeElement()
    const props = panelResizeGripProps(side, stick)
    props.onPointerDown({ button: 0, currentTarget: el, pointerId: 1, clientX: at.x, clientY: at.y, preventDefault: vi.fn(), stopPropagation: vi.fn() } as any)
    return { el, props }
  }

  it('changes the dock height from its inner edge and saves it on release', async () => {
    const patchSettings = vi.fn().mockResolvedValue(undefined)
    const setPanelCursor = vi.fn().mockResolvedValue(undefined)
    installEdge({ setPanelCursor })
    useStore.setState({ patchSettings, settings: { ...useStore.getState().settings, stickPosition: 'bottom' } })
    const { el, props } = grip('inner', 'bottom', { x: 500, y: 800 })
    expect(props.cursor).toBe('ns-resize')
    expect(setPanelCursor).toHaveBeenLastCalledWith('ns-resize')
    el.listeners.pointermove({ pointerId: 1, clientX: 520, clientY: 760 })
    expect(currentSizePatch()).toEqual({ dockHeight: 250 })
    el.listeners.pointerup({ pointerId: 1 })
    expect(patchSettings).toHaveBeenCalledWith({ dockHeight: 250 })
    expect(setPanelCursor).toHaveBeenLastCalledWith(null)
    await vi.runAllTimersAsync()
    expect(currentSizePatch()).toBeNull()
  })

  it('changes the length of a side panel from its lower end', () => {
    const patchSettings = vi.fn().mockResolvedValue(undefined)
    installEdge({})
    ;(g.window as Record<string, unknown>).innerWidth = 1728
    ;(g.window as Record<string, unknown>).innerHeight = 1000
    useStore.setState({ patchSettings, settings: { ...useStore.getState().settings, stickPosition: 'left', panelHeight: 0.5, verticalOffset: 0.5 } })
    const { el } = grip('end', 'left', { x: 100, y: 750 })
    el.listeners.pointermove({ pointerId: 1, clientX: 100, clientY: 850 })
    expect(currentSizePatch()).toEqual({ panelHeight: 0.6, verticalOffset: 0.625 })
    el.listeners.pointerup({ pointerId: 1 })
    expect(patchSettings).toHaveBeenCalledWith({ panelHeight: 0.6, verticalOffset: 0.625 })
  })

  it('does not save a resize that ends where it started', () => {
    const patchSettings = vi.fn().mockResolvedValue(undefined)
    installEdge({})
    useStore.setState({ patchSettings })
    const { el } = grip('inner', 'left', { x: 270, y: 400 })
    el.listeners.pointermove({ pointerId: 1, clientX: 272, clientY: 400 })
    el.listeners.pointerup({ pointerId: 1 })
    expect(patchSettings).not.toHaveBeenCalled()
    expect(currentSizePatch()).toBeNull()
  })

  it('shows and hides the resize cursor as the pointer enters and leaves a grip', () => {
    const setPanelCursor = vi.fn().mockResolvedValue(undefined)
    installEdge({ setPanelCursor })
    const props = panelResizeGripProps('end', 'top')
    props.onPointerEnter()
    expect(setPanelCursor).toHaveBeenLastCalledWith('ew-resize')
    props.onPointerLeave()
    expect(setPanelCursor).toHaveBeenLastCalledWith(null)
  })

  it('puts the normal pointer back once when the grips go away under the pointer', () => {
    const setPanelCursor = vi.fn().mockResolvedValue(undefined)
    installEdge({ setPanelCursor })
    panelResizeGripProps('inner', 'left').onPointerEnter()
    releasePanelCursor()
    releasePanelCursor()
    expect(setPanelCursor.mock.calls).toEqual([['ew-resize'], [null]])
  })
})

describe('crossing to another display', () => {
  it('reveals the window once the viewport has the size of the new work area, even while the panel keeps moving', async () => {
    let push: (p: unknown) => void = () => {}
    const panelDragReveal = vi.fn().mockResolvedValue(undefined)
    installEdge({
      panelDragStart: vi.fn().mockResolvedValue(true),
      panelDragEnd: vi.fn().mockResolvedValue({ moved: true, settings: { ...DEFAULT_SETTINGS, stickPosition: 'left' } }),
      panelDragReveal,
      onPanelDragPlacement: (cb: (p: unknown) => void) => { push = cb; return () => {} }
    })
    const win = g.window as Record<string, unknown>
    win.innerWidth = 1728
    win.innerHeight = 1080
    win.requestAnimationFrame = (fn: () => void) => setTimeout(fn, 16)
    const el = fakeElement()
    pointerDown(el)
    el.listeners.pointermove({ pointerId: 1, screenX: 140, screenY: 300 })
    push({ displayId: 1, edge: 'left', offset: 0.4, area: { width: 1728, height: 1080 } })
    push({ displayId: 2, edge: 'left', offset: 0.4, area: { width: 2560, height: 1415 } })
    await vi.advanceTimersByTimeAsync(50)
    expect(panelDragReveal).not.toHaveBeenCalled()
    win.innerWidth = 2560
    win.innerHeight = 1415
    push({ displayId: 2, edge: 'left', offset: 0.45, area: { width: 2560, height: 1415 } })
    await vi.advanceTimersByTimeAsync(80)
    expect(panelDragReveal).toHaveBeenCalledTimes(1)
    el.listeners.pointerup({ pointerId: 1 })
    await vi.runAllTimersAsync()
  })
})
