'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  apiClient,
  type ApiFeldAssignment,
  type ApiFeldAssignmentsResponse,
  type ApiFeldMaterialItem,
  type ApiFieldReportState,
  type ApiSchadenplatzRapport,
} from '@/lib/api-client'
import { ApiError } from '@/lib/api/types/common'
import { usePolling } from '@/lib/hooks/use-polling'

/**
 * One person's `/feld` list: the newest answer whole, its load state, and the local folds into it.
 *
 * The page calls it before the door (`useFeldDoor`), whose `onForget` calls `reset`. So `load`
 * takes the token, and the page's own steps as handlers: `onAnswer` with the newest answer and
 * `onSignedOut` on a 401. Both run inside the load, before it ends, and only while it is still
 * the newest one.
 *
 *   const list = useFeldLoad()
 *   await list.load(personnelId, token, { silent: true, onAnswer, onSignedOut })
 */
export function useFeldLoad() {
  /** The newest assignments answer for this person, whole – everything the page shows from
   *  the list is read off it, and a local fold (a field report, a check-in) writes into it. */
  const [feld, setFeld] = useState<ApiFeldAssignmentsResponse | null>(null)
  const [loadingAssignments, setLoadingAssignments] = useState(false)
  /** When the list last came back, and whether the newest load failed since (phone sweep
   *  24.11.2026): a cellar must see «Keine Verbindung – Stand 14:05», not rows that look live,
   *  and a first load that failed must not look like a confirmed empty list. */
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)
  const [syncFailed, setSyncFailed] = useState(false)
  // The Magazin's inventory. Only ever fetched for somebody holding the role —
  // the endpoint 403s for anybody else, which is what makes it defensible to
  // serve the whole station's material through a login-less door.
  const [materials, setMaterials] = useState<ApiFeldMaterialItem[]>([])
  /** What the last load asked for – «Erneut versuchen» after a failed first load, when a device
   *  restored from its cookie has no `selectedPerson` yet (that comes with the answer). */
  const lastLoad = useRef<{ personnelId: string; token: string } | null>(null)
  /** Counts loads: only the newest one may write. A poll still retrying in a dead spot must not
   *  bring «Keine Verbindung» back over a refresh that already landed, nor rows over a forget. */
  const loadGeneration = useRef(0)
  /** The load still out, if any: a poll never starts over it (on a link slower than the 10 s tick
   *  each poll would supersede the last and none would ever land). A deliberate load may. */
  const loadInFlight = useRef<number | null>(null)
  /** The Magazin inventory read still out, by whose list (person and token) it was asked for.
   *  One at a time – on a link slower than the poll, each read would be overtaken by the next
   *  and no table would ever land – and its answer only while that list is still the page's. */
  const inventoryRead = useRef<string | null>(null)

  /** A local fold into the list, merged rather than refetched (see `applyFieldReport`). */
  const updateAssignments = useCallback((update: (rows: ApiFeldAssignment[]) => ApiFeldAssignment[]) => {
    setFeld(prev => prev && { ...prev, assignments: update(prev.assignments) })
  }, [])

  /** The page's half of a forget: drop the list and every load still out. */
  const reset = useCallback(() => {
    setFeld(null)
    setSyncedAt(null)
    setSyncFailed(false)
    setLoadingAssignments(false)
    loadGeneration.current += 1
    loadInFlight.current = null
    inventoryRead.current = null
  }, [])

  /**
   * ``silent`` is what the poll passes: no top loading bar, and a failed
   * request keeps the list it already had.
   *
   * Both halves matter on a phone. A progress bar flashing across the top every
   * ten seconds is a page that looks permanently busy; and a poll that missed
   * one request in a cellar must not blank out the Schadenplatz the crew is
   * standing at — the stale list is right far more often than an empty one.
   * A deliberate load (picking a person, coming back to the tab) keeps both.
   */
  const load = useCallback(async (
    personnelId: string,
    activeToken: string,
    options: {
      silent?: boolean
      onAnswer: (data: ApiFeldAssignmentsResponse) => void
      onSignedOut: () => void
    },
  ) => {
    const silent = options.silent === true
    if (silent && loadInFlight.current !== null) return
    lastLoad.current = { personnelId, token: activeToken }
    const generation = ++loadGeneration.current
    loadInFlight.current = generation
    const superseded = () => generation !== loadGeneration.current
    if (!silent) setLoadingAssignments(true)
    try {
      const data = await apiClient.getFeldAssignments(personnelId, activeToken)
      if (superseded()) return
      setFeld(data)
      setSyncedAt(new Date())
      setSyncFailed(false)
      // Chased rather than awaited: the inventory is a second section, and a
      // crew standing at an address must not wait on the Magazin's table for
      // their own rows. A failure here leaves the last table standing, and so
      // does an answer for a list the page no longer shows (`inventoryRead`).
      if (data.functions?.includes('magazin')) {
        const scope = `${personnelId}:${activeToken}`
        if (inventoryRead.current !== scope) {
          inventoryRead.current = scope
          apiClient
            .getFeldMaterial(personnelId, activeToken)
            .then(result => inventoryRead.current === scope && setMaterials(result.materials))
            .catch(error => console.error('Failed to load the material list:', error))
            .finally(() => {
              if (inventoryRead.current === scope) inventoryRead.current = null
            })
        }
      } else {
        setMaterials([])
      }
      options.onAnswer(data)
    } catch (err) {
      console.error('Failed to load field assignments:', err)
      if (superseded()) return
      // 401 means this device was logged out from the board ("alle Geräte
      // abmelden"). The credential is gone, so the honest move is back to the
      // code — not an empty list that looks like "you have nothing to do".
      if (err instanceof ApiError && err.status === 401) {
        options.onSignedOut()
        return
      }
      // A 403 is the server saying this list is not ours to see — the one
      // failure a stale list must NOT survive. Everything else keeps its rows
      // on a silent poll, because a cellar losing one request must not blank
      // the Schadenplatz somebody is standing at.
      if (err instanceof ApiError && err.status === 403) {
        updateAssignments(() => [])
        // The request skips the transport's toast (the band speaks for an outage), so the
        // server's reason is said here.
        toast.error(err.message)
        return
      }
      // Any other failure keeps the rows, silent or not, and says so: the band shows the last
      // good time, and with nothing loaded yet the list says it could not load (never «kein
      // Auftrag»). An offline GET lands here too (`NetworkError`).
      setSyncFailed(true)
    } finally {
      // Only the newest load ends the loading state: an older one settling first would show
      // an empty list before any answer was taken.
      if (!superseded()) {
        loadInFlight.current = null
        if (!silent) setLoadingAssignments(false)
      }
    }
  }, [updateAssignments])

  /** What the last load asked for, read when «Erneut versuchen» is tapped. */
  const lastAsked = useCallback(() => lastLoad.current, [])

  /**
   * Fold the server's answer to a field action back into the list row.
   *
   * Merged locally rather than refetched: the crew is on a phone at the edge of
   * coverage, and a full round trip after every tap is the one thing that makes
   * a big button feel like it did not work.
   */
  const applyFieldReport = useCallback((state: ApiFieldReportState) => {
    updateAssignments(prev =>
      prev.map(a =>
        a.incident_id === state.incident_id
          ? {
              ...a,
              arrived_at: state.arrived_at,
              arrived_by_automation: state.arrived_by_automation,
              field_complete_reported_at: state.field_complete_reported_at,
              pickup_needed: state.pickup_needed,
              pickup_note: state.pickup_note,
              pickup_requested_at: state.pickup_requested_at,
            }
          : a,
      ),
    )
  }, [updateAssignments])

  /**
   * Fold a rapport save back into the list row's state chip.
   *
   * Same reason as `applyFieldReport`: the crew is on a phone at the edge of
   * coverage, and a refetch after every autosave is what makes a big form feel
   * like it did not work.
   */
  const applyRapportState = useCallback((rapport: ApiSchadenplatzRapport) => {
    updateAssignments(prev =>
      prev.map(a =>
        a.incident_id === rapport.incident_id
          ? { ...a, rapport_state: rapport.is_draft ? 'draft' : 'submitted', arrived_at: rapport.arrived_at }
          : a,
      ),
    )
  }, [updateAssignments])

  return {
    feld,
    setFeld,
    loadingAssignments,
    syncedAt,
    syncFailed,
    materials,
    load,
    lastAsked,
    reset,
    applyFieldReport,
    applyRapportState,
  }
}

