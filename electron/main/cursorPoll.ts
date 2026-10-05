import { screen, powerMonitor } from 'electron'
import { pressedMouseButtons } from './macNative'
import { runtime } from './config'
import { clampPanelWidth } from '../../shared/panelWidth'
import { applyClickThroughMode, clickThroughVerdict, noteForced } from './clickThrough'
import { probeSeamAware, isNearProximity, isNearProximityMac, isInMacReportBand, shouldSendCursorEdge, type SeamTickState } from './stickProbe'
import { loadSettings } from '../store/settings'
import { isFullscreenAppActive, pauseFullscreenMonitor, resumeFullscreenMonitor } from './fullscreen'
import { macTriggerZone, macReportedPoint } from './macScreen'
import { mainWindow, interactive, pollPausedForLock, sendToMainWindow, assignPollPausedForLock } from './windowState'
import { currentHotZoneWidth, currentStickDisplayId, geometryPanelWidth, workAreaCache, panelDrag, reassertClickThrough, repositionWindow } from './displays'
import { macEscape, syncMacEscapeCapture } from './winFocus'
import { setInteractive } from './panelInteractive'

function updateClickThrough(pt: { x: number; y: number }): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const bounds = mainWindow.getBounds()
  const verdict = clickThroughVerdict({
    interactive,
    cursor: { x: pt.x - bounds.x, y: pt.y - bounds.y },
    now: Date.now(),
    mouseButtons: () => pressedMouseButtons(),
    holdOpen: panelDrag.isActive()
  })
  if (verdict.force) {
    noteForced(verdict.force)
    if (verdict.closeRenderer) sendToMainWindow('window:toggle', false)
    setInteractive(false)
    return
  }
  applyClickThroughMode(mainWindow, verdict.mode)
}

/**
 * Adaptive cursor poll — two-speed design to minimise battery drain.
 *
 * Problem: a fixed 16ms setInterval fires 60× per second, permanently
 * preventing Intel Core Ultra CPUs from entering deep C-states (C6/C7/C8)
 * that save 2–3W each. During idle browsing (panel closed, cursor far from
 * edge) there is zero useful work being done at 60Hz.
 *
 * Solution: run at SLOW speed (150ms on battery, 80ms on AC) when the panel
 * is closed and the cursor is not within PROXIMITY_PX of the edge. Switch to
 * FAST speed (16ms) the moment the cursor approaches within PROXIMITY_PX.
 * Switch back to SLOW after SLOW_COOLDOWN_MS of no edge-proximity.
 *
 * This reduces timer wake-ups by 5–10× during idle browsing while keeping
 * panel open/close responsiveness completely unchanged (human reaction time
 * is ~150ms, so a SLOW tick of 150ms is imperceptible).
 */

/** Full-speed poll when edge is near. */
const POLL_FAST_MS = 16
/** Battery-power slow poll (panel closed, cursor far). */
const POLL_SLOW_BATTERY_MS = 100
/** AC-power slow poll (panel closed, cursor far). */
const POLL_SLOW_AC_MS = 75
/** After leaving proximity, stay in fast mode for this long before throttling. */
const SLOW_COOLDOWN_MS = 1500

let cursorPollTimer: ReturnType<typeof setInterval> | null = null
let lastEdgeState = false

/** Whether the poll is currently running in fast (16ms) mode. */
let _pollFast = false
/**
 * Cold-start / wake boost deadline (epoch ms). While `Date.now()` is before
 * this, the poll stays FAST even with the cursor far from the edge. Covers
 * the first hover after launch/restart/wake, which otherwise hits a SLOW
 * tick (75/100ms) + dwell and feels like lag. Steady-state adaptive behavior
 * is unchanged once the window expires.
 */
let _boostUntilMs = 0
/** Timestamp of when the cursor last left the proximity zone. */
let _lastProximityExitMs = 0

/**
 * Hold the cursor poll at full speed for `durationMs`. Used once at launch
 * and after system wake. Bounded and self-expiring: after the deadline the
 * adaptive SLOW/FAST logic resumes exactly as before, so idle battery cost
 * is unchanged (one ~8s FAST window per launch/wake).
 */
