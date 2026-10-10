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

/** How many of `people` are at or past the threshold right now. */
export function countPastThreshold(
  people: readonly { checkedInAt?: string | null }[],
  fatigueHours: number,
  now: number = Date.now(),
): number {
  return people.filter((p) => dutyLevel(dutyMinutes(p.checkedInAt, now), fatigueHours) !== 'normal').length
}

// ---------------------------------------------------------------------------
// The Dienstzeiten table: every column sorts, the list filters by who is free.

/** One person as the Dienstzeiten table sees them. Minutes are `null` when unknown. */
export interface CrewDutyEntry {
  id: string
  name: string
  checkedInAt: string | null
  /** Since check-in. */
  onDuty: number | null
  /** On an incident or Auftrag since check-in; `null` until the server has answered. */
  assigned: number | null
  /** On duty and on nothing: `onDuty − assigned`. */
  pause: number | null
  /** Einsätze this Ereignis; `null` until the server has answered. */
  count: number | null
  /** Where they are now, `null` = free. */
  now: string | null
}

export type CrewDutySortKey = 'name' | 'since' | 'onDuty' | 'assigned' | 'pause' | 'count' | 'now'
export type SortDirection = 'asc' | 'desc'
export type CrewDutyFilter = 'all' | 'free' | 'busy'

/** The direction a column sorts in on its first click: the figures most first, the words A–Z,
 *  «seit» earliest first — which is the same question as «längste Dienstzeit». */
export const CREW_DUTY_FIRST_DIRECTION: Record<CrewDutySortKey, SortDirection> = {
  name: 'asc',
  since: 'asc',
  onDuty: 'desc',
  assigned: 'desc',
  pause: 'desc',
  count: 'desc',
  now: 'asc',
}

/**
 * Sorted by `key`. Unknown values (no check-in, counts not loaded) always go last, whichever
 * way round; ties fall back to the name, so the list never shuffles between renders.
 */
export function sortCrewDuty(entries: readonly CrewDutyEntry[], key: CrewDutySortKey, direction: SortDirection): CrewDutyEntry[] {
  const sign = direction === 'asc' ? 1 : -1
  const value = (e: CrewDutyEntry): number | string | null => {
    switch (key) {
      case 'name':
        return e.name
      case 'since': {
        const t = e.checkedInAt ? new Date(e.checkedInAt).getTime() : Number.NaN
        return Number.isNaN(t) ? null : t
      }
      case 'now':
        return e.now
      default:
        return e[key]
    }
  }
  return [...entries].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1
    } else if (va !== vb) {
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string, 'de') : va - (vb as number)
      if (cmp !== 0) return sign * cmp
    }
    return a.name.localeCompare(b.name, 'de')
  })
}

/** Free / on something, and a typed word against name and «jetzt». */
export function filterCrewDuty(entries: readonly CrewDutyEntry[], filter: CrewDutyFilter, query: string): CrewDutyEntry[] {
  const words = query.toLocaleLowerCase('de').split(/\s+/).filter(Boolean)
  return entries.filter((e) => {
    if (filter === 'free' && e.now !== null) return false
    if (filter === 'busy' && e.now === null) return false
    const hay = `${e.name} ${e.now ?? ''}`.toLocaleLowerCase('de')
    return words.every((w) => hay.includes(w))
  })
}
