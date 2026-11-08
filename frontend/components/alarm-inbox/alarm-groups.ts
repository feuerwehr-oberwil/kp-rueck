/**
 * The three sections of the Alarmeingang, and the count on its header icon.
 *
 * - «Neu»: not attached to any Ereignis, not archived, and received in the last 24 hours – what
 *   still waits for somebody to put it on a board. The header icon counts exactly these.
 * - «Heute zugewiesen»: attached in the last 24 hours (the attach time; the receipt time for
 *   rows that never recorded one).
 * - «Früher»: everything else – earlier Ereignisse, archived rows, and an alarm nobody attached
 *   for a day, which can still be attached from there.
 *
 * A rolling 24 hours rather than the calendar day: a storm night crosses midnight, and at 00:30
 * the alarm from 23:50 is still «neu».
 */

import type { ApiDiveraEmergency } from '@/lib/api-client'

export const NEW_WINDOW_MS = 24 * 60 * 60 * 1000

export interface AlarmGroups {
  fresh: ApiDiveraEmergency[]
  today: ApiDiveraEmergency[]
  earlier: ApiDiveraEmergency[]
}

const within = (iso: string | null, now: number) => !!iso && now - Date.parse(iso) < NEW_WINDOW_MS

/** Waiting to be attached (see the file comment). */
export function isNewAlarm(e: ApiDiveraEmergency, now: number): boolean {
  return !e.attached_to_event_id && !e.is_archived && within(e.received_at, now)
}

/** Splits the pool into the sheet's sections; each keeps the pool's order (newest first). */
export function groupAlarms(list: readonly ApiDiveraEmergency[], now: number): AlarmGroups {
  const groups: AlarmGroups = { fresh: [], today: [], earlier: [] }
  for (const e of list) {
    if (isNewAlarm(e, now)) groups.fresh.push(e)
    else if (e.attached_to_event_id && within(e.attached_at ?? e.received_at, now)) groups.today.push(e)
    else groups.earlier.push(e)
  }
  return groups
}

/** The number on the header icon. */
export function countNewAlarms(list: readonly ApiDiveraEmergency[], now: number): number {
  return list.reduce((n, e) => (isNewAlarm(e, now) ? n + 1 : n), 0)
}
