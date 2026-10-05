import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: any[]) => unknown>,
  cursor: { x: 100, y: 300 },
  buttons: 1,
  buttonsAvailable: true,
  displayReads: 0,
  cursors: [] as unknown[],
  settings: { panelHeight: 0.6, hideFromScreenCapture: false } as Record<string, unknown>
}))

const DISPLAYS = [
  { id: 1, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 37, width: 1728, height: 1080 }, scaleFactor: 2 },
  { id: 2, bounds: { x: 1728, y: 0, width: 2560, height: 1440 }, workArea: { x: 1728, y: 25, width: 2560, height: 1415 }, scaleFactor: 1 }
]

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => unknown) => { mocks.handlers[channel] = fn } },
  screen: {
    getCursorScreenPoint: () => ({ ...mocks.cursor }),
    getAllDisplays: () => {
      mocks.displayReads++
      return DISPLAYS
    }
  }
}))

vi.mock('../electron/main/macNative', () => ({
  mouseButtonsAvailable: () => mocks.buttonsAvailable,
  pressedMouseButtons: () => mocks.buttons,
  setPanelCursor: (cursor: unknown) => {
    mocks.cursors.push(cursor)
    return true
  }
}))

vi.mock('../electron/store/settings', () => ({
  loadSettings: () => mocks.settings
}))

function fakeMainWindow() {
  const win: Record<string, any> = {
    bounds: { ...DISPLAYS[0].workArea },
    webContents: { send: vi.fn() },
    isDestroyed: () => false,
    getBounds: () => ({ ...win.bounds }),
    setPosition: vi.fn(),
    setBounds: vi.fn((b: Record<string, number>) => { win.bounds = { ...b } }),
    setOpacity: vi.fn()
  }
  return win
}

const BLADE = { x: 0, y: 216, width: 270, height: 648 }

async function setup(getDisplayId: () => number | undefined = () => 1) {
  const { createPanelDrag } = await import('../electron/main/macPanelDrag')
  const win = fakeMainWindow()
  const commit = vi.fn((target: Record<string, any>) => ({ ...mocks.settings, stickPosition: target.edge, stickDisplayId: target.displayId }))
  const restore = vi.fn()
  const drag = createPanelDrag({ getWindow: () => win as any, getDisplayId, commit: commit as any, restore })
  drag.registerIpc()
  const event = { sender: win.webContents }
  return { drag, win, commit, restore, event }
}

function placements(win: Record<string, any>): Array<Record<string, any>> {
  return win.webContents.send.mock.calls.filter((c: unknown[]) => c[0] === 'window:panel-drag-placement').map((c: unknown[]) => c[1])
}

function move(x: number, y: number): void {
  mocks.cursor = { x, y }
  vi.advanceTimersByTime(16)
}

beforeEach(() => {
  setPlatform('darwin')
  vi.resetModules()
  vi.useFakeTimers()
  mocks.handlers = {}
  mocks.cursor = { x: 100, y: 300 }
  mocks.buttons = 1
  mocks.buttonsAvailable = true
  mocks.displayReads = 0
  mocks.cursors = []
  mocks.settings = { panelHeight: 0.6, hideFromScreenCapture: false, stickPosition: 'left', verticalOffset: 0.5, horizontalOffset: 0.5 }
})

afterEach(() => {
  vi.useRealTimers()
  restorePlatform()
})

