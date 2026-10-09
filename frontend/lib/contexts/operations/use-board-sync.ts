"use client"

import type { useEvent } from "../event-context"
import type { usePersonnel } from "../personnel-context"
import type { useMaterials } from "../materials-context"
import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction, type MutableRefObject } from "react"
import { apiClient, NetworkError, type ApiEventSpecialFunctionResponse, type ApiVehicle } from "@/lib/api-client"
import { setGlobalHomeCity } from "@/lib/utils"
import { RANK_ABBREVIATIONS_KEY, setGlobalRankAbbreviations } from "@/lib/roster-order"
import { isValidUUID } from "@/lib/utils/validation"
import type { Person } from "../personnel-context"
import type { Material } from "../materials-context"
import { wsClient, type WebSocketUpdate, type WebSocketStatus } from "@/lib/websocket-client"
import { topLoading } from "@/components/ui/top-loading-bar"
import { decideCooldownClearAction, decidePollTickAction, decideRemoteUpdateAction, shouldStartPollingOnMount } from "@/lib/sync-cooldown"
import { ReloadScheduler } from "@/lib/reload-scheduler"
import { toMaterialOnSite } from "./mapping"
import { buildEventState } from "./reconcile"
import type { Operation, OperationsContextType, DriverStayPayload } from "./types"

/**
 * `request()` lets a GET resolve to nothing when the connection is dead (a soft
 * degrade meant for pollers). For the board's snapshot «nothing» must not pass
 * for «empty» — this turns it back into the failure it is.
 */
function answered<T>(value: T | undefined): T {
  if (value === undefined || value === null) throw new NetworkError()
  return value
}

/** What the board's loader needs from the provider: who is signed in, which
 *  Ereignis, the personnel/material contexts, and the provider's own state
 *  setters plus the mutation-cooldown refs it must respect. */
export interface BoardSyncInput {
  authLoading: boolean
  isAuthenticated: boolean
  selectedEvent: ReturnType<typeof useEvent>["selectedEvent"]
  isEventLoaded: boolean
  refreshPersonnel: ReturnType<typeof usePersonnel>["refreshPersonnel"]
  refreshMaterials: ReturnType<typeof useMaterials>["refreshMaterials"]
  setPersonnel: Dispatch<SetStateAction<Person[]>>
  setMaterials: Dispatch<SetStateAction<Material[]>>
  setOperations: Dispatch<SetStateAction<Operation[]>>
  setIsLoaded: Dispatch<SetStateAction<boolean>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  isLoadingRef: MutableRefObject<boolean>
  replayPendingUpdatesRef: MutableRefObject<(() => void) | null>
  criticalUpdateInProgress: MutableRefObject<boolean>
  boardDraggingRef: MutableRefObject<boolean>
  assignmentHoldsRef: MutableRefObject<number>
  mutationEpochRef: MutableRefObject<number>
  alertAudioRef: MutableRefObject<HTMLAudioElement | null>
  alertAudioUnlockedRef: MutableRefObject<boolean>
}

/**
 * The board's ONE loader and its live wiring: the snapshot load behind a
 * single-flight scheduler, WebSocket subscriptions, the polling fallback and the
 * sync freshness (`BoardSyncStatus`). Owns the station-wide state that only a
 * load writes (settings, home city, fleet, special functions, Restliste).
 * Moved verbatim out of `OperationsProvider`.
 */
