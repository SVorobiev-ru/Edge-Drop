interface PointerSessionHandlers {
  onMove: (ev: PointerEvent) => void
  onEnd: (commit: boolean) => void
}

export function startPointerSession(el: HTMLElement, pointerId: number, handlers: PointerSessionHandlers): void {
  try { el.setPointerCapture(pointerId) } catch { /* ignore */ }

  const end = (commit: boolean) => {
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onCancel)
    el.removeEventListener('lostpointercapture', onUp)
    try { el.releasePointerCapture(pointerId) } catch { /* ignore */ }
    handlers.onEnd(commit)
  }
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId === pointerId) handlers.onMove(ev)
  }
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId === pointerId) end(true)
  }
  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId === pointerId) end(false)
  }

  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onCancel)
  el.addEventListener('lostpointercapture', onUp)
}
