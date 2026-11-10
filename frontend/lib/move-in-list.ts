/** Where a list item goes when it is reordered without dragging. */
export type MoveTo = "up" | "down" | "top"

/**
 * The list with the item at `index` moved one place up or down, or to the start.
 * Used by the «Nach oben / Nach unten» menu entries – the keyboard and touch way to
 * reorder what is otherwise dragged. Returns `null` when the move changes nothing
 * (first item up, last item down, unknown index), so a caller sends no write.
 */
export function moveInList<T>(list: readonly T[], index: number, to: MoveTo): T[] | null {
  const target = to === "top" ? 0 : to === "up" ? index - 1 : index + 1
  if (index < 0 || index >= list.length || target < 0 || target >= list.length || target === index) return null
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}
