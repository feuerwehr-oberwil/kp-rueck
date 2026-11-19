/**
 * Planned von/bis – «kommt um 20:00» / «geht um 22:00» (feedback 19.11.2026, #3).
 *
 * KP Front's Schicht in one block per person: a PLAN beside the attendance record, never a
 * write to it (the plan says what should happen, the check-in what did). The Appell's time
 * chip, the check-in link and /feld set it; the pickers say «bis 22:00» and advise, amber,
 * when a ticked person leaves within `PLAN_SOON_MINUTES`; the bell rings 15' before
 * (backend `notification_service._check_leaving_alerts`).
 *
 * Same maths as KP Front's `lib/shifts.ts`: half-hour slots for the quick steps
 * (`ceilSlot`), and a plan never ends before it starts. All pure, so the surfaces render.
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** KP Front's grid resolution (`SLOT_MIN`): the quick steps land on a half hour. */
export const SLOT_MS = 30 * MINUTE_MS

/** A ticked person who leaves within this many minutes gets the amber advice (mock 7A). */
export const PLAN_SOON_MINUTES = 60

/**
 * How far back a typed clock may still mean «today». A plan looks forward, but «geht um 19:00»
 * typed at 19:20 is late news, not a 24-hour shift – so the window is [now − 6 h, now + 18 h).
 */
const LOOKBACK_MS = 6 * HOUR_MS

/** KP Front's `ceilSlot`: up to the next half-hour boundary (unchanged when already on one). */
export const ceilSlot = (t: number): number => Math.ceil(t / SLOT_MS) * SLOT_MS

/**
 * The instant a typed «HH:MM» means, on the device's clock: its one occurrence in
 * [now − 6 h, now + 18 h). «01:00» at 22:00 is tomorrow; «19:00» at 19:20 is twenty minutes
 * ago. `null` for anything that is not a clock.
 */
export function resolveClock(hhmm: string, now: number): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  const at = new Date(now)
  at.setHours(hours, minutes, 0, 0)
  // A setDate step, not ±24 h: across a DST change the day is 23 or 25 hours long.
  while (at.getTime() < now - LOOKBACK_MS) at.setDate(at.getDate() + 1)
  while (at.getTime() >= now - LOOKBACK_MS + 24 * HOUR_MS) at.setDate(at.getDate() - 1)
  return at
}

/** «22:00» for a `<input type="time">` value (device clock, 24 h), `''` for none. */
export function clockValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** A quick step («+1 h»): from `now`, up to the next half hour – KP Front's `draftShift` anchor. */
export function inHours(now: number, hours: number): Date {
  return new Date(ceilSlot(now + hours * HOUR_MS))
}

/** Whole minutes until `iso` (negative once it has passed), or null without one. */
export function minutesUntil(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const at = new Date(iso).getTime()
  return Number.isNaN(at) ? null : Math.floor((at - now) / MINUTE_MS)
}

/** Leaves within `PLAN_SOON_MINUTES` – or should already have gone. */
export function leavesSoon(plannedUntil: string | null | undefined, now: number): boolean {
  const left = minutesUntil(plannedUntil, now)
  return left !== null && left < PLAN_SOON_MINUTES
}

/** The plan a person's tile states: «ab 20:00» while the arrival is ahead, else «bis 22:00». */
export type PlanFact = { kind: 'from' | 'until'; at: string; soon: boolean }

export function planFact(
  person: { plannedFrom?: string | null; plannedUntil?: string | null },
  now: number,
): PlanFact | null {
  const from = minutesUntil(person.plannedFrom, now)
  if (person.plannedFrom && from !== null && from > 0) return { kind: 'from', at: person.plannedFrom, soon: false }
  if (person.plannedUntil && minutesUntil(person.plannedUntil, now) !== null) {
    return { kind: 'until', at: person.plannedUntil, soon: leavesSoon(person.plannedUntil, now) }
  }
  return null
}

/**
 * KP Front's `keepEndAfterStart` / `keepStartBeforeEnd`: a «bis» on or before its «von» steps
 * a day forward (a «von» on or after its «bis» a day back) until the block runs forwards – the
 * same clock, on the day that makes sense. Unchanged without the other end.
 */
export function keepOrdered(at: Date, kind: 'from' | 'until', other: string | null | undefined): Date {
  const bound = other ? new Date(other).getTime() : Number.NaN
  if (Number.isNaN(bound)) return at
  const out = new Date(at)
  for (let i = 0; i < 3; i++) {
    if (kind === 'until' && out.getTime() <= bound) out.setDate(out.getDate() + 1)
    else if (kind === 'from' && out.getTime() >= bound) out.setDate(out.getDate() - 1)
    else break
  }
  return out
}
