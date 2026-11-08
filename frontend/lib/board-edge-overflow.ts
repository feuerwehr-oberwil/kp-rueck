/**
 * Which board columns lie past the edges of `#kanban-main`, and where to scroll to bring one
 * back (UX-DESKTOP-07). Pure geometry – the DOM is measured by `useBoardEdgeOverflow` in
 * `components/kanban/board-edge-chips.tsx`, whose chips in the top bar name what this finds.
 * Nothing changes size: a column that does not fit stays a column, even when its chip shows.
 */

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

/**
 * Less than this much of a column in view and it counts as hidden. A strip that narrow
 * shows a header fragment and the edges of cards – nothing an operator reads – so the
 * column gets its chip like one entirely out of view (owner, 08.11.2026, D7). It still
 * draws: the chip is added, nothing is taken away.
 */
export const MIN_READABLE_PX = 96

/**
 * The columns to name at each edge: a column is named while less than `MIN_READABLE_PX` of
 * it is inside the scroller – or, for one narrower than that (the 48px folded strip), while
 * any of it is cut. This refines the owner's rule of 2026-10-25 («only a column with nothing
 * in view becomes a chip»), under which a 4px sliver counted as shown and kept its chip
 * away. A name goes to the edge nearer its column's centre.
 */
export function computeEdgeOverflow(g: BoardScrollGeometry): EdgeOverflow {
  const viewL = g.scrollLeft
  const viewR = g.scrollLeft + g.clientWidth
  const mid = (viewL + viewR) / 2

  const left: string[] = []
  const right: string[] = []
  for (const c of g.columns) {
    const inView = Math.min(c.right, viewR) - Math.max(c.left, viewL)
    if (inView >= Math.min(MIN_READABLE_PX, c.right - c.left)) continue
    ;((c.left + c.right) / 2 >= mid ? right : left).push(c.id)
  }
  return { left, right }
}

/**
 * The `scrollLeft` that brings column `id` fully into view, keeping the board's own padding
 * beside it. Prefers the column's leading edge when the board is too narrow for it.
 */
export function scrollTargetFor(g: BoardScrollGeometry, id: string): number | null {
  const col = g.columns.find((c) => c.id === id)
  if (!col) return null
  const max = Math.max(0, g.scrollWidth - g.clientWidth)
  const towardRight = (col.left + col.right) / 2 > g.scrollLeft + g.clientWidth / 2

  let target = towardRight ? col.right - g.clientWidth + g.padRight : col.left - g.padLeft
  if (col.left < target + g.padLeft) target = col.left - g.padLeft
  return Math.min(Math.max(0, target), max)
}
