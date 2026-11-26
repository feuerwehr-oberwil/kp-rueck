// The status workflow's shared vocabulary: which gate is open, what it remembers, and what the
// dispatch and completion gates name. Imported by the workflow hook and its dialogs.
import type { Operation, OperationStatus } from "@/lib/contexts/operations-context"
import { getIncidentRefParts } from "@/lib/incident-types"

// The Einsatz in every gate's text: «14 · Hauptstrasse 4» – number first, as on the card, in ⌘K
// and the Doppelbelegung prompt; two Einsätze in one street are told apart (owner pick #14).
export function operationLabel(operation: Operation): string {
  return getIncidentRefParts(operation).head
}

export type ResourceType = "crew" | "vehicles" | "materials"

/**
 * What every gate remembers about the move that opened it.
 *
 * Most gates open AFTER the card has moved, so Abbrechen is an undo:
 * `returnStatus` is where the card came from (null when the mover did not say,
 * and then cancelling only closes). Moving a card into a working column also
 * auto-clears «Am Warten» (see `updateOperation`), so `restoreAmWarten` says
 * whether the undo has to put that flag back — otherwise the operator cancels
 * the move and the flag is gone anyway, with a toast already claiming it.
 *
 * `held`: the move WAITS for the gate (`holdStatusMove`) – the card has not left its
 * column, nothing was published or released, and the gate's main answer makes the move.
 * Abbrechen then has nothing to undo (`returnStatus` is null).
 */
export interface GateBase {
  operationId: string
  returnStatus: OperationStatus | null
  restoreAmWarten: boolean
  held: boolean
}

/**
 * The status gates. At most one is open at a time — the state is this union
 * (or null), so two can't be open at once.
 *
 * - `missingResources`: «es fehlt noch etwas» before a dispatch – held: the card
 *   enters «Disponiert / Anfahrt» (status, broadcast, a possible Einsatzzettel) only
 *   with «Disponieren» (hunt 2026-11-24)
 * - `returningVehicle`: «Beendet / Rückfahrt» without a vehicle
 * - `rekoAssignment`: into Reko without a Reko person – the Reko picker opens
 *   at once (owner pick 19.11.2026, #4 A); backing out of it undoes the move
 * - `rekoReport`: into «Reko abgeschlossen» without a report – the Reko form
 *   opens and the move WAITS for it (`holdStatusMove`), so `returnStatus` is
 *   always null: there is nothing to undo, the card never left
 * - `statusCorrection`: a BACKWARD move into «Disponiert / Anfahrt»; always
 *   knows where the card came from
 * - `materialDecision`: the completion gate, with what the completion releases –
 *   held: nobody is freed and nothing is published before «Abschliessen» (hunt
 *   2026-11-24, owner pick «Dialog mit Freigabeliste»); the list is read live off the card
 */
export type OpenGate =
  | (GateBase & { kind: "missingResources" | "returningVehicle" | "rekoAssignment" | "rekoReport" })
  | (GateBase & { kind: "statusCorrection"; returnStatus: OperationStatus })
  | (GateBase & { kind: "materialDecision"; release: CompletionRelease | null })

export type GateKind = OpenGate["kind"]

/**
 * What completing an incident is about to hand back — read off the card BEFORE
 * the status change empties it.
 *
 * `updateOperation` clears crew, vehicles and their assignment maps the instant
 * the status becomes `complete` (the backend releases the same rows), so by the
 * time the gate renders there is nothing left to name. The snapshot is taken in
 * the trigger, which still runs against the pre-change store.
 */
export interface CompletionRelease {
  operationId: string
  /** Crew names, as the card showed them. */
  crew: string[]
  /** «TLF 1 · Omega 21» — name plus Funkrufname where there is one. */
  vehicles: string[]
}

/** Which assignment a «bleibt vor Ort | kehrt zurück» toggle writes: the Einsatz's own vehicle
 *  (`toggleDriverStay`) or its Auftrag's (`setRouteDriverStay`). */
export type DriverStayTarget =
  | { kind: "incident"; operationId: string; vehicleId: string }
  | { kind: "route"; groupId: string; assignmentId: string }

/** Who the dispatch gate's «EL» stub makes Einsatzleiter: one of the Einsatz's own crew
 *  (`usePromoteToLeader`) or one of its Auftrag's (`usePromoteRouteLeader`). */
export type LeaderTarget =
  | { kind: "incident"; operationId: string; personnelId: string }
  | { kind: "route"; groupId: string; assignmentId: string }

/** The Einsatz's and its Auftrag's resources, as the dispatch gate names them. */
export interface ResourceCoverage {
  /** EL first (`sortCrewByLeader`). `leaderTarget` null = nobody can make this person EL here:
   *  the own crew of a stop inside an Auftrag – the route leads (as in the board detail). */
  crew: { personnelId: string; name: string; isLeader: boolean; leaderTarget: LeaderTarget | null }[]
  /** `driverStay` is absent while the assign POST has not answered – then no toggle. */
  vehicles: { vehicleId: string; name: string; driverStay: boolean | undefined; target: DriverStayTarget }[]
  materials: { id: string; name: string | null }[]
}
