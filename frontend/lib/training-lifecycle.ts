import type { Operation, OperationStatus } from "./contexts/operations-context"

// ── Training conductor: FIELD lifecycle steps ────────────────────────────────
// Drives the "Nächste Aktionen" console in the Übungs-Steuerung. The trainer
// only simulates what happens IN THE FIELD — command-post decisions (tasking a
// Reko, disponieren, closing the incident) stay with the operator (trainee) on
// the board. So the console exposes exactly the field-originated milestones:
//
//   Reko vor Ort → Reko-Meldung → Fahrzeug vor Ort → (Feld meldet: beendet)
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
  | "field_complete" // field reports "Einsatz beendet" — info badge, NO status change

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
  vehicleOnScene: 150, // travel time before the vehicles reach the scene
  incidentDone: 420, // time working the incident (~7 min) before the crew reports done
} as const

/**
 * The single recommended FIELD action for an incident, or null when the next
 * move belongs to the operator (Eingegangen, Reko abgeschlossen), the incident
 * is closed, or completion was already reported. Aware of the Reko sub-state:
 * the crew must first arrive ("Reko vor Ort") before the report ("Reko-Meldung").
 */
export function nextAction(op: Operation): NextAction | null {
  switch (op.status) {
    case "ready":
      if (!op.rekoArrivedAt) {
        return { key: "reko_arrived", label: "Reko vor Ort", kind: "reko_arrived", dueAfterSec: DUE.rekoArrived }
      }
      return { key: "reko_report", label: "Reko-Meldung", kind: "reko_report", dueAfterSec: DUE.rekoReport }
    case "enroute":
      return { key: "vehicle_on_scene", label: "Fahrzeug vor Ort", kind: "status", targetStatus: "active", dueAfterSec: DUE.vehicleOnScene }
    case "active":
      // Field reports "Einsatz beendet" once — after that the operator closes it,
      // so drop the action to avoid re-suggesting a completed report.
      if (op.fieldCompleteReportedAt) return null
      return { key: "field_complete", label: "Einsatz beendet", kind: "field_complete", dueAfterSec: DUE.incidentDone }
    // "incoming" (operator tasks Reko) and "rekoDone" (operator disponiert) are
    // command-post decisions — no field action. "returning"/"complete" are done.
    case "incoming":
    case "rekoDone":
    case "returning":
    case "complete":
    default:
      return null
  }
}

/**
 * When the incident entered its CURRENT step. For the "Reko-Meldung" step this
 * is the arrival time (the assessment clock), otherwise the last status change.
 * Null when neither timestamp is known yet (freshly created, pre-first-sync).
 */
export function stepStartedAt(op: Operation): Date | null {
  if (op.status === "ready" && op.rekoArrivedAt) return op.rekoArrivedAt
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
