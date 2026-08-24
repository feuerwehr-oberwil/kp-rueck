'use client'

/**
 * The board-wide incident time mode.
 *
 * Deliberately NOT per-component state. If one card could show «Zeit in Spalte»
 * while the one next to it showed «seit Alarm», the two numbers would be
 * incomparable at a glance — which is the bug this whole thing exists to fix.
 * So the mode lives in a module-level store and every mounted chip re-renders
 * together when it changes.
 *
 * Resolution, weakest to strongest:
 *   1. `DEFAULT_INCIDENT_TIME_MODE` — what the board always did.
 *   2. the `incident_time_display` station setting — the Kommando's house style,
 *      set once in the Einstellungen and inherited by every device.
 *   3. a per-device choice in localStorage — what the dropdown writes. A wall
 *      display and the operator's board can legitimately want different things,
 *      and neither should be able to change the other.
 *
 * The station setting is fetched exactly once per page load, by the first chip
 * that mounts. A failure (offline, viewer token, the public token board) is not
 * an error worth surfacing: the default is a perfectly good answer.
 */

import { useSyncExternalStore } from 'react'

import { apiClient } from '@/lib/api-client'
import {
  DEFAULT_INCIDENT_TIME_MODE,
  isIncidentTimeMode,
  type IncidentTimeMode,
} from '@/lib/incident-time'
import { readItem, writeItem } from '@/lib/utils/safe-storage'

const STORAGE_KEY = 'kp-board-incidentTimeMode'

let mode: IncidentTimeMode = DEFAULT_INCIDENT_TIME_MODE
/** Set once the device has made its own choice — the station setting must not overwrite it. */
let hasDeviceOverride = false
let initialised = false

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function set(next: IncidentTimeMode) {
  if (next === mode) return
  mode = next
  emit()
}

function initialise() {
  if (initialised) return
  initialised = true

  const stored = readItem(STORAGE_KEY)
  if (isIncidentTimeMode(stored)) {
    hasDeviceOverride = true
    set(stored)
  }

  // Another tab on the same device switched — keep the surfaces on one machine
  // in step (board on one monitor, display on the next).
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    if (isIncidentTimeMode(event.newValue)) {
      hasDeviceOverride = true
      set(event.newValue)
    }
  })

  // `try` as well as `.catch`: this fires from a subscribe callback deep inside
  // React's commit phase, where a synchronous throw takes the whole board down —
  // and a time chip is never worth that.
  try {
    Promise.resolve(apiClient.getAllSettings())
      .then((settings) => {
        const stationDefault = settings?.incident_time_display
        if (!hasDeviceOverride && isIncidentTimeMode(stationDefault)) set(stationDefault)
      })
      .catch(() => {
        // No settings (viewer token, offline, public board) — the default stands.
      })
  } catch {
    // Same.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  initialise()
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): IncidentTimeMode {
  return mode
}

/**
 * Nothing on the Next server ever calls `initialise` or `setIncidentTimeMode`,
 * so the module value there is always the default and hydration matches. In the
 * browser this branch is only reached by static renders (Leaflet tooltips),
 * where returning the live mode is exactly what we want.
 */
function getServerSnapshot(): IncidentTimeMode {
  return mode
}

/** Set the per-device mode. Persisted; the station setting no longer applies here. */
export function setIncidentTimeMode(next: IncidentTimeMode): void {
  hasDeviceOverride = true
  writeItem(STORAGE_KEY, next)
  set(next)
}

export function useIncidentTimeMode(): {
  mode: IncidentTimeMode
  setMode: (next: IncidentTimeMode) => void
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { mode: current, setMode: setIncidentTimeMode }
}
