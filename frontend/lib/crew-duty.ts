/**
 * Time on duty — «wer ist wie lange da».
 *
 * One clock for the whole crew: it runs from the person's check-in for this
 * Ereignis (`EventAttendance.checked_in_at`), never from their current
 * assignment. The bell's time-on-duty warning used to measure the assignment,
 * so moving somebody to the next Schadenplatz reset them to zero — the person
 * who had worked three incidents back to back looked fresh. The backend's
 * grouped warning (`_sync_fatigue_notification`) uses this same clock, so the
 * chip and the bell turn at the same minute.
 *
 * The threshold is the station's own «Personalermüdung (Std.)» setting
 * (`fatigue_hours`, default 4). Two steps, both read off it:
 * - `long` from the threshold on (amber) — the same moment the bell speaks;
 * - `over` from 1.5 × the threshold (red) — 6 h at the default.
 * `fatigue_hours` <= 0 switches the colouring off, as it switches the warning off.
 */

export type DutyLevel = 'normal' | 'long' | 'over'

/** Red starts at this multiple of the configured threshold. */
export const DUTY_OVER_FACTOR = 1.5

/** Whole minutes on duty since `checkedInAt`, or null when there is no stamp. */
export function dutyMinutes(checkedInAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!checkedInAt) return null
  const since = new Date(checkedInAt).getTime()
  if (Number.isNaN(since)) return null
  return Math.max(0, Math.floor((now - since) / 60_000))
}

export function dutyLevel(minutes: number | null, fatigueHours: number): DutyLevel {
  if (minutes === null || !(fatigueHours > 0)) return 'normal'
  const threshold = fatigueHours * 60
  if (minutes >= threshold * DUTY_OVER_FACTOR) return 'over'
  if (minutes >= threshold) return 'long'
  return 'normal'
}

/** Text colour per level — tone only; the weight changes too, so colour is never the only signal. */
export const DUTY_TEXT_CLASSES: Record<DutyLevel, string> = {
  normal: 'text-muted-foreground',
  long: 'font-semibold text-amber-600 dark:text-amber-400',
  over: 'font-semibold text-red-600 dark:text-red-400',
}

/**
 * Longest on duty first — the overview answers «who has been here longest».
 * People without a check-in stamp go last; ties by name, so the list is stable.
 */
export function sortByTimeOnDuty<T extends { name: string; checkedInAt?: string | null }>(people: readonly T[]): T[] {
  const stamp = (p: T) => {
    const t = p.checkedInAt ? new Date(p.checkedInAt).getTime() : Number.NaN
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
  }
  return [...people].sort((a, b) => stamp(a) - stamp(b) || a.name.localeCompare(b.name, 'de'))
}

/** How many of `people` are at or past the threshold right now. */
export function countPastThreshold(
  people: readonly { checkedInAt?: string | null }[],
  fatigueHours: number,
  now: number = Date.now(),
): number {
  return people.filter((p) => dutyLevel(dutyMinutes(p.checkedInAt, now), fatigueHours) !== 'normal').length
}
