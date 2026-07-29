/**
 * The one place the board's status vocabulary meets the API's.
 *
 * The database stores the incident lifecycle in German identifiers
 * (`eingegangen … abschluss`, see the CHECK constraint on `incidents.status`), while the
 * board works in English ones (`incoming … complete`). Something has to bridge the two, and
 * that bridge used to be written out by hand three times inside `operations-context.tsx` —
 * once inbound and twice outbound, under two different names. A status added or renamed in
 * two of the three places would have desynced the UI silently, which is the kind of bug that
 * only shows up on the board during an Einsatz.
 *
 * Note what is NOT here: the German the operator READS. Those labels come from `de.json`
 * through next-intl and belong to the translation layer, not to this file. This module is
 * about identifiers in code, and the long-term direction is for the API to speak the English
 * ones too — at which point this file collapses to nothing. Until that migration, it is the
 * single seam.
 *
 * The outbound map is DERIVED from the inbound one rather than typed out, so the two cannot
 * drift into disagreeing about a status; `incident-status.test.ts` pins that they are exact
 * inverses and that every status is covered.
 */

import type { IncidentStatus } from "@/lib/api/types/incidents"

/** The board's own status vocabulary. */
export type OperationStatus =
  | "incoming"
  | "ready"
  | "rekoDone"
  | "enroute"
  | "active"
  | "returning"
  | "complete"

/**
 * API status → board status.
 *
 * `reko → ready` is the odd pair: a Reko is a running reconnaissance order, not a state of
 * readiness. The name is inherited and kept here only so the mapping stays truthful about
 * what the code does — worth revisiting when the API moves to English identifiers.
 */
export const OPERATION_STATUS_BY_INCIDENT_STATUS: Record<IncidentStatus, OperationStatus> = {
  eingegangen: "incoming",
  reko: "ready",
  reko_done: "rekoDone",
  disponiert: "enroute",
  einsatz: "active",
  einsatz_beendet: "returning",
  abschluss: "complete",
}

/** Board status → API status. Inverted from the map above, never written out separately. */
export const INCIDENT_STATUS_BY_OPERATION_STATUS = Object.fromEntries(
  Object.entries(OPERATION_STATUS_BY_INCIDENT_STATUS).map(([incidentStatus, operationStatus]) => [
    operationStatus,
    incidentStatus,
  ]),
) as Record<OperationStatus, IncidentStatus>

/**
 * API status → board status, for values that arrive as a bare string.
 *
 * Falls back to `incoming` for anything unrecognised: a status this build has never heard of
 * is far likelier to be a newer backend than corruption, and putting the card in the first
 * column keeps it visible and movable instead of dropping it off the board.
 */
export function toOperationStatus(status: string): OperationStatus {
  return OPERATION_STATUS_BY_INCIDENT_STATUS[status as IncidentStatus] ?? "incoming"
}

/** Board status → API status. Total, so no fallback is needed. */
export function toIncidentStatus(status: OperationStatus): IncidentStatus {
  return INCIDENT_STATUS_BY_OPERATION_STATUS[status]
}