export function requestPollBoost(durationMs = 8000): void {
  if (process.platform === 'darwin') return
  try {
    _boostUntilMs = Date.now() + Math.max(0, durationMs)
  } catch {
    _boostUntilMs = 0
  }
  if (cursorPollTimer !== null && !_pollFast) {
    _pollFast = true
    _lastProximityExitMs = 0
    _restartPollTimer(POLL_FAST_MS)
  }
}
/** Last sent cursor position — used to suppress duplicate IPC messages. */
let _lastSentX = -9999
let _lastSentY = -9999
/** Seam-policy tracker threaded between ticks (see stickProbe.ts pillars). */
let _seamState: SeamTickState = {}
let _lastInReportBand = false

/** Restart the poll timer at the given interval. Clears any existing timer. */
function _restartPollTimer(intervalMs: number): void {
  if (cursorPollTimer !== null) {
    clearInterval(cursorPollTimer)
  }
  cursorPollTimer = setInterval(_pollTick, intervalMs)
}

/** Single cursor poll tick — shared by both fast and slow modes. */
function _pollTick(): void {
  if (runtime.quitting || !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return

  const settings = loadSettings()
  if (process.platform !== 'darwin' && geometryPanelWidth !== null && clampPanelWidth(settings.panelWidth) !== geometryPanelWidth) repositionWindow()
  const macCursor = process.platform === 'darwin' ? screen.getCursorScreenPoint() : null
  if (macCursor) updateClickThrough(macCursor)
  if (settings.suppressInFullscreen && isFullscreenAppActive(currentStickDisplayId)) {
    if (process.platform !== 'darwin' || !interactive) return
  }

  const pt = macCursor ?? screen.getCursorScreenPoint()

  // Versioned read: rebuilds automatically whenever the stick display id
  // changed (Settings/tray switch, re-resolution after topology events).
  const wa = workAreaCache.get(currentStickDisplayId)
  if (!wa) return // no successful enumeration yet; retry next tick

  // Seam-aware probe (unit-tested against simulated multi-display
  // topologies in tests/stickProbeScenarios.test.ts). The returned
  // armedInEdge is what the renderer's dwell consumes: own pixels only,
  // slow enough to be intent, and outside any post-crossing lockout.
  const macDisplayBounds = process.platform === 'darwin' ? (workAreaCache.getBounds(currentStickDisplayId) ?? wa) : null
  const macZone = macDisplayBounds
    ? macTriggerZone({
        bounds: macDisplayBounds,
        workArea: wa,
        stickPosition: settings.stickPosition,
        hotZoneWidth: currentHotZoneWidth
      })
    : null

  const seam = probeSeamAware(
    {
      cursor: pt,
      workArea: macZone ? macZone.probeArea : wa,
      stickPosition: settings.stickPosition,
      hotZoneWidth: macZone ? macZone.hotZoneWidth : currentHotZoneWidth,
      now: Date.now()
    },
    _seamState
  )
  _seamState = seam.nextState
  if (seam.probe.garbage) return

  const clientX = seam.probe.clientX
  const clientY = seam.probe.clientY
  const distFromEdge = seam.probe.distFromEdge

  // ── Adaptive speed: switch to fast poll when cursor approaches the edge ──
  // The launch/wake boost forces FAST during the cold window so the first
  // hover never waits on a SLOW tick. `isNearProximity` behavior is untouched.
  const nearProximity = macDisplayBounds
    ? isNearProximityMac({ distFromEdge, cursor: pt, displayBounds: macDisplayBounds })
    : isNearProximity(distFromEdge) || Date.now() < _boostUntilMs

  if (nearProximity || interactive) {
    _lastProximityExitMs = 0  // reset cooldown
    if (!_pollFast) {
      _pollFast = true
      _restartPollTimer(POLL_FAST_MS)
    }
  } else {
    // Cursor is far from edge and panel is closed.
    if (_pollFast) {
      if (_lastProximityExitMs === 0) {
        _lastProximityExitMs = Date.now()
      }
      // Wait for the cooldown before throttling back.
      if (Date.now() - _lastProximityExitMs >= SLOW_COOLDOWN_MS) {
        _pollFast = false
        _lastProximityExitMs = 0
        const slowMs = powerMonitor.isOnBatteryPower() ? POLL_SLOW_BATTERY_MS : POLL_SLOW_AC_MS
        _restartPollTimer(slowMs)
        return
      }
    }
  }

  // Seam-aware verdict replaces the raw band test: fast traversal through a
  // display boundary never arms the opener, while outer-edge behavior is
  // preserved (cursor clamps at hardware edges => speed ~0, no crossings).
  const inEdge = seam.armedInEdge

  const newState = inEdge

  // ── Fix 5: IPC gating — suppress redundant messages ──────────────────────
  // Previously every poll tick within 450px of the edge sent a full IPC message
  // to the renderer, even when the cursor hadn't moved. This flooded the IPC
  // channel at 60Hz during all active browsing.
  //
  // Now we only send when:
  //   a) Edge crossing state changes (inEdge flip) — always send immediately.
  //   b) Panel is open (interactive) — send on every fast tick so the renderer
  //      can track cursor position for the close-panel logic.
  //   c) Cursor moved >= IPC_MIN_DELTA_PX since last send — avoids spamming
  //      the renderer when the cursor is stationary near the edge.
  const IPC_MIN_DELTA_PX = 3
  const nearEdge = isNearProximity(distFromEdge)

  const positionChangedEnough =
    Math.abs(clientX - _lastSentX) >= IPC_MIN_DELTA_PX ||
    Math.abs(clientY - _lastSentY) >= IPC_MIN_DELTA_PX

  const inReportBand = macZone && macDisplayBounds
    ? isInMacReportBand({
        distFromEdge,
        cursor: pt,
        displayBounds: macDisplayBounds,
        stickPosition: settings.stickPosition,
        hotZoneWidth: macZone.hotZoneWidth
      })
    : false

  const shouldSend = shouldSendCursorEdge({
    platform: process.platform,
    stateChanged: newState !== lastEdgeState,
    interactive,
    nearEdge,
    inReportBand,
    wasInReportBand: _lastInReportBand,
    positionChangedEnough
  })
  _lastInReportBand = inReportBand

  if (shouldSend) {
    lastEdgeState = newState
    _lastSentX = clientX
    _lastSentY = clientY
    const reported = macZone
      ? macReportedPoint({
          zone: macZone,
          stickPosition: settings.stickPosition,
          clientX,
          clientY,
          distFromEdge,
          armed: inEdge,
          expanded: interactive,
          hotZoneWidth: currentHotZoneWidth
        })
      : { x: clientX, y: clientY }
    sendToMainWindow('window:cursor-edge', {
      x: reported.x,
      y: reported.y,
      inEdge,
      inZone: true,
      stickPosition: settings.stickPosition,
      displayWidth: wa.width,
      displayHeight: wa.height
    })
  }
}

export function startCursorPoll(): void {
  if (cursorPollTimer !== null || pollPausedForLock) return
  // Start in slow mode; will accelerate when cursor approaches the edge.
  const slowMs = powerMonitor.isOnBatteryPower() ? POLL_SLOW_BATTERY_MS : POLL_SLOW_AC_MS
  _pollFast = false
  cursorPollTimer = setInterval(_pollTick, slowMs)
  // Cold-start boost: hold FAST briefly so the very first hover after a
  // device restart / full relaunch responds on a 16ms tick, not a 75/100ms
  // one. Self-expiring; idle battery behavior after the window is unchanged.
  requestPollBoost(8000)
}

export function stopCursorPoll(): void {
  if (cursorPollTimer !== null) {
    clearInterval(cursorPollTimer)
    cursorPollTimer = null
  }
}

let macLockHooksRegistered = false

export function registerMacLockScreenHooks(): void {
  if (process.platform !== 'darwin' || macLockHooksRegistered) return
  macLockHooksRegistered = true
  powerMonitor.on('lock-screen', () => {
    assignPollPausedForLock(true)
    stopCursorPoll()
    pauseFullscreenMonitor()
    macEscape.release()
  })
  powerMonitor.on('unlock-screen', () => {
    assignPollPausedForLock(false)
    if (runtime.quitting) return
    reassertClickThrough()
    startCursorPoll()
    resumeFullscreenMonitor()
    syncMacEscapeCapture()
  })
  powerMonitor.on('resume', () => {
    if (runtime.quitting) return
    reassertClickThrough()
  })
}
