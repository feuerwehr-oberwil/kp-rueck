/**
 * The `/feld` feed's rules about one assignment: which bucket it sorts into,
 * whether it is still live work, where the crew is on its journey, and whether
 * the Rapport is theirs to file. Plus the routing-only decode of the bound
 * credential a direct Reko link carries.
 *
 * Moved out of `app/feld/page.tsx` verbatim (2026-09-23) so the rules can be
 * tested without mounting the page. Pure: no React, no cookies, no fetches.
 */

import type { ApiFeldAssignment } from '@/lib/api-client'
import { rapportApplies } from '@/lib/rapport-visibility'

/**
 * The four buckets the feed sorts into, strongest first (plan 26 §3).
 *
 * **Fixed order, not a computed score.** The whole design leans on the crew
 * being able to explain the list in four words — jetzt · Rapport fehlt ·
 * unterwegs · offen — and bucket 2 is load-bearing: a Schadenplatz somebody has
 * already left, still owing a Rapport, must never sort below a newer task. That
 * is the requirement the whole surface exists for.
 */
export function feedBucket(assignment: ApiFeldAssignment): number {
  if (isLiveAssignment(assignment) && assignment.arrived_at) return 0 // jetzt: standing there
  if (owesRapport(assignment)) return 1 // abgerückt, aber offen
  if (isLiveAssignment(assignment)) return 2 // unterwegs
  return 3
}

/** Still owes one: the rapport applies here (which already means it is a crew
 *  row) and nobody has filed it yet. This is bucket 2 of the feed — the reason
 *  a Schadenplatz somebody has already left stays near the top. */
export function owesRapport(assignment: ApiFeldAssignment): boolean {
  return assignment.rapport_state !== 'submitted' && assignmentRapportApplies(assignment)
}

/** Statuses from «Disponiert» on — the KP has moved past the recce. */
const REKO_WINDOW_CLOSED_STATUSES = new Set(['enroute', 'active', 'returning', 'complete'])

/**
 * The Reko person's contribution window is over: the Schadenplatz was
 * disponiert (or later) without a Reko-Meldung ever landing. The KP has
 * decided on other grounds, so a Reko filed now would brief nobody — the row
 * moves under «Früher» and stops offering the form.
 */
export function rekoWindowClosed(assignment: ApiFeldAssignment): boolean {
  return (
    assignment.source === 'reko' &&
    !assignment.reko &&
    REKO_WINDOW_CLOSED_STATUSES.has(assignment.incident_status)
  )
}

/** What the feed treats as live work: still assigned, and — for a Reko row —
 *  the window still open. The assignment flag alone kept a stale Reko auftrag
 *  sorted above finished work forever, because Reko assignments are never
 *  formally released. */
export function isLiveAssignment(assignment: ApiFeldAssignment): boolean {
  return assignment.is_active_assignment && !rekoWindowClosed(assignment)
}

/**
 * Recognizes a bound or one-use picker credential WITHOUT verifying it.
 *
 * The board's direct Reko link carries a *bound* feld token (the strength the
 * code exchange mints — plan 26, decision 18), so the person it was sent to
 * lands here already authenticated: no code screen, no picker. Decoding is
 * routing only — it decides which screens to skip; the server verifies the
 * signature on every request, so a forged payload buys an empty list, never
 * access.
 */
export function decodeFeldCredential(token: string): { personnelId: string | null } | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (payload?.type === 'feld' && payload.unlocked) {
      return { personnelId: payload.personnel_id && payload.claim_id ? String(payload.personnel_id) : null }
    }
  } catch {
    // Not a readable JWT — the poster-token path below handles it.
  }
  return null
}

/**
 * Where this row is in the crew's own evening: hin — dran — zurück.
 *
 * Deliberately NOT the board's status. «Disponiert» is the KP's word for a
 * decision they made, and a crew already standing in the water reads it as a
 * claim about themselves; that is why the rows carried no status at all. But
 * carrying none made a Schadenplatz somebody had finished look exactly like the
 * one they are driving to — a Rückfahrt sat at the top of the list saying
 * nothing. The journey is the part that IS about them, and every state below is
 * read off their own taps (plus the one status that says the job is over).
 */
export function journeyState(assignment: ApiFeldAssignment): 'approach' | 'onSite' | 'returning' | null {
  if (!isLiveAssignment(assignment)) return null
  if (assignment.field_complete_reported_at || assignment.incident_status === 'returning') return 'returning'
  if (assignment.arrived_at) return 'onSite'
  return 'approach'
}

/**
 * Does this SCHADENPLATZ have a Rapport at all? (§18.27)
 *
 * About the incident, not about who is looking at it: nobody was ever sent
 * here, so there is nothing to report on.
 */
export function incidentHasRapport(assignment: ApiFeldAssignment): boolean {
  return rapportApplies({
    hasBeenDispatched: assignment.has_been_dispatched,
    status: assignment.incident_status,
    hasReport: assignment.rapport_state !== 'none',
    // «Kein Einsatz nötig» + closed = nothing was done here, no rapport (§P2.7).
    rekoNotRelevant: assignment.reko?.is_relevant === false,
  })
}

/**
 * Is the Rapport **this person's** to file?
 *
 * Two questions, deliberately separate. Folding them into one told a driver
 * standing at a long-dispatched Schadenplatz that it "wird erst erfasst, wenn
 * der Schadenplatz disponiert wurde" — the right answer to a question nobody
 * had asked, and a visibly false statement about the incident.
 *
 * Only a `crew` row owes one (plan 26, decision 11): a driver parked outside
 * and a Reko trupp that only looked owe nothing, and the server refuses the
 * write — so the form must not be offered either.
 */
export function assignmentRapportApplies(assignment: ApiFeldAssignment): boolean {
  return assignment.source === 'crew' && incidentHasRapport(assignment)
}
