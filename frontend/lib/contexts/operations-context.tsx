"use client"

import { createContext, useContext, useState, useEffect, useMemo, ReactNode, useRef, useCallback } from "react"
import { apiClient, ApiError, type ApiIncident, type ApiIncidentCreate, type ApiIncidentUpdate, type IncidentStatus } from "@/lib/api-client"
import { formatLocationForDisplay, setGlobalHomeCity } from "@/lib/utils"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { isValidUUID } from "@/lib/utils/validation"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"
import { usePersonnel, type Person, type PersonStatus } from "./personnel-context"
import { useMaterials, type Material } from "./materials-context"
import { toast } from "sonner"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { wsClient, type WebSocketUpdate, type WebSocketStatus } from "@/lib/websocket-client"
import { topLoading } from "@/components/ui/top-loading-bar"
import {
  decideCooldownClearAction,
  decidePollTickAction,
  decideRemoteUpdateAction,
} from "@/lib/sync-cooldown"
import {
  findRecentRemoval,
  recordRemoval,
  type RecentRemovals,
} from "@/lib/recent-removals"
import { decideRestoreAction, type RestoreOutcome } from "@/lib/restore-incident"
import { UpdateBatcher } from "@/lib/update-batcher"
import { apiCoordinatesToTuple, coordinatesToApiFields, type IncidentCoordinates } from "@/lib/coordinate-parser"

// Re-export types for backward compatibility
export type { Person, PersonStatus } from "./personnel-context"
export type { Material } from "./materials-context"
export type PersonRole = string

// Types
// The board's status vocabulary IS the API's — one set of seven identifiers,
// shared by database, API and board, so nothing translates between them. The
// German an operator reads comes from `de.json`, keyed on these same values.
export type OperationStatus = IncidentStatus
export type VehicleType = string | null

/** Payload of an `assignment_update` with `action: 'driver_stay'`. */
interface DriverStayPayload {
  id?: string
  incident_id?: string
  driver_stay?: boolean
}

/** Callers pass coordinates as numbers; the API wants decimal strings. */
interface CoordinateInput {
  location_lat?: number | string | null
  location_lng?: number | string | null
}
type IncidentCreateInput = Omit<ApiIncidentCreate, "location_lat" | "location_lng"> & CoordinateInput
type IncidentUpdateInput = Omit<ApiIncidentUpdate, "location_lat" | "location_lng"> & CoordinateInput

export interface RekoSummary {
  isRelevant: boolean
  hasDangers: boolean
  dangerTypes: string[]
  personnelCount: number | null
  estimatedDuration: number | null
  /** What the Reko wrote — the sentence the form calls «Lagebeurteilung». */
  summaryText: string | null
  /** Photo filenames from the Reko form; resolve via `rekoPhotoUrl`. */
  photos: string[]
}

export interface Operation {
  id: string
  location: string
  /** Server-computed short location label (home city stripped). Absent on
   *  locally-created optimistic operations until the next server sync. */
  locationDisplay?: string
  vehicle: VehicleType
  vehicles: string[]
  incidentType: string
  dispatchTime: Date
  crew: string[]
  priority: "high" | "medium" | "low"
  status: OperationStatus
  coordinates: IncidentCoordinates
  materials: string[]
  notes: string
  contact: string
  contactPhone: string
  internalNotes: string
  nachbarhilfe: boolean
  nachbarhilfeNote: string
  amWarten: boolean
  amWartenNote: string
  zuFuss: boolean
  /** Auftrag (incident group) this stop belongs to, or null when ungrouped. */
  groupId: string | null
  /** Order of this stop within its Auftrag (lower = earlier). 0 when ungrouped. */
  groupPosition: number
  source?: string // Origin: "operator" (dashboard) or "intake" (public token form). Absent for locally-created ops.
  statusChangedAt: Date | null
  hasCompletedReko: boolean
  rekoArrivedAt: Date | null
  /** Set when the field crew reported the incident finished (training). Drives the
   *  "Feld meldet: beendet" card badge; the operator still closes it manually. */
  fieldCompleteReportedAt?: Date | null
  rekoSummary: RekoSummary | null
  assignedReko: { id: string; name: string } | null
  crewAssignments: Map<string, string>
  materialAssignments: Map<string, string>
  vehicleAssignments: Map<string, string>
  vehicleCallsigns: Map<string, string> // vehicle name -> radio_call_sign
  vehicleDriverStay: Map<string, boolean>
}

/**
 * Context interface for managing operations, personnel, and materials.
 * Personnel and materials are delegated to their own contexts but exposed here for backward compatibility.
 */
interface OperationsContextType {
  // Delegated from PersonnelContext
  personnel: Person[]
  setPersonnel: React.Dispatch<React.SetStateAction<Person[]>>
  // Delegated from MaterialsContext
  materials: Material[]
  setMaterials: React.Dispatch<React.SetStateAction<Material[]>>
  // Operations state
  operations: Operation[]
  setOperations: React.Dispatch<React.SetStateAction<Operation[]>>
  homeCity: string
  isLoading: boolean
  /** True once the first data load has resolved. Stays true afterwards.
   * Gate empty states on this so they only show when data is genuinely empty,
   * never during the initial blank-before-fetch window. */
  isLoaded: boolean
  /** Wall-clock time of the last successful operations load. null until the first load completes. */
  lastSyncAt: Date | null
  formatLocation: (fullAddress: string) => string
  refreshOperations: () => Promise<void>
  /** Resolves true when the removal was persisted (or ran local-only), false
   * when it failed and was rolled back — callers that chain a follow-up
   * action (e.g. "remove from incident, then make driver") must check it. */
  removeCrew: (operationId: string, crewName: string) => Promise<boolean>
  removeMaterial: (operationId: string, materialId: string) => void
  /** Same result contract as removeCrew. */
  removeVehicle: (operationId: string, vehicleName: string) => Promise<boolean>
  removeReko: (operationId: string) => void
  updateOperation: (operationId: string, updates: Partial<Operation>) => void
  /** Persist the manual top-to-bottom order of a status column after a drag-reorder. */
  reorderColumn: (orderedIds: string[]) => void
  /** Board drag lifecycle. While a card is being dragged, remote updates are
   * queued instead of applied — a mid-drag reload remounts the columns and
   * aborts the native drag. Call with false when the drag ends (any outcome). */
  setBoardDragging: (dragging: boolean) => void
  /** Change an incident's status and move it to the TOP of the target column —
   *  the one-click equivalent of dragging it across (mirrors the reko auto-move). */
  changeStatusToTop: (operationId: string, newStatus: OperationStatus) => void
  createOperation: (operation: Omit<Operation, "id" | "dispatchTime">) => void
  getNextOperationId: () => string
  assignPersonToOperation: (personId: string, personName: string, operationId: string) => void
  assignRekoPersonToOperation: (personId: string, personName: string, operationId: string) => void
  assignMaterialToOperation: (materialId: string, operationId: string) => void
  assignVehicleToOperation: (vehicleId: string, vehicleName: string, operationId: string) => void
  /** Set when a vehicle is assigned to an incident but has no driver yet, so the UI
   * can prompt for driver selection. The user may dismiss the prompt to leave the
   * vehicle without a driver. Cleared via clearVehicleNeedingDriver. */
  vehicleNeedingDriver: { vehicleId: string; vehicleName: string } | null
  clearVehicleNeedingDriver: () => void
  /** Set when a vehicle is being assigned to an incident while it is still
   * assigned to one or more other incidents. The UI prompts the operator to
   * either move the vehicle (remove from the others) or keep the double
   * booking. Resolved via resolveVehicleConflict / cancelVehicleConflict. */
  vehicleConflict:
    | {
        vehicleId: string
        vehicleName: string
        targetOperationId: string
        conflicts: { operationId: string; operationLabel: string }[]
        customResolve?: (action: "move" | "keep") => Promise<void> | void
      }
    | null
  resolveVehicleConflict: (action: "move" | "keep") => void
  cancelVehicleConflict: () => void
  requestVehicleConflict: (conflict: NonNullable<OperationsContextType["vehicleConflict"]>) => void
  deleteOperation: (operationId: string) => Promise<void>
}

const OperationsContext = createContext<OperationsContextType | undefined>(undefined)

