/**
 * The phone Lagekarte's Abholung chip (owner pick 3A, 24.11.2026): the open Abholungen and the
 * one a tap on the chip goes to next – the oldest request first, then on from the selected one,
 * round. A tap per Abholung walks the operator through all of them.
 */

interface PickupCandidate {
  id: string
  pickupNeeded?: boolean
  pickupRequestedAt?: Date | null
}

/** The Einsätze waiting for an Abholung, the longest wait first (no time: last). */
export function openPickups<T extends PickupCandidate>(operations: readonly T[]): T[] {
  const at = (op: T) => op.pickupRequestedAt?.getTime() ?? Number.POSITIVE_INFINITY
  return operations.filter((op) => op.pickupNeeded).sort((a, b) => at(a) - at(b))
}

/** The Abholung after `selectedId` in `pickups` (wrapping), the first one when none of them is
 *  selected, null without any. */
export function nextPickupId(pickups: readonly PickupCandidate[], selectedId: string | null): string | null {
  if (pickups.length === 0) return null
  const index = pickups.findIndex((op) => op.id === selectedId)
  return pickups[(index + 1) % pickups.length].id
}
