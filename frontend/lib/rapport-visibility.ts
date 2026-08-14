/**
 * Does the Schadenplatz-Rapport exist for this incident at all? (§18.27)
 *
 * A Schadenplatz nobody was ever sent to has nothing to report on, so the
 * rapport is not "empty" there — it is absent: no form in the detail, no form
 * on `/feld`, no chip on the card, no line in anybody's missing count. The
 * empty rapport was noise on every one of those surfaces.
 *
 * The backend answers the hard half (`has_been_dispatched`, computed from
 * `status_transitions` — see `services/incident_dispatch.py`); this module is
 * the one place the frontend combines it with what it can see locally, so the
 * four surfaces cannot drift apart.
 */

/** The working statuses — mirrors `DISPATCHED_STATUSES` in the backend service,
 *  `complete` deliberately included in neither. Used here for the optimistic
 *  case only: dragging a card into *Disponiert* has to reveal the rapport on
 *  the spot, not one refetch later. */
const DISPATCHED_STATUSES = new Set(["enroute", "active", "returning"])

export function isDispatchedStatus(status: string): boolean {
  return DISPATCHED_STATUSES.has(status)
}

/**
 * The gate every rapport surface asks.
 *
 * `hasReport` always wins: a rapport somebody already filed must never become
 * unreachable — not on data that predates this rule, and not on a card whose
 * history says it was never dispatched. Hiding written work is a worse failure
 * than an empty form on a card that skipped the board.
 */
export function rapportApplies({
  hasBeenDispatched,
  status,
  hasReport,
}: {
  hasBeenDispatched?: boolean
  /** The card's current status — covers the optimistic move described above. */
  status?: string
  /** A rapport row exists, filed or draft. */
  hasReport?: boolean
}): boolean {
  if (hasReport) return true
  if (hasBeenDispatched) return true
  return status !== undefined && isDispatchedStatus(status)
}