export function OperationsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const { selectedEvent, isEventLoaded } = useEvent()

  // Get personnel and materials from their dedicated contexts
  const { personnel, setPersonnel, refreshPersonnel } = usePersonnel()
  const { materials, setMaterials, refreshMaterials } = useMaterials()

  // Operations state (only operations-specific state here)
  const [operations, setOperations] = useState<Operation[]>([])
  // Always-current mirror of `operations` for reads inside async callbacks that
  // would otherwise close over a stale snapshot (e.g. the post-assign driver prompt).
  const operationsRef = useRef<Operation[]>([])
  operationsRef.current = operations
  const [isLoaded, setIsLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  // Mirror for reads inside the long-lived sync effect: having isLoading in
  // its dependency array tore down and rebuilt the whole WebSocket+polling
  // setup on every loading flip (multiple reconnects during startup).
  const isLoadingRef = useRef(false)
  isLoadingRef.current = isLoading
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
  // When a vehicle is assigned to an incident with no driver yet, hold it here so the
  // UI can open driver assignment. Null when there's nothing to prompt for.
  const [vehicleNeedingDriver, setVehicleNeedingDriver] = useState<{ vehicleId: string; vehicleName: string } | null>(null)
  const clearVehicleNeedingDriver = useCallback(() => setVehicleNeedingDriver(null), [])
  const [vehicleConflict, setVehicleConflict] = useState<OperationsContextType["vehicleConflict"]>(null)

  // Refs for debouncing and cooldowns. One debounce timer + pending-merge
  // buffer PER incident (a single shared timer made rapid edits to two
  // different incidents silently drop the first one's PATCH).
  const updateBatcherRef = useRef<UpdateBatcher<Operation>>(new UpdateBatcher())
  const criticalUpdateInProgress = useRef<boolean>(false)
  // Refcounted cooldown: every optimistic mutation takes a hold when it
  // starts and releases it (plus a grace period) when its request settles.
  // A single boolean + shared timer let a FAST mutation clear the cooldown
  // while a SLOWER one was still in flight — a poll could then load
  // pre-mutation state and visibly snap the slow mutation back. This also
  // replaces the old fixed 2s status cooldown, which could expire while a
  // slow status PATCH was still in flight.
  const assignmentHoldsRef = useRef<number>(0)
  // True while an operation card is physically being dragged. Remote updates
  // queue for the duration: a mid-drag reload remounts the columns, which
  // aborts the native drag and silently drops the card back.
  const boardDraggingRef = useRef<boolean>(false)
  // Serialize reorder POSTs: two rapid drags could land out of order
  // server-side, silently persisting the FIRST drag's order. Only the latest
  // queued order survives; intermediates are skipped.
  const reorderInFlightRef = useRef<boolean>(false)
  const queuedReorderRef = useRef<string[] | null>(null)
  // UI #2: queue-and-replay for WS/poll updates that arrive during a cooldown.
  // When set, the next cooldown clear triggers a single loadData(false). Prevents
  // silent loss of remote updates during rapid local dispatch.
  const pendingReplayRef = useRef<boolean>(false)
  const replayPendingUpdatesRef = useRef<(() => void) | null>(null)
  // B6: client-only memory of recent crew removals so we can warn on
  // rapid re-assignment ("you took Müller off A 30s ago, now putting
  // them on B"). Lives in a ref because it's purely informational
  // and shouldn't trigger re-renders.
  const recentRemovalsRef = useRef<RecentRemovals>(new Map())

  // Every optimistic local mutation bumps this epoch. Reloads capture it when
  // they START fetching and discard their result if it moved while they were
  // in flight — otherwise a reload that began just before a drag/assign lands
  // would overwrite the optimistic state with a pre-mutation snapshot
  // (visible as the card "snapping back" for a second or two).
  const mutationEpochRef = useRef<number>(0)

  // Shared preamble of every optimistic mutation: invalidate in-flight
  // reloads and take one cooldown hold. Must be paired with exactly one
  // releaseAssignmentCooldown call once the mutation's request settles.
  const armAssignmentCooldown = () => {
    mutationEpochRef.current++
    assignmentHoldsRef.current++
  }

  // Release the hold taken by armAssignmentCooldown after a short grace
  // period; when the last hold drops, replay any queued remote update.
  const releaseAssignmentCooldown = (graceMs = 500) => {
    setTimeout(() => {
      assignmentHoldsRef.current = Math.max(0, assignmentHoldsRef.current - 1)
      if (assignmentHoldsRef.current === 0) replayPendingUpdatesRef.current?.()
    }, graceMs)
  }

  // Card drag lifecycle, wired from the board via context. Ending a drag
  // replays queued remote updates — an aborted drag would otherwise leave
  // them waiting for an unrelated mutation to flush the queue.
  const setBoardDragging = useCallback((dragging: boolean) => {
    if (boardDraggingRef.current === dragging) return
    boardDraggingRef.current = dragging
    if (!dragging) replayPendingUpdatesRef.current?.()
  }, [])

  // Track known incident IDs for new high-priority alert sound
  const knownIncidentIdsRef = useRef<Set<string>>(new Set())
  const alertAudioRef = useRef<HTMLAudioElement | null>(null)
  // Browsers block .play() until the user has interacted with the page. Track
  // unlock state so we know whether the alert sound can actually fire and
  // retry without spamming the console.
  const alertAudioUnlockedRef = useRef<boolean>(false)

  // Prime the alert audio element on the first user gesture so subsequent
  // programmatic .play() calls aren't blocked by the browser autoplay policy.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const unlock = () => {
      const audio = alertAudioRef.current
      if (!audio) return
      audio.volume = 0.7
      const prime = audio.play()
      if (prime && typeof prime.then === 'function') {
        prime
          .then(() => {
            audio.pause()
            audio.currentTime = 0
            alertAudioUnlockedRef.current = true
          })
          .catch(() => {
            // Some browsers still refuse — leave unlocked=false; we'll retry on the next gesture.
          })
      } else {
        alertAudioUnlockedRef.current = true
      }
    }
    const opts: AddEventListenerOptions = { once: false, passive: true }
    const handler = () => {
      if (alertAudioUnlockedRef.current) return
      unlock()
    }
    window.addEventListener('pointerdown', handler, opts)
    window.addEventListener('keydown', handler, opts)
    window.addEventListener('touchstart', handler, opts)
    return () => {
      window.removeEventListener('pointerdown', handler, opts)
      window.removeEventListener('keydown', handler, opts)
      window.removeEventListener('touchstart', handler, opts)
    }
  }, [])

  // Flush debounced board edits when the page is hidden or closed — the
  // debounce window must not silently swallow the last edit (classic case:
  // drag the last card to ABGESCHLOSSEN, close the laptop). updateIncident
  // sends keepalive requests, so the flushed PATCH outlives the document.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const batcher = updateBatcherRef.current
    const flushPending = () => batcher.flushAll()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushPending()
    }
    window.addEventListener('pagehide', flushPending)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', flushPending)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      // Provider unmount: fire whatever is still pending.
      flushPending()
    }
  }, [])

  // Sync version for lightweight polling optimization
  const lastSyncVersionRef = useRef<string | null>(null)

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

  // Helper to convert Incident to Operation
  const apiIncidentToOperation = (incident: ApiIncident): Operation => {

    return {
      id: incident.id,
      location: incident.location_address || incident.title,
      locationDisplay: incident.location_display ?? undefined,
      vehicle: null,
      vehicles: [],
      incidentType: incident.type || "elementarereignis",
      dispatchTime: new Date(incident.created_at),
      crew: [],
      priority: incident.priority as "high" | "medium" | "low",
      status: incident.status,
      coordinates: apiCoordinatesToTuple(incident.location_lat, incident.location_lng),
      materials: [],
      notes: incident.description || "",
      contact: incident.contact || "",
      contactPhone: incident.contact_phone || "",
      internalNotes: incident.internal_notes || "",
      nachbarhilfe: incident.nachbarhilfe || false,
      nachbarhilfeNote: incident.nachbarhilfe_note || "",
      amWarten: incident.am_warten || false,
      amWartenNote: incident.am_warten_note || "",
      zuFuss: incident.zu_fuss || false,
      groupId: incident.group_id ?? null,
      groupPosition: incident.group_position ?? 0,
      source: incident.source || "operator",
      statusChangedAt: incident.status_changed_at ? new Date(incident.status_changed_at) : null,
      hasCompletedReko: incident.has_completed_reko || false,
      rekoArrivedAt: incident.reko_arrived_at ? new Date(incident.reko_arrived_at) : null,
      fieldCompleteReportedAt: incident.field_complete_reported_at ? new Date(incident.field_complete_reported_at) : null,
      rekoSummary: null,
      assignedReko: null,
      crewAssignments: new Map(),
      materialAssignments: new Map(),
      vehicleAssignments: new Map(),
      vehicleCallsigns: new Map(),
      vehicleDriverStay: new Map(),
    }
  }

  // Refresh operations from server
  const refreshOperations = useCallback(async () => {
    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      setOperations([])
      setIsLoading(false)
      return
    }

    const epochAtStart = mutationEpochRef.current

    try {

      // Fetch all data in parallel. skipStateUpdate keeps the raw personnel/material
      // list off the UI — we write reconciled, event-scoped state below in one go,
      // avoiding a flicker where every person briefly reads as "available".
      const [apiIncidents, personnelList, materialsList, settings, vehiclesList] = await Promise.all([
        apiClient.getIncidents(selectedEvent.id),
        refreshPersonnel({ skipStateUpdate: true }),
        refreshMaterials({ skipStateUpdate: true }),
        apiClient.getAllSettings().catch(() => ({ home_city: "" })),
        apiClient.getVehicles(),
      ])

      // Convert incidents to operations
      const ops = apiIncidents.map(apiIncidentToOperation)

      // Fetch special functions first to know who is reko personnel
      // (reko personnel should not appear in crew list - they're tracked separately)
      const rekoPersonnelIds = new Set<string>()
      const driverPersonnelIds = new Map<string, { vehicleId: string; vehicleName: string }>() // personId -> vehicle info
      const magazinPersonnelIds = new Set<string>()
      let specialFunctions: Awaited<ReturnType<typeof apiClient.getEventSpecialFunctions>> = []
      try {
        specialFunctions = await apiClient.getEventSpecialFunctions(selectedEvent.id)
        for (const func of specialFunctions) {
          if (func.function_type === 'reko') rekoPersonnelIds.add(func.personnel_id)
          else if (func.function_type === 'driver') driverPersonnelIds.set(func.personnel_id, { vehicleId: func.vehicle_id || '', vehicleName: func.vehicle_name || '' })
          else if (func.function_type === 'magazin') magazinPersonnelIds.add(func.personnel_id)
        }
      } catch (error) {
        console.error('Failed to load special functions:', error)
      }

      // Fetch assignments for this event
      try {
        const assignmentsByIncident = await apiClient.getAssignmentsByEvent(selectedEvent.id)

        ops.forEach((operation) => {
          const assignments = assignmentsByIncident[operation.id] || []
          for (const assignment of assignments) {
            if (assignment.resource_type === "personnel") {
              const person = personnelList.find(p => p.id === assignment.resource_id)
              if (person) {
                // Reko personnel are stored separately, not as crew
                if (rekoPersonnelIds.has(person.id)) {
                  operation.assignedReko = { id: person.id, name: person.name }
                  continue
                }
                operation.crew.push(person.name)
                operation.crewAssignments.set(person.name, assignment.id)
              }
            } else if (assignment.resource_type === "material") {
              operation.materials.push(assignment.resource_id)
              operation.materialAssignments.set(assignment.resource_id, assignment.id)
            } else if (assignment.resource_type === "vehicle") {
              const vehicle = vehiclesList.find(v => v.id === assignment.resource_id)
              if (vehicle) {
                operation.vehicles.push(vehicle.name)
                operation.vehicleAssignments.set(vehicle.name, assignment.id)
                if (vehicle.radio_call_sign) {
                  operation.vehicleCallsigns.set(vehicle.name, vehicle.radio_call_sign)
                }
                operation.vehicleDriverStay.set(vehicle.name, assignment.driver_stay || false)
              }
            }
          }
        })
      } catch (error) {
        console.error(`Failed to load assignments:`, error)
      }

      // Show vehicles in their configured display order everywhere (radio text,
      // Divera/WhatsApp messages, cards) instead of assignment order.
      {
        const vehicleOrder = new Map(vehiclesList.map(v => [v.name, v.display_order]))
        ops.forEach(op => op.vehicles.sort((a, b) => (vehicleOrder.get(a) ?? 0) - (vehicleOrder.get(b) ?? 0)))
      }

      // Fetch reko summaries
      try {
        const rekoSummaries = await apiClient.getEventRekoSummaries(selectedEvent.id)
        ops.forEach(op => {
          const summary = rekoSummaries.summaries[op.id]
          if (summary?.has_completed_reko) {
            const dangerTypes: string[] = []
            if (summary.dangers_json) {
              if (summary.dangers_json.fire) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.fire'))
              if (summary.dangers_json.fire_danger) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.fireDanger'))
              if (summary.dangers_json.explosion) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.explosion'))
              if (summary.dangers_json.collapse) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.collapse'))
              if (summary.dangers_json.chemical) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.chemical'))
              if (summary.dangers_json.electrical) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.electrical'))
            }
            op.hasCompletedReko = true
            op.rekoSummary = {
              isRelevant: summary.is_relevant ?? false,
              hasDangers: dangerTypes.length > 0,
              dangerTypes,
              personnelCount: summary.effort_json?.personnel_count ?? null,
              estimatedDuration: summary.effort_json?.estimated_duration_hours ?? null,
              summaryText: summary.summary_text ?? null,
              photos: summary.photos_json ?? [],
            }
          }
        })
      } catch (error) {
        console.error('Failed to load reko summaries:', error)
      }

      // Calculate event-scoped availability
      const assignedPersonIds = new Set<string>()
      const assignedMaterialIds = new Set<string>()

      // Add non-reko special function personnel to assigned set
      specialFunctions
        .filter(func => func.function_type !== 'reko')
        .forEach(func => assignedPersonIds.add(func.personnel_id))

      ops.forEach(operation => {
        operation.crew.forEach(crewName => {
          const person = personnelList.find(p => p.name === crewName)
          if (person) assignedPersonIds.add(person.id)
        })
        operation.materials.forEach(materialId => assignedMaterialIds.add(materialId))
      })

      // Update personnel status based on assignments
      const eventScopedPersonnel = personnelList.map(person => ({
        ...person,
        status: assignedPersonIds.has(person.id) ? "assigned" as PersonStatus : "available" as PersonStatus,
        isReko: rekoPersonnelIds.has(person.id),
        isDriver: driverPersonnelIds.has(person.id),
        driverVehicleId: driverPersonnelIds.get(person.id)?.vehicleId || undefined,
        driverVehicleName: driverPersonnelIds.get(person.id)?.vehicleName || undefined,
        isMagazin: magazinPersonnelIds.has(person.id),
      }))

      // Update material status based on assignments
      const eventScopedMaterials = materialsList.map(material => ({
        ...material,
        status: assignedMaterialIds.has(material.id) ? "assigned" as Material["status"] : "available" as Material["status"]
      }))

      // A local mutation landed while this reload was fetching — its optimistic
      // state is newer than this snapshot. Discard and replay once cooldowns clear.
      if (mutationEpochRef.current !== epochAtStart) {
        pendingReplayRef.current = true
        replayPendingUpdatesRef.current?.()
        return
      }

      setOperations(ops)
      setPersonnel(eventScopedPersonnel)
      setMaterials(eventScopedMaterials)
      // Sync the module-level mirror BEFORE the state batch renders: the
      // mirror-effect runs only after render, so helpers reading it
      // (getIncidentRefLabel & co.) would format the first paint without the
      // home city and visibly re-render to the short label later.
      setGlobalHomeCity(settings.home_city || "")
      setHomeCity(settings.home_city || "")
      setLastSyncAt(new Date())
    } catch (error) {
      console.error("Failed to load data:", error)
    } finally {
      setIsLoading(false)
    }
  }, [selectedEvent, refreshPersonnel, refreshMaterials, setPersonnel, setMaterials])

  // Load initial data and set up WebSocket/polling
  useEffect(() => {
    if (authLoading || !isAuthenticated) {
      setIsLoading(false)
      return
    }

    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      setOperations([])
      setIsLoading(false)
      // Only declare "loaded" once events have actually resolved. While the
      // EventProvider is still figuring out which event is selected, stay
      // unloaded so the board shows the progress bar — not a premature empty
      // state (empty columns + "Keine Personen" + QR) that flashes before data.
      if (isEventLoaded) setIsLoaded(true)
      return
    }

    const eventId = selectedEvent.id

    const loadData = async (showLoading = true) => {
      // Drive the top progress bar only for the meaningful initial load — not
      // the silent ~5s background polls — so the board's first paint feels fast
      // without the bar flickering on every sync.
      const driveBar = showLoading && isInitialLoadRef.current
      if (driveBar) topLoading.start()
      try {
        if (showLoading && isInitialLoadRef.current) {
          setIsLoading(true)
        }

        const epochAtStart = mutationEpochRef.current

        // Snapshot the sync version BEFORE fetching data. Pairing the stored
        // version with data fetched after it can only err toward one extra
        // reload — the old trailing fetch could store a version NEWER than the
        // data it was paired with, blinding the polling fallback to a change.
        const versionSnapshot = await apiClient.getSyncVersion(eventId).catch(() => null)

        // Fetch all data in parallel. See refreshOperations for why we suppress
        // intermediate personnel/material writes.
        const [apiIncidents, personnelList, materialsList, settings, vehiclesList] = await Promise.all([
          apiClient.getIncidents(eventId),
          refreshPersonnel({ skipStateUpdate: true }),
          refreshMaterials({ skipStateUpdate: true }),
          apiClient.getAllSettings().catch(() => ({ home_city: "" })),
          apiClient.getVehicles(),
        ])

        const ops = apiIncidents.map(apiIncidentToOperation)

        // Fetch special functions, assignments, and reko summaries in parallel
        const rekoPersonnelIds = new Set<string>()
        const driverPersonnelIds = new Map<string, { vehicleId: string; vehicleName: string }>()
        const magazinPersonnelIds = new Set<string>()
        const assignedPersonIds = new Set<string>()
        const assignedMaterialIds = new Set<string>()

        const [specialFunctionsResult, assignmentsResult, rekoSummariesResult] = await Promise.allSettled([
          apiClient.getEventSpecialFunctions(eventId),
          apiClient.getAssignmentsByEvent(eventId),
          apiClient.getEventRekoSummaries(eventId),
        ])

        // Process special functions (single fetch, used for both reko filtering and availability)
        if (specialFunctionsResult.status === 'fulfilled') {
          for (const func of specialFunctionsResult.value) {
            if (func.function_type === 'reko') rekoPersonnelIds.add(func.personnel_id)
            else if (func.function_type === 'driver') {
              driverPersonnelIds.set(func.personnel_id, { vehicleId: func.vehicle_id || '', vehicleName: func.vehicle_name || '' })
              assignedPersonIds.add(func.personnel_id)
            } else if (func.function_type === 'magazin') {
              magazinPersonnelIds.add(func.personnel_id)
              assignedPersonIds.add(func.personnel_id)
            } else {
              assignedPersonIds.add(func.personnel_id)
            }
          }
        } else {
          console.error('Failed to load special functions:', specialFunctionsResult.reason)
        }

        // Process assignments
        if (assignmentsResult.status === 'fulfilled') {
          const assignmentsByIncident = assignmentsResult.value
          ops.forEach((operation) => {
            const assignments = assignmentsByIncident[operation.id] || []
            for (const assignment of assignments) {
              if (assignment.resource_type === "personnel") {
                const person = personnelList.find(p => p.id === assignment.resource_id)
                if (person) {
                  if (rekoPersonnelIds.has(person.id)) {
                    operation.assignedReko = { id: person.id, name: person.name }
                    continue
                  }
                  operation.crew.push(person.name)
                  operation.crewAssignments.set(person.name, assignment.id)
                }
              } else if (assignment.resource_type === "material") {
                operation.materials.push(assignment.resource_id)
                operation.materialAssignments.set(assignment.resource_id, assignment.id)
              } else if (assignment.resource_type === "vehicle") {
                const vehicle = vehiclesList.find(v => v.id === assignment.resource_id)
                if (vehicle) {
                  operation.vehicles.push(vehicle.name)
                  operation.vehicleAssignments.set(vehicle.name, assignment.id)
                  if (vehicle.radio_call_sign) {
                    operation.vehicleCallsigns.set(vehicle.name, vehicle.radio_call_sign)
                  }
                  operation.vehicleDriverStay.set(vehicle.name, assignment.driver_stay || false)
                }
              }
            }
          })
        } else {
          console.error('Failed to load assignments:', assignmentsResult.reason)
        }

        // Show vehicles in their configured display order everywhere (radio text,
        // Divera/WhatsApp messages, cards) instead of assignment order.
        {
          const vehicleOrder = new Map(vehiclesList.map(v => [v.name, v.display_order]))
          ops.forEach(op => op.vehicles.sort((a, b) => (vehicleOrder.get(a) ?? 0) - (vehicleOrder.get(b) ?? 0)))
        }

        // Process reko summaries
        if (rekoSummariesResult.status === 'fulfilled') {
          const rekoSummaries = rekoSummariesResult.value
          ops.forEach(op => {
            const summary = rekoSummaries.summaries[op.id]
            if (summary?.has_completed_reko) {
              const dangerTypes: string[] = []
              if (summary.dangers_json) {
                if (summary.dangers_json.fire) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.fire'))
                if (summary.dangers_json.explosion) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.explosion'))
                if (summary.dangers_json.collapse) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.collapse'))
                if (summary.dangers_json.chemical) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.chemical'))
                if (summary.dangers_json.electrical) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.electrical'))
              }
              op.hasCompletedReko = true
              op.rekoSummary = {
                isRelevant: summary.is_relevant ?? false,
                hasDangers: dangerTypes.length > 0,
                dangerTypes,
                personnelCount: summary.effort_json?.personnel_count ?? null,
                estimatedDuration: summary.effort_json?.estimated_duration_hours ?? null,
                summaryText: summary.summary_text ?? null,
                photos: summary.photos_json ?? [],
              }
            }
          })
        } else {
          console.error('Failed to load reko summaries:', rekoSummariesResult.reason)
        }

        // Calculate availability from assignments

        ops.forEach(operation => {
          operation.crew.forEach(crewName => {
            const person = personnelList.find(p => p.name === crewName)
            if (person) assignedPersonIds.add(person.id)
          })
          operation.materials.forEach(materialId => assignedMaterialIds.add(materialId))
        })

        const eventScopedPersonnel = personnelList.map(person => ({
          ...person,
          status: assignedPersonIds.has(person.id) ? "assigned" as PersonStatus : "available" as PersonStatus,
          isReko: rekoPersonnelIds.has(person.id),
          isDriver: driverPersonnelIds.has(person.id),
          driverVehicleId: driverPersonnelIds.get(person.id)?.vehicleId || undefined,
          driverVehicleName: driverPersonnelIds.get(person.id)?.vehicleName || undefined,
          isMagazin: magazinPersonnelIds.has(person.id),
        }))

        const eventScopedMaterials = materialsList.map(material => ({
          ...material,
          status: assignedMaterialIds.has(material.id) ? "assigned" as Material["status"] : "available" as Material["status"]
        }))

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
        // Sync the module-level mirror BEFORE the state batch renders: the
      // mirror-effect runs only after render, so helpers reading it
      // (getIncidentRefLabel & co.) would format the first paint without the
      // home city and visibly re-render to the short label later.
      setGlobalHomeCity(settings.home_city || "")
      setHomeCity(settings.home_city || "")
        setIsLoaded(true)
        setLastSyncAt(new Date())
        isInitialLoadRef.current = false

        // Store the version snapshot taken before the data fetch (null forces
        // the next poll tick to reload — fails toward freshness).
        lastSyncVersionRef.current = versionSnapshot?.version ?? null
      } catch (error) {
        console.error("Failed to load data:", error)
        setIsLoaded(true)
        isInitialLoadRef.current = false
      } finally {
        setIsLoading(false)
        if (driveBar) topLoading.done()
      }
    }

    loadData()

    // WebSocket setup
    wsClient.connect()

    // Waking from a background/suspended tab: the socket may have been reaped
    // server-side while timers were throttled. connect() is a no-op when the
    // socket is alive or still auto-reconnecting.
    const handleWake = () => {
      if (document.visibilityState === 'visible') wsClient.connect()
    }
    document.addEventListener('visibilitychange', handleWake)

    const inCooldown = () =>
      criticalUpdateInProgress.current || assignmentHoldsRef.current > 0 || boardDraggingRef.current

    const handleRemoteUpdate = () => {
      const action = decideRemoteUpdateAction({ inCooldown: inCooldown() })
      if (action === "queue") {
        // Queue rather than drop — replay once the cooldown clears.
        pendingReplayRef.current = true
        return
      }
      loadData(false)
    }

    // Expose replay so cooldown-clear timers (defined outside this useEffect)
    // can trigger a coalesced reload when they fire.
    replayPendingUpdatesRef.current = () => {
      const action = decideCooldownClearAction({
        pendingReplay: pendingReplayRef.current,
        stillInCooldown: inCooldown(),
      })
      if (action === "skip") return
      pendingReplayRef.current = false
      loadData(false)
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
        const tickAction = decidePollTickAction({ isLoading: isLoadingRef.current, inCooldown: inCooldown() })
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
            await loadData(false)
          } else {
            // Confirmed fresh — keep the stale-data banner honest. Without
            // this, a healthy polling session with no changes let lastSyncAt
            // age past the threshold and showed "Verbindung verloren".
            setLastSyncAt(new Date())
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

    const statusUnsubscribe = wsClient.onStatusChange((status: WebSocketStatus) => {
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

    return () => {
      document.removeEventListener('visibilitychange', handleWake)
      unsubscribeIncidentUpdate()
      unsubscribePersonnelUpdate()
      unsubscribeVehicleUpdate()
      unsubscribeMaterialUpdate()
      unsubscribeAssignmentUpdate()
      unsubscribeAssignmentsTransferred()
      statusUnsubscribe()
      stopPolling()
      wsClient.disconnect()
    }
  }, [authLoading, isAuthenticated, selectedEvent, isEventLoaded, refreshPersonnel, refreshMaterials, setPersonnel, setMaterials])

  const removeCrew = (operationId: string, crewName: string): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return Promise.resolve(false)

    const assignmentId = operation.crewAssignments.get(crewName)
    if (!assignmentId) {
      console.warn(`No assignment ID found for crew member ${crewName}`)
      return Promise.resolve(false)
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const newCrewAssignments = new Map(op.crewAssignments)
          newCrewAssignments.delete(crewName)
          return { ...op, crew: op.crew.filter((name) => name !== crewName), crewAssignments: newCrewAssignments }
        }
        return op
      })
    )

    const person = personnel.find((p) => p.name === crewName)
    const personStatusSnapshot = person?.status ?? null
    const personnelShouldRevert =
      person !== undefined &&
      !operations.some(op => op.id !== operationId && op.crew.includes(crewName))
    if (personnelShouldRevert) {
      setPersonnel((people) =>
        people.map((p) => (p.id === person!.id ? { ...p, status: "available" as PersonStatus } : p))
      )
    }

    // B6: remember this removal so the next assignment can warn about rapid re-binding.
    if (person) {
      recordRemoval(recentRemovalsRef.current, person.id, operationId, operation.location)
    }

    if (isLoaded) {
      return apiClient.unassignResource(operationId, assignmentId)
        .then(() => true)
        .catch(err => {
          console.error("Failed to unassign crew:", err)
          toast.error(translateOutsideReact('notifications.operations.removeFailedTitle'), { description: translateOutsideReact('notifications.operations.removePersonFailedDescription') })
          setOperations((ops) =>
            ops.map((op) => (op.id === operationId ? operation : op))
          )
          if (personnelShouldRevert && person && personStatusSnapshot) {
            setPersonnel((people) =>
              people.map((p) => (p.id === person.id ? { ...p, status: personStatusSnapshot } : p))
            )
          }
          // Removal failed → drop the memo so we don't warn about a phantom removal.
          if (person) recentRemovalsRef.current.delete(person.id)
          return false
        })
        .finally(() => {
          releaseAssignmentCooldown()
        })
    }
    releaseAssignmentCooldown(3000)
    return Promise.resolve(true)
  }

  const removeReko = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation || !operation.assignedReko) return

    const rekoPersonId = operation.assignedReko.id

    armAssignmentCooldown()

    // Optimistically update UI
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, assignedReko: null } : op))
    )

    if (isLoaded) {
      // Use the unassign reko API
      apiClient.unassignRekoPersonnel(operationId, rekoPersonId)
        .catch(err => {
          console.error("Failed to unassign reko:", err)
          toast.error(translateOutsideReact('notifications.operations.removeFailedTitle'), { description: translateOutsideReact('notifications.operations.removeRekoFailedDescription') })
          // Revert on error
          setOperations((ops) =>
            ops.map((op) => (op.id === operationId ? { ...op, assignedReko: operation.assignedReko } : op))
          )
        })
        .finally(() => {
          releaseAssignmentCooldown()
        })
    } else {
      releaseAssignmentCooldown(3000)
    }
  }

  const removeMaterial = (operationId: string, materialId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const assignmentId = operation.materialAssignments.get(materialId)
    if (!assignmentId) {
      console.warn(`No assignment ID found for material ${materialId}`)
      return
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const newMaterialAssignments = new Map(op.materialAssignments)
          newMaterialAssignments.delete(materialId)
          return { ...op, materials: op.materials.filter((id) => id !== materialId), materialAssignments: newMaterialAssignments }
        }
        return op
      })
    )

    const material = materials.find((m) => m.id === materialId)
    const materialStatusSnapshot = material?.status ?? null
    const materialShouldRevert =
      material !== undefined &&
      !operations.some(op => op.id !== operationId && op.materials.includes(materialId))
    if (materialShouldRevert) {
      setMaterials((mats) =>
        mats.map((m) => (m.id === material!.id ? { ...m, status: "available" as Material["status"] } : m))
      )
    }

    if (isLoaded) {
      apiClient.unassignResource(operationId, assignmentId)
        .catch(err => {
          console.error("Failed to unassign material:", err)
          toast.error(translateOutsideReact('notifications.operations.removeFailedTitle'), { description: translateOutsideReact('notifications.operations.removeMaterialFailedDescription') })
          setOperations((ops) =>
            ops.map((op) => (op.id === operationId ? operation : op))
          )
          if (materialShouldRevert && material && materialStatusSnapshot) {
            setMaterials((mats) =>
              mats.map((m) => (m.id === material.id ? { ...m, status: materialStatusSnapshot } : m))
            )
          }
        })
        .finally(() => {
          releaseAssignmentCooldown()
        })
    } else {
      releaseAssignmentCooldown(3000)
    }
  }

  const updateOperation = (operationId: string, updates: Partial<Operation>) => {
    // LocationInput clears the address and coordinates together. Normalize both
    // legacy `coordinates: undefined` and address-only clear callbacks without
    // changing updates that simply omit coordinates.
    const hasCoordinateUpdate = Object.prototype.hasOwnProperty.call(updates, "coordinates")
    const normalizedUpdates = hasCoordinateUpdate
      ? { ...updates, coordinates: updates.coordinates ?? null }
      : updates.location === ""
        ? { ...updates, coordinates: null }
        : updates
    const enhancedUpdates = normalizedUpdates.status
      ? { ...normalizedUpdates, statusChangedAt: new Date() }
      : normalizedUpdates

    // When completing an operation, auto-release personnel and vehicles (backend does this too)
    const isCompletingOperation = normalizedUpdates.status === "complete"

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id !== operationId) return op

        let updatedOp = { ...op, ...enhancedUpdates }

        // Clear crew and vehicles when completing (backend auto-releases these)
        if (isCompletingOperation) {
          updatedOp = {
            ...updatedOp,
            crew: [],
            crewAssignments: new Map(),
            vehicles: [],
            vehicleAssignments: new Map(),
            vehicleCallsigns: new Map(),
            // Keep materials - backend keeps them assigned (may be left on site)
          }
        }

        return updatedOp
      })
    )

    // Update personnel status to available when operation completes
    if (isCompletingOperation) {
      const operation = operations.find(op => op.id === operationId)
      if (operation) {
        const crewToRelease = operation.crew
        setPersonnel((people) =>
          people.map((p) => {
            if (crewToRelease.includes(p.name)) {
              // Check if still assigned to another operation
              const stillAssigned = operations.some(
                op => op.id !== operationId && op.crew.includes(p.name)
              )
              if (!stillAssigned) {
                return { ...p, status: "available" as PersonStatus }
              }
            }
            return p
          })
        )
      }
    }

    // Guard against polling overwriting optimistic updates (status changes
    // included — the hold is released only after the PATCH settles, unlike
    // the old fixed 2s status timer that could expire mid-flight). Take ONE
    // hold per pending batch: schedule() merges rapid edits into a single
    // flush, so arming on every call would leak holds and freeze syncing.
    if (isLoaded && updateBatcherRef.current.getPending(operationId) !== undefined) {
      mutationEpochRef.current++ // still invalidate in-flight reloads
    } else {
      armAssignmentCooldown()
    }

    if (isLoaded) {
      const performUpdate = async (batchedUpdates: Partial<Operation>) => {
        const apiUpdates: Partial<ApiIncidentUpdate> = {}
        if (batchedUpdates.location !== undefined) apiUpdates.location_address = batchedUpdates.location
        if (batchedUpdates.incidentType !== undefined) apiUpdates.type = batchedUpdates.incidentType as ApiIncidentUpdate['type']
        if (batchedUpdates.priority !== undefined) apiUpdates.priority = batchedUpdates.priority
        if (batchedUpdates.status !== undefined) apiUpdates.status = batchedUpdates.status
        if (batchedUpdates.coordinates !== undefined) {
          Object.assign(apiUpdates, coordinatesToApiFields(batchedUpdates.coordinates))
        }
        if (batchedUpdates.notes !== undefined) apiUpdates.description = batchedUpdates.notes
        if (batchedUpdates.contact !== undefined) apiUpdates.contact = batchedUpdates.contact
        if (batchedUpdates.contactPhone !== undefined) apiUpdates.contact_phone = batchedUpdates.contactPhone
        if (batchedUpdates.internalNotes !== undefined) apiUpdates.internal_notes = batchedUpdates.internalNotes
        if (batchedUpdates.nachbarhilfe !== undefined) apiUpdates.nachbarhilfe = batchedUpdates.nachbarhilfe
        if (batchedUpdates.nachbarhilfeNote !== undefined) apiUpdates.nachbarhilfe_note = batchedUpdates.nachbarhilfeNote
        if (batchedUpdates.amWarten !== undefined) apiUpdates.am_warten = batchedUpdates.amWarten
        if (batchedUpdates.amWartenNote !== undefined) apiUpdates.am_warten_note = batchedUpdates.amWartenNote
        if (batchedUpdates.zuFuss !== undefined) apiUpdates.zu_fuss = batchedUpdates.zuFuss

        try {
          await apiClient.updateIncident(operationId, apiUpdates)
        } catch (err) {
          console.error("Failed to update operation:", err)
          if (ApiError.isConflictError(err)) {
            toast.info(translateOutsideReact('notifications.operations.conflictTitle'), {
              description: translateOutsideReact('notifications.operations.conflictDescription')
            })
            await refreshOperations()
          } else if (batchedUpdates.status !== undefined) {
            // Status changes are usually drag-drops between columns. If the
            // backend rejects the change, the card visually sits in the wrong
            // column until the next poll — refresh now so it snaps back.
            toast.error(translateOutsideReact('notifications.operations.statusNotChangedTitle'), {
              description: translateOutsideReact('notifications.operations.statusNotChangedDescription'),
            })
            await refreshOperations()
          } else {
            toast.error(translateOutsideReact('notifications.operations.updateFailedTitle'), { description: translateOutsideReact('notifications.operations.updateFailedDescription') })
          }
        } finally {
          if (criticalUpdateInProgress.current) criticalUpdateInProgress.current = false
          releaseAssignmentCooldown()
        }
      }

      // Location/coordinate edits and STATUS changes flush almost immediately
      // (map pin drops need to persist fast; status drags must hit the server
      // before the reorder POST lands and before a possible tab close).
      // Everything else debounces to coalesce rapid edits. Criticality is
      // decided on the MERGED batch so a follow-up non-critical edit can't
      // demote a pending critical write back to the slow path.
      const merged = { ...(updateBatcherRef.current.getPending(operationId) ?? {}), ...normalizedUpdates }
      const isCriticalUpdate =
        merged.location !== undefined || merged.coordinates !== undefined || merged.status !== undefined
      if (isCriticalUpdate) criticalUpdateInProgress.current = true
      updateBatcherRef.current.schedule(operationId, normalizedUpdates, isCriticalUpdate ? 50 : 500, performUpdate)
    } else {
      releaseAssignmentCooldown(3000)
    }
  }

  // Persist the manual order of a status column. The optimistic reorder already
  // happened in the drag handler; this writes the new positions so the next
  // reconciliation reload reproduces the same order instead of snapping the
  // card back to its old (created_at) slot. Guards reconciliation with the same
  // assignment cooldown updateOperation uses, so a poll/WS reload mid-write
  // can't clobber the optimistic order before the POST lands.
  const reorderColumn = (orderedIds: string[]) => {
    if (!isLoaded || !selectedEvent || !isValidUUID(selectedEvent.id) || orderedIds.length === 0) return

    // Serialize the POSTs: two rapid drags in flight together can commit in
    // reverse order server-side, silently persisting the FIRST drag's order.
    // Only the latest queued order is sent once the in-flight POST settles.
    const eventId = selectedEvent.id
    queuedReorderRef.current = orderedIds
    if (reorderInFlightRef.current) return

    reorderInFlightRef.current = true
    void (async () => {
      try {
        while (queuedReorderRef.current) {
          const ids = queuedReorderRef.current
          queuedReorderRef.current = null
          armAssignmentCooldown()
          try {
            await apiClient.reorderIncidents(eventId, ids)
          } catch (err) {
            console.error("Failed to persist column order:", err)
            // The optimistic order isn't saved — tell the user and pull the
            // authoritative order back (the generic API toast doesn't say the
            // ORDER was reverted).
            toast.error(translateOutsideReact('notifications.operations.reorderFailedTitle'), {
              description: translateOutsideReact('notifications.operations.reorderFailedDescription'),
            })
            await refreshOperations()
          } finally {
            releaseAssignmentCooldown()
          }
        }
      } finally {
        reorderInFlightRef.current = false
      }
    })()
  }

  // One-click status change that drops the card at the TOP of its new column,
  // mirroring how the reko auto-advance surfaces freshly-moved incidents. Saves
  // the operator a drag across the board.
  const changeStatusToTop = (operationId: string, newStatus: OperationStatus) => {
    // Persist the status (debounced backend update + completion side effects).
    updateOperation(operationId, { status: newStatus })
    // Optimistically move the card to the front of the array so it renders at the
    // top of its (single-status) column immediately.
    setOperations((ops) => {
      const target = ops.find((o) => o.id === operationId)
      if (!target) return ops
      return [target, ...ops.filter((o) => o.id !== operationId)]
    })
    // Persist the new in-column order with this card first.
    const ids = [
      operationId,
      ...operations
        .filter((o) => o.id !== operationId && o.status === newStatus)
        .map((o) => o.id),
    ]
    reorderColumn(ids)
  }

  const getNextOperationId = () => {
    const maxId = Math.max(...operations.map(op => parseInt(op.id) || 0))
    return String(maxId + 1)
  }

  const createOperation = async (operation: Omit<Operation, "id" | "dispatchTime">) => {
    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      console.error("Cannot create operation without valid selected event")
      return
    }

    if (isLoaded) {
      try {
        const incidentData = {
          event_id: selectedEvent.id,
          title: operation.location,
          type: (operation.incidentType || "elementarereignis") as ApiIncidentCreate['type'],
          priority: operation.priority as "low" | "medium" | "high",
          location_address: operation.location,
          ...coordinatesToApiFields(operation.coordinates),
          status: "incoming" as const,
          description: operation.notes || null,
          contact: operation.contact || null,
          contact_phone: operation.contactPhone || null,
          internal_notes: operation.internalNotes || null,
          // Attach to an Auftrag at creation when the caller preset a group
          // (streamlined "+ Stop" flow) — backend stamps group_position.
          group_id: operation.groupId ?? null,
        }

        const apiIncident = await apiClient.createIncident(incidentData)

        const newOperation: Operation = {
          id: apiIncident.id,
          location: apiIncident.location_address || apiIncident.title,
          locationDisplay: apiIncident.location_display ?? undefined,
          vehicle: operation.vehicle,
          vehicles: [],
          incidentType: operation.incidentType,
          dispatchTime: new Date(apiIncident.created_at),
          crew: [],
          priority: apiIncident.priority as "low" | "medium" | "high",
          status: "incoming",
          coordinates: apiCoordinatesToTuple(apiIncident.location_lat, apiIncident.location_lng),
          materials: [],
          notes: apiIncident.description || "",
          contact: apiIncident.contact || "",
          contactPhone: apiIncident.contact_phone || "",
          internalNotes: apiIncident.internal_notes || "",
          nachbarhilfe: apiIncident.nachbarhilfe || false,
          nachbarhilfeNote: apiIncident.nachbarhilfe_note || "",
          amWarten: apiIncident.am_warten || false,
          amWartenNote: apiIncident.am_warten_note || "",
          zuFuss: apiIncident.zu_fuss || false,
          source: apiIncident.source || "operator",
          statusChangedAt: apiIncident.status_changed_at ? new Date(apiIncident.status_changed_at) : null,
          hasCompletedReko: false,
          rekoArrivedAt: null,
          rekoSummary: null,
          assignedReko: null,
          crewAssignments: new Map(),
          materialAssignments: new Map(),
          vehicleAssignments: new Map(),
          vehicleCallsigns: new Map(),
          vehicleDriverStay: new Map(),
          groupId: apiIncident.group_id ?? null,
          groupPosition: apiIncident.group_position ?? 0,
        }
        // Invalidate reloads that started before the POST landed — they'd
        // overwrite the board without the new incident.
        mutationEpochRef.current++
        // A WS-triggered reload can already have delivered this incident
        // between the POST and this write — don't render it twice.
        setOperations((ops) =>
          ops.some((op) => op.id === newOperation.id) ? ops : [newOperation, ...ops]
        )
      } catch (error) {
        console.error("Failed to create operation:", error)
        toast.error(translateOutsideReact('notifications.operations.createFailedTitle'), {
          description: translateOutsideReact('notifications.operations.createFailedDescription'),
        })
      }
    } else {
      const newOperation: Operation = {
        ...operation,
        id: getNextOperationId(),
        dispatchTime: new Date(),
        nachbarhilfe: operation.nachbarhilfe || false,
        statusChangedAt: null,
        hasCompletedReko: false,
        rekoArrivedAt: null,
        rekoSummary: null,
        crewAssignments: new Map(),
        materialAssignments: new Map(),
        vehicleAssignments: new Map(),
        vehicleCallsigns: new Map(),
      }
      setOperations((ops) => [newOperation, ...ops])
    }
  }

  const assignPersonToOperation = async (personId: string, personName: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    const person = personnel.find(p => p.id === personId)

    // Block silently double-booking someone who's "assigned" — EXCEPT people
    // busy in a special function (reko/driver/magazin). Those are surfaced in the
    // crew dialog (badge) and assigned only through an explicit confirm, so let
    // them through here instead of silently no-oping the confirmed assignment.
    const hasSpecialFunction = person?.isReko || person?.isDriver || person?.isMagazin
    if (!operation || !person || (person.status === "assigned" && !hasSpecialFunction) || operation.crew.includes(personName)) {
      return
    }

    // B6: warn (don't block) when re-assigning someone we just took off another incident.
    const recentRemoval = findRecentRemoval(recentRemovalsRef.current, personId, operationId)
    if (recentRemoval) {
      const elapsedSec = Math.round((Date.now() - recentRemoval.removedAt) / 1000)
      toast.warning(translateOutsideReact('notifications.operations.recentRemovalWarningTitle', { name: personName, seconds: elapsedSec, incident: recentRemoval.incidentLabel }), {
        description: translateOutsideReact('notifications.operations.recentRemovalWarningDescription'),
      })
      // Don't repeat the warning if the same operator re-confirms the assignment.
      recentRemovalsRef.current.delete(personId)
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, crew: [...op.crew, personName] } : op))
    )
    setPersonnel((people) =>
      people.map((p) => (p.id === personId ? { ...p, status: "assigned" as PersonStatus } : p))
    )

    if (isLoaded) {
      try {
        const assignment = await apiClient.assignResource(operationId, {
          resource_type: "personnel",
          resource_id: personId,
        })
        setOperations((ops) =>
          ops.map((op) => {
            if (op.id === operationId) {
              const newCrewAssignments = new Map(op.crewAssignments)
              newCrewAssignments.set(personName, assignment.id)
              return { ...op, crewAssignments: newCrewAssignments }
            }
            return op
          })
        )
      } catch (err) {
        console.error("Failed to assign person:", err)
        toast.error(translateOutsideReact('notifications.operations.assignFailedTitle'), {
          description: ApiError.isConflictError(err)
            ? translateOutsideReact('notifications.operations.assignConflictDescription', { name: personName })
            : translateOutsideReact('notifications.operations.assignFailedDescription', { name: personName }),
        })
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, crew: op.crew.filter(n => n !== personName) } : op))
        )
        setPersonnel((people) =>
          people.map((p) => (p.id === personId ? { ...p, status: "available" as PersonStatus } : p))
        )
        // The chip already snapped back — say why, or the operator assumes it stuck.
        toast.error(translateOutsideReact('notifications.operations.assignFailedFollowupTitle'), {
          description: translateOutsideReact('notifications.operations.assignFailedDescription', { name: personName }),
        })
      } finally {
        releaseAssignmentCooldown()
      }
    } else {
      releaseAssignmentCooldown(3000)
    }
  }

  const assignRekoPersonToOperation = async (personId: string, personName: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    const person = personnel.find(p => p.id === personId)

    // Only allow reko personnel to be assigned via this function
    if (!operation || !person || !person.isReko) {
      return
    }

    // If same person already assigned, do nothing
    if (operation.assignedReko?.id === personId) {
      return
    }

    armAssignmentCooldown()

    // Optimistically update UI - also move to "reko" status if currently "incoming"
    const currentOp = operations.find(op => op.id === operationId)
    const shouldAutoMoveToReko = currentOp?.status === "incoming"

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id !== operationId) return op
        const updated = { ...op, assignedReko: { id: personId, name: personName } }
        if (shouldAutoMoveToReko) {
          updated.status = "reko"
          updated.statusChangedAt = new Date()
        }
        return updated
      })
    )

    if (isLoaded) {
      try {
        // Use the reko assignment API (backend auto-moves status to "reko" if eingegangen)
        await apiClient.assignRekoPersonnel(operationId, personId)
      } catch (err) {
        console.error("Failed to assign reko person:", err)
        toast.error(translateOutsideReact('notifications.operations.assignFailedTitle'), {
          description: translateOutsideReact('notifications.operations.assignRekoFailedDescription', { name: personName }),
        })
        // Revert on error
        setOperations((ops) =>
          ops.map((op) => {
            if (op.id !== operationId) return op
            const reverted = { ...op, assignedReko: null }
            if (shouldAutoMoveToReko) {
              reverted.status = "incoming" as OperationStatus
              reverted.statusChangedAt = currentOp?.statusChangedAt ?? null
            }
            return reverted
          })
        )
        // The reko badge already snapped back — say why, or the operator assumes it stuck.
        toast.error(translateOutsideReact('notifications.operations.assignRekoFailedTitle'), {
          description: translateOutsideReact('notifications.operations.assignRekoFailedDescription', { name: personName }),
        })
      } finally {
        releaseAssignmentCooldown()
      }
    } else {
      releaseAssignmentCooldown(3000)
    }
  }

  const assignMaterialToOperation = async (materialId: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    const material = materials.find(m => m.id === materialId)

    const isConsumable = material?.consumable
    if (!operation || !material || (!isConsumable && material.status === "assigned") || operation.materials.includes(materialId)) {
      return
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, materials: [...op.materials, materialId] } : op))
    )
    // Consumables stay "available" — they can be assigned to multiple incidents
    if (!isConsumable) {
      setMaterials((mats) =>
        mats.map((m) => (m.id === materialId ? { ...m, status: "assigned" as Material["status"] } : m))
      )
    }

    if (isLoaded) {
      try {
        const assignment = await apiClient.assignResource(operationId, {
          resource_type: "material",
          resource_id: materialId,
        })
        setOperations((ops) =>
          ops.map((op) => {
            if (op.id === operationId) {
              const newMaterialAssignments = new Map(op.materialAssignments)
              newMaterialAssignments.set(materialId, assignment.id)
              return { ...op, materialAssignments: newMaterialAssignments }
            }
            return op
          })
        )
      } catch (err) {
        console.error("Failed to assign material:", err)
        toast.error(translateOutsideReact('notifications.operations.assignFailedTitle'), {
          description: ApiError.isConflictError(err)
            ? translateOutsideReact('notifications.operations.assignConflictDescription', { name: material.name })
            : translateOutsideReact('notifications.operations.assignFailedDescription', { name: material.name }),
        })
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, materials: op.materials.filter(id => id !== materialId) } : op))
        )
        setMaterials((mats) =>
          mats.map((m) => (m.id === materialId ? { ...m, status: "available" as Material["status"] } : m))
        )
      } finally {
        releaseAssignmentCooldown()
      }
    } else {
      releaseAssignmentCooldown(3000)
    }
  }

  const assignVehicleToOperation = async (vehicleId: string, vehicleName: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)

    if (!operation || operation.vehicles.includes(vehicleName)) {
      return
    }

    if (!vehicleId || vehicleId.trim() === '') {
      console.error('[ERROR] Invalid vehicleId:', { vehicleId, vehicleName, operationId })
      toast.error(translateOutsideReact('notifications.operations.errorTitle'), { description: translateOutsideReact('notifications.operations.vehicleInvalidIdDescription', { name: vehicleName }) })
      return
    }

    // A vehicle is a single physical asset — if it's still assigned elsewhere,
    // ask the operator whether to move it here or keep the double booking,
    // rather than silently double-booking it.
    const conflicts = operations
      .filter(op => op.id !== operationId && op.vehicles.includes(vehicleName))
      .map(op => ({ operationId: op.id, operationLabel: getIncidentRefLabel(op) }))
    if (conflicts.length > 0) {
      setVehicleConflict({ vehicleId, vehicleName, targetOperationId: operationId, conflicts })
      return
    }

    await performVehicleAssign(vehicleId, vehicleName, operationId)
  }

  const performVehicleAssign = async (vehicleId: string, vehicleName: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation || operation.vehicles.includes(vehicleName)) {
      return
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, vehicles: [...op.vehicles, vehicleName] } : op))
    )

    if (isLoaded) {
      try {
        const assignment = await apiClient.assignResource(operationId, {
          resource_type: "vehicle",
          resource_id: vehicleId,
        })
        setOperations((ops) =>
          ops.map((op) => {
            if (op.id === operationId) {
              const newVehicleAssignments = new Map(op.vehicleAssignments)
              newVehicleAssignments.set(vehicleName, assignment.id)
              const newVehicleDriverStay = new Map(op.vehicleDriverStay)
              newVehicleDriverStay.set(vehicleName, assignment.driver_stay || false)
              return { ...op, vehicleAssignments: newVehicleAssignments, vehicleDriverStay: newVehicleDriverStay }
            }
            return op
          })
        )

        // Prompt for a driver if this vehicle doesn't have one yet. Drivers are
        // event-scoped (EventSpecialFunction), so a vehicle that already has a
        // driver from elsewhere in the event isn't prompted again. Non-fatal:
        // if we can't determine the driver state, we simply skip the prompt.
        if (selectedEvent?.id) {
          try {
            const functions = await apiClient.getEventSpecialFunctions(selectedEvent.id)
            const hasDriver = functions.some(
              (f) => f.function_type === "driver" && f.vehicle_id === vehicleId
            )
            // Guard against the assign→remove race: this runs two network
            // round-trips after the assignment, so the operator may have already
            // unassigned the vehicle. Only prompt if it's still on this incident,
            // otherwise the prompt appears to fire on *un*assignment.
            const stillAssigned = operationsRef.current
              .find((op) => op.id === operationId)
              ?.vehicles.includes(vehicleName)
            if (!hasDriver && stillAssigned) {
              setVehicleNeedingDriver({ vehicleId, vehicleName })
            }
          } catch (err) {
            console.error("Failed to check vehicle driver state:", err)
          }
        }
      } catch (err) {
        console.error("Failed to assign vehicle:", err)
        toast.error(translateOutsideReact('notifications.operations.assignFailedTitle'), {
          description: ApiError.isConflictError(err)
            ? translateOutsideReact('notifications.operations.assignConflictDescription', { name: vehicleName })
            : translateOutsideReact('notifications.operations.assignFailedDescription', { name: vehicleName }),
        })
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, vehicles: op.vehicles.filter(name => name !== vehicleName) } : op))
        )
      } finally {
        // Clear cooldown after API response, with a small grace period
        releaseAssignmentCooldown()
      }
    } else {
      releaseAssignmentCooldown(3000)
    }
  }

  const removeVehicle = (operationId: string, vehicleName: string): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return Promise.resolve(false)

    const assignmentId = operation.vehicleAssignments.get(vehicleName)
    if (!assignmentId) {
      console.warn(`No assignment ID found for vehicle ${vehicleName}`)
      return Promise.resolve(false)
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const newVehicleAssignments = new Map(op.vehicleAssignments)
          newVehicleAssignments.delete(vehicleName)
          const newVehicleCallsigns = new Map(op.vehicleCallsigns)
          newVehicleCallsigns.delete(vehicleName)
          const newVehicleDriverStay = new Map(op.vehicleDriverStay)
          newVehicleDriverStay.delete(vehicleName)
          return { ...op, vehicles: op.vehicles.filter((name) => name !== vehicleName), vehicleAssignments: newVehicleAssignments, vehicleCallsigns: newVehicleCallsigns, vehicleDriverStay: newVehicleDriverStay }
        }
        return op
      })
    )

    if (isLoaded) {
      return apiClient.unassignResource(operationId, assignmentId)
        .then(() => true)
        .catch(err => {
          console.error("Failed to unassign vehicle:", err)
          toast.error(translateOutsideReact('notifications.operations.removeFailedTitle'), { description: translateOutsideReact('notifications.operations.removeVehicleFailedDescription') })
          setOperations((ops) =>
            ops.map((op) => (op.id === operationId ? operation : op))
          )
          return false
        })
        .finally(() => {
          releaseAssignmentCooldown()
        })
    }
    releaseAssignmentCooldown(3000)
    return Promise.resolve(true)
  }

  const resolveVehicleConflict = async (action: "move" | "keep") => {
    const conflict = vehicleConflict
    if (!conflict) return
    setVehicleConflict(null)

    if (conflict.customResolve) {
      await conflict.customResolve(action)
      return
    }

    if (action === "move") {
      // Remove the vehicle from every other incident before assigning it
      // here — and WAIT for the removals: toasting "verschoben" before they
      // were confirmed left the vehicle double-booked on failure despite the
      // user explicitly choosing "move".
      const results = await Promise.all(
        conflict.conflicts.map((c) => removeVehicle(c.operationId, conflict.vehicleName))
      )
      if (results.some((ok) => !ok)) {
        // removeVehicle already rolled back and toasted the failed ones.
        toast.error(translateOutsideReact('notifications.operations.vehicleNotMovedTitle', { name: conflict.vehicleName }), {
          description: translateOutsideReact('notifications.operations.vehicleNotMovedDescription'),
        })
        return
      }
      const labels = conflict.conflicts.map(c => `"${c.operationLabel}"`).join(", ")
      toast.info(translateOutsideReact('notifications.operations.vehicleMovedTitle', { name: conflict.vehicleName }), {
        description: translateOutsideReact('notifications.operations.vehicleMovedDescription', { labels }),
      })
    }

    await performVehicleAssign(conflict.vehicleId, conflict.vehicleName, conflict.targetOperationId)
  }

  const cancelVehicleConflict = useCallback(() => setVehicleConflict(null), [])
  const requestVehicleConflict = useCallback((conflict: NonNullable<OperationsContextType["vehicleConflict"]>) => {
    setVehicleConflict(conflict)
  }, [])

  // Undo a delete: restore the soft-deleted incident and reconcile the board.
  // api-client's request() returns undefined on a network error (no throw) and
  // throws an ApiError (409 → isConflictError) on HTTP failures, so we normalize
  // both into a RestoreOutcome and let the pure decideRestoreAction map it.
  const handleRestore = async (operationId: string): Promise<void> => {
    let outcome: RestoreOutcome
    try {
      const restored = await apiClient.restoreIncident(operationId)
      outcome = restored ? "ok" : "network"
    } catch (err) {
      outcome = ApiError.isConflictError(err) ? "conflict" : "error"
    }

    const action = decideRestoreAction(outcome)
    if (action === "error") {
      toast.error(translateOutsideReact('notifications.operations.restoreFailedTitle'), {
        description: translateOutsideReact('notifications.operations.restoreFailedDescription'),
      })
      return
    }

    // A restore always re-includes the card on the next load, so there is no
    // WS-resurrection suppression to bypass — refresh pulls the card back.
    await refreshOperations()
    if (action === "refresh-success") {
      toast.success(translateOutsideReact('notifications.operations.restoredTitle'))
    }
  }

  const deleteOperation = async (operationId: string): Promise<void> => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) {
      console.error("Operation not found:", operationId)
      return
    }

    try {
      if (isLoaded) {
        await apiClient.deleteIncident(operationId)
      }

      for (const crewName of operation.crew) {
        const person = personnel.find(p => p.name === crewName)
        if (person) {
          const stillAssigned = operations.some(op => op.id !== operationId && op.crew.includes(crewName))
          if (!stillAssigned) {
            setPersonnel((people) =>
              people.map((p) => (p.id === person.id ? { ...p, status: "available" as PersonStatus } : p))
            )
          }
        }
      }

      for (const materialId of operation.materials) {
        const material = materials.find(m => m.id === materialId)
        if (material) {
          const stillAssigned = operations.some(op => op.id !== operationId && op.materials.includes(materialId))
          if (!stillAssigned) {
            setMaterials((mats) =>
              mats.map((m) => (m.id === material.id ? { ...m, status: "available" as Material["status"] } : m))
            )
          }
        }
      }

      // Invalidate reloads that started before the DELETE landed — they'd
      // resurrect the card until the next sync.
      mutationEpochRef.current++
      setOperations((ops) => ops.filter((op) => op.id !== operationId))

      // Offer an undo. Only when the delete was persisted (isLoaded) — a purely
      // local optimistic delete has no backend row to restore.
      if (isLoaded) {
        toast(translateOutsideReact('notifications.operations.deletedTitle'), {
          description: getIncidentRefLabel(operation),
          duration: 8000,
          action: {
            label: translateOutsideReact('notifications.operations.undoLabel'),
            onClick: () => {
              void handleRestore(operationId)
            },
          },
        })
      }
    } catch (error) {
      console.error("Failed to delete operation:", error)
      throw error
    }
  }

  // Prefer the server-computed labels (location_display) so first paint shows
  // the final string; the client formatter only covers addresses the server
  // hasn't labelled (optimistic local ops, free-form strings).
  const serverLocationLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (const op of operations) {
      if (op.locationDisplay !== undefined) labels.set(op.location, op.locationDisplay)
    }
    return labels
  }, [operations])

  const formatLocation = (fullAddress: string): string => {
    const serverLabel = serverLocationLabels.get(fullAddress)
    if (serverLabel !== undefined) return serverLabel
    return formatLocationForDisplay(fullAddress, homeCity)
  }

  return (
    <OperationsContext.Provider
      value={{
        personnel,
        setPersonnel,
        materials,
        setMaterials,
        operations,
        setOperations,
        homeCity,
        isLoading,
        isLoaded,
        lastSyncAt,
        formatLocation,
        refreshOperations,
        removeCrew,
        removeMaterial,
        removeVehicle,
        removeReko,
        updateOperation,
        reorderColumn,
        setBoardDragging,
        changeStatusToTop,
        createOperation,
        getNextOperationId,
        assignPersonToOperation,
        assignRekoPersonToOperation,
        assignMaterialToOperation,
        assignVehicleToOperation,
        vehicleNeedingDriver,
        clearVehicleNeedingDriver,
        vehicleConflict,
        resolveVehicleConflict,
        cancelVehicleConflict,
        requestVehicleConflict,
        deleteOperation,
      }}
    >
      {children}
      <audio ref={alertAudioRef} src="/alerts/mixkit-digital-quick-tone-2866.wav" preload="auto" />
    </OperationsContext.Provider>
  )
}

