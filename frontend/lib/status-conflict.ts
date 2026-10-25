'use client'

/**
 * «Gerade geändert» – a status move the server refused because the card had moved.
 *
 * Two operators, seconds apart (sweep 2026-10-23, TESTS-01, owner pick B): Fischer
 * closes «Rebbergstrasse 5», four seconds later this board's drag from the stale card
 * lands. The server answers 409 `incident_status_changed` and changes nothing
 * (`backend/app/crud/incidents.py`, `_guard_seen_status`). Every status write on the
 * board goes through `updateOperation`, which sends the status its board showed as
 * `from_status`; the GPS prompts send theirs to `/status`. Both hand a refusal to
 * `reportStatusConflict` – the one place that turns it into the dialog
 * (`components/kanban/status-conflict-dialog.tsx`, mounted once in the root layout).
 * The ink answer keeps the server's state; «Trotzdem …» resends the move through
 * `updateOperation` with `override_status`, which the server records with the stale
 * mark the Verlauf shows («war schon abgeschlossen (vor 4 s)»).
 */

import { useSyncExternalStore } from 'react'

import { ApiError } from '@/lib/api/types/common'
import { formatDuration } from '@/lib/duration'
import { isIncidentStatus, type IncidentStatus } from '@/lib/types/incidents'

export const STATUS_CHANGED_CODE = 'incident_status_changed'

export interface StatusConflict {
  operationId: string
  /** What this board showed when the operator moved the card. */
  seen: IncidentStatus
  /** Where the operator moved it. */
  wanted: IncidentStatus
  /** Where the server has it now – the state «… lassen» keeps. */
  current: IncidentStatus
  /** Who put it there; null for a move nobody signed (the field, the GPS automation). */
  changedBy: string | null
  /** Seconds since that move, by the server's clock; null when the server had no transition. */
  secondsAgo: number | null
  /** The names a «Trotzdem …» out of «Abgeschlossen» assigns again, comma-separated. */
  released: string | null
}

/** What the operator tried; the server's answer fills in the rest. */
export interface StatusMove {
  operationId: string
  seen: IncidentStatus
  wanted: IncidentStatus
}

/** The conflict in a 409 `incident_status_changed`, or null for any other error. */
export function statusConflictFrom(err: unknown, move: StatusMove): StatusConflict | null {
  if (!(err instanceof ApiError) || err.status !== 409 || err.code !== STATUS_CHANGED_CODE) return null
  const { status, changed_by, seconds_ago, released } = err.params ?? {}
  if (typeof status !== 'string' || !isIncidentStatus(status)) return null
  return {
    ...move,
    current: status,
    changedBy: typeof changed_by === 'string' && changed_by ? changed_by : null,
    secondsAgo: typeof seconds_ago === 'number' ? seconds_ago : null,
    released: typeof released === 'string' && released ? released : null,
  }
}

// One open conflict at a time, the newest wins: a second refusal says the later truth.
let open: StatusConflict | null = null
const listeners = new Set<() => void>()
const reportListeners = new Set<(conflict: StatusConflict) => void>()

function emit(next: StatusConflict | null) {
  open = next
  for (const listener of listeners) listener()
  if (next) for (const listener of reportListeners) listener(next)
}

/**
 * Called once per refusal. The status gates (`useIncidentStatusWorkflow`) open after
 * the card moved and treat «Abbrechen» as an undo – for a refused move there is
 * nothing to undo, so they close on this instead.
 */
export function onStatusConflict(listener: (conflict: StatusConflict) => void): () => void {
  reportListeners.add(listener)
  return () => {
    reportListeners.delete(listener)
  }
}

/**
 * Open «Gerade geändert» when `err` is a stale-status refusal. True = handled: the
 * caller reloads the board (so the card sits where the server has it) and says
 * nothing else; false = some other error, the caller's own handling applies.
 */
export function reportStatusConflict(err: unknown, move: StatusMove): boolean {
  const conflict = statusConflictFrom(err, move)
  if (!conflict) return false
  emit(conflict)
  return true
}

export function dismissStatusConflict() {
  emit(null)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The open conflict, or null. */
export function useStatusConflict(): StatusConflict | null {
  return useSyncExternalStore(subscribe, () => open, () => null)
}

type KanbanT = (key: string, values?: Record<string, string | number>) => string

/** «vor 4 s» / «vor 3'» / «soeben» – how long ago, said through the `kanban` messages. */
export function formatStaleAgo(seconds: number | null | undefined, t: KanbanT): string {
  if (seconds == null) return t('statusConflict.agoNow')
  if (seconds < 60) return t('statusConflict.agoSeconds', { seconds })
  return t('statusConflict.agoDuration', { duration: formatDuration(seconds * 1000) })
}
