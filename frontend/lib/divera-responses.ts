/**
 * «Anrückend» — what the Appell and the Personen-Leiste make of the Divera Rückmeldungen.
 *
 * Yes/no only (owner decision): the backend has classified every answer as «kommt» or «kommt
 * nicht» at poll time and dropped everything else — no answer times, estimates, status names
 * or notes. This only decides who is still worth showing on the board:
 *
 * - Anybody with an attendance record on this Ereignis drops out — checked in, or in and out
 *   again. The backend flags them (`attended`); the surface adds the ones it knows itself.
 *   A Divera answer never checks anybody in by itself (presence stays one explicit tap).
 * - «kommt nicht» is its own group, never mixed into the coming list: those people are most
 *   likely not there, but a misclick happens, so check-in is still offered for them.
 * - Answers from Divera members nobody on the roster is linked to are only counted.
 */

import type { ApiDiveraResponsePerson, ApiDiveraResponsesSummary } from '@/lib/api/types'

export type IncomingPerson = ApiDiveraResponsePerson

export interface IncomingGroups {
  /** Coming, no attendance record yet — by name. */
  coming: IncomingPerson[]
  /** «kommt nicht», no attendance record — by name. */
  notComing: IncomingPerson[]
  /** Answers no roster person is linked to — a count line, no names. */
  unmapped: number
}

/**
 * @param attendedIds personnel the surface knows to have an attendance record right now —
 *   on top of the backend's `attended`, which is only as fresh as the last read.
 */
export function groupIncoming(
  summary: ApiDiveraResponsesSummary | null,
  attendedIds: ReadonlySet<string>,
): IncomingGroups {
  const groups: IncomingGroups = { coming: [], notComing: [], unmapped: 0 }
  if (!summary?.available) return groups
  groups.unmapped = summary.unmapped
  for (const person of summary.people) {
    if (person.attended || attendedIds.has(person.personnel_id)) continue
    if (person.kind === 'coming') groups.coming.push(person)
    else if (person.kind === 'not_coming') groups.notComing.push(person)
  }
  const byName = (a: IncomingPerson, b: IncomingPerson) => a.name.localeCompare(b.name)
  groups.coming.sort(byName)
  groups.notComing.sort(byName)
  return groups
}

/** Whether the block exists at all: Divera configured AND something recent came from Divera. */
export function showsIncoming(summary: ApiDiveraResponsesSummary | null): summary is ApiDiveraResponsesSummary {
  return !!summary?.available
}
