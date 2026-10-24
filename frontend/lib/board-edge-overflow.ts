/**
 * Which board columns lie past the edges of `#kanban-main`, and where to scroll to bring one
 * back (UX-DESKTOP-07, owner pick D «Wegweiser am Rand»). Pure geometry – the DOM is measured
 * by `useBoardEdgeOverflow` in `components/kanban/board-edge-tabs.tsx`, which also draws the
 * folded tabs this decides about. Nothing changes size: a column that does not fit stays a
 * column; the board only names it at the edge it is hidden behind.
 */

/** Width of one edge tab – the same 48px as a folded column strip (`w-12`). */
export const EDGE_TAB_WIDTH = 48
/** The tab stack sits this far inside the board's padding edge, so a reopen pill in the
 *  padding (`left-1` / `right-1`, 20px wide) keeps clear of it. */
export const EDGE_TAB_PAD_GIVE = 4
/** Room between the tab stack and the nearest column that still counts as visible. */
export const EDGE_TAB_CLEARANCE = 8

export interface BoardColumnSpan {
  id: string
  /** Edges in the scroller's content coordinates (0 = start of the scrolled content). */
  left: number
  right: number
}

export interface BoardScrollGeometry {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
  padLeft: number
  padRight: number
  columns: readonly BoardColumnSpan[]
}

export interface EdgeOverflow {
  left: string[]
  right: string[]
}

/** How far from the scroller's visible edge the tab stack reaches into the board. */
export function edgeZone(pad: number): number {
  return Math.max(0, pad - EDGE_TAB_PAD_GIVE) + EDGE_TAB_WIDTH + EDGE_TAB_CLEARANCE
}

/**
 * The columns to name as tabs at each edge. A side gets tabs only when some column is
 * actually cut off there; once it has them, a column under the tab stack counts as hidden
 * too – the stack is opaque, so a column it covers is one the operator cannot read.
 */
export function computeEdgeOverflow(g: BoardScrollGeometry): EdgeOverflow {
  const viewL = g.scrollLeft
  const viewR = g.scrollLeft + g.clientWidth
  // 1px of slack: subpixel layout must not flicker a tab in and out.
  const cutRight = g.columns.some((c) => c.right > viewR - g.padRight + 1)
  const cutLeft = g.columns.some((c) => c.left < viewL + g.padLeft - 1)
  const limitR = viewR - edgeZone(g.padRight)
  const limitL = viewL + edgeZone(g.padLeft)
  const mid = (viewL + viewR) / 2

  const left: string[] = []
  const right: string[] = []
  for (const c of g.columns) {
    const pastR = cutRight && c.right > limitR + 1
    const pastL = cutLeft && c.left < limitL - 1
    // A column wider than what is left between both stacks: it belongs to the nearer edge.
    if (pastR && pastL) ((c.left + c.right) / 2 >= mid ? right : left).push(c.id)
    else if (pastR) right.push(c.id)
    else if (pastL) left.push(c.id)
  }
  return { left, right }
}

/**
 * The `scrollLeft` that brings column `id` fully into view, clear of the tab stack that will
 * still stand at that edge afterwards (columns beyond it stay hidden) – so the column a tab
 * was clicked for never lands under the next tab. Prefers the column's leading edge when the
 * board is too narrow for both.
 */
export function scrollTargetFor(g: BoardScrollGeometry, id: string): number | null {
  const i = g.columns.findIndex((c) => c.id === id)
  if (i < 0) return null
  const col = g.columns[i]
  const reserveL = i > 0 ? edgeZone(g.padLeft) : g.padLeft
  const reserveR = i < g.columns.length - 1 ? edgeZone(g.padRight) : g.padRight
  const max = Math.max(0, g.scrollWidth - g.clientWidth)
  const towardRight = (col.left + col.right) / 2 > g.scrollLeft + g.clientWidth / 2

  let target = towardRight ? col.right - g.clientWidth + reserveR : col.left - reserveL
  if (col.left < target + reserveL) target = col.left - reserveL
  return Math.min(Math.max(0, target), max)
}
