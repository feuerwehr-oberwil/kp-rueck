"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from "react"
import { apiClient, ApiError, type ApiPersonnel, type ApiMaterialResource, type ApiIncident, type ApiIncidentCreate, type ApiIncidentUpdate } from "@/lib/api-client"
import { formatLocationForDisplay } from "@/lib/utils"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"
import { usePersonnel, type Person, type PersonStatus } from "./personnel-context"
import { useMaterials, type Material } from "./materials-context"
import { toast } from "sonner"
import { wsClient, type WebSocketUpdate, type WebSocketStatus } from "@/lib/websocket-client"

// Re-export types for backward compatibility
export type { Person, PersonStatus } from "./personnel-context"
export type { Material } from "./materials-context"
export type PersonRole = string

// Simple UUID validation to prevent invalid IDs from being used in API calls
const isValidUUID = (id: string | undefined | null): id is string => {
  if (!id) return false
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

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
  statusChangedAt: Date | null
  hasCompletedReko: boolean
  rekoArrivedAt: Date | null
  rekoSummary: RekoSummary | null
  assignedReko: { id: string; name: string } | null
  crewAssignments: Map<string, string>
  materialAssignments: Map<string, string>
  vehicleAssignments: Map<string, string>
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
  formatLocation: (fullAddress: string) => string
  refreshOperations: () => Promise<void>
  removeCrew: (operationId: string, crewName: string) => void
  removeMaterial: (operationId: string, materialId: string) => void
  removeVehicle: (operationId: string, vehicleName: string) => void
  removeReko: (operationId: string) => void
  updateOperation: (operationId: string, updates: Partial<Operation>) => void
  createOperation: (operation: Omit<Operation, "id" | "dispatchTime">) => void
  getNextOperationId: () => string
  assignPersonToOperation: (personId: string, personName: string, operationId: string) => void
  assignRekoPersonToOperation: (personId: string, personName: string, operationId: string) => void
  assignMaterialToOperation: (materialId: string, operationId: string) => void
  assignVehicleToOperation: (vehicleId: string, vehicleName: string, operationId: string) => void
  deleteOperation: (operationId: string) => Promise<void>
}

const OperationsContext = createContext<OperationsContextType | undefined>(undefined)

