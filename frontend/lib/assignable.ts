/**
 * Which Einsätze and Aufträge take NEW assignments – the board's copy of the server's
 * `ensure_assignable` (backend/app/crud/assignments.py; owner feedback 23.11.2026 #7).
 *
 * A closed Einsatz takes nothing new: no crew, no vehicle, no material. Material left on
 * site at the close keeps its row – that is the close, not an assignment. An Auftrag takes
 * nothing new once every stop is closed; one without a stop yet is open.
 *
 * Every assign entry asks here: the drop targets (card, detail panel, Auftrag row and stop),
 * the card menu, the detail's «Zuweisen» buttons, the number keys and ⌘K.
 *
 *   if (!takesAssignments(operation)) return          // hide «Zuweisen», refuse the drop
 *   canDrop: ({ source }) => !isResourceDrag(source.data) || takesAssignments(operation)
 */

interface HasStatus {
  status: string
}

export function takesAssignments(incident: HasStatus): boolean {
  return incident.status !== 'complete'
}

/** `stops` as the board knows them; an id it has not loaded (undefined) counts as open. */
export function auftragTakesAssignments(stops: readonly (HasStatus | undefined)[]): boolean {
  return stops.length === 0 || stops.some((stop) => !stop || takesAssignments(stop))
}
