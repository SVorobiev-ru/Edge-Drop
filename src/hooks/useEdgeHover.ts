/**
 * useEdgeHover — the heart of the "invisible until you approach the edge" feel.
 *
 * Detection strategy:
 *
 *  OPENING: cursor dwells in the leftmost TRIGGER_PX band within the hot zone.
 *
 *  CLOSING — two complementary mechanisms:
 *
 *  1. panel:leave custom event (primary): Panel.tsx dispatches this event on the
 *     blade div's onMouseLeave. React's mouseleave does NOT bubble through child
 *     elements, so it fires exactly when the cursor leaves the visible black area.
 *     This correctly handles all directions (right, top, bottom) without relying
 *     on Electron's broken document-level pointerleave for transparent windows.
 *
 *  2. Y-axis overshooting (backup): while the cursor is inside the window, we
 *     track whether it has gone above or below the panel's visual bounds via
 *     pointermove. This catches cases where the cursor leaves the panel vertically
 *     before React's mouseleave has a chance to fire.
 *
 *  Drag-awareness: while an external OS file drag is active we never close.
 */
import { useEffect, useRef } from 'react'
import { edge, IS_DARWIN } from '../lib/edge'
import { useStore } from '../store/appStore'
import { isShelfClosing, releaseInteractive, watchShelfClose } from '../lib/shelf'
import { TRIGGER_PX, BUFFER_PX } from '../../shared/edgeZones'
import { isHorizontalEdge } from '../../shared/panelPlacement'
import { resolvePanelWidth, panelZones, dockBladeHeight, getHorizontalDockMetrics } from '../lib/edgeGeometry'
import { startPanelStateReporter } from '../lib/panelStateReporter'

export { PANEL_WIDTH_DEFAULT, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN, PANEL_WIDTH_STEP } from '../../shared/panelWidth'
export { resolvePanelWidth, panelZones, dockBladeHeight, getHorizontalDockMetrics }

const DWELL_MS = 40      // cursor must linger this long to open
const GRACE_MS = 250     // close delay after leaving
const OPEN_COMMIT_TIMEOUT_MS = 250

export const PANEL_LEAVE_EVENT = 'panel:leave'
export const PANEL_ENTER_EVENT = 'panel:enter'

