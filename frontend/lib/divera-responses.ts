/**
 * «Anrückend» — what the Appell and the Personen-Leiste make of the Divera Rückmeldungen.
 *
 * The backend has already classified every answer (coming / not_coming / other, see
 * `backend/app/services/divera_responses.py`); this only decides what is still worth
 * showing on the board:
 *
 * - People already checked in drop out — the block answers «wer kommt noch?», and a Divera
 *   answer never checks anybody in by itself (presence stays one explicit tap).
 * - «kommt nicht» is its own group, never mixed into the coming list: those people are most
 *   likely not there, but a misclick happens, so check-in is still offered for them.
 * - Answers from Divera members nobody on the roster is linked to are only counted.
 */

import type { ApiDiveraResponsePerson, ApiDiveraResponsesSummary } from '@/lib/api/types'

/** A roster person's answer, `personnel_id` known. */
export type IncomingPerson = ApiDiveraResponsePerson & { personnel_id: string }

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

export function groupIncoming(
  summary: ApiDiveraResponsesSummary | null,
  checkedInIds: ReadonlySet<string>,
): IncomingGroups {
  const groups: IncomingGroups = { coming: [], other: [], notComing: [], unmapped: 0 }
  if (!summary?.available) return groups
  for (const person of summary.people) {
    if (!person.personnel_id) {
      groups.unmapped += 1
      continue
    }
    if (checkedInIds.has(person.personnel_id)) continue
    const mapped = person as IncomingPerson
    if (person.kind === 'coming') groups.coming.push(mapped)
    else if (person.kind === 'not_coming') groups.notComing.push(mapped)
    else groups.other.push(mapped)
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