export function useBoardSync(input: BoardSyncInput) {
  const {
    authLoading,
    isAuthenticated,
    selectedEvent,
    isEventLoaded,
    refreshPersonnel,
    refreshMaterials,
    setPersonnel,
    setMaterials,
    setOperations,
    setIsLoaded,
    setIsLoading,
    isLoadingRef,
    replayPendingUpdatesRef,
    criticalUpdateInProgress,
    boardDraggingRef,
    assignmentHoldsRef,
    mutationEpochRef,
    alertAudioRef,
    alertAudioUnlockedRef,
  } = input

  // Ref, not state: only the sync closures care, and as a dependency it
  // caused the same effect churn as isLoading.
  const isInitialLoadRef = useRef(true)
  const [homeCity, setHomeCity] = useState<string>("")
  // Mirror into the module-level store so non-React helpers
  // (getIncidentRefLabel) can strip the home city from addresses too.
  useEffect(() => {
    setGlobalHomeCity(homeCity)
  }, [homeCity])
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [liveSince, setLiveSince] = useState<Date | null>(null)
  // Mirrors for the socket status handler, which lives in the long-lived sync
  // effect and must not take these as dependencies.
  const liveSinceRef = useRef<Date | null>(null)
  const lastSyncAtRef = useRef<Date | null>(null)
  lastSyncAtRef.current = lastSyncAt
  const [incidentTotal, setIncidentTotal] = useState<number | null>(null)
  const [materialOnSite, setMaterialOnSite] = useState<OperationsContextType["materialOnSite"]>(new Map())
  const [outOfServiceVehicleIds, setOutOfServiceVehicleIds] = useState<Set<string>>(new Set())
  const [specialFunctions, setSpecialFunctions] = useState<ApiEventSpecialFunctionResponse[]>([])
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})

  // UI #2: queue-and-replay for WS/poll updates that arrive during a cooldown.
  // When set, the next cooldown clear triggers a single reload. Prevents
  // silent loss of remote updates during rapid local dispatch.
  const pendingReplayRef = useRef<boolean>(false)

  // Track known incident IDs for new high-priority alert sound
  const knownIncidentIdsRef = useRef<Set<string>>(new Set())

  // Sync version for lightweight polling optimization
  const lastSyncVersionRef = useRef<string | null>(null)
  // Id of the newest board load; see `loadData`.
  const loadIdRef = useRef<number>(0)
  // The Ereignis whose board is in state — see the switch reset in the sync effect.
  const boardEventIdRef = useRef<string | null>(null)

  // Polling configuration
  const pollingBackoffRef = useRef<number>(1)
  const POLLING_BASE_INTERVAL = 5000
  const POLLING_MAX_BACKOFF = 6
  const POLLING_JITTER_RANGE = 0.2

  const getNextPollInterval = (success: boolean): number => {
    if (success) {
      pollingBackoffRef.current = 1
    } else {
      pollingBackoffRef.current = Math.min(pollingBackoffRef.current * 2, POLLING_MAX_BACKOFF)
    }
    const jitter = 1 + (Math.random() * 2 - 1) * POLLING_JITTER_RANGE
    return Math.round(POLLING_BASE_INTERVAL * pollingBackoffRef.current * jitter)
  }

  // The board has ONE loader: `loadData` in the sync effect below, behind a
  // single-flight scheduler (`lib/reload-scheduler`). Explicit refreshes queue
  // behind a running load instead of racing it. Until 2026-09-23 this was a
  // second, sequential copy of the whole load that could land in either order
  // with the effect's — and the two copies had already drifted once (see
  // `rekoDangerTypes`).
  const reloadSchedulerRef = useRef<ReloadScheduler | null>(null)
  const refreshOperations = useCallback(async () => {
    const scheduler = reloadSchedulerRef.current
    if (scheduler) return scheduler.request()
    // No sync effect running: signed out, or no Ereignis selected.
    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      setOperations([])
      setIsLoading(false)
    }
  }, [selectedEvent, setOperations, setIsLoading])

  // Load initial data and set up WebSocket/polling
  useEffect(() => {
    if (authLoading || !isAuthenticated) {
      setIsLoading(false)
      return
    }

    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      setOperations([])
      // No Ereignis, no board to be fresh or stale about.
      boardEventIdRef.current = null
      setLastSyncAt(null)
      setLoadError(null)
      setIsLoading(false)
      // Only declare "loaded" once events have actually resolved. While the
      // EventProvider is still figuring out which event is selected, stay
      // unloaded so the board shows the progress bar — not a premature empty
      // state (empty columns + "Keine Personen" + QR) that flashes before data.
      if (isEventLoaded) setIsLoaded(true)
      return
    }

    const eventId = selectedEvent.id
    // A counter, not a DOM ref — the cleanup below bumps the live value on purpose.
    const loadIds = loadIdRef

    // Another Ereignis: the board in state is the PREVIOUS one's, and it must go
    // before B's first load, not after it. «Keep the last good board» (a0f05021)
    // is about one Ereignis over time; across a switch, A's board kept its
    // `lastSyncAt`, so a failed first load of B showed A's incidents as «B, a
    // little stale» — the wrong Ereignis, presented as fact. B starts where a
    // fresh page starts: nothing loaded, progress bar, and on failure «never
    // loaded». The known ids go too, or B's high-priority incidents would all
    // ring as «new» the moment they land. Station-wide state (vehicles,
    // settings, home city) stays: it is the same across Ereignisse.
    // Same id (the event object was refetched) is not a switch.
    if (boardEventIdRef.current !== null && boardEventIdRef.current !== eventId) {
      setOperations([])
      setPersonnel([])
      setMaterials([])
      setMaterialOnSite(new Map())
      setSpecialFunctions([])
      setIncidentTotal(null)
      setLastSyncAt(null)
      setLoadError(null)
      setIsLoaded(false)
      isInitialLoadRef.current = true
      knownIncidentIdsRef.current = new Set()
      lastSyncVersionRef.current = null
    }
    boardEventIdRef.current = eventId

    // Only ever called through `reloadScheduler` (below) — one load at a time.
    const loadData = async () => {
      // Monotonic across effect instances: a load still in flight when the
      // Ereignis changes (or the user signs out) must not paint the previous
      // Ereignis over the new one. The cleanup bumps the counter too.
      const loadId = ++loadIdRef.current
      const isCurrentLoad = () => loadId === loadIdRef.current
      // Drive the top progress bar only for the meaningful initial load — not
      // the silent ~5s background polls — so the board's first paint feels fast
      // without the bar flickering on every sync.
      const driveBar = isInitialLoadRef.current
      if (driveBar) topLoading.start()
      try {
        if (driveBar) {
          setIsLoading(true)
        }

        const epochAtStart = mutationEpochRef.current

        // Snapshot the sync version BEFORE fetching data. Pairing the stored
        // version with data fetched after it can only err toward one extra
        // reload — the old trailing fetch could store a version NEWER than the
        // data it was paired with, blinding the polling fallback to a change.
        const versionSnapshot = await apiClient.getSyncVersion(eventId).catch(() => null)

        // Fetch all data in parallel. skipStateUpdate keeps the raw personnel/material
        // list off the UI — we write reconciled, event-scoped state below in one go,
        // avoiding a flicker where every person briefly reads as "available".
        //
        // A failed fetch never becomes an empty list: the reload fails as a
        // whole and the board keeps its last good state (`answered`, and the
        // rejecting refreshPersonnel/refreshMaterials). Settings and the
        // Restliste are the exceptions — a failure there keeps the previous
        // value instead of failing the board.
        const [incidentPage, personnelList, materialsList, settings, vehiclesList, restliste] = await Promise.all([
          apiClient.getIncidentsWithTotal(eventId),
          refreshPersonnel({ skipStateUpdate: true }),
          refreshMaterials({ skipStateUpdate: true }),
          apiClient.getAllSettings().catch(() => undefined),
          apiClient.getVehicles().then(answered),
          // Never fatal: a board that cannot say which pump is still in a cellar is
          // still a board.
          apiClient.getEventRestliste(eventId).catch(() => undefined),
        ])
        const apiIncidents = incidentPage.incidents

        // Fetch special functions, assignments, and reko summaries in parallel.
        //
        // ⚠️ Part of the snapshot, not decoration: these used to be allSettled
        // and «non-fatal», so a failed assignments fetch painted every card
        // without its crew and every person as available — a board that invites
        // a double dispatch. Now any of them failing fails the reload, and the
        // board keeps its last good state.
        const [specialFunctions, assignmentsByIncident, rekoSummaries] = await Promise.all([
          apiClient.getEventSpecialFunctions(eventId).then(answered),
          apiClient.getAssignmentsByEvent(eventId).then(answered),
          apiClient.getEventRekoSummaries(eventId).then(answered),
        ])

        // Cards, roster and depot for THIS Ereignis — see ./operations/reconcile.
        const { ops, eventScopedPersonnel, eventScopedMaterials } = buildEventState({
          apiIncidents,
          personnelList,
          materialsList,
          vehiclesList,
          specialFunctions,
          assignmentsByIncident,
          rekoSummaries,
        })

        // Fetched for an Ereignis that is no longer on screen: drop it whole —
        // no state, no alert sound, no known-incident bookkeeping.
        if (!isCurrentLoad()) return

        // Detect new high-priority incidents and play alert sound
        if (knownIncidentIdsRef.current.size > 0) {
          const newHighPriority = ops.filter(
            op => op.priority === 'high' && !knownIncidentIdsRef.current.has(op.id)
          )
          if (newHighPriority.length > 0 && alertAudioRef.current) {
            const audio = alertAudioRef.current
            audio.volume = 0.7
            audio.currentTime = 0
            const retryDelays = [0, 500, 1500, 3000]
            const tryPlay = (attempt: number) => {
              if (attempt >= retryDelays.length) {
                if (!alertAudioUnlockedRef.current) {
                  console.warn(
                    'Alert sound suppressed: waiting for first user interaction to unlock audio.',
                  )
                }
                return
              }
              window.setTimeout(() => {
                const playPromise = audio.play()
                if (playPromise && typeof playPromise.catch === 'function') {
                  playPromise.catch(() => tryPlay(attempt + 1))
                }
              }, retryDelays[attempt])
            }
            tryPlay(0)
          }
        }
        // Update known incident IDs
        knownIncidentIdsRef.current = new Set(ops.map(op => op.id))

        // A local mutation landed while this reload was fetching — its
        // optimistic state is newer than this snapshot. Discard the stale
        // result and replay once the mutation's cooldown clears.
        if (mutationEpochRef.current !== epochAtStart) {
          pendingReplayRef.current = true
          replayPendingUpdatesRef.current?.()
          return
        }

        setOperations(ops)
        setPersonnel(eventScopedPersonnel)
        setMaterials(eventScopedMaterials)
        if (restliste) setMaterialOnSite(toMaterialOnSite(restliste))
        setOutOfServiceVehicleIds(new Set(vehiclesList.filter(v => v.out_of_service).map(v => v.id)))
        setSpecialFunctions(specialFunctions)
        setVehicles(vehiclesList)
        setIncidentTotal(incidentPage.total)
        if (settings) {
          setSettings(settings)
          // Sync the module-level mirror BEFORE the state batch renders: the
          // mirror-effect runs only after render, so helpers reading it
          // (getIncidentRefLabel & co.) would format the first paint without the
          // home city and visibly re-render to the short label later.
          setGlobalHomeCity(settings.home_city || "")
          setGlobalRankAbbreviations(settings[RANK_ABBREVIATIONS_KEY] || "")
          setHomeCity(settings.home_city || "")
        }
        setIsLoaded(true)
        setLastSyncAt(new Date())
        setLoadError(null)
        isInitialLoadRef.current = false
        stopPollingIfSocketCarries()

        // Store the version snapshot taken before the data fetch (null forces
        // the next poll tick to reload — fails toward freshness).
        lastSyncVersionRef.current = versionSnapshot?.version ?? null
      } catch (error) {
        if (!isCurrentLoad()) return
        console.error("Failed to load data:", error)
        // Last good state stays on screen; `lastSyncAt` does NOT move, so the
        // stale-data banner starts counting. `isLoaded` still flips on a failed
        // FIRST load — mutations key off it — which is why `loadError` exists:
        // an empty board and a board that never arrived are told apart there.
        // The board page reads it as `boardNeverLoaded` (error panel instead of
        // empty columns); the banner reads it for the stale case.
        setLoadError(error instanceof Error ? error : new Error(String(error)))
        setIsLoaded(true)
        isInitialLoadRef.current = false
        // With the socket up nothing polls, and a quiet Ereignis sends no
        // event to retry on: poll until a load gets through again.
        onLoadFailed()
      } finally {
        if (isCurrentLoad()) setIsLoading(false)
        if (driveBar) topLoading.done()
      }
    }

    const inCooldown = () =>
      criticalUpdateInProgress.current || assignmentHoldsRef.current > 0 || boardDraggingRef.current

    // Socket events, poll ticks and cooldown replays are automatic loads: the
    // scheduler holds them back during a mutation cooldown and we queue a
    // replay instead — the same queue-don't-drop rule as before, now also
    // applied when a queued follow-up load finally gets its turn.
    const reloadScheduler = new ReloadScheduler({
      load: loadData,
      mayAutoLoad: () => decideRemoteUpdateAction({ inCooldown: inCooldown() }) === "fetch",
      onAutoLoadHeld: () => {
        pendingReplayRef.current = true
      },
    })
    reloadSchedulerRef.current = reloadScheduler

    void reloadScheduler.request()

    // WebSocket setup
    wsClient.connect()

    // Waking from a background/suspended tab: the socket may have been reaped
    // server-side while timers were throttled. connect() is a no-op when the
    // socket is alive or still auto-reconnecting.
    const handleWake = () => {
      if (document.visibilityState === 'visible') wsClient.connect()
    }
    document.addEventListener('visibilitychange', handleWake)

    // A burst of events (a Reko submit is incident + assignment + personnel
    // within milliseconds) becomes one reload; the cooldown gate is checked
    // when the debounce fires, not when the first event arrived.
    const handleRemoteUpdate = () => reloadScheduler.requestDebounced()

    // Expose replay so cooldown-clear timers (defined outside this useEffect)
    // can trigger a coalesced reload when they fire.
    replayPendingUpdatesRef.current = () => {
      const action = decideCooldownClearAction({
        pendingReplay: pendingReplayRef.current,
        stillInCooldown: inCooldown(),
      })
      if (action === "skip") return
      pendingReplayRef.current = false
      void reloadScheduler.requestAuto()
    }

    // Surgically apply a driver_stay ("bleibt vor Ort") toggle from another
    // client — flip just that vehicle's flag instead of reloading the board.
    // Matches the assignment by id within the incident; idempotent for the
    // sender (it already applied the value optimistically).
    const applyDriverStayUpdate = (data: DriverStayPayload) => {
      if (!data?.id || !data?.incident_id) return
      setOperations((ops) =>
        ops.map((op) => {
          if (op.id !== data.incident_id) return op
          let vehicleName: string | undefined
          for (const [name, assignmentId] of op.vehicleAssignments) {
            if (assignmentId === data.id) { vehicleName = name; break }
          }
          if (!vehicleName) return op
          const newVehicleDriverStay = new Map(op.vehicleDriverStay)
          newVehicleDriverStay.set(vehicleName, data.driver_stay ?? false)
          return { ...op, vehicleDriverStay: newVehicleDriverStay }
        })
      )
    }

    const unsubscribeIncidentUpdate = wsClient.on('incident_update', handleRemoteUpdate)
    const unsubscribePersonnelUpdate = wsClient.on('personnel_update', handleRemoteUpdate)
    const unsubscribeVehicleUpdate = wsClient.on('vehicle_update', handleRemoteUpdate)
    const unsubscribeMaterialUpdate = wsClient.on('material_update', handleRemoteUpdate)
    // Drivers, Reko, Magazin: the sidebar flags and the Bereitschaft checklist
    // both read them off this load, and nothing else would bring another
    // client's change in.
    const unsubscribeSpecialFunctionUpdate = wsClient.on('special_function_update', handleRemoteUpdate)
    const unsubscribeAssignmentUpdate = wsClient.on('assignment_update', (update: WebSocketUpdate<DriverStayPayload>) => {
      if (update?.action === 'driver_stay') {
        applyDriverStayUpdate(update.data)
        return
      }
      handleRemoteUpdate()
    })
    const unsubscribeAssignmentsTransferred = wsClient.on('assignments_transferred', () => {
      handleRemoteUpdate()
    })

    // Fallback polling
    let pollTimeout: NodeJS.Timeout | undefined
    let isPollingActive = false

    const schedulePoll = () => {
      if (!isPollingActive) return
      const interval = getNextPollInterval(true)
      pollTimeout = setTimeout(async () => {
        if (!isPollingActive) return
        const tickAction = decidePollTickAction({
          isLoading: isLoadingRef.current || reloadScheduler.busy,
          inCooldown: inCooldown(),
        })
        if (tickAction === "skip") {
          if (isPollingActive) schedulePoll()
          return
        }
        if (tickAction === "queue") {
          // Queue a replay rather than skipping silently — the cooldown clear
          // will pick this up. We still keep the polling cadence going.
          pendingReplayRef.current = true
          if (isPollingActive) schedulePoll()
          return
        }
        try {
          // Lightweight version check before full reload
          const { version } = await apiClient.getSyncVersion(eventId)
          if (version !== lastSyncVersionRef.current) {
            lastSyncVersionRef.current = version
            await reloadScheduler.requestAuto()
          } else {
            // Confirmed fresh — keep the stale-data banner honest. Without
            // this, a healthy polling session with no changes let lastSyncAt
            // age past the threshold and showed "Verbindung verloren".
            // Same version as the last GOOD load: the board on screen is
            // current, whatever a failed reload in between said.
            setLastSyncAt(new Date())
            setLoadError(null)
            stopPollingIfSocketCarries()
          }
        } catch {
          pollingBackoffRef.current = Math.min(pollingBackoffRef.current * 2, POLLING_MAX_BACKOFF)
        }
        if (isPollingActive) schedulePoll()
      }, interval)
    }

    const startPolling = () => {
      if (!isPollingActive) {
        isPollingActive = true
        pollingBackoffRef.current = 1
        schedulePoll()
      }
    }

    const stopPolling = () => {
      isPollingActive = false
      if (pollTimeout) {
        clearTimeout(pollTimeout)
        pollTimeout = undefined
      }
    }

    // A failed load polls even with the socket up (see loadData's catch); the
    // first sync that gets through hands back to the socket.
    const onLoadFailed = () => startPolling()
    const stopPollingIfSocketCarries = () => {
      if (wsClient.getStatus() === 'connected') stopPolling()
    }

    const statusUnsubscribe = wsClient.onStatusChange((status: WebSocketStatus) => {
      // When the socket came up (see `BoardSyncStatus.liveSince`). And when a
      // socket that vouched for the board goes away, the board WAS current up
      // to this instant — every change until now would have arrived — so that
      // is its confirmed time. Without it a quiet hour on a healthy socket left
      // `lastSyncAt` an hour old, and the first blip raised the banner at once.
      if (status === 'connected') {
        if (liveSinceRef.current === null) {
          liveSinceRef.current = new Date()
          setLiveSince(liveSinceRef.current)
        }
      } else if (liveSinceRef.current !== null) {
        const confirmed = lastSyncAtRef.current
        if (confirmed && confirmed.getTime() >= liveSinceRef.current.getTime()) setLastSyncAt(new Date())
        liveSinceRef.current = null
        setLiveSince(null)
      }
      if (status === 'disconnected' || status === 'error') {
        startPolling()
      } else if (status === 'connected') {
        stopPolling()
        // Resync once per (re)connect: events broadcast while we weren't in
        // the room are gone for good — without this the board stays stale
        // until the next unrelated mutation triggers an event. Respects the
        // cooldown queue like any other remote update.
        handleRemoteUpdate()
      }
    })

    // If the socket is already down when this effect runs, start polling NOW —
    // see `shouldStartPollingOnMount` for what this cost when it was missing.
    // Verified in a browser: two windows, clear a pickup in one, and before
    // this the badge stayed in the other while `sync-version` visibly changed
    // underneath it.
    if (shouldStartPollingOnMount(wsClient.getStatus())) startPolling()

    return () => {
      document.removeEventListener('visibilitychange', handleWake)
      unsubscribeIncidentUpdate()
      unsubscribePersonnelUpdate()
      unsubscribeVehicleUpdate()
      unsubscribeMaterialUpdate()
      unsubscribeSpecialFunctionUpdate()
      unsubscribeAssignmentUpdate()
      unsubscribeAssignmentsTransferred()
      statusUnsubscribe()
      stopPolling()
      reloadScheduler.dispose()
      if (reloadSchedulerRef.current === reloadScheduler) reloadSchedulerRef.current = null
      // Invalidate the load still in flight, if any (see `loadData`).
      loadIds.current++
      wsClient.disconnect()
    }
  }, [
    authLoading,
    isAuthenticated,
    selectedEvent,
    isEventLoaded,
    refreshPersonnel,
    refreshMaterials,
    setPersonnel,
    setMaterials,
    // Stable (state setters and refs handed in by the provider): listed only
    // because they arrive as arguments now; they never re-run the effect.
    setOperations,
    setIsLoaded,
    setIsLoading,
    isLoadingRef,
    replayPendingUpdatesRef,
    criticalUpdateInProgress,
    boardDraggingRef,
    assignmentHoldsRef,
    mutationEpochRef,
    alertAudioRef,
    alertAudioUnlockedRef,
  ])

  return {
    homeCity,
    lastSyncAt,
    loadError,
    liveSince,
    incidentTotal,
    materialOnSite,
    outOfServiceVehicleIds,
    specialFunctions,
    vehicles,
    settings,
    refreshOperations,
  }
}
