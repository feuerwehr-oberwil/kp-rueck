/**
 * Duration — the one place that turns «how long» into text.
 *
 * Every running clock in the app (card age chip, Ereignis clock, vehicle
 * assignment time, pickup wait, the «seit …» lines) used to do its own minute
 * maths, and all of them ended in hours forever: a Unwetter-Ereignis on its
 * second day read «34h 12'» — a number the operator has to divide by 24 before
 * it means anything, and wide enough to push the location off a phone card.
 *
 * So from one day on every compact form switches to days + hours («1d 10h»).
 * Below a day each surface keeps the notation it has always had: the board's
 * magnet-board `12'` / `1h 23'`, the Ereignis clock's `12m` / `1h 04m`.
 * Minutes are dropped at day scale on purpose: on a multi-day Einsatz the
 * minute is noise, and the full value is always in the accessible label
 * (`formatDurationLong`) and the tooltip.
 *
 * Only the TEXT changes here. The age colours (60/120 minutes, `ageLevel`) are
 * a Fachentscheidung and live in `kanban-utils.ts`, untouched.
 */

export interface DurationParts {
  /** Whole minutes in total (clamped at 0). */
  totalMinutes: number
  days: number
  /** Hours within the day (0–23). */
  hours: number
  /** Minutes within the hour (0–59). */
  minutes: number
}

const MINUTE_MS = 60_000

/**
 * Split a span into whole days / hours / minutes. Negative spans (a timestamp a
 * few seconds in the future through clock skew) clamp to zero, so nothing ever
 * renders «-1'».
 */
export function splitDuration(ms: number): DurationParts {
  const totalMinutes = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / MINUTE_MS)) : 0
  const totalHours = Math.floor(totalMinutes / 60)
  return {
    totalMinutes,
    days: Math.floor(totalHours / 24),
    hours: totalHours % 24,
    minutes: totalMinutes % 60,
  }
}

/**
 * - `board` — the card / list notation the station reads off the magnet board:
 *   `12'`, `1h 23'`, `1d 10h`.
 * - `clock` — the Ereignis clock in the header: `12m`, `1h 04m`, `1d 10h`.
 */
export type DurationStyle = 'board' | 'clock'

/** Compact duration for a chip. ≥ 1 day always reads `«d»d «h»h`. */
export function formatDuration(ms: number, style: DurationStyle = 'board'): string {
  const { totalMinutes, days, hours, minutes } = splitDuration(ms)
  if (days > 0) return `${days}d ${hours}h`
  const totalHours = Math.floor(totalMinutes / 60)
  if (style === 'clock') {
    return totalHours > 0 ? `${totalHours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`
  }
  return totalHours > 0 ? `${totalHours}h ${minutes}'` : `${minutes}'`
}

/** Compact duration from `since` until `now`. */
export function formatDurationSince(since: Date, now: number = Date.now(), style: DurationStyle = 'board'): string {
  return formatDuration(now - since.getTime(), style)
}

/**
 * Translator for the `common.duration` namespace (`days` / `hours` / `minutes`,
 * each an ICU plural on `count`). Passed in so this module stays usable from
 * plain functions and tests.
 */
export type DurationTranslator = (key: 'days' | 'hours' | 'minutes', values: { count: number }) => string

/**
 * The spoken / tooltip form: «1 Tag 10 Stunden», «2 Stunden 5 Minuten»,
 * «12 Minuten». At day scale the minutes are left out, matching the chip; a
 * zero part in the middle is skipped («2 Tage», «3 Stunden»).
 */
export function formatDurationLong(ms: number, t: DurationTranslator): string {
  const { totalMinutes, days, hours, minutes } = splitDuration(ms)
  if (days > 0) {
    return hours > 0 ? `${t('days', { count: days })} ${t('hours', { count: hours })}` : t('days', { count: days })
  }
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours > 0) {
    return minutes > 0
      ? `${t('hours', { count: totalHours })} ${t('minutes', { count: minutes })}`
      : t('hours', { count: totalHours })
  }
  return t('minutes', { count: minutes })
}
