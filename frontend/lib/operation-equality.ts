/**
 * Value equality for `Operation`, used by the column's `React.memo` comparator
 * (`droppable-column.tsx`).
 *
 * Why this exists: the column comparator used to be a hand-written whitelist of fields. A
 * whitelist only stays correct while somebody remembers to extend it, and fields the cards
 * below actually render kept falling out of it (`nachbarhilfeNote`, `locationDisplay`,
 * `contactPhone`, the pickup fields, `vehicleCallsigns`, …). Because the column's `memo` is
 * the OUTER gate, a field missing there never reaches the card's own comparator at all: the
 * card holds stale content and there is no self-heal on the next render either.
 *
 * A structural walk has no list to forget. Add a field to `Operation` and it participates.
 *
 * The card's comparator (`draggable-operation.tsx`) deliberately stays a curated list — it
 * encodes per-field decisions (identity as the change signal for externally-owned props,
 * `rekoSummary` fields the card does not draw) that a structural walk would erase.
 *
 * Comparing by VALUE rather than identity is also what makes the memo useful here: the
 * `ApiIncident → Operation` mapper rebuilds every array and `Map` on each sync, so identity
 * checks (`a.crew !== b.crew`) report "changed" on every poll even when nothing did. The
 * arrays and maps in `Operation` are small — single-digit entries in practice — so walking
 * them is cheaper than the re-render it avoids.
 */

/** Structural equality for the value shapes that appear in `Operation`. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true

  // Null/undefined are only equal to themselves, already handled by Object.is above.
  if (a == null || b == null) return false

  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => valuesEqual(item, b[i]))
  }

  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false
    for (const [key, value] of a) {
      // `has` matters: a key mapped to `undefined` is not the same as a missing key.
      if (!b.has(key) || !valuesEqual(value, b.get(key))) return false
    }
    return true
  }

  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false
    for (const value of a) {
      if (!b.has(value)) return false
    }
    return true
  }

  // Plain objects — `coordinates`, `rekoSummary`, `assignedReko`.
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>)
    const bKeys = Object.keys(b as Record<string, unknown>)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        valuesEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    )
  }

  return false
}

/**
 * True when two operations are indistinguishable to a renderer.
 *
 * Compares every own key of either object, so a field added to `Operation` is covered
 * without touching this file.
 */
export function areOperationsEqual(a: unknown, b: unknown): boolean {
  return valuesEqual(a, b)
}

/** True when two operation lists are element-wise equal, in order. */
export function areOperationListsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false
  return a.every((item, i) => areOperationsEqual(item, b[i]))
}
