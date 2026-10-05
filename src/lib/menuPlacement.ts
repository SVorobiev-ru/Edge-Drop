export interface Box {
  top: number
  left: number
  right: number
  bottom: number
}

export type MenuDirection = 'up' | 'down'

export interface MenuPlacementInput {
  anchor: Box
  bounds: Box
  menuWidth: number
  menuHeight: number
  prefer: MenuDirection
  align: 'start' | 'end' | 'stretch'
  gap?: number
  margin?: number
  maxHeight?: number
}

export interface MenuPlacement {
  top: number
  left: number
  width: number
  maxHeight: number
  direction: MenuDirection
}

export function intersectBoxes(a: Box, b: Box): Box {
  const top = Math.max(a.top, b.top)
  const left = Math.max(a.left, b.left)
  return { top, left, right: Math.max(left, Math.min(a.right, b.right)), bottom: Math.max(top, Math.min(a.bottom, b.bottom)) }
}

export function placeMenu({ anchor, bounds, menuWidth, menuHeight, prefer, align, gap = 6, margin = 8, maxHeight = Infinity }: MenuPlacementInput): MenuPlacement {
  const below = bounds.bottom - margin - (anchor.bottom + gap)
  const above = anchor.top - gap - (bounds.top + margin)
  const wanted = Math.min(menuHeight, maxHeight)
  const space = (d: MenuDirection) => (d === 'down' ? below : above)
  const other: MenuDirection = prefer === 'down' ? 'up' : 'down'
  const direction = space(prefer) >= wanted ? prefer : space(other) >= wanted ? other : space(prefer) >= space(other) ? prefer : other
  const fit = Math.max(0, Math.min(maxHeight, space(direction)))
  const height = Math.min(menuHeight, fit)

  const room = Math.max(0, bounds.right - bounds.left - margin * 2)
  const width = Math.min(align === 'stretch' ? anchor.right - anchor.left : menuWidth, room)
  const rawLeft = align === 'end' ? anchor.right - width : anchor.left
  const left = Math.min(Math.max(rawLeft, bounds.left + margin), bounds.right - margin - width)

  const rawTop = direction === 'down' ? anchor.bottom + gap : anchor.top - gap - height
  const top = Math.min(Math.max(rawTop, bounds.top + margin), Math.max(bounds.top + margin, bounds.bottom - margin - height))

  return { top, left, width, maxHeight: fit, direction }
}