export function OperationsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const { selectedEvent } = useEvent()

  // Get personnel and materials from their dedicated contexts
  const { personnel, setPersonnel, refreshPersonnel } = usePersonnel()
  const { materials, setMaterials, refreshMaterials } = useMaterials()

  // Operations state (only operations-specific state here)
  const [operations, setOperations] = useState<Operation[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [homeCity, setHomeCity] = useState<string>("")

  // Refs for debouncing and cooldowns
  const updateTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const criticalUpdateInProgress = useRef<boolean>(false)
  const pendingUpdatesRef = useRef<Map<string, Partial<Operation>>>(new Map())
  const criticalUpdateTimerRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const recentAssignmentRef = useRef<boolean>(false)
  const assignmentCooldownTimerRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const recentStatusUpdateRef = useRef<boolean>(false)
  const statusUpdateCooldownTimerRef = useRef<NodeJS.Timeout | undefined>(undefined)

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
      statusChangedAt: incident.status_changed_at ? new Date(incident.status_changed_at) : null,
      hasCompletedReko: incident.has_completed_reko || false,
      rekoArrivedAt: incident.reko_arrived_at ? new Date(incident.reko_arrived_at) : null,
      rekoSummary: null,
      assignedReko: null,
      crewAssignments: new Map(),
      materialAssignments: new Map(),
      vehicleAssignments: new Map(),
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
      setIsLoading(true)

      // Fetch all data in parallel
      const [apiIncidents, personnelList, materialsList, settings, vehiclesList] = await Promise.all([
        apiClient.getIncidents(selectedEvent.id),
        refreshPersonnel(),
        refreshMaterials(),
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
              }
            }
          }
        })
      } catch (error) {
        console.error(`Failed to load assignments:`, error)
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
      setIsLoaded(true)
      return
    }

    const eventId = selectedEvent.id

    const loadData = async (showLoading = true) => {
      try {
        if (showLoading && isInitialLoad) {
          setIsLoading(true)
        }

        // Fetch all data in parallel
        const [apiIncidents, personnelList, materialsList, settings, vehiclesList] = await Promise.all([
          apiClient.getIncidents(eventId),
          refreshPersonnel(),
          refreshMaterials(),
          apiClient.getAllSettings().catch(() => ({ home_city: "" })),
          apiClient.getVehicles(),
        ])

        const ops = apiIncidents.map(apiIncidentToOperation)

        // Fetch special functions first to know who is reko personnel
        const rekoPersonnelIdsPolling = new Set<string>()
        try {
          const specialFunctionsPolling = await apiClient.getEventSpecialFunctions(eventId)
          specialFunctionsPolling
            .filter(func => func.function_type === 'reko')
            .forEach(func => rekoPersonnelIdsPolling.add(func.personnel_id))
        } catch (error) {
          console.error('Failed to load special functions:', error)
        }

        // Fetch assignments
        try {
          const assignmentsByIncident = await apiClient.getAssignmentsByEvent(eventId)
          ops.forEach((operation) => {
            const assignments = assignmentsByIncident[operation.id] || []
            for (const assignment of assignments) {
              if (assignment.resource_type === "personnel") {
                const person = personnelList.find(p => p.id === assignment.resource_id)
                if (person) {
                  // Reko personnel are stored separately, not as crew
                  if (rekoPersonnelIdsPolling.has(person.id)) {
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
                }
              }
            }
          })
        } catch (error) {
          console.error(`Failed to load assignments:`, error)
        }

        // Fetch reko summaries
        try {
          const rekoSummaries = await apiClient.getEventRekoSummaries(eventId)
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
        } catch (error) {
          console.error('Failed to load reko summaries:', error)
        }

        // Calculate availability
        const assignedPersonIds = new Set<string>()
        const assignedMaterialIds = new Set<string>()
        const rekoPersonnelIds = new Set<string>()
        const driverPersonnelIds = new Map<string, { vehicleId: string; vehicleName: string }>() // personId -> vehicle info
        const magazinPersonnelIds = new Set<string>()

        try {
          const specialFunctions = await apiClient.getEventSpecialFunctions(eventId)
          for (const func of specialFunctions) {
            if (func.function_type === 'reko') rekoPersonnelIds.add(func.personnel_id)
            else if (func.function_type === 'driver') { driverPersonnelIds.set(func.personnel_id, { vehicleId: func.vehicle_id || '', vehicleName: func.vehicle_name || '' }); assignedPersonIds.add(func.personnel_id) }
            else if (func.function_type === 'magazin') { magazinPersonnelIds.add(func.personnel_id); assignedPersonIds.add(func.personnel_id) }
            else assignedPersonIds.add(func.personnel_id)
          }
        } catch (error) {
          console.error('Failed to load special functions:', error)
        }

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

        setOperations(ops)
        setPersonnel(eventScopedPersonnel)
        setMaterials(eventScopedMaterials)
        setHomeCity(settings.home_city || "")
        setIsLoaded(true)
        if (isInitialLoad) setIsInitialLoad(false)
      } catch (error) {
        console.error("Failed to load data:", error)
        setIsLoaded(true)
        if (isInitialLoad) setIsInitialLoad(false)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()

    // WebSocket setup
    wsClient.connect()

    const shouldSkipUpdate = () =>
      criticalUpdateInProgress.current || recentAssignmentRef.current || recentStatusUpdateRef.current

    const unsubscribeIncidentUpdate = wsClient.on('incident_update', () => {
      if (!shouldSkipUpdate()) loadData(false)
    })
    const unsubscribePersonnelUpdate = wsClient.on('personnel_update', () => {
      if (!shouldSkipUpdate()) loadData(false)
    })
    const unsubscribeVehicleUpdate = wsClient.on('vehicle_update', () => {
      if (!shouldSkipUpdate()) loadData(false)
    })
    const unsubscribeMaterialUpdate = wsClient.on('material_update', () => {
      if (!shouldSkipUpdate()) loadData(false)
    })
    const unsubscribeAssignmentUpdate = wsClient.on('assignment_update', () => {
      if (!shouldSkipUpdate()) loadData(false)
    })
    const unsubscribeAssignmentsTransferred = wsClient.on('assignments_transferred', (update: WebSocketUpdate) => {
      if (!shouldSkipUpdate()) {
        loadData(false)
        if (update.data && typeof update.data === 'object' && 'count' in update.data) {
          toast.success("Ressourcen übertragen", {
            description: `${update.data.count} Ressourcen wurden erfolgreich übertragen.`
          })
        }
      }
    })

    // Fallback polling
    let pollTimeout: NodeJS.Timeout | undefined
    let isPollingActive = false

    const schedulePoll = () => {
      if (!isPollingActive) return
      const interval = getNextPollInterval(true)
      pollTimeout = setTimeout(async () => {
        if (!isPollingActive) return
        if (!isLoading && !shouldSkipUpdate()) {
          try {
            await loadData(false)
          } catch {
            pollingBackoffRef.current = Math.min(pollingBackoffRef.current * 2, POLLING_MAX_BACKOFF)
          }
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
  }, [authLoading, isAuthenticated, selectedEvent, refreshPersonnel, refreshMaterials, setPersonnel, setMaterials, isLoading, isInitialLoad])

  const removeCrew = (operationId: string, crewName: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const assignmentId = operation.crewAssignments.get(crewName)
    if (!assignmentId) {
      console.warn(`No assignment ID found for crew member ${crewName}`)
      return
    }

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
    if (person) {
      const stillAssigned = operations.some(op => op.id !== operationId && op.crew.includes(crewName))
      if (!stillAssigned) {
        setPersonnel((people) =>
          people.map((p) => (p.id === person.id ? { ...p, status: "available" as PersonStatus } : p))
        )
      }
    }

    if (isLoaded) {
      apiClient.unassignResource(operationId, assignmentId).catch(err => {
        console.error("Failed to unassign crew:", err)
        toast.error("Fehler beim Entfernen", { description: "Die Person konnte nicht entfernt werden." })
      })
    }
  }

  const removeReko = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation || !operation.assignedReko) return

    const rekoPersonId = operation.assignedReko.id

    // Optimistically update UI
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, assignedReko: null } : op))
    )

    if (isLoaded) {
      // Use the unassign reko API
      apiClient.unassignRekoPersonnel(operationId, rekoPersonId).catch(err => {
        console.error("Failed to unassign reko:", err)
        toast.error("Fehler beim Entfernen", { description: "Die Reko-Person konnte nicht entfernt werden." })
        // Revert on error
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, assignedReko: operation.assignedReko } : op))
        )
      })
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
    if (material) {
      const stillAssigned = operations.some(op => op.id !== operationId && op.materials.includes(materialId))
      if (!stillAssigned) {
        setMaterials((mats) =>
          mats.map((m) => (m.id === material.id ? { ...m, status: "available" as Material["status"] } : m))
        )
      }
    }

    if (isLoaded) {
      apiClient.unassignResource(operationId, assignmentId).catch(err => {
        console.error("Failed to unassign material:", err)
        toast.error("Fehler beim Entfernen", { description: "Das Material konnte nicht entfernt werden." })
      })
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
      statusUpdateCooldownTimerRef.current = setTimeout(() => {
        recentStatusUpdateRef.current = false
      }, 2000)
    }

    const isCriticalUpdate = updates.location !== undefined || updates.coordinates !== undefined

    if (isLoaded) {
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current)

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

        try {
          await apiClient.updateIncident(operationId, apiUpdates)
        } catch (err) {
          console.error("Failed to update operation:", err)
          if (ApiError.isConflictError(err)) {
            toast.error("Konflikt bei Aktualisierung", {
              description: "Ein anderer Benutzer hat diesen Einsatz geändert. Daten werden aktualisiert..."
            })
            await refreshOperations()
          } else {
            toast.error("Fehler beim Aktualisieren", { description: "Der Einsatz konnte nicht aktualisiert werden." })
          }
        } finally {
          pendingUpdatesRef.current.delete(operationId)
          if (criticalUpdateInProgress.current) criticalUpdateInProgress.current = false
        }
      }

      if (isCriticalUpdate) {
        if (criticalUpdateTimerRef.current) clearTimeout(criticalUpdateTimerRef.current)
        const existingUpdates = pendingUpdatesRef.current.get(operationId) || {}
        const mergedUpdates = { ...existingUpdates, ...updates }
        pendingUpdatesRef.current.set(operationId, mergedUpdates)
        criticalUpdateInProgress.current = true
        criticalUpdateTimerRef.current = setTimeout(() => {
          const finalUpdates = pendingUpdatesRef.current.get(operationId) || updates
          performUpdate(finalUpdates)
        }, 50)
      } else {
        updateTimeoutRef.current = setTimeout(() => performUpdate(updates), 500)
      }
    }
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
          type: (operation.incidentType || "elementarereignis") as any,
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
          statusChangedAt: apiIncident.status_changed_at ? new Date(apiIncident.status_changed_at) : null,
          hasCompletedReko: false,
          rekoArrivedAt: null,
          rekoSummary: null,
          assignedReko: null,
          crewAssignments: new Map(),
          materialAssignments: new Map(),
          vehicleAssignments: new Map(),
        }
        setOperations((ops) => [newOperation, ...ops])
      } catch (error) {
        console.error("Failed to create operation:", error)
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
      } finally {
        assignmentCooldownTimerRef.current = setTimeout(() => { recentAssignmentRef.current = false }, 500)
      }
    } else {
      assignmentCooldownTimerRef.current = setTimeout(() => { recentAssignmentRef.current = false }, 3000)
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
      } finally {
        assignmentCooldownTimerRef.current = setTimeout(() => { recentAssignmentRef.current = false }, 500)
      }
    } else {
      assignmentCooldownTimerRef.current = setTimeout(() => { recentAssignmentRef.current = false }, 3000)
    }
  }

  const assignMaterialToOperation = async (materialId: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    const material = materials.find(m => m.id === materialId)

    if (!operation || !material || material.status === "assigned" || operation.materials.includes(materialId)) {
      return
    }

    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) clearTimeout(assignmentCooldownTimerRef.current)

    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, materials: [...op.materials, materialId] } : op))
    )
    setMaterials((mats) =>
      mats.map((m) => (m.id === materialId ? { ...m, status: "assigned" as Material["status"] } : m))
    )

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
        assignmentCooldownTimerRef.current = setTimeout(() => { recentAssignmentRef.current = false }, 500)
      }
    } else {
      assignmentCooldownTimerRef.current = setTimeout(() => { recentAssignmentRef.current = false }, 3000)
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
              return { ...op, vehicleAssignments: newVehicleAssignments }
            }
            return op
          })
        )
      } catch (err) {
        console.error("Failed to assign vehicle:", err)
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, vehicles: op.vehicles.filter(name => name !== vehicleName) } : op))
        )
      } finally {
        // Clear cooldown after API response, with a small grace period
        assignmentCooldownTimerRef.current = setTimeout(() => { recentAssignmentRef.current = false }, 500)
      }
    } else {
      assignmentCooldownTimerRef.current = setTimeout(() => { recentAssignmentRef.current = false }, 3000)
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

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const newVehicleAssignments = new Map(op.vehicleAssignments)
          newVehicleAssignments.delete(vehicleName)
          return { ...op, vehicles: op.vehicles.filter((name) => name !== vehicleName), vehicleAssignments: newVehicleAssignments }
        }
        return op
      })
    )

    if (isLoaded) {
      apiClient.unassignResource(operationId, assignmentId).catch(err => {
        console.error("Failed to unassign vehicle:", err)
        toast.error("Fehler beim Entfernen", { description: "Das Fahrzeug konnte nicht entfernt werden." })
      })
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
        formatLocation,
        refreshOperations,
        removeCrew,
        removeMaterial,
        removeVehicle,
        removeReko,
        updateOperation,
        createOperation,
        getNextOperationId,
        assignPersonToOperation,
        assignRekoPersonToOperation,
        assignMaterialToOperation,
        assignVehicleToOperation,
        deleteOperation,
      }}
    >
      {children}
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
    type: op.incidentType as any,
    priority: op.priority as "low" | "medium" | "high",
    location_address: op.location,
    location_lat: op.coordinates?.[0] ?? null,
    location_lng: op.coordinates?.[1] ?? null,
    status: operationToIncidentStatus[op.status] as any,
    description: op.notes,
    nachbarhilfe: op.nachbarhilfe || false,
    created_at: op.dispatchTime,
    updated_at: op.dispatchTime,
    created_by: null,
    completed_at: op.status === "complete" ? new Date() : null,
    status_changed_at: op.statusChangedAt,
    has_completed_reko: op.hasCompletedReko || false,
    reko_arrived_at: op.rekoArrivedAt ?? null,
    assigned_vehicles: op.vehicles.map((name) => ({
      assignment_id: "",
      vehicle_id: "",
      name,
      type: "",
      assigned_at: new Date(),
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
