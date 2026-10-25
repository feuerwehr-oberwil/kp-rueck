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
/** Room a scroll target leaves between a column and the tab stack still standing beside it. */
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

/** How far the tab stack itself reaches into the board from the scroller's edge. */
export function stackDepth(pad: number): number {
  return Math.max(0, pad - EDGE_TAB_PAD_GIVE) + EDGE_TAB_WIDTH
}

/**
 * The columns to name as tabs at each edge (owner, 2026-10-25): a column is a tab only while
 * NONE of it is inside the scroller. Any pixel in view and it is simply a partly visible
 * column, drawn as always – the stack may lie over that sliver. A tab goes to the edge
 * nearer its column's centre.
 */
export function computeEdgeOverflow(g: BoardScrollGeometry): EdgeOverflow {
  const viewL = g.scrollLeft
  const viewR = g.scrollLeft + g.clientWidth
  const mid = (viewL + viewR) / 2

  const left: string[] = []
  const right: string[] = []
  for (const c of g.columns) {
    if (Math.min(c.right, viewR) - Math.max(c.left, viewL) > 0) continue
    ;((c.left + c.right) / 2 >= mid ? right : left).push(c.id)
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
  const reserveL = i > 0 ? stackDepth(g.padLeft) + EDGE_TAB_CLEARANCE : g.padLeft
  const reserveR = i < g.columns.length - 1 ? stackDepth(g.padRight) + EDGE_TAB_CLEARANCE : g.padRight
  const max = Math.max(0, g.scrollWidth - g.clientWidth)
  const towardRight = (col.left + col.right) / 2 > g.scrollLeft + g.clientWidth / 2

  let target = towardRight ? col.right - g.clientWidth + reserveR : col.left - reserveL
  if (col.left < target + reserveL) target = col.left - reserveL
  return Math.min(Math.max(0, target), max)
}
