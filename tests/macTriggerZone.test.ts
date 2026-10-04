import { describe, expect, it } from 'vitest'
import { computeStickBounds } from '../electron/main/geometry'
import { probeSeamAware, REST_FRAMES_REQUIRED, type SeamTickState } from '../electron/main/stickProbe'
import { macTriggerZone, macReportedPoint, MAC_DOCK_EDGE_BAND_PX } from '../electron/main/macScreen'

type Position = 'left' | 'right' | 'top'
type Rect = { x: number; y: number; width: number; height: number }

const BOUNDS: Rect = { x: 0, y: 0, width: 1512, height: 982 }
const MENU = 25
const NOTCH = 37
const DOCK = 70
const HOT = 3
const TICK = 16

function workArea(opts: { menu?: number; left?: number; right?: number; bottom?: number }, bounds = BOUNDS): Rect {
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

function rendererWouldOpen(position: Position, point: { x: number; y: number }, displayWidth: number, hot = HOT): boolean {
  if (position === 'top') return point.y >= -30 && point.y <= Math.max(hot, 1)
  const dist = position === 'right' ? displayWidth - point.x : point.x
  return dist >= -30 && dist <= 3
}

function rendererKeepsTopOpen(point: { x: number; y: number }): boolean {
  return point.y >= -30 && point.y <= 218
}

class Sim {
  private state: SeamTickState = {}
  private now = 1000
  expanded = false

  constructor(
    readonly bounds: Rect,
    readonly wa: Rect,
    readonly position: Position,
    readonly hot = HOT
  ) {}

  tick(cursor: { x: number; y: number }) {
    this.now += TICK
    const zone = macTriggerZone({ bounds: this.bounds, workArea: this.wa, stickPosition: this.position, hotZoneWidth: this.hot })
    const seam = probeSeamAware(
      { cursor, workArea: zone.probeArea, stickPosition: this.position, hotZoneWidth: zone.hotZoneWidth, now: this.now },
      this.state
    )
    this.state = seam.nextState
    const point = macReportedPoint({
      zone,
      stickPosition: this.position,
      clientX: seam.probe.clientX,
      clientY: seam.probe.clientY,
      distFromEdge: seam.probe.distFromEdge,
      armed: seam.armedInEdge,
      expanded: this.expanded,
      hotZoneWidth: this.hot
    })
    return { seam, point, opens: rendererWouldOpen(this.position, point, this.wa.width, this.hot) }
  }

  rest(cursor: { x: number; y: number }, frames = REST_FRAMES_REQUIRED + 2) {
    let last = this.tick(cursor)
    for (let i = 1; i < frames; i++) last = this.tick(cursor)
    return last
  }
}

describe('macTriggerZone — probe area', () => {
  it.each(['left', 'right'] as const)('%s without a Dock on that side probes the physical edge unchanged', (position) => {
    for (const wa of [workArea({ menu: MENU }), workArea({ menu: MENU, bottom: DOCK }), workArea({ menu: NOTCH })]) {
      const zone = macTriggerZone({ bounds: BOUNDS, workArea: wa, stickPosition: position, hotZoneWidth: HOT })
      expect(zone.probeArea).toEqual(wa)
      expect(zone.hotZoneWidth).toBe(HOT)
      expect(zone.dockOnEdge).toBe(false)
      expect(zone.probeArea.x).toBe(BOUNDS.x)
      expect(zone.probeArea.x + zone.probeArea.width).toBe(BOUNDS.x + BOUNDS.width)
    }
  })

  it('left with a visible left Dock keeps the work-area edge and widens the band', () => {
    const wa = workArea({ menu: MENU, left: DOCK })
    const zone = macTriggerZone({ bounds: BOUNDS, workArea: wa, stickPosition: 'left', hotZoneWidth: HOT })
    expect(zone.probeArea).toEqual(wa)
    expect(zone.dockOnEdge).toBe(true)
    expect(zone.hotZoneWidth).toBe(MAC_DOCK_EDGE_BAND_PX)
  })

  it('right with a visible right Dock keeps the work-area edge and widens the band', () => {
    const wa = workArea({ menu: MENU, right: DOCK })
    const zone = macTriggerZone({ bounds: BOUNDS, workArea: wa, stickPosition: 'right', hotZoneWidth: HOT })
    expect(zone.dockOnEdge).toBe(true)
    expect(zone.hotZoneWidth).toBe(MAC_DOCK_EDGE_BAND_PX)
  })

  it('never narrows a user band that is already wider than the Dock band', () => {
    const wa = workArea({ menu: MENU, left: DOCK })
    const zone = macTriggerZone({ bounds: BOUNDS, workArea: wa, stickPosition: 'left', hotZoneWidth: 20 })
    expect(zone.hotZoneWidth).toBe(20)
  })

  it('a Dock on the opposite side or at the bottom does not widen the band', () => {
    expect(macTriggerZone({ bounds: BOUNDS, workArea: workArea({ menu: MENU, right: DOCK }), stickPosition: 'left', hotZoneWidth: HOT }).dockOnEdge).toBe(false)
    expect(macTriggerZone({ bounds: BOUNDS, workArea: workArea({ menu: MENU, left: DOCK }), stickPosition: 'right', hotZoneWidth: HOT }).dockOnEdge).toBe(false)
    expect(macTriggerZone({ bounds: BOUNDS, workArea: workArea({ menu: MENU, bottom: DOCK }), stickPosition: 'left', hotZoneWidth: HOT }).dockOnEdge).toBe(false)
  })

  it.each([
    ['25pt menu bar', MENU],
    ['37pt notch menu bar', NOTCH]
  ] as const)('top with a %s probes from the physical top', (_name, menu) => {
    const wa = workArea({ menu, bottom: DOCK })
    const zone = macTriggerZone({ bounds: BOUNDS, workArea: wa, stickPosition: 'top', hotZoneWidth: HOT })
    expect(zone.probeArea.y).toBe(BOUNDS.y)
    expect(zone.probeArea.x).toBe(wa.x)
    expect(zone.probeArea.width).toBe(wa.width)
    expect(zone.menuBarHeight).toBe(menu)
    expect(zone.hotZoneWidth).toBe(HOT)
  })

  it('top keeps the work-area horizontal range next to a side Dock', () => {
    const wa = workArea({ menu: MENU, left: DOCK })
    const zone = macTriggerZone({ bounds: BOUNDS, workArea: wa, stickPosition: 'top', hotZoneWidth: HOT })
    expect(zone.probeArea.x).toBe(DOCK)
    expect(zone.probeArea.y).toBe(0)
  })

  it('top on a second display without a menu bar is the plain work area', () => {
    const second = { x: 1512, y: -200, width: 2560, height: 1440 }
    const wa = workArea({}, second)
    const zone = macTriggerZone({ bounds: second, workArea: wa, stickPosition: 'top', hotZoneWidth: HOT })
    expect(zone.probeArea).toEqual(wa)
    expect(zone.menuBarHeight).toBe(0)
  })

  it('top on a second display with its own menu bar probes from that display top', () => {
    const second = { x: 1512, y: -200, width: 2560, height: 1440 }
    const wa = workArea({ menu: MENU }, second)
    const zone = macTriggerZone({ bounds: second, workArea: wa, stickPosition: 'top', hotZoneWidth: HOT })
    expect(zone.probeArea.y).toBe(-200)
    expect(zone.menuBarHeight).toBe(MENU)
  })
})

describe('window geometry on macOS displays', () => {
  const displays = (wa: Rect) => [{ id: 1, workArea: wa, isPrimary: true }]

  it.each([
    ['25pt menu bar', MENU],
    ['37pt notch menu bar', NOTCH]
  ] as const)('top window sits below a %s', (_name, menu) => {
    const wa = workArea({ menu, bottom: DOCK })
    const b = computeStickBounds({ position: 'top', displays: displays(wa), windowWidth: 384 })
    expect(b.y).toBe(menu)
  })

  it('left window hugs the Dock when the Dock is on the left', () => {
    const wa = workArea({ menu: MENU, left: DOCK })
    const b = computeStickBounds({ position: 'left', displays: displays(wa), windowWidth: 384 })
    expect(b.x).toBe(DOCK)
    expect(b.y).toBe(MENU)
    expect(b.height).toBe(wa.height)
  })

  it('right window hugs the Dock when the Dock is on the right', () => {
    const wa = workArea({ menu: MENU, right: DOCK })
    const b = computeStickBounds({ position: 'right', displays: displays(wa), windowWidth: 384 })
    expect(b.x + b.width).toBe(BOUNDS.width - DOCK)
  })

  it.each(['left', 'right'] as const)('%s window reaches the physical edge with a bottom or hidden Dock', (position) => {
    for (const wa of [workArea({ menu: MENU, bottom: DOCK }), workArea({ menu: MENU })]) {
      const b = computeStickBounds({ position, displays: displays(wa), windowWidth: 384 })
      if (position === 'left') expect(b.x).toBe(BOUNDS.x)
      else expect(b.x + b.width).toBe(BOUNDS.x + BOUNDS.width)
    }
  })
})

describe('top trigger at the physical screen top', () => {
  it.each([
    ['25pt menu bar', MENU],
    ['37pt notch menu bar', NOTCH]
  ] as const)('%s: opens at the physical top only', (_name, menu) => {
    const wa = workArea({ menu, bottom: DOCK })
    const sim = new Sim(BOUNDS, wa, 'top')
    const x = 700

    const atTop = sim.rest({ x, y: 0 })
    expect(atTop.seam.armedInEdge).toBe(true)
    expect(atTop.opens).toBe(true)
    expect(atTop.point).toEqual({ x, y: 0 })

    expect(new Sim(BOUNDS, wa, 'top').rest({ x, y: HOT }).opens).toBe(true)
    expect(new Sim(BOUNDS, wa, 'top').rest({ x, y: HOT + 1 }).opens).toBe(false)
    expect(new Sim(BOUNDS, wa, 'top').rest({ x, y: menu - 1 }).opens).toBe(false)
    expect(new Sim(BOUNDS, wa, 'top').rest({ x, y: menu }).opens).toBe(false)
    expect(new Sim(BOUNDS, wa, 'top').rest({ x, y: menu + HOT }).opens).toBe(false)
    expect(new Sim(BOUNDS, wa, 'top').rest({ x, y: 400 }).opens).toBe(false)
  })

  it.each([
    ['25pt menu bar', MENU],
    ['37pt notch menu bar', NOTCH]
  ] as const)('%s: an expanded panel stays open while the cursor crosses the menu bar', (_name, menu) => {
    const wa = workArea({ menu, bottom: DOCK })
    const sim = new Sim(BOUNDS, wa, 'top')
    sim.expanded = true
    for (let y = 0; y <= menu + 218; y++) {
      const { point } = sim.tick({ x: 700, y })
      expect(rendererKeepsTopOpen(point)).toBe(true)
    }
  })

  it('reports window-relative coordinates below the menu bar once expanded', () => {
    const wa = workArea({ menu: NOTCH })
    const sim = new Sim(BOUNDS, wa, 'top')
    sim.expanded = true
    expect(sim.tick({ x: 700, y: NOTCH + 100 }).point).toEqual({ x: 700, y: 100 })
    expect(sim.tick({ x: 700, y: NOTCH + 300 }).point.y).toBe(300)
    expect(rendererKeepsTopOpen(sim.tick({ x: 700, y: NOTCH + 300 }).point)).toBe(false)
  })

  it('an expanded panel does not re-arm from the menu bar strip or the first work-area rows', () => {
    const wa = workArea({ menu: MENU })
    const sim = new Sim(BOUNDS, wa, 'top')
    sim.expanded = true
    for (let y = HOT + 1; y <= MENU + HOT; y++) {
      expect(sim.tick({ x: 700, y }).opens).toBe(false)
    }
  })

  it('reports x relative to the work area next to a left Dock', () => {
    const wa = workArea({ menu: MENU, left: DOCK })
    const sim = new Sim(BOUNDS, wa, 'top')
    expect(sim.rest({ x: DOCK + 500, y: 0 }).point).toEqual({ x: 500, y: 0 })
  })

  it('second display without a menu bar behaves like a plain top edge', () => {
    const second = { x: 1512, y: 0, width: 2560, height: 1440 }
    const wa = workArea({}, second)
    const sim = new Sim(second, wa, 'top')
    expect(sim.rest({ x: 2000, y: 0 }).opens).toBe(true)
    expect(new Sim(second, wa, 'top').rest({ x: 2000, y: HOT + 1 }).opens).toBe(false)
    const open = new Sim(second, wa, 'top')
    open.expanded = true
    expect(open.tick({ x: 2000, y: 120 }).point).toEqual({ x: 488, y: 120 })
  })

  it('second display with its own menu bar triggers at its own physical top', () => {
    const second = { x: 1512, y: -200, width: 2560, height: 1440 }
    const wa = workArea({ menu: MENU }, second)
    expect(new Sim(second, wa, 'top').rest({ x: 2000, y: -200 }).opens).toBe(true)
    expect(new Sim(second, wa, 'top').rest({ x: 2000, y: -200 + MENU }).opens).toBe(false)
  })
})

describe('left/right trigger without a Dock on the stick side', () => {
  it.each([
    ['bottom Dock', workArea({ menu: MENU, bottom: DOCK })],
    ['hidden Dock', workArea({ menu: MENU })],
    ['Dock on the right', workArea({ menu: MENU, right: DOCK })]
  ] as const)('left with %s: passes coordinates through and opens at the physical edge', (_name, wa) => {
    const sim = new Sim(BOUNDS, wa, 'left')
    const hit = sim.rest({ x: 0, y: 500 })
    expect(hit.point).toEqual({ x: 0, y: 500 - wa.y })
    expect(hit.opens).toBe(true)
    expect(new Sim(BOUNDS, wa, 'left').rest({ x: 4, y: 500 }).opens).toBe(false)
  })

  it.each([
    ['bottom Dock', workArea({ menu: MENU, bottom: DOCK })],
    ['hidden Dock', workArea({ menu: MENU })],
    ['Dock on the left', workArea({ menu: MENU, left: DOCK })]
  ] as const)('right with %s: passes coordinates through and opens at the physical edge', (_name, wa) => {
    const edgeX = BOUNDS.width - 1
    const sim = new Sim(BOUNDS, wa, 'right')
    const hit = sim.rest({ x: edgeX, y: 500 })
    expect(hit.point).toEqual({ x: edgeX - wa.x, y: 500 - wa.y })
    expect(hit.opens).toBe(true)
    expect(new Sim(BOUNDS, wa, 'right').rest({ x: BOUNDS.width - 5, y: 500 }).opens).toBe(false)
  })
})

describe('left/right trigger next to a visible Dock', () => {
  const leftWa = workArea({ menu: MENU, left: DOCK })
  const rightWa = workArea({ menu: MENU, right: DOCK })
  const rightEdge = BOUNDS.width - DOCK

  it('left: resting inside the widened band opens', () => {
    for (const offset of [0, 3, 8, MAC_DOCK_EDGE_BAND_PX]) {
      const hit = new Sim(BOUNDS, leftWa, 'left').rest({ x: DOCK + offset, y: 500 })
      expect(hit.seam.armedInEdge).toBe(true)
      expect(hit.opens).toBe(true)
    }
  })

  it('left: resting just outside the widened band does not open', () => {
    expect(new Sim(BOUNDS, leftWa, 'left').rest({ x: DOCK + MAC_DOCK_EDGE_BAND_PX + 1, y: 500 }).opens).toBe(false)
  })

  it('left: resting over the Dock does not open', () => {
    for (const x of [DOCK - 1, DOCK - 15, DOCK - 30, 10]) {
      expect(new Sim(BOUNDS, leftWa, 'left').rest({ x, y: 500 }).opens).toBe(false)
    }
  })

  it('left: a fast pass into the Dock never opens', () => {
    const sim = new Sim(BOUNDS, leftWa, 'left')
    let opened = false
    for (let x = DOCK + 400; x >= 20; x -= 40) opened = sim.tick({ x, y: 500 }).opens || opened
    opened = sim.rest({ x: 20, y: 500 }).opens || opened
    expect(opened).toBe(false)
  })

  it('left: returning from the Dock opens only after the cursor rests in the band', () => {
    const sim = new Sim(BOUNDS, leftWa, 'left')
    sim.rest({ x: 20, y: 500 })
    const crossed = sim.tick({ x: DOCK + 5, y: 500 })
    expect(crossed.seam.crossedNow).toBe(true)
    expect(crossed.opens).toBe(false)
    let last = crossed
    for (let i = 0; i < REST_FRAMES_REQUIRED - 1; i++) {
      last = sim.tick({ x: DOCK + 5, y: 500 })
      expect(last.opens).toBe(false)
    }
    last = sim.tick({ x: DOCK + 5, y: 500 })
    expect(last.seam.lockedOut).toBe(false)
    expect(last.opens).toBe(true)
  })

  it('left: an expanded panel keeps real-enough coordinates for keep-open', () => {
    const sim = new Sim(BOUNDS, leftWa, 'left')
    sim.expanded = true
    expect(sim.tick({ x: DOCK + 150, y: 500 }).point).toEqual({ x: 150, y: 500 - MENU })
    const overDock = sim.tick({ x: DOCK - 10, y: 500 }).point
    expect(overDock.x).toBeGreaterThanOrEqual(-30)
    expect(overDock.x).toBeLessThanOrEqual(255)
    expect(sim.tick({ x: DOCK - 50, y: 500 }).point.x).toBe(-50)
  })

  it('right: resting inside the widened band opens, over the Dock does not', () => {
    for (const offset of [1, 4, MAC_DOCK_EDGE_BAND_PX]) {
      expect(new Sim(BOUNDS, rightWa, 'right').rest({ x: rightEdge - offset, y: 500 }).opens).toBe(true)
    }
    expect(new Sim(BOUNDS, rightWa, 'right').rest({ x: rightEdge - MAC_DOCK_EDGE_BAND_PX - 1, y: 500 }).opens).toBe(false)
    for (const x of [rightEdge + 1, rightEdge + 20, BOUNDS.width - 5]) {
      expect(new Sim(BOUNDS, rightWa, 'right').rest({ x, y: 500 }).opens).toBe(false)
    }
  })

  it('right: a fast pass into the Dock never opens', () => {
    const sim = new Sim(BOUNDS, rightWa, 'right')
    let opened = false
    for (let x = rightEdge - 400; x <= BOUNDS.width - 20; x += 40) opened = sim.tick({ x, y: 500 }).opens || opened
    opened = sim.rest({ x: BOUNDS.width - 20, y: 500 }).opens || opened
    expect(opened).toBe(false)
  })
})
