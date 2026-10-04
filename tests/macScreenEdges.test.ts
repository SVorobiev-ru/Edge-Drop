import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mocks.execFile(...args),
  default: { execFile: (...args: unknown[]) => mocks.execFile(...args) }
}))

type MacScreenModule = typeof import('../electron/main/macScreen')

const BOUNDS = { x: 0, y: 0, width: 1512, height: 982 }
const MENU = 25
const NOTCH = 37
const DOCK = 70

function workArea(opts: { menu?: number; left?: number; right?: number; bottom?: number }, bounds = BOUNDS) {
  const menu = opts.menu ?? 0
  const left = opts.left ?? 0
  const right = opts.right ?? 0
  const bottom = opts.bottom ?? 0
  return {
    x: bounds.x + left,
    y: bounds.y + menu,
    width: bounds.width - left - right,
    height: bounds.height - menu - bottom
  }
}

function answerDefaults(values: Record<string, string | Error>): void {
  mocks.execFile.mockImplementation((_file: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
    const value = values[args[2]]
    if (value === undefined || value instanceof Error) cb(value ?? new Error('missing key'), '')
    else cb(null, value)
  })
}

let mac: MacScreenModule

beforeEach(async () => {
  vi.resetModules()
  mocks.execFile.mockReset()
  mac = await import('../electron/main/macScreen')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('macScreen — occupied display edges', () => {
  it('reports a clean display when workArea equals bounds', () => {
    expect(mac.screenInsets(BOUNDS, workArea({}))).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
    expect(mac.visibleDockSide(BOUNDS, workArea({}))).toBeNull()
    expect(mac.menuBarHeight(BOUNDS, workArea({}))).toBe(0)
  })

  it.each([
    ['left', { left: DOCK }],
    ['right', { right: DOCK }],
    ['bottom', { bottom: DOCK }]
  ] as const)('detects a visible Dock on the %s', (side, inset) => {
    const wa = workArea({ menu: MENU, ...inset })
    expect(mac.visibleDockSide(BOUNDS, wa)).toBe(side)
    expect(mac.screenInsets(BOUNDS, wa)[side]).toBe(DOCK)
  })

  it('sees no Dock when it auto-hides (workArea only loses the menu bar)', () => {
    const wa = workArea({ menu: MENU })
    expect(mac.visibleDockSide(BOUNDS, wa)).toBeNull()
    expect(mac.menuBarHeight(BOUNDS, wa)).toBe(MENU)
  })

  it('measures a 25pt menu bar and a 37pt notch menu bar', () => {
    expect(mac.menuBarHeight(BOUNDS, workArea({ menu: MENU }))).toBe(25)
    expect(mac.menuBarHeight(BOUNDS, workArea({ menu: NOTCH }))).toBe(37)
  })

  it('handles a second display with and without its own menu bar', () => {
    const second = { x: 1512, y: -200, width: 2560, height: 1440 }
    expect(mac.menuBarHeight(second, workArea({}, second))).toBe(0)
    expect(mac.menuBarHeight(second, workArea({ menu: MENU }, second))).toBe(25)
    expect(mac.visibleDockSide(second, workArea({ menu: MENU }, second))).toBeNull()
  })

  it.each([
    ['left', { left: DOCK }, 'left', true],
    ['left', { left: DOCK }, 'right', false],
    ['left', { left: DOCK }, 'top', false],
    ['right', { right: DOCK }, 'right', true],
    ['right', { right: DOCK }, 'left', false],
    ['right', { right: DOCK }, 'top', false],
    ['bottom', { bottom: DOCK }, 'left', false],
    ['bottom', { bottom: DOCK }, 'right', false],
    ['bottom', { bottom: DOCK }, 'top', false]
  ] as const)('visible Dock %s vs panel %s', (_dock, inset, position, expected) => {
    expect(mac.isDockOnStickEdge(BOUNDS, workArea({ menu: MENU, ...inset }), position)).toBe(expected)
  })

  it.each(['left', 'right', 'top'] as const)('auto-hidden Dock never occupies the %s stick edge', (position) => {
    expect(mac.isDockOnStickEdge(BOUNDS, workArea({ menu: MENU }), position)).toBe(false)
  })

  it('keeps left/right work-area edges on the physical edge without a Dock there', () => {
    const wa = workArea({ menu: MENU, bottom: DOCK })
    expect(wa.x).toBe(BOUNDS.x)
    expect(wa.x + wa.width).toBe(BOUNDS.x + BOUNDS.width)
  })
})

describe('macScreen — Dock preferences', () => {
  it('parses orientation with bottom as the default', () => {
    expect(mac.parseDockOrientation('left\n')).toBe('left')
    expect(mac.parseDockOrientation('right\n')).toBe('right')
    expect(mac.parseDockOrientation('bottom\n')).toBe('bottom')
    expect(mac.parseDockOrientation('')).toBe('bottom')
    expect(mac.parseDockOrientation(null)).toBe('bottom')
    expect(mac.parseDockOrientation('garbage')).toBe('bottom')
  })

  it('reads only the orientation, through one defaults call', async () => {
    answerDefaults({ orientation: 'left\n', autohide: '1\n' })
    await expect(mac.readDockOrientation()).resolves.toBe('left')
    expect(mocks.execFile).toHaveBeenCalledTimes(1)
    expect(mocks.execFile).toHaveBeenCalledWith('/usr/bin/defaults', ['read', 'com.apple.dock', 'orientation'], expect.anything(), expect.any(Function))
  })

  it('reports null when the key cannot be read', async () => {
    answerDefaults({})
    await expect(mac.readDockOrientation()).resolves.toBeNull()
  })

  it('reports null when defaults cannot be spawned', async () => {
    mocks.execFile.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    await expect(mac.readDockOrientation()).resolves.toBeNull()
  })

  it('reads the Dock again on every call instead of keeping a cache', async () => {
    answerDefaults({ orientation: 'right\n' })
    await expect(mac.readDockOrientation()).resolves.toBe('right')
    answerDefaults({ orientation: 'left\n' })
    await expect(mac.readDockOrientation()).resolves.toBe('left')
    expect(mocks.execFile).toHaveBeenCalledTimes(2)
  })
})

describe('macScreen — initial stick position', () => {
  it.each([
    ['left', 'right'],
    ['right', 'left'],
    ['bottom', 'left']
  ] as const)('Dock %s -> panel %s', (orientation, expected) => {
    expect(mac.pickInitialStickPosition(orientation)).toBe(expected)
  })

  it('defaults to left when the Dock is unknown', () => {
    expect(mac.pickInitialStickPosition(null)).toBe('left')
  })
})

describe('macScreen — edge constants shared with the renderer', () => {
  it('reports a Dock-side rest with the same trigger band the renderer hover logic uses', async () => {
    const { TRIGGER_PX, BUFFER_PX } = await import('../shared/edgeZones')
    const bounds = BOUNDS
    const wa = workArea({ menu: MENU, left: DOCK })
    const zone = mac.macTriggerZone({ bounds, workArea: wa, stickPosition: 'left', hotZoneWidth: 3 })
    const point = (distFromEdge: number, armed: boolean) =>
      mac.macReportedPoint({ zone, stickPosition: 'left', clientX: distFromEdge, clientY: 100, distFromEdge, armed, expanded: false, hotZoneWidth: 3 })

    expect(point(8, true).x).toBe(TRIGGER_PX)
    expect(point(TRIGGER_PX, false).x).toBe(TRIGGER_PX + 1)
    expect(point(-BUFFER_PX, false).x).toBe(TRIGGER_PX + 1)
    expect(point(-BUFFER_PX - 1, false).x).toBe(-BUFFER_PX - 1)
  })
})
