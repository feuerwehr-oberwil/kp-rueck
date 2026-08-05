/**
 * Incident time — one vocabulary for "how long has this been going?".
 *
 * The board used to show two different numbers that looked identical: the
 * kanban card's chip meant «Zeit in dieser Spalte», the detail header and the
 * map list meant «Zeit seit Alarmierung», and nothing on screen said which. Two
 * operators reading two surfaces could disagree about the same incident by an
 * hour and both be right.
 *
 * So there is exactly one set of three meanings, and one of them is active for
 * the whole app at a time (see `use-incident-time-mode`) — cards stay
 * comparable to each other and to the wall display:
 *
 *   Start   🕐  when the incident came in            → `HH:MM`
 *   Spalte  ⏱  how long it has sat in this status   → `12'` / `1h 23'`  (default)
 *   Total   ⏳  how long since the alarm             → `12'` / `1h 23'`
 *
 * The duration shape comes from `getTimeSince` and is deliberately NOT
 * localised: `12'` / `1h 23'` is the notation the station already reads off the
 * magnet board.
 */

import { Clock, Hourglass, Timer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { getTimeSince } from '@/lib/kanban-utils'

export type IncidentTimeMode = 'start' | 'column' | 'total'

/** Menu order: absolute first, then the two durations from narrow to wide. */
export const INCIDENT_TIME_MODES: readonly IncidentTimeMode[] = ['start', 'column', 'total'] as const

/**
 * What the board has always shown on its cards. Also the value seeded into the
 * `incident_time_display` station setting.
 */
export const DEFAULT_INCIDENT_TIME_MODE: IncidentTimeMode = 'column'

/** A distinct icon per mode, so the chip itself says which of the three it is. */
export const INCIDENT_TIME_MODE_ICON: Record<IncidentTimeMode, LucideIcon> = {
  start: Clock,
  column: Timer,
  total: Hourglass,
}

export function isIncidentTimeMode(value: unknown): value is IncidentTimeMode {
  return value === 'start' || value === 'column' || value === 'total'
}

/**
 * The two timestamps every mode is derived from. Structural on purpose: an
 * `Operation` satisfies it directly, and the raw API incident (`created_at` /
 * `status_changed_at`) can be adapted with `incidentTimeSource`.
 */
export interface IncidentTimeSource {
  dispatchTime: Date
  statusChangedAt?: Date | null
}

/** Adapt a raw API incident (snake_case, dates already parsed) to the source shape. */
export function incidentTimeSource(incident: {
  created_at: Date
  status_changed_at?: Date | null
}): IncidentTimeSource {
  return { dispatchTime: incident.created_at, statusChangedAt: incident.status_changed_at ?? null }
}

/** `HH:MM`, 24-hour. The one formatter for an absolute incident time. */
export function formatClockTime(date: Date): string {
  return date.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
}

/**
 * The instant a mode measures from.
 *
 * `statusChangedAt` is derived per request from the latest status transition and
 * can be absent (or lag a beat behind the status itself), so `column` falls back
 * to the dispatch time — which is where the incident's current status began when
 * it has never moved.
 */
export function incidentTimeReference(source: IncidentTimeSource, mode: IncidentTimeMode): Date {
  if (mode === 'column') return source.statusChangedAt ?? source.dispatchTime
  return source.dispatchTime
}

/** True for the modes that render a running duration rather than a fixed clock time. */
export function isDurationMode(mode: IncidentTimeMode): boolean {
  return mode !== 'start'
}

/** The rendered value for a mode: `HH:MM` for `start`, `getTimeSince` otherwise. */
export function formatIncidentTime(source: IncidentTimeSource, mode: IncidentTimeMode): string {
  const reference = incidentTimeReference(source, mode)
  return mode === 'start' ? formatClockTime(reference) : getTimeSince(reference)
}
