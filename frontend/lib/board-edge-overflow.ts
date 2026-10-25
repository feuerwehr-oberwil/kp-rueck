/**
 * Which board columns lie past the edges of `#kanban-main`, and where to scroll to bring one
 * back (UX-DESKTOP-07). Pure geometry – the DOM is measured by `useBoardEdgeOverflow` in
 * `components/kanban/board-edge-chips.tsx`, whose chips in the top bar name what this finds.
 * Nothing changes size: a column that does not fit stays a column.
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
 * The columns to name at each edge (owner, 2026-10-25): a column is named only while NONE of
 * it is inside the scroller. Any pixel in view and it is simply a partly visible column,
 * drawn as always. A name goes to the edge nearer its column's centre.
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