export function useOperations() {
  const context = useContext(OperationsContext)
  if (context === undefined) {
    throw new Error("useOperations must be used within an OperationsProvider")
  }
  return context
}

/**
 * useIncidents - Compatibility hook for components that only need incident data
 */
export function useIncidents() {
  const context = useContext(OperationsContext)
  const { selectedEvent } = useEvent()

  if (context === undefined) {
    throw new Error("useIncidents must be used within an OperationsProvider")
  }

  const incidents = context.operations.map((op) => ({
    id: op.id,
    event_id: selectedEvent?.id || "",
    title: op.location,
    type: op.incidentType as ApiIncident['type'],
    priority: op.priority as "low" | "medium" | "high",
    location_address: op.location,
    location_display: op.locationDisplay ?? null,
    location_lat: op.coordinates?.[0] ?? null,
    location_lng: op.coordinates?.[1] ?? null,
    status: op.status,
    description: op.notes,
    nachbarhilfe: op.nachbarhilfe || false,
    am_warten: op.amWarten || false,
    zu_fuss: op.zuFuss || false,
    created_at: op.dispatchTime,
    updated_at: op.dispatchTime,
    created_by: null,
    completed_at: op.status === "complete" ? new Date() : null,
    status_changed_at: op.statusChangedAt,
    has_completed_reko: op.hasCompletedReko || false,
    reko_arrived_at: op.rekoArrivedAt ?? null,
    assigned_vehicles: op.vehicles.map((name) => ({
      assignment_id: op.vehicleAssignments.get(name) || "",
      vehicle_id: "",
      name,
      type: "",
      assigned_at: new Date(),
      driver_stay: op.vehicleDriverStay.get(name) || false,
    })),
    assigned_personnel: op.crew.map((name) => ({
      assignment_id: "",
      personnel_id: "",
      name,
      role: "",
      assigned_at: new Date(),
    })),
    assigned_materials: op.materials.map((id) => {
      const material = context.materials.find(m => m.id === id)
      return {
        assignment_id: "",
        material_id: id,
        name: material?.name || id,
        assigned_at: new Date(),
      }
    }),
  }))

  return {
    incidents,
    personnel: context.personnel,
    materials: context.materials,
    isLoading: context.isLoading,
    isLoaded: context.isLoaded,
    error: null,
    trainingMode: false,
    homeCity: context.homeCity,
    setIncidents: () => {},
    setPersonnel: context.setPersonnel,
    setMaterials: context.setMaterials,
    setTrainingMode: (_trainingMode: boolean) => {},
    formatLocation: context.formatLocation,
    createIncident: async (data: IncidentCreateInput) => {
      const apiData: ApiIncidentCreate = {
        ...data,
        location_lat: data.location_lat != null ? String(data.location_lat) : null,
        location_lng: data.location_lng != null ? String(data.location_lng) : null,
      }
      const apiIncident = await apiClient.createIncident(apiData)
      await context.refreshOperations()
      return apiIncident
    },
    updateIncident: async (id: string, data: IncidentUpdateInput) => {
      const apiData: Partial<ApiIncidentUpdate> = {
        ...data,
        location_lat: data.location_lat != null ? String(data.location_lat) : data.location_lat === null ? null : undefined,
        location_lng: data.location_lng != null ? String(data.location_lng) : data.location_lng === null ? null : undefined,
      }
      await apiClient.updateIncident(id, apiData)
      await context.refreshOperations()
    },
    deleteIncident: async (id: string) => {
      await context.deleteOperation(id)
    },
    refreshIncidents: context.refreshOperations,
    updateIncidentStatus: async () => {},
    getStatusHistory: async () => [],
  }
}
