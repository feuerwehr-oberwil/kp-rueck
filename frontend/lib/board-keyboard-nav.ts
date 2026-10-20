/**
 * Moving the board's selection with the arrow keys.
 *
 * Read from the DOM rather than from state, deliberately. What the operator
 * sees is the product of the column filter, the per-column sort, which columns
 * are folded and the search box; reconstructing that order from `operations`
 * would be a second implementation of it, free to disagree with the first. The
 * rendered cards already ARE the order, so they are what we walk.
 *
 * `[data-column]` and `[data-incident-id]` are the same hooks `scrollToCard`
 * uses in app/page.tsx; a folded column contributes no cards because it
 * renders none, which is also the behaviour we want (arrows skip it).
 */

export type BoardDirection = "up" | "down" | "left" | "right"

/** The rendered board, column by column, as incident ids in visual order. */
function readColumns(root: ParentNode): string[][] {
  return [...root.querySelectorAll("[data-column]")].map((column) =>
    [...column.querySelectorAll("[data-incident-id]")]
      .map((card) => card.getAttribute("data-incident-id"))
      .filter((id): id is string => !!id),
  )
}

/**
 * The card the selection should move to, or `null` when there is nowhere to go
 * (the edge of the board, or an empty board).
 *
 * With nothing selected yet, any key lands on the first card of the first
 * column that has one — so the keyboard has a way in from cold.
 */
export function nextCardId(
  fromId: string | null,
  direction: BoardDirection,
  root: ParentNode = document,
): string | null {
  const grid = readColumns(root)

  let col = -1
  let row = -1
  if (fromId) {
    col = grid.findIndex((ids) => ids.includes(fromId))
    if (col !== -1) row = grid[col].indexOf(fromId)
  }
  if (col === -1) {
    const first = grid.find((ids) => ids.length > 0)
    return first ? first[0] : null
  }

  if (direction === "up" || direction === "down") {
    const next = row + (direction === "down" ? 1 : -1)
    return grid[col][next] ?? null
  }

  // Sideways: step over columns that are empty or folded rather than stopping
  // at them, and keep the vertical position as closely as the target allows.
  const step = direction === "right" ? 1 : -1
  for (let c = col + step; c >= 0 && c < grid.length; c += step) {
    const ids = grid[c]
    if (ids.length === 0) continue
    return ids[Math.min(row, ids.length - 1)]
  }
  return null
}

/** Arrow keys only. Returns `null` for anything else. */
export function directionFromKey(key: string): BoardDirection | null {
  switch (key) {
    case "ArrowUp":
      return "up"
    case "ArrowDown":
      return "down"
    case "ArrowLeft":
      return "left"
    case "ArrowRight":
      return "right"
    default:
      return null
  }
}