/**
 * How often the field list refetches while the tab is visible.
 *
 * Twice the board's ~5 s, because the two surfaces answer different questions:
 * an operator watches forty cards move, a crew looks at one address between two
 * jobs. Ten seconds is well inside "I glanced at it and it was right" and halves
 * the requests from a phone on mobile data.
 */
const FELD_POLL_MS = 10000

/**
 * Live updates — **polling, deliberately, not the WebSocket**.
 *
 * `/feld` had no live path at all: a crew watched a page that never changed
 * until it reloaded. Not a pickup the KP cleared, not a rapport a colleague
 * filed, not an arrival, and — worst — not a new Schadenplatz they had just
 * been assigned to, while the empty state promises "sobald du zugewiesen
 * bist, erscheint sie hier".
 *
 * The socket was the other candidate and was rejected. It requires a JWT in
 * the `access_token` cookie (`ws_require_auth`), so serving this page would
 * mean teaching the socket a second identity: a token that is **printed on a
 * poster on a wall**. That turns a login-less read surface into a persistent
 * authenticated server connection whose credential cannot be revoked from the
 * people holding it — a new failure mode, in exchange for a few seconds of
 * latency on a screen somebody looks at between two hose lines. Polling is
 * what the board itself already falls back to, it cannot leak anything, and
 * its bad-connection behaviour is understood.
 *
 * Two rules keep it cheap: it runs **only while the tab is visible** (a phone
 * in a pocket is the normal state of this page, and it must not poll from
 * there), and it goes through the same `loadAssignments` as everything else —
 * so the server-side "visibility is only mine" two-step is unchanged and no
 * new door was opened for this.
 *
 * The page passes the person on screen, the door's token and its `loadAssignments`:
 *
 *   useFeldRefresh(selectedPerson?.personnel_id, token, loadAssignments)
 */
export function useFeldRefresh(
  personnelId: string | undefined,
  token: string | null,
  reload: (personnelId: string, options?: { silent?: boolean }) => Promise<void>,
) {
  // Coming back from another tab/app should show the current state, not what
  // the board looked like when the phone went into the pocket. Declared before the
  // poll: this load goes out first, and the poll's own run on «visible» then skips.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      if (personnelId && token) void reload(personnelId)
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [personnelId, token, reload])

  const pollAssignments = useCallback(() => {
    if (personnelId) return reload(personnelId, { silent: true })
  }, [personnelId, reload])
  // Not immediate: every way onto the list (the door, a pick, «Erneut versuchen») loads it itself.
  usePolling(pollAssignments, { intervalMs: FELD_POLL_MS, enabled: Boolean(personnelId && token), immediate: false })
}