export function useEdgeHover(): void {
  // Throttle the self-healing setInteractive(true) call.
  // Without this, it fires at 60Hz (every 16ms) via the cursor-edge poll,
  // flooding the IPC queue and starving the messages that open the panel.
  const lastSetInteractiveRef = useRef(0)

  // Track active display dimensions (received from main process cursor poll)
  const displaySize = useRef({
    width: typeof window !== 'undefined' && window.screen ? window.screen.width : 1920,
    height: typeof window !== 'undefined' && window.screen ? window.screen.height : 1080
  })

  // Hot zone and panel bounds, recomputed on resize to avoid reading DOM at 1000Hz
  const zone = useRef<{
    top: number
    bottom: number
    midY: number
    panelHalfH: number
    left?: number
    right?: number
    midX?: number
    panelHalfW?: number
    dockW?: number
  }>({ top: 0, bottom: 0, midY: 0, panelHalfH: 0 })

  // Last known pointer position (updated on every pointermove). Used to vet
  // `panel:leave` events — Framer Motion layout reflows can fire spurious
  // mouseleave events while the cursor never actually left the blade.
  const lastClient = useRef({ x: -1, y: -1 })

  useEffect(() => {
    const recompute = () => {
      const h = window.innerHeight
      const s = useStore.getState().settings
      const isHorizontal = isHorizontalEdge(s.stickPosition)

      const pFrac = s.panelHeight || 0.6
      const panelH = h * pFrac
      const minY = panelH / 2
      const maxY = h - panelH / 2
      const vOffset = s.verticalOffset ?? 0.5
      const midY = minY + vOffset * (maxY - minY)

      const alignment = s.triggerAlignment || 'center'
      const panelTop = midY - panelH / 2
      const panelBottom = midY + panelH / 2
      const triggerH = Math.min(panelH, h * (s.hotZoneHeight || 0.25))

      let top = midY - triggerH / 2
      let bottom = midY + triggerH / 2

      if (alignment === 'top') {
        top = panelTop
        bottom = panelTop + triggerH
      } else if (alignment === 'bottom') {
        top = panelBottom - triggerH
        bottom = panelBottom
      }

      // Horizontal dock bounds (for top/bottom) — calculated in DISPLAY coordinates
      const dispW = displaySize.current.width
      const dockMetrics = getHorizontalDockMetrics(dispW, s.horizontalOffset ?? 0.5, s.hotZoneHeight ?? 0.25, s.triggerAlignment || 'center', s.dockWidth)
      const left = dockMetrics.triggerLeft
      const right = dockMetrics.triggerRight
      const midX = dockMetrics.dockCenterX
      const dockW = dockMetrics.dockWidth
      const panelHalfW = dockW / 2 + 24

      const panelHalfH = isHorizontal ? 120 : panelH / 2 + 24
      zone.current = { 
        top, 
        bottom,
        midY,
        panelHalfH,
        left,
        right,
        midX,
        panelHalfW,
        dockW
      }
    }
    recompute()
    window.addEventListener('resize', recompute)
    const unsubStore = useStore.subscribe((state, prevState) => {
      if (
        state.settings.panelHeight !== prevState.settings.panelHeight ||
        state.settings.hotZoneHeight !== prevState.settings.hotZoneHeight ||
        state.settings.verticalOffset !== prevState.settings.verticalOffset ||
        state.settings.horizontalOffset !== prevState.settings.horizontalOffset ||
        state.settings.stickPosition !== prevState.settings.stickPosition ||
        state.settings.triggerAlignment !== prevState.settings.triggerAlignment ||
        state.settings.dockWidth !== prevState.settings.dockWidth
      ) {
        recompute()
      }
    })
    return () => {
      window.removeEventListener('resize', recompute)
      unsubStore()
    }
  }, [])

  // Single stable effect — deps never change after mount.
  useEffect(() => {
    let dwellTimer: number | undefined
    let graceTimer: number | undefined
    let commitTimer: number | undefined
    const stopCloseWatch = watchShelfClose()
    const stopPanelState = edge.platform === 'darwin' ? startPanelStateReporter() : () => {}

    const closePanelNow = () => {
      const s = useStore.getState()
      if (s.styleFlyoutOpen) s.setStyleFlyoutOpen(false)
      if (s.languageFlyoutOpen) s.setLanguageFlyoutOpen(false)
      s.setOpen(false)
    }

    const closePanel = () => {
      const state = useStore.getState()
      if (!state.open) return
      if (state.sliderActive || state.edgeTransition?.active) return
      if (state.dragActive && !state.internalDragReq) return

      // If any flyout is open, let it play its exit spring first.
      // The Electron window resize (inside setOpen) would cut the flyout animation
      // in half if we close both simultaneously — so we sequence it properly.
      if (state.styleFlyoutOpen || state.languageFlyoutOpen) {
        if (state.styleFlyoutOpen) state.setStyleFlyoutOpen(false)
        if (state.languageFlyoutOpen) state.setLanguageFlyoutOpen(false)
        if (graceTimer !== undefined) window.clearTimeout(graceTimer)
        graceTimer = window.setTimeout(() => {
          graceTimer = undefined
          if (!useStore.getState().open) return // already closed by another path
          closePanelNow()
        }, 300)
        return
      }

      // If the preview screen is open, close the preview screen first,
      // and after a delay let the main clipboard panel start retracting.
      if (state.previewItemId) {
        state.setPreviewItemId(null)
        if (graceTimer !== undefined) window.clearTimeout(graceTimer)
        graceTimer = window.setTimeout(() => {
          graceTimer = undefined
          if (!useStore.getState().open) return
          closePanelNow()
        }, 300)
        return
      }

      closePanelNow()
    }

    const scheduleClose = (delay = GRACE_MS) => {
      const state = useStore.getState()
      if (state.sliderActive || state.edgeTransition?.active) return
      if (state.itemMenuOpen) return
      if (state.dragActive && !state.internalDragReq) return
      if (graceTimer !== undefined) return // already closing

      // If position/display/slider was recently changed (< 1.75s ago), wait out remaining preview stay window
      const timeSincePositionChange = state.sliderReleasedTime > 0 ? Date.now() - state.sliderReleasedTime : Infinity
      let effectiveDelay = delay

      if (timeSincePositionChange < 1750) {
        effectiveDelay = Math.max(delay, 1750 - timeSincePositionChange)
      }

      graceTimer = window.setTimeout(closePanel, effectiveDelay)
    }

    const cancelClose = () => {
      if (graceTimer !== undefined) {
        window.clearTimeout(graceTimer)
        graceTimer = undefined
      }
      // User re-entered the clipboard — clear the preview grace period flags only
      // after the 1750ms position-changed stay window has completed, so the panel
      // does not close prematurely during edge or display transitions.
      const state = useStore.getState()
      const elapsed = state.sliderReleasedTime > 0 ? Date.now() - state.sliderReleasedTime : Infinity
      if (elapsed >= 1750) {
        state.resetPositionChangedTime()
      }
    }

    const openPanel = () => {
      cancelClose()
      if (dwellTimer !== undefined) {
        window.clearTimeout(dwellTimer)
        dwellTimer = undefined
      }
      // Sequence the open across two steps so the OS/DWM surface work
      // (click-through off + always-on-top re-assert over IPC) starts before
      // the React clip-path/spring commit. Previously both fired in the same
      // tick, so DWM recomposition contended with layout + first-paint work
      // and the first open after launch visibly hitched. No visual change:
      // the same two calls run in the same order, one frame apart.
      try {
        void (edge.setInteractive(true) as unknown as Promise<void>)?.catch?.(() => {})
      } catch { /* ignore IPC errors; close path still governs state */ }
      if (useStore.getState().open) return
      let committed = false
      const commitOpen = () => {
        if (committed) return
        committed = true
        if (commitTimer !== undefined) window.clearTimeout(commitTimer)
        commitTimer = undefined
        if (useStore.getState().open) return
        useStore.getState().setOpen(true)
      }
      if (commitTimer !== undefined) window.clearTimeout(commitTimer)
      commitTimer = window.setTimeout(() => {
        commitTimer = undefined
        if (committed) return
        committed = true
        if (!useStore.getState().open) releaseInteractive()
      }, OPEN_COMMIT_TIMEOUT_MS)
      try {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => commitOpen())
        } else {
          commitOpen()
        }
      } catch {
        commitOpen()
      }
    }

    // ── panel:leave / panel:enter (from Panel.tsx blade div) ──────────────
    // NOTE: `mouseleave` can fire spuriously when Framer Motion's `layout`
    // reflow repositions an exiting child out from under the cursor (e.g. on
    // expand). So we treat `panel:leave` as a *hint* and only actually close
    // if the last known pointer position is genuinely outside the blade.
    const isInsideBlade = () => {
      const state = useStore.getState()
      if (state.sliderActive || state.edgeTransition?.active) return true
      const timeSincePositionChange = state.sliderReleasedTime > 0 ? Date.now() - state.sliderReleasedTime : Infinity
      if (timeSincePositionChange < 1750) return true

      const { x, y } = lastClient.current
      if (x < -BUFFER_PX || y < 0) return true // unknown — be conservative, don't close
      const s = state.settings
      const zones = panelZones(s)
      const hasFlyout = !!(state.previewItemId || state.styleFlyoutOpen || state.languageFlyoutOpen)
      const currentPanelWide = hasFlyout ? zones.previewWide : zones.wide

      if (isHorizontalEdge(s.stickPosition)) {
        const dispW = displaySize.current.width
        const { dockWidth, dockX } = getHorizontalDockMetrics(dispW, s.horizontalOffset ?? 0.5, s.hotZoneHeight ?? 0.25, s.triggerAlignment || 'center', s.dockWidth)
        const bladeHeight = dockBladeHeight(s)
        const depth = s.stickPosition === 'bottom' ? displaySize.current.height - y : y
        const inBlade = depth >= -BUFFER_PX && depth <= bladeHeight && x >= dockX - BUFFER_PX && x <= dockX + dockWidth + BUFFER_PX
        if (inBlade) return true
        if (hasFlyout && state.previewFlyoutRect && state.previewFlyoutRect.left !== undefined && state.previewFlyoutRect.right !== undefined) {
          const FLYOUT_BUFFER = 24
          const flyoutScreenLeft = dockX + state.previewFlyoutRect.left
          const flyoutScreenRight = dockX + state.previewFlyoutRect.right
          const inFlyout = y >= (state.previewFlyoutRect.top - FLYOUT_BUFFER) &&
            y <= (state.previewFlyoutRect.bottom + FLYOUT_BUFFER) &&
            x >= flyoutScreenLeft - FLYOUT_BUFFER && x <= flyoutScreenRight + FLYOUT_BUFFER
          if (inFlyout) return true
        }
        return false
      }

      let insideX = false
      const dispW = edge.platform === 'darwin' ? displaySize.current.width : window.innerWidth
      if (s.stickPosition === 'right') {
        insideX = x >= dispW - currentPanelWide - BUFFER_PX && x <= dispW + BUFFER_PX
      } else {
        insideX = x >= -BUFFER_PX && x <= currentPanelWide + BUFFER_PX
      }
      if (!insideX) return false

      const inPreviewCol = s.stickPosition === 'right'
        ? x < dispW - zones.keepOpen
        : x > zones.keepOpen

      if (inPreviewCol && hasFlyout && state.previewFlyoutRect) {
        const FLYOUT_BUFFER = 24
        return y >= state.previewFlyoutRect.top - FLYOUT_BUFFER && y <= state.previewFlyoutRect.bottom + FLYOUT_BUFFER
      }

      const { midY, panelHalfH } = zone.current
      return y >= midY - panelHalfH && y <= midY + panelHalfH
    }

    const onPanelLeave = () => {
      if (useStore.getState().keyboardMode) return
      if (isInsideBlade()) {
        cancelClose()
        return
      }
      scheduleClose()
    }

    const onPanelEnter = () => {
      cancelClose()
    }

    let edgeHintTimer: number | undefined
    let edgeHintFired = false

    const triggerEdgeHint = () => {
      if (edgeHintFired) return
      edgeHintFired = true
      const s = useStore.getState()
      s.setEdgeHintActive(true)
      if (edgeHintTimer !== undefined) window.clearTimeout(edgeHintTimer)
      edgeHintTimer = window.setTimeout(() => {
        edgeHintTimer = undefined
        useStore.getState().setEdgeHintActive(false)
      }, 450)
    }

    // ── main-process cursor poll (replaces broken pointermove forwarding) ──
    // The main process polls screen.getCursorScreenPoint() every 16ms and
    // sends window:cursor-edge with raw x/y coords. We check the hot zone
    // here with the renderer's own settings so everything stays in sync.
    const unsubCursorEdge = window.edge.onCursorEdge((data) => {
      lastClient.current = { x: data.x, y: data.y }
      if (data.displayWidth) displaySize.current.width = data.displayWidth
      if (data.displayHeight) displaySize.current.height = data.displayHeight
      const state = useStore.getState()
      const { stickPosition, displayWidth } = data
      const { top, bottom, midY, panelHalfH } = zone.current
      const hasFlyout = !!(state.previewItemId || state.styleFlyoutOpen || state.languageFlyoutOpen)
      const zones = panelZones(state.settings)
      const currentKeepOpenPx = hasFlyout ? zones.previewWide - 15 : zones.keepOpen
      const currentStartClosePx = hasFlyout ? zones.previewWide + 20 : zones.startClose

      switch (stickPosition) {
        case 'top':
        case 'bottom': {
          const distFromEdge = stickPosition === 'bottom' ? (data.displayHeight || displaySize.current.height) - data.y : data.y
          const triggerDepth = Math.max(state.settings.hotZoneWidth ?? 3, 1)
          const inEdgeNear = distFromEdge >= -BUFFER_PX && distFromEdge <= (triggerDepth + 25)
          const dispW = displayWidth || displaySize.current.width
          const { dockWidth, dockX, triggerLeft, triggerRight } = getHorizontalDockMetrics(dispW, state.settings.horizontalOffset ?? 0.5, state.settings.hotZoneHeight ?? 0.25, state.settings.triggerAlignment || 'center', state.settings.dockWidth)
          const inZone = data.x >= triggerLeft && data.x <= triggerRight

          if (!inEdgeNear) {
            edgeHintFired = false
          }

          const isHoverEnabled = state.settings.hoverActivation ?? true

          if (inEdgeNear && !inZone && !state.open && isHoverEnabled && (state.settings.showEdgeLocationHint ?? false)) {
            triggerEdgeHint()
          }

          if (distFromEdge >= -BUFFER_PX && distFromEdge <= triggerDepth && inZone && !state.open && isHoverEnabled) {
            if (state.edgeHintActive) state.setEdgeHintActive(false)
            cancelClose()
            if (dwellTimer === undefined) {
              dwellTimer = window.setTimeout(() => {
                dwellTimer = undefined
                openPanel()
              }, DWELL_MS)
            }
            return
          }

          if (dwellTimer !== undefined) {
            window.clearTimeout(dwellTimer)
            dwellTimer = undefined
          }

          if (!state.open) return
          if (state.edgeHintActive) state.setEdgeHintActive(false)

          const now = Date.now()
          if (!isShelfClosing() && now - lastSetInteractiveRef.current > 2000) {
            lastSetInteractiveRef.current = now
            edge.setInteractive(true)
          }
          if (state.keyboardMode) return

          const baseBladeH = dockBladeHeight(state.settings)
          const keepOpenDepth = baseBladeH
          const startCloseDepth = baseBladeH + 40
          const insideX = data.x >= dockX - BUFFER_PX && data.x <= dockX + dockWidth + BUFFER_PX
          const outsideX = data.x < dockX - (BUFFER_PX + 40) || data.x > dockX + dockWidth + (BUFFER_PX + 40)

          let inFlyout = false
          if (hasFlyout && state.previewFlyoutRect && state.previewFlyoutRect.left !== undefined && state.previewFlyoutRect.right !== undefined) {
            const FLYOUT_BUFFER = 24
            const flyoutScreenLeft = dockX + state.previewFlyoutRect.left
            const flyoutScreenRight = dockX + state.previewFlyoutRect.right
            inFlyout = data.y >= (state.previewFlyoutRect.top - FLYOUT_BUFFER) &&
              data.y <= (state.previewFlyoutRect.bottom + FLYOUT_BUFFER) &&
              data.x >= flyoutScreenLeft - FLYOUT_BUFFER && data.x <= flyoutScreenRight + FLYOUT_BUFFER
          }

          if ((distFromEdge >= -BUFFER_PX && distFromEdge <= keepOpenDepth && insideX) || inFlyout) {
            cancelClose()
            return
          }

          if (distFromEdge > startCloseDepth || distFromEdge < -BUFFER_PX || outsideX) {
            scheduleClose()
          }
          break
        }

        case 'right': {
          const distFromRight = displayWidth - data.x
          const inEdgeNear = distFromRight >= -BUFFER_PX && distFromRight <= (TRIGGER_PX + 25)
          const inZone = data.y >= top && data.y <= bottom

          if (!inEdgeNear) {
            edgeHintFired = false
          }

          const isHoverEnabled = state.settings.hoverActivation ?? true

          if (inEdgeNear && !inZone && !state.open && isHoverEnabled && (state.settings.showEdgeLocationHint ?? false)) {
            triggerEdgeHint()
          }

          if (distFromRight >= -BUFFER_PX && distFromRight <= TRIGGER_PX && inZone && !state.open && isHoverEnabled) {
            if (state.edgeHintActive) state.setEdgeHintActive(false)
            cancelClose()
            if (dwellTimer === undefined) {
              dwellTimer = window.setTimeout(() => {
                dwellTimer = undefined
                openPanel()
              }, DWELL_MS)
            }
            return
          }

          if (dwellTimer !== undefined) {
            window.clearTimeout(dwellTimer)
            dwellTimer = undefined
          }

          if (!state.open) return

          if (state.edgeHintActive) state.setEdgeHintActive(false)

          const now = Date.now()
          if (!isShelfClosing() && now - lastSetInteractiveRef.current > 2000) {
            lastSetInteractiveRef.current = now
            edge.setInteractive(true)
          }
          if (state.keyboardMode) return

          const inPreviewColumn = distFromRight > zones.keepOpen
          let insideY = false
          if (inPreviewColumn && hasFlyout && state.previewFlyoutRect) {
            const FLYOUT_BUFFER = 24
            insideY = data.y >= state.previewFlyoutRect.top - FLYOUT_BUFFER && data.y <= state.previewFlyoutRect.bottom + FLYOUT_BUFFER
          } else {
            insideY = data.y >= midY - panelHalfH && data.y <= midY + panelHalfH
          }

          if (distFromRight >= -BUFFER_PX && distFromRight <= currentKeepOpenPx && insideY) {
            cancelClose()
            return
          }

          if (distFromRight > currentStartClosePx || distFromRight < -BUFFER_PX || !insideY) {
            scheduleClose()
          }
          break
        }

        // left
        default: {
          const inEdgeNear = data.x >= -BUFFER_PX && data.x <= (TRIGGER_PX + 25)
          const inZone = data.y >= top && data.y <= bottom

          if (!inEdgeNear) {
            edgeHintFired = false
          }

          const isHoverEnabled = state.settings.hoverActivation ?? true

          if (inEdgeNear && !inZone && !state.open && isHoverEnabled && (state.settings.showEdgeLocationHint ?? false)) {
            triggerEdgeHint()
          }

          if (data.x >= -BUFFER_PX && data.x <= TRIGGER_PX && inZone && !state.open && isHoverEnabled) {
            if (state.edgeHintActive) state.setEdgeHintActive(false)
            cancelClose()
            if (dwellTimer === undefined) {
              dwellTimer = window.setTimeout(() => {
                dwellTimer = undefined
                openPanel()
              }, DWELL_MS)
            }
            return
          }

          if (dwellTimer !== undefined) {
            window.clearTimeout(dwellTimer)
            dwellTimer = undefined
          }

          if (!state.open) return

          if (state.edgeHintActive) state.setEdgeHintActive(false)

          const now = Date.now()
          if (!isShelfClosing() && now - lastSetInteractiveRef.current > 2000) {
            lastSetInteractiveRef.current = now
            edge.setInteractive(true)
          }
          if (state.keyboardMode) return

          const inPreviewColumn = data.x > zones.keepOpen
          let insideY = false
          if (inPreviewColumn && hasFlyout && state.previewFlyoutRect) {
            const FLYOUT_BUFFER = 24
            insideY = data.y >= state.previewFlyoutRect.top - FLYOUT_BUFFER && data.y <= state.previewFlyoutRect.bottom + FLYOUT_BUFFER
          } else {
            insideY = data.y >= midY - panelHalfH && data.y <= midY + panelHalfH
          }

          if (data.x >= -BUFFER_PX && data.x <= currentKeepOpenPx && insideY) {
            cancelClose()
            return
          }

          if (data.x > currentStartClosePx || data.x < -BUFFER_PX || !insideY) {
            scheduleClose()
          }
        }
      }
    })

    // ── keyboard ───────────────────────────────────────────────────────────
    const onKeyDown = (e: KeyboardEvent) => {
      // Never close the panel while the user is typing in a text field
      // (search owns Escape: clear, then blur).
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (e.key === 'Escape' && useStore.getState().open) scheduleClose(0)
    }

    // ── window blur (Alt+Tab / OS focus stolen) ────────────────────────────
    // When the user presses Alt+Tab or any other mechanism gives focus to
    // another OS window, the Electron renderer fires a native `blur` event on
    // the global `window` object. Because the Edge-Drop window is `focusable:
    // false`, the cursor-poll path never learns that the app lost OS focus —
    // the cursor position it last saw was still "inside the blade", so
    // isInsideBlade() keeps returning true and the panel is stuck open.
    //
    // Listening for `window.blur` here catches the exact moment the OS
    // switches focus away and immediately force-closes the panel with a tiny
    // grace period so the animation is not jarring (e.g. user Alt+Tabs to
    // quickly read something and comes back — 400 ms gives them a moment).
    const onWindowBlur = () => {
      const state = useStore.getState()
      if (!state.open) return
      if (IS_DARWIN && state.isInternalCopying) return
      // Don't close during an external OS file drag — the drag surface may
      // temporarily shift focus to the OS drag-ghost or file manager.
      if (state.dragActive && !state.internalDragReq) return
      scheduleClose(400)
    }

    // ── OS file drag awareness ─────────────────────────────────────────────
    const onDocDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        useStore.getState().setDragActive(true)
        openPanel()
      }
    }
    const onDocDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        cancelClose()
      }
    }
    const onDocDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) {
        useStore.getState().setDragActive(false)
        if (useStore.getState().internalDragReq) scheduleClose(0)
      }
    }
    const onDocDrop = (e: DragEvent) => {
      e.preventDefault()
      useStore.getState().setDragActive(false)
    }
    const onDocDragEnd = (e: DragEvent) => {
      e.preventDefault()
      useStore.getState().setDragActive(false)
    }

    // ── register ───────────────────────────────────────────────────────────
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener(PANEL_LEAVE_EVENT, onPanelLeave)
    window.addEventListener(PANEL_ENTER_EVENT, onPanelEnter)
    document.addEventListener('dragenter', onDocDragEnter)
    document.addEventListener('dragover', onDocDragOver)
    document.addEventListener('dragleave', onDocDragLeave)
    document.addEventListener('drop', onDocDrop)
    document.addEventListener('dragend', onDocDragEnd)

    return () => {
      unsubCursorEdge()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener(PANEL_LEAVE_EVENT, onPanelLeave)
      window.removeEventListener(PANEL_ENTER_EVENT, onPanelEnter)
      document.removeEventListener('dragenter', onDocDragEnter)
      document.removeEventListener('dragover', onDocDragOver)
      document.removeEventListener('dragleave', onDocDragLeave)
      document.removeEventListener('drop', onDocDrop)
      document.removeEventListener('dragend', onDocDragEnd)
      window.clearTimeout(dwellTimer)
      window.clearTimeout(graceTimer)
      window.clearTimeout(commitTimer)
      stopCloseWatch()
      stopPanelState()
    }
  }, [])
}
