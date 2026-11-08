'use client'

/**
 * The Alarmeingang: whether its sheet is open, and the one copy of the alarm pool.
 *
 * Module-level like `lib/status-conflict.ts`: the sheet is mounted once in the root layout
 * (`AlarmInboxSheet`), its ways in live elsewhere – the header's inbox icon
 * (`AlarmInboxButton`, in `PageNavigation`), the phone's «Mehr» sheet, the user menu, the old
 * `/divera-pool` route – and all of them talk to it through `openAlarmInbox` /
 * `toggleAlarmInbox`.
 *
 * The pool (`useAlarmPool`) is fetched only while something shows it: the first mounted
 * consumer loads it and listens on the socket (a new alarm, a created incident – which is what
 * an attach makes –, the socket coming back after an outage), the last one to unmount stops.
 * No polling loop of its own.
 */

import { useSyncExternalStore } from 'react'

import { apiClient, type ApiDiveraEmergency } from '@/lib/api-client'
import { wsClient, type WebSocketStatus } from '@/lib/websocket-client'

/** Marks the header's entry button: the desktop sheet hangs from the header holding it. */
export const ALARM_INBOX_TRIGGER_ATTR = 'data-alarm-inbox-trigger'

// ── open / closed ───────────────────────────────────────────────────────────────────

let open = false
const openListeners = new Set<() => void>()

function setOpen(next: boolean) {
  if (open === next) return
  open = next
  for (const listener of openListeners) listener()
}

export const openAlarmInbox = () => setOpen(true)
export const closeAlarmInbox = () => setOpen(false)
export const toggleAlarmInbox = () => setOpen(!open)

function subscribeOpen(listener: () => void) {
  openListeners.add(listener)
  return () => {
    openListeners.delete(listener)
  }
}

/** Is the Alarmeingang sheet open? */
export function useAlarmInboxOpen(): boolean {
  return useSyncExternalStore(subscribeOpen, () => open, () => false)
}

// ── the pool ────────────────────────────────────────────────────────────────────────

export interface AlarmPool {
  /** Newest first, archived included (the server's first page of 100). */
  emergencies: ApiDiveraEmergency[]
  /** Every row the server has, beyond the page too. */
  total: number
  /** True once the first answer came in. */
  loaded: boolean
  loading: boolean
}

const EMPTY: AlarmPool = { emergencies: [], total: 0, loaded: false, loading: false }

let pool: AlarmPool = EMPTY
const poolListeners = new Set<() => void>()
let inflight: Promise<void> | null = null
let again = false

function setPool(patch: Partial<AlarmPool>) {
  pool = { ...pool, ...patch }
  for (const listener of poolListeners) listener()
}

/**
 * Fetch the pool again. Calls during a fetch fold into ONE more fetch after it, so a burst of
 * socket events costs two requests, and the last answer is always the newest state.
 */
export function reloadAlarmPool(): Promise<void> {
  if (inflight) {
    again = true
    return inflight
  }
  setPool({ loading: true })
  inflight = (async () => {
    try {
      do {
        again = false
        const res = await apiClient.getDiveraEmergencies({ include_archived: true })
        setPool({ emergencies: res.emergencies, total: res.total, loaded: true })
      } while (again)
    } catch (error) {
      // The transport already said «no connection»; anything else is worth a log line.
      if (!(error instanceof Error) || !error.message.includes('Verbindung zum Server')) {
        console.error('Failed to load the alarm pool:', error)
      }
    } finally {
      inflight = null
      setPool({ loading: false })
    }
  })()
  return inflight
}

let stopListening: (() => void) | null = null

function startListening() {
  void reloadAlarmPool()
  wsClient.connect()
  const offAlarm = wsClient.on('divera_emergency_received', () => void reloadAlarmPool())
  // An attach (here, on another board, or the server's auto-attach) creates an incident.
  const offIncident = wsClient.on('incident_update', (data: { action?: string } | undefined) => {
    if (data?.action === 'create') void reloadAlarmPool()
  })
  // Back after an outage: whatever arrived meanwhile was never pushed.
  let last: WebSocketStatus = wsClient.getStatus()
  const offStatus = wsClient.onStatusChange((status) => {
    if (status === 'connected' && last !== 'connected') void reloadAlarmPool()
    last = status
  })
  stopListening = () => {
    offAlarm()
    offIncident()
    offStatus()
    wsClient.disconnect()
  }
}

function subscribePool(listener: () => void) {
  poolListeners.add(listener)
  if (poolListeners.size === 1) startListening()
  return () => {
    poolListeners.delete(listener)
    if (poolListeners.size === 0) {
      stopListening?.()
      stopListening = null
    }
  }
}

/** The alarm pool, live while mounted. */
export function useAlarmPool(): AlarmPool {
  return useSyncExternalStore(subscribePool, () => pool, () => EMPTY)
}

/** Test seam: forget the pool and the open state. */
export function resetAlarmInboxForTests() {
  stopListening?.()
  stopListening = null
  poolListeners.clear()
  openListeners.clear()
  pool = EMPTY
  open = false
  inflight = null
  again = false
}
