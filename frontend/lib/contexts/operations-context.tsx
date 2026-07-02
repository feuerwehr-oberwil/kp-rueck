"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from "react"
import { apiClient, ApiError, type ApiPersonnel, type ApiMaterialResource, type ApiIncident, type ApiIncidentCreate, type ApiIncidentUpdate } from "@/lib/api-client"
import { formatLocationForDisplay } from "@/lib/utils"
import { isValidUUID } from "@/lib/utils/validation"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"
import { usePersonnel, type Person, type PersonStatus } from "./personnel-context"
import { useMaterials, type Material } from "./materials-context"
import { toast } from "sonner"
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

// Re-export types for backward compatibility
export type { Person, PersonStatus } from "./personnel-context"
export type { Material } from "./materials-context"
export type PersonRole = string

// Types
export type OperationStatus = "incoming" | "ready" | "rekoDone" | "enroute" | "active" | "returning" | "complete"
export type VehicleType = string | null

export interface RekoSummary {
  isRelevant: boolean
  hasDangers: boolean
  dangerTypes: string[]
  personnelCount: number | null
  estimatedDuration: number | null
}

export interface Operation {
  id: string
  location: string
  vehicle: VehicleType
  vehicles: string[]
  incidentType: string
  dispatchTime: Date
  crew: string[]
  priority: "high" | "medium" | "low"
  status: OperationStatus
  coordinates: [number, number]
  materials: string[]
  notes: string
  contact: string
  internalNotes: string
  nachbarhilfe: boolean
  nachbarhilfeNote: string
  amWarten: boolean
  amWartenNote: string
  zuFuss: boolean
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
  removeCrew: (operationId: string, crewName: string) => void
  removeMaterial: (operationId: string, materialId: string) => void
  removeVehicle: (operationId: string, vehicleName: string) => void
  removeReko: (operationId: string) => void
  updateOperation: (operationId: string, updates: Partial<Operation>) => void
  /** Persist the manual top-to-bottom order of a status column after a drag-reorder. */
  reorderColumn: (orderedIds: string[]) => void
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
      }
    | null
  resolveVehicleConflict: (action: "move" | "keep") => void
  cancelVehicleConflict: () => void
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
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [homeCity, setHomeCity] = useState<string>("")
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
  const recentAssignmentRef = useRef<boolean>(false)
  const assignmentCooldownTimerRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const recentStatusUpdateRef = useRef<boolean>(false)
  const statusUpdateCooldownTimerRef = useRef<NodeJS.Timeout | undefined>(undefined)
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

  const clearAssignmentCooldown = () => {
    recentAssignmentRef.current = false
    replayPendingUpdatesRef.current?.()
  }
  const clearStatusUpdateCooldown = () => {
    recentStatusUpdateRef.current = false
    replayPendingUpdatesRef.current?.()
  }

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
    const statusMap: Record<string, OperationStatus> = {
      "eingegangen": "incoming",
      "reko": "ready",
      "reko_done": "rekoDone",
      "disponiert": "enroute",
      "einsatz": "active",
      "einsatz_beendet": "returning",
      "abschluss": "complete",
    }

    return {
      id: incident.id,
      location: incident.location_address || incident.title,
      vehicle: null,
      vehicles: [],
      incidentType: incident.type || "elementarereignis",
      dispatchTime: new Date(incident.created_at),
      crew: [],
      priority: incident.priority as "high" | "medium" | "low",
      status: statusMap[incident.status] || "incoming",
      coordinates: incident.location_lat && incident.location_lng
        ? [parseFloat(incident.location_lat), parseFloat(incident.location_lng)]
        : [47.51637699933488, 7.561800450458299],
      materials: [],
      notes: incident.description || "",
      contact: incident.contact || "",
      internalNotes: incident.internal_notes || "",
      nachbarhilfe: incident.nachbarhilfe || false,
      nachbarhilfeNote: incident.nachbarhilfe_note || "",
      amWarten: incident.am_warten || false,
      amWartenNote: incident.am_warten_note || "",
      zuFuss: incident.zu_fuss || false,
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
              if (summary.dangers_json.fire) dangerTypes.push("Feuer")
              if (summary.dangers_json.fire_danger) dangerTypes.push("Brandgefahr")
              if (summary.dangers_json.explosion) dangerTypes.push("Explosion")
              if (summary.dangers_json.collapse) dangerTypes.push("Einsturz")
              if (summary.dangers_json.chemical) dangerTypes.push("Gefahrstoffe")
              if (summary.dangers_json.electrical) dangerTypes.push("Elektrisch")
            }
            op.hasCompletedReko = true
            op.rekoSummary = {
              isRelevant: summary.is_relevant ?? false,
              hasDangers: dangerTypes.length > 0,
              dangerTypes,
              personnelCount: summary.effort_json?.personnel_count ?? null,
              estimatedDuration: summary.effort_json?.estimated_duration_hours ?? null,
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

      setOperations(ops)
      setPersonnel(eventScopedPersonnel)
      setMaterials(eventScopedMaterials)
      setHomeCity(settings.home_city || "")
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
      const driveBar = showLoading && isInitialLoad
      if (driveBar) topLoading.start()
      try {
        if (showLoading && isInitialLoad) {
          setIsLoading(true)
        }

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
                if (summary.dangers_json.fire) dangerTypes.push("Feuer")
                if (summary.dangers_json.explosion) dangerTypes.push("Explosion")
                if (summary.dangers_json.collapse) dangerTypes.push("Einsturz")
                if (summary.dangers_json.chemical) dangerTypes.push("Gefahrstoffe")
                if (summary.dangers_json.electrical) dangerTypes.push("Elektrisch")
              }
              op.hasCompletedReko = true
              op.rekoSummary = {
                isRelevant: summary.is_relevant ?? false,
                hasDangers: dangerTypes.length > 0,
                dangerTypes,
                personnelCount: summary.effort_json?.personnel_count ?? null,
                estimatedDuration: summary.effort_json?.estimated_duration_hours ?? null,
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

        setOperations(ops)
        setPersonnel(eventScopedPersonnel)
        setMaterials(eventScopedMaterials)
        setHomeCity(settings.home_city || "")
        setIsLoaded(true)
        setLastSyncAt(new Date())
        if (isInitialLoad) setIsInitialLoad(false)

        // Update sync version after successful full load
        try {
          const { version } = await apiClient.getSyncVersion(eventId)
          lastSyncVersionRef.current = version
        } catch {
          // Non-critical - version check is an optimization
        }
      } catch (error) {
        console.error("Failed to load data:", error)
        setIsLoaded(true)
        if (isInitialLoad) setIsInitialLoad(false)
      } finally {
        setIsLoading(false)
        if (driveBar) topLoading.done()
      }
    }

    loadData()

    // WebSocket setup
    wsClient.connect()

    const inCooldown = () =>
      criticalUpdateInProgress.current || recentAssignmentRef.current || recentStatusUpdateRef.current

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
    const applyDriverStayUpdate = (data: { id?: string; incident_id?: string; driver_stay?: boolean }) => {
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
    const unsubscribeAssignmentUpdate = wsClient.on('assignment_update', (update: WebSocketUpdate) => {
      if (update?.action === 'driver_stay') {
        applyDriverStayUpdate(update.data)
        return
      }
      handleRemoteUpdate()
    })
    const unsubscribeAssignmentsTransferred = wsClient.on('assignments_transferred', (_update: WebSocketUpdate) => {
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
        const tickAction = decidePollTickAction({ isLoading, inCooldown: inCooldown() })
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
      }
    })

    return () => {
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
  }, [authLoading, isAuthenticated, selectedEvent, isEventLoaded, refreshPersonnel, refreshMaterials, setPersonnel, setMaterials, isLoading, isInitialLoad])

  const removeCrew = (operationId: string, crewName: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const assignmentId = operation.crewAssignments.get(crewName)
    if (!assignmentId) {
      console.warn(`No assignment ID found for crew member ${crewName}`)
      return
    }

    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) clearTimeout(assignmentCooldownTimerRef.current)

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
      apiClient.unassignResource(operationId, assignmentId)
        .catch(err => {
          console.error("Failed to unassign crew:", err)
          toast.error("Fehler beim Entfernen", { description: "Die Person konnte nicht entfernt werden." })
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
        })
        .finally(() => {
          assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 500)
        })
    } else {
      assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 3000)
    }
  }

  const removeReko = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation || !operation.assignedReko) return

    const rekoPersonId = operation.assignedReko.id

    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) clearTimeout(assignmentCooldownTimerRef.current)

    // Optimistically update UI
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, assignedReko: null } : op))
    )

    if (isLoaded) {
      // Use the unassign reko API
      apiClient.unassignRekoPersonnel(operationId, rekoPersonId)
        .catch(err => {
          console.error("Failed to unassign reko:", err)
          toast.error("Fehler beim Entfernen", { description: "Die Reko-Person konnte nicht entfernt werden." })
          // Revert on error
          setOperations((ops) =>
            ops.map((op) => (op.id === operationId ? { ...op, assignedReko: operation.assignedReko } : op))
          )
        })
        .finally(() => {
          assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 500)
        })
    } else {
      assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 3000)
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

    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) clearTimeout(assignmentCooldownTimerRef.current)

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
          toast.error("Fehler beim Entfernen", { description: "Das Material konnte nicht entfernt werden." })
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
          assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 500)
        })
    } else {
      assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 3000)
    }
  }

  const updateOperation = (operationId: string, updates: Partial<Operation>) => {
    const enhancedUpdates = updates.status ? { ...updates, statusChangedAt: new Date() } : updates

    // When completing an operation, auto-release personnel and vehicles (backend does this too)
    const isCompletingOperation = updates.status === "complete"

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

    if (updates.status !== undefined) {
      recentStatusUpdateRef.current = true
      if (statusUpdateCooldownTimerRef.current) clearTimeout(statusUpdateCooldownTimerRef.current)
      statusUpdateCooldownTimerRef.current = setTimeout(clearStatusUpdateCooldown, 2000)
    }

    // Guard against polling overwriting optimistic updates for field changes
    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) clearTimeout(assignmentCooldownTimerRef.current)

    if (isLoaded) {
      const performUpdate = async (batchedUpdates: Partial<Operation>) => {
        const statusToBackend: Record<OperationStatus, string> = {
          "incoming": "eingegangen",
          "ready": "reko",
          "rekoDone": "reko_done",
          "enroute": "disponiert",
          "active": "einsatz",
          "returning": "einsatz_beendet",
          "complete": "abschluss",
        }

        const apiUpdates: Partial<ApiIncidentUpdate> = {}
        if (batchedUpdates.location !== undefined) apiUpdates.location_address = batchedUpdates.location
        if (batchedUpdates.incidentType !== undefined) apiUpdates.type = batchedUpdates.incidentType as ApiIncidentUpdate['type']
        if (batchedUpdates.priority !== undefined) apiUpdates.priority = batchedUpdates.priority
        if (batchedUpdates.status !== undefined) apiUpdates.status = statusToBackend[batchedUpdates.status] as ApiIncidentUpdate['status']
        if (batchedUpdates.coordinates !== undefined) {
          apiUpdates.location_lat = batchedUpdates.coordinates[0]?.toString()
          apiUpdates.location_lng = batchedUpdates.coordinates[1]?.toString()
        }
        if (batchedUpdates.notes !== undefined) apiUpdates.description = batchedUpdates.notes
        if (batchedUpdates.contact !== undefined) apiUpdates.contact = batchedUpdates.contact
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
            toast.info("Von anderer Person geändert", {
              description: "Dieser Einsatz wurde gerade von jemand anderem aktualisiert — die Ansicht wurde neu geladen."
            })
            await refreshOperations()
          } else if (batchedUpdates.status !== undefined) {
            // Status changes are usually drag-drops between columns. If the
            // backend rejects the change, the card visually sits in the wrong
            // column until the next poll — refresh now so it snaps back.
            toast.error("Status nicht geändert", {
              description: "Der Einsatz wurde auf den letzten Stand zurückgesetzt.",
            })
            await refreshOperations()
          } else {
            toast.error("Fehler beim Aktualisieren", { description: "Der Einsatz konnte nicht aktualisiert werden." })
          }
        } finally {
          if (criticalUpdateInProgress.current) criticalUpdateInProgress.current = false
          assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 500)
        }
      }

      // Location/coordinate edits flush almost immediately (map pin drops need
      // to persist fast); everything else debounces to coalesce rapid edits.
      // Criticality is decided on the MERGED batch so a follow-up non-critical
      // edit can't demote a pending location write back to the slow path.
      const merged = { ...(updateBatcherRef.current.getPending(operationId) ?? {}), ...updates }
      const isCriticalUpdate = merged.location !== undefined || merged.coordinates !== undefined
      if (isCriticalUpdate) criticalUpdateInProgress.current = true
      updateBatcherRef.current.schedule(operationId, updates, isCriticalUpdate ? 50 : 500, performUpdate)
    } else {
      assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 3000)
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

    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) clearTimeout(assignmentCooldownTimerRef.current)

    void (async () => {
      try {
        await apiClient.reorderIncidents(selectedEvent.id, orderedIds)
      } catch (err) {
        console.error("Failed to persist column order:", err)
        // The optimistic order isn't saved — pull the authoritative order back.
        await refreshOperations()
      } finally {
        assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 500)
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
          location_lat: operation.coordinates[0]?.toString(),
          location_lng: operation.coordinates[1]?.toString(),
          status: "eingegangen" as const,
          description: operation.notes || null,
          contact: operation.contact || null,
          internal_notes: operation.internalNotes || null,
        }

        const apiIncident = await apiClient.createIncident(incidentData)

        const newOperation: Operation = {
          id: apiIncident.id,
          location: apiIncident.location_address || apiIncident.title,
          vehicle: operation.vehicle,
          vehicles: [],
          incidentType: operation.incidentType,
          dispatchTime: new Date(apiIncident.created_at),
          crew: [],
          priority: apiIncident.priority as "low" | "medium" | "high",
          status: "incoming",
          coordinates: apiIncident.location_lat && apiIncident.location_lng
            ? [parseFloat(apiIncident.location_lat), parseFloat(apiIncident.location_lng)]
            : operation.coordinates,
          materials: [],
          notes: apiIncident.description || "",
          contact: apiIncident.contact || "",
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
        }
        setOperations((ops) => [newOperation, ...ops])
      } catch (error) {
        console.error("Failed to create operation:", error)
        toast.error("Einsatz konnte nicht erstellt werden", {
          description: "Bitte erneut versuchen. Wenn das Problem bestehen bleibt, prüfen Sie die Verbindung.",
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

    if (!operation || !person || (person.status === "assigned" && !person.isReko) || operation.crew.includes(personName)) {
      return
    }

    // B6: warn (don't block) when re-assigning someone we just took off another incident.
    const recentRemoval = findRecentRemoval(recentRemovalsRef.current, personId, operationId)
    if (recentRemoval) {
      const elapsedSec = Math.round((Date.now() - recentRemoval.removedAt) / 1000)
      toast.warning(`${personName} war vor ${elapsedSec}s noch auf "${recentRemoval.incidentLabel}"`, {
        description: "Doppelbelegung — bitte prüfen.",
      })
      // Don't repeat the warning if the same operator re-confirms the assignment.
      recentRemovalsRef.current.delete(personId)
    }

    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) clearTimeout(assignmentCooldownTimerRef.current)

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
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, crew: op.crew.filter(n => n !== personName) } : op))
        )
        setPersonnel((people) =>
          people.map((p) => (p.id === personId ? { ...p, status: "available" as PersonStatus } : p))
        )
        // The chip already snapped back — say why, or the operator assumes it stuck.
        toast.error("Zuweisung fehlgeschlagen", {
          description: `${personName} konnte nicht zugewiesen werden.`,
        })
      } finally {
        assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 500)
      }
    } else {
      assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 3000)
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

    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) clearTimeout(assignmentCooldownTimerRef.current)

    // Optimistically update UI - also move to "reko" status if currently "eingegangen"
    const currentOp = operations.find(op => op.id === operationId)
    const shouldAutoMoveToReko = currentOp?.status === "incoming"

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id !== operationId) return op
        const updated = { ...op, assignedReko: { id: personId, name: personName } }
        if (shouldAutoMoveToReko) {
          updated.status = "ready" as OperationStatus // "ready" maps to "reko" backend status
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
        toast.error("Reko-Zuweisung fehlgeschlagen", {
          description: `${personName} konnte nicht als Reko zugewiesen werden.`,
        })
      } finally {
        assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 500)
      }
    } else {
      assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 3000)
    }
  }

  const assignMaterialToOperation = async (materialId: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    const material = materials.find(m => m.id === materialId)

    const isConsumable = material?.consumable
    if (!operation || !material || (!isConsumable && material.status === "assigned") || operation.materials.includes(materialId)) {
      return
    }

    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) clearTimeout(assignmentCooldownTimerRef.current)

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
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, materials: op.materials.filter(id => id !== materialId) } : op))
        )
        setMaterials((mats) =>
          mats.map((m) => (m.id === materialId ? { ...m, status: "available" as Material["status"] } : m))
        )
      } finally {
        assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 500)
      }
    } else {
      assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 3000)
    }
  }

  const assignVehicleToOperation = async (vehicleId: string, vehicleName: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)

    if (!operation || operation.vehicles.includes(vehicleName)) {
      return
    }

    if (!vehicleId || vehicleId.trim() === '') {
      console.error('[ERROR] Invalid vehicleId:', { vehicleId, vehicleName, operationId })
      toast.error("Fehler", { description: `Fahrzeug "${vehicleName}" hat keine gültige ID. Bitte laden Sie die Seite neu.` })
      return
    }

    // A vehicle is a single physical asset — if it's still assigned elsewhere,
    // ask the operator whether to move it here or keep the double booking,
    // rather than silently double-booking it.
    const conflicts = operations
      .filter(op => op.id !== operationId && op.vehicles.includes(vehicleName))
      .map(op => ({ operationId: op.id, operationLabel: op.location }))
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

    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) clearTimeout(assignmentCooldownTimerRef.current)

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
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, vehicles: op.vehicles.filter(name => name !== vehicleName) } : op))
        )
      } finally {
        // Clear cooldown after API response, with a small grace period
        assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 500)
      }
    } else {
      assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 3000)
    }
  }

  const removeVehicle = (operationId: string, vehicleName: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const assignmentId = operation.vehicleAssignments.get(vehicleName)
    if (!assignmentId) {
      console.warn(`No assignment ID found for vehicle ${vehicleName}`)
      return
    }

    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) clearTimeout(assignmentCooldownTimerRef.current)

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
      apiClient.unassignResource(operationId, assignmentId)
        .catch(err => {
          console.error("Failed to unassign vehicle:", err)
          toast.error("Fehler beim Entfernen", { description: "Das Fahrzeug konnte nicht entfernt werden." })
          setOperations((ops) =>
            ops.map((op) => (op.id === operationId ? operation : op))
          )
        })
        .finally(() => {
          assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 500)
        })
    } else {
      assignmentCooldownTimerRef.current = setTimeout(clearAssignmentCooldown, 3000)
    }
  }

  const resolveVehicleConflict = async (action: "move" | "keep") => {
    const conflict = vehicleConflict
    if (!conflict) return
    setVehicleConflict(null)

    if (action === "move") {
      // Remove the vehicle from every other incident before assigning it here.
      for (const c of conflict.conflicts) {
        removeVehicle(c.operationId, conflict.vehicleName)
      }
      const labels = conflict.conflicts.map(c => `"${c.operationLabel}"`).join(", ")
      toast.info(`${conflict.vehicleName} verschoben`, {
        description: `Von ${labels} entfernt.`,
      })
    }

    await performVehicleAssign(conflict.vehicleId, conflict.vehicleName, conflict.targetOperationId)
  }

  const cancelVehicleConflict = useCallback(() => setVehicleConflict(null), [])

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
      toast.error("Wiederherstellen fehlgeschlagen", {
        description: "Der Einsatz konnte nicht wiederhergestellt werden.",
      })
      return
    }

    // A restore always re-includes the card on the next load, so there is no
    // WS-resurrection suppression to bypass — refresh pulls the card back.
    await refreshOperations()
    if (action === "refresh-success") {
      toast.success("Einsatz wiederhergestellt")
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

      setOperations((ops) => ops.filter((op) => op.id !== operationId))

      // Offer an undo. Only when the delete was persisted (isLoaded) — a purely
      // local optimistic delete has no backend row to restore.
      if (isLoaded) {
        toast("Einsatz gelöscht", {
          description: operation.location,
          duration: 8000,
          action: {
            label: "Rückgängig",
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

  const formatLocation = (fullAddress: string): string => {
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

  const operationToIncidentStatus: Record<OperationStatus, string> = {
    "incoming": "eingegangen",
    "ready": "reko",
    "rekoDone": "reko_done",
    "enroute": "disponiert",
    "active": "einsatz",
    "returning": "einsatz_beendet",
    "complete": "abschluss",
  }

  const incidents = context.operations.map((op) => ({
    id: op.id,
    event_id: selectedEvent?.id || "",
    title: op.location,
    type: op.incidentType as ApiIncident['type'],
    priority: op.priority as "low" | "medium" | "high",
    location_address: op.location,
    location_lat: op.coordinates?.[0] ?? null,
    location_lng: op.coordinates?.[1] ?? null,
    status: operationToIncidentStatus[op.status] as ApiIncident['status'],
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
    createIncident: async (data: any) => {
      const apiData: ApiIncidentCreate = {
        ...data,
        location_lat: data.location_lat != null ? String(data.location_lat) : null,
        location_lng: data.location_lng != null ? String(data.location_lng) : null,
      }
      const apiIncident = await apiClient.createIncident(apiData)
      await context.refreshOperations()
      return apiIncident
    },
    updateIncident: async (id: string, data: any) => {
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
