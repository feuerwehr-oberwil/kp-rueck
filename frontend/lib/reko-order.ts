/**
 * A Reko person's order – which of their Rekos comes first (feedback 19.11.2026, #19).
 *
 * The order is real data on the server (`incident_assignments.reko_position`, written by
 * `POST /api/reko/personnel/{id}/order`) and reads like an Auftrag's stop order: numbered
 * pins and a dotted line on the map, the order of the person's /feld list. The Reko-Editor
 * shows and drags only the OPEN ones; the server orders all the person holds, so a drag
 * puts the open ones in their new order back into the places they had and leaves the done
 * ones where they were.
 */

import type { Operation } from "@/lib/contexts/operations-context"

/** A Reko still to be done: assigned, no report filed, Einsatz not closed. */
export function isOpenReko(op: Operation): boolean {
  return !!op.assignedReko && !op.hasCompletedReko && op.status !== "complete"
}

/**
 * What a tap on an Einsatz marker does in the Reko-Editor with `personId` selected: release
 * their Reko there, say it is still saving (no release before the row's id is known – its
 * assign POST may still be refused, `removeReko`), ask before replacing somebody else's, or
 * assign them.
 */
export function rekoEditorTap(
  op: Operation,
  personId: string,
): { kind: "release" | "saving" | "assign" } | { kind: "replace"; current: NonNullable<Operation["assignedReko"]> } {
  const current = op.assignedReko
  if (current?.id === personId) return { kind: current.assignmentId ? "release" : "saving" }
  return current ? { kind: "replace", current } : { kind: "assign" }
}

/** Every Einsatz a Reko person holds, in their order (unnumbered ones last, as they came). */
export function rekosOf(operations: readonly Operation[], personId: string): Operation[] {
  return operations
    .filter((op) => op.assignedReko?.id === personId)
    .map((op, index) => ({ op, index }))
    .sort((a, b) => (a.op.rekoPosition ?? Infinity) - (b.op.rekoPosition ?? Infinity) || a.index - b.index)
    .map(({ op }) => op)
}

/** The open Rekos of every person, each list in that person's order. */
export function openRekosByPerson(operations: readonly Operation[]): Map<string, Operation[]> {
  const people = new Set<string>()
  for (const op of operations) if (op.assignedReko) people.add(op.assignedReko.id)
  const byPerson = new Map<string, Operation[]>()
  for (const personId of people) {
    const open = rekosOf(operations, personId).filter(isOpenReko)
    if (open.length > 0) byPerson.set(personId, open)
  }
  return byPerson
}

/**
 * The person's whole list after the open ones were put in `nextOpenIds` order: each open
 * slot of `allIds` takes the next of `nextOpenIds`, every other id keeps its slot.
 * `openIds` = the open ones as they stood. Returns null when nothing moves.
 */
export function mergeOpenOrder(allIds: readonly string[], openIds: readonly string[], nextOpenIds: readonly string[]): string[] | null {
  if (openIds.length !== nextOpenIds.length || openIds.every((id, i) => id === nextOpenIds[i])) return null
  const open = new Set(openIds)
  let next = 0
  return allIds.map((id) => (open.has(id) ? nextOpenIds[next++] : id))
}
