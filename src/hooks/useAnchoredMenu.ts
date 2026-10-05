/**
 * useAnchoredMenu — positions a dropdown rendered in a body portal next to its
 * trigger, so no `overflow` ancestor can clip it. The menu stays inside the
 * visible panel (blade ∩ window): the area outside the blade is click-through
 * on macOS. Flips upward when the preferred side has no room.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { intersectBoxes, placeMenu, type Box, type MenuDirection, type MenuPlacement } from '../lib/menuPlacement'

interface AnchoredMenuOptions {
  prefer: MenuDirection
  align: 'start' | 'end' | 'stretch'
  maxHeight?: number
  onLost?: () => void
}

const HIDDEN: CSSProperties = { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom }
}

function menuBounds(anchor: HTMLElement): Box {
  const viewport = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }
  const blade = anchor.closest('.blade')
  return blade ? intersectBoxes(viewport, boxOf(blade)) : viewport
}

function samePlacement(a: MenuPlacement | null, b: MenuPlacement): boolean {
  return !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.maxHeight === b.maxHeight && a.direction === b.direction
}

export function useAnchoredMenu(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  { prefer, align, maxHeight, onLost }: AnchoredMenuOptions
): { style: CSSProperties; direction: MenuDirection; width?: number } {
  const [placement, setPlacement] = useState<MenuPlacement | null>(null)
  const lostRef = useRef(onLost)
  lostRef.current = onLost

  const update = useCallback(() => {
    const anchorEl = anchorRef.current
    const menuEl = menuRef.current
    if (!anchorEl || !menuEl) return
    const anchor = boxOf(anchorEl)
    const bounds = menuBounds(anchorEl)
    if (anchor.bottom <= bounds.top || anchor.top >= bounds.bottom) {
      lostRef.current?.()
      return
    }
    const next = placeMenu({
      anchor,
      bounds,
      menuWidth: menuEl.offsetWidth,
      menuHeight: menuEl.scrollHeight + menuEl.offsetHeight - menuEl.clientHeight,
      prefer,
      align,
      maxHeight
    })
    setPlacement((prev) => (samePlacement(prev, next) ? prev : next))
  }, [anchorRef, menuRef, prefer, align, maxHeight])

  useLayoutEffect(() => {
    if (!open) return
    setPlacement(null)
    update()
    const menuEl = menuRef.current
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => update()) : null
    if (observer && menuEl) observer.observe(menuEl)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, update, menuRef])

  if (!placement) return { style: HIDDEN, direction: prefer }
  return {
    style: {
      position: 'fixed',
      top: placement.top,
      left: placement.left,
      ...(align === 'stretch' ? { width: placement.width } : { maxWidth: placement.width }),
      maxHeight: placement.maxHeight,
      overflowY: 'auto'
    },
    direction: placement.direction,
    width: placement.width
  }
}

/** Closes a portal menu on a press outside both the trigger and the menu, and on Escape. */
export function useMenuDismiss(
  open: boolean,
  refs: ReadonlyArray<RefObject<HTMLElement | null>>,
  close: () => void
): void {
  const closeRef = useRef(close)
  closeRef.current = close
  const refsRef = useRef(refs)
  refsRef.current = refs

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (target && refsRef.current.some((r) => r.current?.contains(target))) return
      closeRef.current()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])
}
