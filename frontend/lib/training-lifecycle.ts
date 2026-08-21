import type { Operation, OperationStatus } from "./contexts/operations-context"
import { translateOutsideReact } from "./i18n-messages"

// ── Training conductor: FIELD lifecycle steps ────────────────────────────────
// Drives the "Nächste Aktionen" console in the Übungs-Steuerung. The trainer
// only simulates what happens IN THE FIELD — command-post decisions (tasking a
// Reko, disponieren, closing the incident) stay with the operator (trainee) on
// the board. So the console exposes exactly the field-originated milestones:
//
//   Reko vor Ort → Reko-Meldung → Fahrt zu Einsatz → Einsatz beendet + Rückfahrt
//   → Rapport (once the operator closed the incident, until it is filed)
//
// The last step offers BOTH actions side by side: once the vehicles arrived,
// the trainer decides whether the crew stays until "beendet" or a vehicle
// drives home early (drop-off) — and a returned vehicle never blocks the
// "beendet" report.
//
// "Fahrt zu Einsatz" / "Rückfahrt Magazin" start simulated GPS drives for the
// assigned vehicles; the geofence prompts (arrival / release) then ask the
// OPERATOR to confirm, so status and resource changes stay command-post
// decisions. When the drive can't run (no coordinates, no vehicle assigned,
// demo mode) the outbound step falls back to the direct "Fahrzeug vor Ort"
// status change.
//
// Each step has an expected dwell time; once an incident waits past it the
// action becomes "due" and floats to the top of the console, highlighted.
// This is the pull-based reminder — nothing pings.
//
// The final step ("Einsatz beendet") is INFORMATIONAL: it reports completion to
// the operator (a card badge) without changing status. The operator decides to
// close the incident. Incidents whose ball is in the operator's court
// (Eingegangen, Reko abgeschlossen) have no field action and are hidden.

export type NextActionKind =
  | "status" // field arrival that advances status (reuses changeStatusToTop)
  | "reko_arrived" // Reko crew "vor Ort" — sets arrived_at, stays in "reko"
  | "reko_report" // Reko-Meldung — generates + submits the report → reko_done
  | "gps_drive" // starts a simulated GPS drive to the incident; arrival prompt follows
  | "gps_return" // starts a simulated GPS drive back to the magazin; release prompt follows
  | "field_complete" // field reports "Einsatz beendet" — console note, NO status change
  | "rapport" // Schadenplatz-Rapport arrives for a completed incident (plan 25)

export interface NextAction {
  key: string
  /** Short German button label (the milestone being reached). */
  label: string
  kind: NextActionKind
  /** Target status for kind === "status". */
  targetStatus?: OperationStatus
  /** Seconds in the current step after which this action is "due" / recommended. */
  dueAfterSec: number
}

// Demo-scaled expected dwell times (seconds). Deliberately short so a ~30–45 min
// exercise flows naturally instead of waiting real-world travel/work times.
const DUE = {
  rekoArrived: 120, // travel time before the Reko crew reaches the scene
  rekoReport: 90, // assessment time on scene before the report comes in
  driveStart: 45, // the field would start driving right after being disponiert
  vehicleOnScene: 150, // travel time before the vehicles reach the scene (fallback)
  incidentDone: 420, // time working the incident (~7 min) before the crew reports done
  returnStart: 120, // packing-up time after "beendet" before the crew drives home
  rapportFiled: 180, // paperwork time after completion before the rapport comes in
} as const

/**
 * The recommended FIELD actions for an incident (primary first — it drives the
 * due-highlight and sorting), or an empty list when the next move belongs to
 * the operator (Eingegangen, Reko abgeschlossen) or the incident is closed.
 * Aware of the Reko sub-state: the crew must first arrive ("Reko vor Ort")
 * before the report ("Reko-Meldung").
 *
 * `opts.gpsSim` says whether the GPS drive simulation is usable (backend
 * refuses it in demo mode) — without it, Disponiert falls back to the direct
 * "Fahrzeug vor Ort" status change and the Rückfahrt action is hidden.
 */
