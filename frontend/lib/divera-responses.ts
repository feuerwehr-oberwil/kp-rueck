/**
 * «Anrückend» — what the Appell and the Personen-Leiste make of the Divera Rückmeldungen.
 *
 * The backend has already classified every answer (coming / not_coming / other, see
 * `backend/app/services/divera_responses.py`); this only decides what is still worth
 * showing on the board:
 *
 * - Anybody with an attendance record on this Ereignis drops out — checked in, or in and out
 *   again (somebody who went home is not «anrückend» because of an answer from hours ago).
 *   The backend flags them (`attended`); the surface adds the ones it just checked in itself.
 *   A Divera answer never checks anybody in by itself (presence stays one explicit tap).
 * - «kommt nicht» is its own group, never mixed into the coming list: those people are most
 *   likely not there, but a misclick happens, so check-in is still offered for them.
 * - Answers from Divera members nobody on the roster is linked to are only counted (the
 *   backend does not even send them).
 */

import type { ApiDiveraResponsePerson, ApiDiveraResponsesSummary } from '@/lib/api/types'

export type IncomingPerson = ApiDiveraResponsePerson

export interface IncomingGroups {
  /** Coming, not checked in yet — first expected arrival on top. */
  coming: IncomingPerson[]
  /** Answered something else («Rückruf erbeten») — not checked in. */
  other: IncomingPerson[]
  /** «kommt nicht», not checked in. */
  notComing: IncomingPerson[]
  /** Answers no roster person is linked to — a count line, no names. */
  unmapped: number
}

function time(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
}

/** When to expect them: the estimate if Divera's status has a time, else the answer itself. */
export function arrivalKey(person: ApiDiveraResponsePerson): number {
  return person.eta ? time(person.eta) : time(person.answered_at)
}

/**
 * @param attendedIds personnel the surface knows to have an attendance record right now —
 *   on top of the backend's `attended`, which is only as fresh as the last read.
 */
export function groupIncoming(
  summary: ApiDiveraResponsesSummary | null,
  attendedIds: ReadonlySet<string>,
): IncomingGroups {
  const groups: IncomingGroups = { coming: [], other: [], notComing: [], unmapped: 0 }
  if (!summary?.available) return groups
  groups.unmapped = summary.unmapped
  for (const person of summary.people) {
    if (!person.personnel_id || person.attended || attendedIds.has(person.personnel_id)) continue
    if (person.kind === 'coming') groups.coming.push(person)
    else if (person.kind === 'not_coming') groups.notComing.push(person)
    else groups.other.push(person)
  }
  const byArrival = (a: IncomingPerson, b: IncomingPerson) =>
    arrivalKey(a) - arrivalKey(b) || (a.name ?? '').localeCompare(b.name ?? '')
  const byName = (a: IncomingPerson, b: IncomingPerson) => (a.name ?? '').localeCompare(b.name ?? '')
  groups.coming.sort(byArrival)
  groups.other.sort(byName)
  groups.notComing.sort(byName)
  return groups
}

/** «HH:MM» in the device's language, or null for a missing/broken timestamp. */
export function formatClock(value: string | null | undefined, locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

/** Whether the block exists at all: Divera configured AND something here came from Divera. */
export function showsIncoming(summary: ApiDiveraResponsesSummary | null): summary is ApiDiveraResponsesSummary {
  return !!summary?.available
}