describe('macOS panel drag', () => {
  it('does not touch the window when the drag starts or while the cursor rests', async () => {
    const { drag, win, event } = await setup()
    expect(mocks.handlers['window:panel-drag-start'](event, BLADE)).toBe(true)
    expect(drag.isActive()).toBe(true)
    vi.advanceTimersByTime(160)
    expect(win.setBounds).not.toHaveBeenCalled()
    expect(win.setPosition).not.toHaveBeenCalled()
    expect(win.setOpacity).not.toHaveBeenCalled()
    expect(placements(win)).toEqual([])
  })

  it('slides the panel along its edge with the cursor', async () => {
    const { win, event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    move(110, 400)
    const [first] = placements(win)
    expect(first).toMatchObject({ displayId: 1, edge: 'left', area: { width: 1728, height: 1080 } })
    expect(first.offset).toBeCloseTo(0.5 + 100 / (1080 * 0.4), 3)
    move(110, 400)
    expect(placements(win)).toHaveLength(1)
    expect(win.setBounds).not.toHaveBeenCalled()
  })

  it('attaches the panel to the edge the cursor comes closest to', async () => {
    const { win, event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    move(800, 1100)
    expect(placements(win).at(-1)).toMatchObject({ displayId: 1, edge: 'bottom' })
    move(1700, 600)
    expect(placements(win).at(-1)).toMatchObject({ displayId: 1, edge: 'right' })
    move(800, 45)
    expect(placements(win).at(-1)).toMatchObject({ displayId: 1, edge: 'top' })
    expect(win.setBounds).not.toHaveBeenCalled()
  })

  it('moves the window to another display and keeps it hidden until the renderer has drawn the panel', async () => {
    const { win, event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    move(1760, 400)
    expect(win.setBounds).toHaveBeenLastCalledWith(DISPLAYS[1].workArea)
    expect(win.setOpacity).toHaveBeenLastCalledWith(0)
    expect(placements(win).at(-1)).toMatchObject({ displayId: 2, edge: 'left', area: { width: 2560, height: 1415 } })
    mocks.handlers['window:panel-drag-reveal'](event)
    expect(win.setOpacity).toHaveBeenLastCalledWith(1)
    move(1770, 500)
    expect(win.setBounds).toHaveBeenCalledTimes(1)
  })

  it('reveals the window on its own when the renderer does not answer', async () => {
    const { win, event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    move(1760, 400)
    expect(win.setOpacity).toHaveBeenLastCalledWith(0)
    vi.advanceTimersByTime(400)
    expect(win.setOpacity).toHaveBeenLastCalledWith(1)
  })

  it('saves the attached placement on release without touching the window', async () => {
    const { drag, win, commit, restore, event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    move(900, 1100)
    const result = mocks.handlers['window:panel-drag-end'](event, true) as { moved: boolean; settings: Record<string, unknown> }
    expect(drag.isActive()).toBe(false)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0][0]).toMatchObject({ displayId: 1, edge: 'bottom', workArea: DISPLAYS[0].workArea, scaleFactor: 2 })
    expect(commit.mock.calls[0][0].offset).toBe(placements(win).at(-1)!.offset)
    expect(result).toMatchObject({ moved: true, settings: { stickPosition: 'bottom' } })
    expect(restore).not.toHaveBeenCalled()
    expect(win.setOpacity).not.toHaveBeenCalled()
  })

  it('does not save when the panel ends where it started', async () => {
    const { commit, restore, event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    move(110, 500)
    move(100, 300)
    expect(mocks.handlers['window:panel-drag-end'](event, true)).toMatchObject({ moved: false })
    expect(commit).not.toHaveBeenCalled()
    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('moves the window back and hides it when a drag to another display is cancelled', async () => {
    const { win, commit, restore, event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    move(1760, 400)
    mocks.handlers['window:panel-drag-reveal'](event)
    expect(mocks.handlers['window:panel-drag-end'](event, false)).toMatchObject({ moved: false })
    expect(commit).not.toHaveBeenCalled()
    expect(restore).toHaveBeenCalledTimes(1)
    expect(win.setOpacity).toHaveBeenLastCalledWith(0)
  })

  it('finishes by itself when the mouse button is released outside the renderer', async () => {
    const { drag, commit, event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    move(900, 60)
    mocks.buttons = 0
    vi.advanceTimersByTime(16)
    expect(drag.isActive()).toBe(false)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(mocks.handlers['window:panel-drag-end'](event, true)).toMatchObject({ moved: true })
    expect(mocks.handlers['window:panel-drag-end'](event, true)).toBeNull()
  })

  it('does not hand a finished result to a later drag', async () => {
    const { event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    move(900, 60)
    mocks.buttons = 0
    vi.advanceTimersByTime(16)
    mocks.buttons = 1
    mocks.cursor = { x: 100, y: 300 }
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    expect(mocks.handlers['window:panel-drag-end'](event, true)).toMatchObject({ moved: false })
  })

  it('gives up without saving when the buttons cannot be read and the cursor stays still', async () => {
    mocks.buttonsAvailable = false
    const { drag, commit, restore, event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    move(600, 300)
    vi.advanceTimersByTime(4900)
    expect(drag.isActive()).toBe(true)
    vi.advanceTimersByTime(200)
    expect(drag.isActive()).toBe(false)
    expect(commit).not.toHaveBeenCalled()
    expect(restore).toHaveBeenCalledTimes(1)
    vi.clearAllTimers()
  })

  it('keeps a drag with unreadable buttons alive while the cursor moves', async () => {
    mocks.buttonsAvailable = false
    const { drag, event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    for (let i = 0; i < 40; i++) {
      mocks.cursor = { x: 100 + i * 10, y: 300 }
      vi.advanceTimersByTime(200)
    }
    expect(drag.isActive()).toBe(true)
  })

  it('cancel ends a running drag, restores the placement and the cursor', async () => {
    const { drag, commit, restore, event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    mocks.handlers['window:panel-cursor'](event, 'ew-resize')
    move(900, 300)
    drag.cancel()
    expect(drag.isActive()).toBe(false)
    expect(commit).not.toHaveBeenCalled()
    expect(restore).toHaveBeenCalledTimes(1)
    expect(mocks.cursors.at(-1)).toBeNull()
    drag.cancel()
    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('reads the displays once per drag, not on every tick', async () => {
    const { event } = await setup()
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    for (let i = 0; i < 10; i++) move(200 + i * 300, 300 + i * 40)
    mocks.handlers['window:panel-drag-end'](event, true)
    expect(mocks.displayReads).toBe(1)
  })

  it('finds the display of the window when its id is unknown', async () => {
    const { win, event } = await setup(() => undefined)
    win.bounds = { ...DISPLAYS[1].workArea }
    mocks.cursor = { x: 1800, y: 400 }
    mocks.handlers['window:panel-drag-start'](event, BLADE)
    move(1800, 500)
    expect(placements(win).at(-1)).toMatchObject({ displayId: 2, edge: 'left' })
    expect(win.setBounds).not.toHaveBeenCalled()
  })

  it('starts from the saved edge and offset of a dock', async () => {
    mocks.settings = { ...mocks.settings, stickPosition: 'bottom', horizontalOffset: 0.2 }
    const { win, event } = await setup()
    mocks.cursor = { x: 400, y: 1000 }
    mocks.handlers['window:panel-drag-start'](event, { x: 150, y: 870, width: 1080, height: 210 })
    move(450, 1000)
    const free = 1728 - 1080 - 60
    expect(placements(win).at(-1)).toMatchObject({ edge: 'bottom' })
    expect(placements(win).at(-1)!.offset).toBeCloseTo(0.2 + 50 / free, 3)
  })

  it('ignores other senders, invalid rectangles and a second start', async () => {
    const { drag, event } = await setup()
    expect(mocks.handlers['window:panel-drag-start']({ sender: {} }, BLADE)).toBe(false)
    expect(mocks.handlers['window:panel-drag-start'](event, { x: 0, y: 0, width: -1, height: 10 })).toBe(false)
    expect(mocks.handlers['window:panel-drag-start'](event, null)).toBe(false)
    expect(drag.isActive()).toBe(false)
    expect(mocks.handlers['window:panel-drag-start'](event, BLADE)).toBe(true)
    expect(mocks.handlers['window:panel-drag-start'](event, BLADE)).toBe(false)
    expect(mocks.handlers['window:panel-drag-end']({ sender: {} }, true)).toBeNull()
  })

  it('sets only known cursors, for its own window', async () => {
    const { event } = await setup()
    mocks.handlers['window:panel-cursor']({ sender: {} }, 'ns-resize')
    mocks.handlers['window:panel-cursor'](event, 'ns-resize')
    mocks.handlers['window:panel-cursor'](event, 'crosshair')
    expect(mocks.cursors).toEqual(['ns-resize', null])
  })

  it('does nothing outside macOS', async () => {
    setPlatform('win32')
    const { drag, event } = await setup()
    expect(mocks.handlers['window:panel-drag-start'](event, BLADE)).toBe(false)
    mocks.handlers['window:panel-cursor'](event, 'ns-resize')
    expect(drag.isActive()).toBe(false)
    expect(mocks.cursors).toEqual([])
  })
})