export function nextActions(op: Operation, opts?: { gpsSim?: boolean }): NextAction[] {
  switch (op.status) {
    case "reko":
      if (!op.rekoArrivedAt) {
        return [{ key: "reko_arrived", label: translateOutsideReact('notifications.trainingActions.rekoArrived'), kind: "reko_arrived", dueAfterSec: DUE.rekoArrived }]
      }
      return [{ key: "reko_report", label: translateOutsideReact('notifications.trainingActions.rekoReport'), kind: "reko_report", dueAfterSec: DUE.rekoReport }]
    case "enroute":
      if (opts?.gpsSim && op.coordinates && op.vehicles.length > 0) {
        return [{ key: "drive_to_incident", label: translateOutsideReact('notifications.trainingActions.driveToIncident'), kind: "gps_drive", dueAfterSec: DUE.driveStart }]
      }
      return [{ key: "vehicle_on_scene", label: translateOutsideReact('notifications.trainingActions.vehicleOnScene'), kind: "status", targetStatus: "active", dueAfterSec: DUE.vehicleOnScene }]
    case "active": {
      // On scene, the trainer holds both levers: report "Einsatz beendet"
      // (once) and/or send the vehicles home early (drop-off). After the
      // beendet report the Rückfahrt becomes the primary (packing-up clock);
      // a vehicle already back home never hides the beendet report.
      const actions: NextAction[] = []
      if (!op.fieldCompleteReportedAt) {
        actions.push({ key: "field_complete", label: translateOutsideReact('notifications.trainingActions.fieldComplete'), kind: "field_complete", dueAfterSec: DUE.incidentDone })
      }
      if (opts?.gpsSim && op.vehicles.length > 0) {
        const action: NextAction = { key: "drive_to_magazin", label: translateOutsideReact('notifications.trainingActions.driveToMagazin'), kind: "gps_return", dueAfterSec: DUE.returnStart }
        if (op.fieldCompleteReportedAt) actions.unshift(action)
        else actions.push(action)
      }
      return actions
    }
    case "returning":
      // Operator already moved the card to Rückführung — vehicles still assigned
      // should actually drive home so the release prompt can fire.
      if (opts?.gpsSim && op.vehicles.length > 0) {
        return [{ key: "drive_to_magazin", label: translateOutsideReact('notifications.trainingActions.driveToMagazin'), kind: "gps_return", dueAfterSec: DUE.driveStart }]
      }
      return []
    case "complete":
      // Closed on the board, but the field still owes its Schadenplatz-Rapport
      // (plan 25). Same candidate rule as the bulk endpoint: completed and no
      // *submitted* rapport — a draft is somebody who walked away, not a filing.
      if (!op.hasSchadenplatzRapport) {
        return [{ key: "rapport", label: translateOutsideReact('notifications.trainingActions.rapport'), kind: "rapport", dueAfterSec: DUE.rapportFiled }]
      }
      return []
    // "incoming" (operator tasks Reko) and "reko_done" (operator disponiert) are
    // command-post decisions — no field action.
    case "incoming":
    case "reko_done":
    default:
      return []
  }
}

/**
 * When the incident entered its CURRENT step. For the "Reko-Meldung" step this
 * is the arrival time (the assessment clock); for the "Rückfahrt" step after a
 * "beendet" report it is that report (the packing-up clock); otherwise the last
 * status change. Null when no timestamp is known yet (freshly created).
 */
export function stepStartedAt(op: Operation): Date | null {
  if (op.status === "reko" && op.rekoArrivedAt) return op.rekoArrivedAt
  if (op.status === "active" && op.fieldCompleteReportedAt) return op.fieldCompleteReportedAt
  return op.statusChangedAt
}

/** Seconds the incident has spent in its current step, or null if unknown. */
export function secondsInStep(op: Operation, now: number): number | null {
  const started = stepStartedAt(op)
  if (!started) return null
  return Math.max(0, Math.floor((now - started.getTime()) / 1000))
}

/**
 * Whether the incident's next action is "due" (has waited past its expected
 * dwell time). Unknown step-start counts as due so a card never gets stranded
 * without a recommendation.
 */
export function isActionDue(op: Operation, action: NextAction, now: number): boolean {
  const elapsed = secondsInStep(op, now)
  if (elapsed === null) return true
  return elapsed >= action.dueAfterSec
}
