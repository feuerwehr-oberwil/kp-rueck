/**
 * HH:MM editing for the field timestamps (plan 25).
 *
 * Shared by the "Feldmeldungen" row and the Schadenplatz-Rapport form, because
 * both let an operator correct a time that already exists and both have to fold
 * the edit onto the right *day*.
 */

/** A Date as the value of an `<input type="time">`, or '' when there is none. */
export function toTimeInput(value: Date | null | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return ''
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

/**
 * Fold an HH:MM edit back onto the day the report belongs to.
 *
 * The date comes from the existing timestamp, not from `now`: an operator
 * correcting "23:14" at 00:20 means yesterday's 23:14, and silently moving it a
 * day forward would put the report after the incident it belongs to.
 */
export function applyTimeEdit(existing: Date | null | undefined, time: string, now: Date = new Date()): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  const base = existing && !Number.isNaN(existing.getTime()) ? new Date(existing) : new Date(now)
  base.setHours(hours, minutes, 0, 0)
  return base
}
