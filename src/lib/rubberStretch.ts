export interface SlotEdges {
  l: number
  r: number
}

export const MAX_STRETCH_SLOTS = 2

export function stretchedEdges(from: SlotEdges, to: SlotEdges, stretch: number, maxSlots = MAX_STRETCH_SLOTS): SlotEdges {
  const u = stretch / 100
  const cap = maxSlots === Infinity ? Infinity : Math.max(0, to.r - to.l) * maxSlots
  return {
    l: to.l - Math.min((to.l - Math.min(from.l, to.l)) * u, cap),
    r: to.r + Math.min((Math.max(from.r, to.r) - to.r) * u, cap)
  }
}
