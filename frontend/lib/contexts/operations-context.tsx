"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from "react"
import { apiClient, type ApiPersonnel, type ApiMaterialResource, type ApiIncident, type ApiIncidentCreate, type ApiIncidentUpdate } from "@/lib/api-client"
import { formatLocationForDisplay } from "@/lib/utils"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"
import { toast } from "sonner"
import { wsClient, type WebSocketUpdate, type WebSocketStatus } from "@/lib/websocket-client"

// Types
export type PersonStatus = "available" | "assigned"
export type PersonRole = string // Dynamic role - can be any string from backend

export interface Person {
  id: string
  name: string
  role: PersonRole
  status: PersonStatus
  tags?: string[]
}

export type OperationStatus = "incoming" | "ready" | "enroute" | "active" | "returning" | "complete"
export type VehicleType = string | null

export interface RekoSummary {
  isRelevant: boolean
  hasDangers: boolean
  dangerTypes: string[] // e.g., ["fire", "explosion"]
  personnelCount: number | null
  estimatedDuration: number | null
}

export interface Operation {
  id: string
  location: string
  vehicle: VehicleType // Legacy field for backward compatibility
  vehicles: string[] // Array of vehicle names
  incidentType: string
  dispatchTime: Date
  crew: string[]
  priority: "high" | "medium" | "low"
  status: OperationStatus
  coordinates: [number, number]
  materials: string[]
  notes: string
  contact: string
  statusChangedAt: Date | null // Timestamp when the operation moved to its current status
  hasCompletedReko: boolean // Whether a completed (non-draft) reko report exists
  rekoSummary: RekoSummary | null // Summary of reko report for card display
  // Track assignment IDs for unassignment
  crewAssignments: Map<string, string> // name -> assignment_id
  materialAssignments: Map<string, string> // material_id -> assignment_id
  vehicleAssignments: Map<string, string> // vehicle_name -> assignment_id
}

export interface Material {
  id: string
  name: string
  category: string
  status: "available" | "assigned"
}

// No initial/dummy data - all data comes from the backend database

/**
 * Context interface for managing operations, personnel, and materials.
 * All mutation functions automatically persist changes to the database.
 */
interface OperationsContextType {
  personnel: Person[]
  setPersonnel: React.Dispatch<React.SetStateAction<Person[]>>
  materials: Material[]
  setMaterials: React.Dispatch<React.SetStateAction<Material[]>>
  operations: Operation[]
  setOperations: React.Dispatch<React.SetStateAction<Operation[]>>
  homeCity: string
  /** Loading state for data fetching */
  isLoading: boolean
  /** Format a location address for display based on home city */
  formatLocation: (fullAddress: string) => string
  /** Refresh operations from the server */
  refreshOperations: () => Promise<void>
  /** Remove a crew member from an operation (persists to DB) */
  removeCrew: (operationId: string, crewName: string) => void
  /** Remove material from an operation (persists to DB) */
  removeMaterial: (operationId: string, materialId: string) => void
  /** Remove vehicle from an operation (persists to DB) */
  removeVehicle: (operationId: string, vehicleName: string) => void
  /** Update operation properties (persists to DB with debouncing) */
  updateOperation: (operationId: string, updates: Partial<Operation>) => void
  /** Create a new operation (persists to DB) */
  createOperation: (operation: Omit<Operation, "id" | "dispatchTime">) => void
  /** Get the next available operation ID */
  getNextOperationId: () => string
  /** Assign a person to an operation (persists both operation and person status to DB) */
  assignPersonToOperation: (personId: string, personName: string, operationId: string) => void
  /** Assign material to an operation (persists both operation and material status to DB) */
  assignMaterialToOperation: (materialId: string, operationId: string) => void
  /** Assign vehicle to an operation (persists to DB) */
  assignVehicleToOperation: (vehicleId: string, vehicleName: string, operationId: string) => void
  /** Delete an operation (persists to DB) */
  deleteOperation: (operationId: string) => Promise<void>
}

const OperationsContext = createContext<OperationsContextType | undefined>(undefined)

export function OperationsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const { selectedEvent } = useEvent()
  const [personnel, setPersonnel] = useState<Person[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [operations, setOperations] = useState<Operation[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [homeCity, setHomeCity] = useState<string>("")
  const updateTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const criticalUpdateInProgress = useRef<boolean>(false)
  const pendingUpdatesRef = useRef<Map<string, Partial<Operation>>>(new Map())
  const criticalUpdateTimerRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const recentAssignmentRef = useRef<boolean>(false)
  const assignmentCooldownTimerRef = useRef<NodeJS.Timeout | undefined>(undefined)

  // Helper functions to convert between API and frontend types
  const apiPersonToPerson = (apiPerson: ApiPersonnel): Person => ({
    id: String(apiPerson.id),
    name: apiPerson.name,
    role: apiPerson.role as PersonRole,
    status: apiPerson.availability as PersonStatus, // Backend uses 'availability' field
    tags: apiPerson.tags || [],
  })

  const apiMaterialToMaterial = (apiMat: ApiMaterialResource): Material => ({
    id: String(apiMat.id),
    name: apiMat.name,
    category: apiMat.location || "General",
    status: (apiMat.status === "available" ? "available" : "assigned") as "available" | "assigned",
  })

  // Helper to convert Incident to Operation
  const apiIncidentToOperation = (incident: ApiIncident): Operation => {
    // Map incident status to operation status
    const statusMap: Record<string, OperationStatus> = {
      "eingegangen": "incoming",
      "reko": "ready",
      "disponiert": "enroute",
      "einsatz": "active",
      "einsatz_beendet": "returning",
      "abschluss": "complete",
    }

    return {
      id: incident.id,
      location: incident.location_address || incident.title,
      vehicle: null, // Legacy field - kept for backward compatibility
      vehicles: [], // Will be populated from assignments
      incidentType: incident.type || "elementarereignis",
      dispatchTime: new Date(incident.created_at),
      crew: [], // Will be populated from assignments
      priority: incident.priority as "high" | "medium" | "low",
      status: statusMap[incident.status] || "incoming",
      coordinates: incident.location_lat && incident.location_lng
        ? [parseFloat(incident.location_lat), parseFloat(incident.location_lng)]
        : [47.51637699933488, 7.561800450458299],
      materials: [], // Will be populated from assignments
      notes: incident.description || "",
      contact: "", // Not in incident schema
      statusChangedAt: incident.status_changed_at ? new Date(incident.status_changed_at) : null,
      hasCompletedReko: incident.has_completed_reko || false,
      rekoSummary: null, // Will be populated from reko reports API
      crewAssignments: new Map(),
      materialAssignments: new Map(),
      vehicleAssignments: new Map(),
    }
  }

  // Refresh operations from server
  const refreshOperations = useCallback(async () => {
    // Don't load data if no event is selected
    if (!selectedEvent) {
      setOperations([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const [apiIncidents, apiPersonnel, apiMats, settings] = await Promise.all([
        apiClient.getIncidents(selectedEvent.id),
        apiClient.getAllPersonnel({ checked_in_only: true, event_id: selectedEvent.id }), // Only show checked-in personnel for this event
        apiClient.getAllMaterials(),
        apiClient.getAllSettings().catch(() => ({ home_city: "" })), // Don't fail if settings not available
      ])

      // Convert to frontend types
      const personnelList = apiPersonnel.map(apiPersonToPerson)
      const materialsList = apiMats.map(apiMaterialToMaterial)
      const operations = apiIncidents.map(apiIncidentToOperation)

      // Fetch vehicles for vehicle assignment lookups
      const vehiclesList = await apiClient.getVehicles()

      // Fetch ALL assignments for this event in a single bulk request (optimized - replaces N+1 query pattern)
      try {
        const assignmentsByIncident = await apiClient.getAssignmentsByEvent(selectedEvent.id)

        // Populate crew/materials/vehicles for each operation from bulk data
        operations.forEach((operation) => {
          const assignments = assignmentsByIncident[operation.id] || []

          for (const assignment of assignments) {
            if (assignment.resource_type === "personnel") {
              const person = personnelList.find(p => p.id === assignment.resource_id)
              if (person) {
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
        console.error(`Failed to load assignments for event ${selectedEvent.id}:`, error)
      }

      // Fetch reko reports for incidents with completed rekos
      try {
        const rekoPromises = operations
          .filter(op => op.hasCompletedReko)
          .map(async (op) => {
            try {
              const reports = await apiClient.getIncidentRekoReports(op.id)
              const completedReports = reports.filter(r => !r.is_draft)

              if (completedReports.length > 0) {
                // Use the most recent report
                const latestReport = completedReports[completedReports.length - 1]

                // Extract danger types
                const dangerTypes: string[] = []
                if (latestReport.dangers_json) {
                  if (latestReport.dangers_json.fire) dangerTypes.push("Feuer")
                  if (latestReport.dangers_json.explosion) dangerTypes.push("Explosion")
                  if (latestReport.dangers_json.collapse) dangerTypes.push("Einsturz")
                  if (latestReport.dangers_json.chemical) dangerTypes.push("Gefahrstoffe")
                  if (latestReport.dangers_json.electrical) dangerTypes.push("Elektrisch")
                }

                return {
                  operationId: op.id,
                  summary: {
                    isRelevant: latestReport.is_relevant ?? false,
                    hasDangers: dangerTypes.length > 0,
                    dangerTypes,
                    personnelCount: latestReport.effort_json?.personnel_count ?? null,
                    estimatedDuration: latestReport.effort_json?.estimated_duration_hours ?? null,
                  }
                }
              }
            } catch (error) {
              console.error(`Failed to load reko for incident ${op.id}:`, error)
            }
            return null
          })

        const rekoResults = await Promise.all(rekoPromises)

        // Populate reko summaries
        rekoResults.forEach(result => {
          if (result) {
            const operation = operations.find(op => op.id === result.operationId)
            if (operation) {
              operation.rekoSummary = result.summary
            }
          }
        })
      } catch (error) {
        console.error('Failed to load reko reports:', error)
      }

      // Calculate event-scoped availability
      const assignedPersonIds = new Set<string>()
      const assignedMaterialIds = new Set<string>()

      operations.forEach(operation => {
        operation.crew.forEach(crewName => {
          const person = personnelList.find(p => p.name === crewName)
          if (person) {
            assignedPersonIds.add(person.id)
          }
        })
        operation.materials.forEach(materialId => {
          assignedMaterialIds.add(materialId)
        })
      })

      // Also mark personnel as assigned if they have special functions (drivers, reko, magazin)
      try {
        const specialFunctions = await apiClient.getEventSpecialFunctions(selectedEvent.id)
        specialFunctions.forEach(func => {
          assignedPersonIds.add(func.personnel_id)
        })
      } catch (error) {
        console.error('Failed to load special functions for personnel status:', error)
      }

      // Update personnel/material status based on event-scoped assignments
      const eventScopedPersonnel = personnelList.map(person => ({
        ...person,
        status: assignedPersonIds.has(person.id) ? "assigned" as PersonStatus : "available" as PersonStatus
      }))

      const eventScopedMaterials = materialsList.map(material => ({
        ...material,
        status: assignedMaterialIds.has(material.id) ? "assigned" as Material["status"] : "available" as Material["status"]
      }))

      setOperations(operations)
      setPersonnel(eventScopedPersonnel)
      setMaterials(eventScopedMaterials)
      setHomeCity(settings.home_city || "")
    } catch (error) {
      console.error("Failed to load data from API:", error)
      // Leave arrays empty if API fails - no fallback data
    } finally {
      setIsLoading(false)
    }
  }, [selectedEvent])

  // Load initial data from API - only when authenticated and event selected
  useEffect(() => {
    // Don't load data if auth is still loading or user is not authenticated
    if (authLoading || !isAuthenticated) {
      setIsLoading(false)
      return
    }

    // Don't load data if no event is selected
    if (!selectedEvent) {
      setOperations([])
      setIsLoading(false)
      setIsLoaded(true)
      return
    }

    const loadData = async (showLoading = true) => {
      try {
        // Only show loading skeleton on initial load, not on polling updates
        if (showLoading && isInitialLoad) {
          setIsLoading(true)
        }
        const [apiIncidents, apiPersonnel, apiMats, settings] = await Promise.all([
          apiClient.getIncidents(selectedEvent.id),
          apiClient.getAllPersonnel({ checked_in_only: true, event_id: selectedEvent.id }), // Only show checked-in personnel for this event
          apiClient.getAllMaterials(),
          apiClient.getAllSettings().catch(() => ({ home_city: "" })), // Don't fail if settings not available
        ])

        // Convert to frontend types
        const personnelList = apiPersonnel.map(apiPersonToPerson)
        const materialsList = apiMats.map(apiMaterialToMaterial)
        const operations = apiIncidents.map(apiIncidentToOperation)

        // Fetch vehicles for vehicle assignment lookups
        const vehiclesList = await apiClient.getVehicles()

        // Fetch ALL assignments for this event in a single bulk request (optimized - replaces N+1 query pattern)
        try {
          const assignmentsByIncident = await apiClient.getAssignmentsByEvent(selectedEvent.id)

          // Populate crew/materials/vehicles for each operation from bulk data
          operations.forEach((operation) => {
            const assignments = assignmentsByIncident[operation.id] || []

            for (const assignment of assignments) {
              if (assignment.resource_type === "personnel") {
                // Find person by ID to get their name
                const person = personnelList.find(p => p.id === assignment.resource_id)
                if (person) {
                  operation.crew.push(person.name)
                  operation.crewAssignments.set(person.name, assignment.id)
                }
              } else if (assignment.resource_type === "material") {
                // Add material ID to materials array
                operation.materials.push(assignment.resource_id)
                operation.materialAssignments.set(assignment.resource_id, assignment.id)
              } else if (assignment.resource_type === "vehicle") {
                // Find vehicle by ID to get its name
                const vehicle = vehiclesList.find(v => v.id === assignment.resource_id)
                if (vehicle) {
                  operation.vehicles.push(vehicle.name)
                  operation.vehicleAssignments.set(vehicle.name, assignment.id)
                }
              }
            }
          })
        } catch (error) {
          console.error(`Failed to load assignments for event ${selectedEvent.id}:`, error)
        }

        // Fetch reko reports for incidents with completed rekos
        try {
          const rekoPromises = operations
            .filter(op => op.hasCompletedReko)
            .map(async (op) => {
              try {
                const reports = await apiClient.getIncidentRekoReports(op.id)
                const completedReports = reports.filter(r => !r.is_draft)

                if (completedReports.length > 0) {
                  // Use the most recent report
                  const latestReport = completedReports[completedReports.length - 1]

                  // Extract danger types
                  const dangerTypes: string[] = []
                  if (latestReport.dangers_json) {
                    if (latestReport.dangers_json.fire) dangerTypes.push("Feuer")
                    if (latestReport.dangers_json.explosion) dangerTypes.push("Explosion")
                    if (latestReport.dangers_json.collapse) dangerTypes.push("Einsturz")
                    if (latestReport.dangers_json.chemical) dangerTypes.push("Gefahrstoffe")
                    if (latestReport.dangers_json.electrical) dangerTypes.push("Elektrisch")
                  }

                  return {
                    operationId: op.id,
                    summary: {
                      isRelevant: latestReport.is_relevant ?? false,
                      hasDangers: dangerTypes.length > 0,
                      dangerTypes,
                      personnelCount: latestReport.effort_json?.personnel_count ?? null,
                      estimatedDuration: latestReport.effort_json?.estimated_duration_hours ?? null,
                    }
                  }
                }
              } catch (error) {
                console.error(`Failed to load reko for incident ${op.id}:`, error)
              }
              return null
            })

          const rekoResults = await Promise.all(rekoPromises)

          // Populate reko summaries
          rekoResults.forEach(result => {
            if (result) {
              const operation = operations.find(op => op.id === result.operationId)
              if (operation) {
                operation.rekoSummary = result.summary
              }
            }
          })
        } catch (error) {
          console.error('Failed to load reko reports:', error)
        }

        // Calculate event-scoped availability:
        // A person/material is "assigned" only if assigned to an incident in THIS event
        const assignedPersonIds = new Set<string>()
        const assignedMaterialIds = new Set<string>()

        operations.forEach(operation => {
          operation.crew.forEach(crewName => {
            const person = personnelList.find(p => p.name === crewName)
            if (person) {
              assignedPersonIds.add(person.id)
            }
          })
          operation.materials.forEach(materialId => {
            assignedMaterialIds.add(materialId)
          })
        })

        // Also mark personnel as assigned if they have special functions (drivers, reko, magazin)
        try {
          const specialFunctions = await apiClient.getEventSpecialFunctions(selectedEvent.id)
          specialFunctions.forEach(func => {
            assignedPersonIds.add(func.personnel_id)
          })
        } catch (error) {
          console.error('Failed to load special functions for personnel status:', error)
        }

        // Update personnel status based on event-scoped assignments
        const eventScopedPersonnel = personnelList.map(person => ({
          ...person,
          status: assignedPersonIds.has(person.id) ? "assigned" as PersonStatus : "available" as PersonStatus
        }))

        // Update material status based on event-scoped assignments
        const eventScopedMaterials = materialsList.map(material => ({
          ...material,
          status: assignedMaterialIds.has(material.id) ? "assigned" as Material["status"] : "available" as Material["status"]
        }))

        setOperations(operations)
        setPersonnel(eventScopedPersonnel)
        setMaterials(eventScopedMaterials)
        setHomeCity(settings.home_city || "")
        setIsLoaded(true)
        // Mark initial load as complete
        if (isInitialLoad) {
          setIsInitialLoad(false)
        }
      } catch (error) {
        console.error("Failed to load data from API:", error)
        // Leave arrays empty if API fails - no fallback data
        setIsLoaded(true)
        if (isInitialLoad) {
          setIsInitialLoad(false)
        }
      } finally {
        setIsLoading(false)
      }
    }

    loadData()

    // Connect to WebSocket and set up real-time updates
    wsClient.connect()

    // Listen for WebSocket updates
    const unsubscribeIncidentUpdate = wsClient.on('incident_update', (update: WebSocketUpdate<ApiIncident>) => {
      if (!criticalUpdateInProgress.current && !recentAssignmentRef.current) {
        // Refresh data when incident is updated via WebSocket
        loadData(false) // Don't show loading skeleton for real-time updates
      }
    })

    const unsubscribePersonnelUpdate = wsClient.on('personnel_update', (update: WebSocketUpdate<ApiPersonnel>) => {
      if (!criticalUpdateInProgress.current && !recentAssignmentRef.current) {
        // Refresh data when personnel is updated via WebSocket
        loadData(false)
      }
    })

    const unsubscribeVehicleUpdate = wsClient.on('vehicle_update', (update: WebSocketUpdate) => {
      if (!criticalUpdateInProgress.current && !recentAssignmentRef.current) {
        // Refresh data when vehicle is updated via WebSocket
        loadData(false)
      }
    })

    const unsubscribeMaterialUpdate = wsClient.on('material_update', (update: WebSocketUpdate) => {
      if (!criticalUpdateInProgress.current && !recentAssignmentRef.current) {
        // Refresh data when material is updated via WebSocket
        loadData(false)
      }
    })

    const unsubscribeAssignmentUpdate = wsClient.on('assignment_update', (update: WebSocketUpdate) => {
      if (!criticalUpdateInProgress.current && !recentAssignmentRef.current) {
        // Refresh data when assignment is updated via WebSocket
        loadData(false)
      }
    })

    // Fallback polling - only if WebSocket disconnects
    let pollInterval: NodeJS.Timeout | undefined
    const statusUnsubscribe = wsClient.onStatusChange((status: WebSocketStatus) => {
      if (status === 'disconnected' || status === 'error') {
        // Start fallback polling if WebSocket is not connected
        if (!pollInterval) {
          pollInterval = setInterval(() => {
            if (!isLoading && !criticalUpdateInProgress.current && !recentAssignmentRef.current) {
              loadData(false)
            }
          }, 5000)
        }
      } else if (status === 'connected') {
        // Stop polling when WebSocket reconnects
        if (pollInterval) {
          clearInterval(pollInterval)
          pollInterval = undefined
        }
      }
    })

    return () => {
      // Cleanup WebSocket listeners
      unsubscribeIncidentUpdate()
      unsubscribePersonnelUpdate()
      unsubscribeVehicleUpdate()
      unsubscribeMaterialUpdate()
      unsubscribeAssignmentUpdate()
      statusUnsubscribe()

      // Cleanup polling if active
      if (pollInterval) {
        clearInterval(pollInterval)
      }

      // Disconnect WebSocket
      wsClient.disconnect()
    }
  }, [authLoading, isAuthenticated, selectedEvent])

  const removeCrew = (operationId: string, crewName: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    // Get assignment ID from the map
    const assignmentId = operation.crewAssignments.get(crewName)
    if (!assignmentId) {
      console.warn(`No assignment ID found for crew member ${crewName}`)
      return
    }

    // Update frontend state immediately
    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const newCrewAssignments = new Map(op.crewAssignments)
          newCrewAssignments.delete(crewName)
          return {
            ...op,
            crew: op.crew.filter((name) => name !== crewName),
            crewAssignments: newCrewAssignments,
          }
        }
        return op
      })
    )

    // The API unassignment will automatically update the person's status to "available"
    // So we just need to update our local state
    const person = personnel.find((p) => p.name === crewName)
    if (person) {
      const stillAssigned = operations.some(op => op.id !== operationId && op.crew.includes(crewName))
      if (!stillAssigned) {
        setPersonnel((people) =>
          people.map((p) => (p.id === person.id ? { ...p, status: "available" as PersonStatus } : p)),
        )
      }
    }

    // Call unassignment API
    if (isLoaded) {
      apiClient.unassignResource(operationId, assignmentId)
        .catch(err => {
          console.error("Failed to unassign crew:", err)
          toast.error("Fehler beim Entfernen", {
            description: "Die Person konnte nicht entfernt werden. Bitte versuchen Sie es erneut."
          })
        })
    }
  }

  const removeMaterial = (operationId: string, materialId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    // Get assignment ID from the map
    const assignmentId = operation.materialAssignments.get(materialId)
    if (!assignmentId) {
      console.warn(`No assignment ID found for material ${materialId}`)
      return
    }

    // Update frontend state immediately
    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const newMaterialAssignments = new Map(op.materialAssignments)
          newMaterialAssignments.delete(materialId)
          return {
            ...op,
            materials: op.materials.filter((id) => id !== materialId),
            materialAssignments: newMaterialAssignments,
          }
        }
        return op
      })
    )

    // The API unassignment will automatically update the material's status to "available"
    // So we just need to update our local state
    const material = materials.find((m) => m.id === materialId)
    if (material) {
      const stillAssigned = operations.some(op => op.id !== operationId && op.materials.includes(materialId))
      if (!stillAssigned) {
        setMaterials((mats) =>
          mats.map((m) => (m.id === material.id ? { ...m, status: "available" as Material["status"] } : m)),
        )
      }
    }

    // Call unassignment API
    if (isLoaded) {
      apiClient.unassignResource(operationId, assignmentId)
        .catch(err => {
          console.error("Failed to unassign material:", err)
          toast.error("Fehler beim Entfernen", {
            description: "Das Material konnte nicht entfernt werden. Bitte versuchen Sie es erneut."
          })
        })
    }
  }

  const updateOperation = (operationId: string, updates: Partial<Operation>) => {
    // If status is being updated, also update statusChangedAt to current time
    const enhancedUpdates = updates.status
      ? { ...updates, statusChangedAt: new Date() }
      : updates

    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, ...enhancedUpdates } : op)),
    )

    // For critical fields (location, coordinates), update immediately without debounce
    const isCriticalUpdate = updates.location !== undefined || updates.coordinates !== undefined

    // Debounce API updates to avoid too many requests (except for critical updates)
    if (isLoaded) {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }

      const performUpdate = async (batchedUpdates: Partial<Operation>) => {
        // Map frontend status to backend status
        const statusToBackend: Record<OperationStatus, string> = {
          "incoming": "eingegangen",
          "ready": "reko",
          "enroute": "disponiert",
          "active": "einsatz",
          "returning": "einsatz_beendet",
          "complete": "abschluss",
        }

        const apiUpdates: Partial<ApiIncidentUpdate> = {}
        // Only include fields that exist in ApiIncidentUpdate
        if (batchedUpdates.location !== undefined) apiUpdates.location_address = batchedUpdates.location
        if (batchedUpdates.incidentType !== undefined) apiUpdates.type = batchedUpdates.incidentType as ApiIncidentUpdate['type']
        if (batchedUpdates.priority !== undefined) apiUpdates.priority = batchedUpdates.priority
        if (batchedUpdates.status !== undefined) apiUpdates.status = statusToBackend[batchedUpdates.status] as ApiIncidentUpdate['status']
        if (batchedUpdates.coordinates !== undefined) {
          apiUpdates.location_lat = batchedUpdates.coordinates[0]?.toString()
          apiUpdates.location_lng = batchedUpdates.coordinates[1]?.toString()
        }
        if (batchedUpdates.notes !== undefined) apiUpdates.description = batchedUpdates.notes
        // Note: vehicle, crew, materials, contact, and dispatchTime are not part of the incident update API
        // These are handled separately through assignment APIs or are legacy fields

        try {
          await apiClient.updateIncident(operationId, apiUpdates)
        } catch (err) {
          console.error("Failed to update operation:", err)
          toast.error("Fehler beim Aktualisieren", {
            description: "Der Einsatz konnte nicht aktualisiert werden."
          })
        } finally {
          // Clear pending updates for this operation
          pendingUpdatesRef.current.delete(operationId)

          // Release the critical update lock
          if (criticalUpdateInProgress.current) {
            criticalUpdateInProgress.current = false
          }
        }
      }

      // Execute immediately for critical updates, with batching for rapid successive calls
      if (isCriticalUpdate) {
        // Clear any existing critical update timer
        if (criticalUpdateTimerRef.current) {
          clearTimeout(criticalUpdateTimerRef.current)
        }

        // Merge with any pending updates for this operation
        const existingUpdates = pendingUpdatesRef.current.get(operationId) || {}
        const mergedUpdates = { ...existingUpdates, ...updates }
        pendingUpdatesRef.current.set(operationId, mergedUpdates)

        criticalUpdateInProgress.current = true

        // Batch rapid updates within 50ms window
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
    // Don't create if no event is selected
    if (!selectedEvent) {
      console.error("Cannot create operation without selected event")
      return
    }

    if (isLoaded) {
      try {
        // Transform Operation format to Incident format
        const incidentData = {
          event_id: selectedEvent.id, // Use selected event's ID
          title: operation.location,
          type: (operation.incidentType || "elementarereignis") as any,
          priority: operation.priority as "low" | "medium" | "high",
          location_address: operation.location,
          location_lat: operation.coordinates[0]?.toString(),
          location_lng: operation.coordinates[1]?.toString(),
          status: "eingegangen" as const, // Always start as eingegangen
          description: operation.notes || null,
        }

        const apiIncident = await apiClient.createIncident(incidentData)

        // Transform Incident back to Operation for frontend state
        const newOperation: Operation = {
          id: apiIncident.id,
          location: apiIncident.location_address || apiIncident.title,
          vehicle: operation.vehicle, // Keep vehicle from form (not in incident schema yet)
          vehicles: [],
          incidentType: operation.incidentType,
          dispatchTime: new Date(apiIncident.created_at),
          crew: [],
          priority: apiIncident.priority as "low" | "medium" | "high",
          status: "incoming", // Map eingegangen to incoming
          coordinates: apiIncident.location_lat && apiIncident.location_lng
            ? [parseFloat(apiIncident.location_lat), parseFloat(apiIncident.location_lng)]
            : operation.coordinates,
          materials: [],
          notes: apiIncident.description || "",
          contact: operation.contact,
          statusChangedAt: apiIncident.status_changed_at ? new Date(apiIncident.status_changed_at) : null,
          hasCompletedReko: false, // New incidents don't have reko reports yet
          rekoSummary: null, // New incidents don't have reko reports yet
          crewAssignments: new Map(),
          materialAssignments: new Map(),
          vehicleAssignments: new Map(),
        }
        setOperations((ops) => [newOperation, ...ops])
      } catch (error) {
        console.error("Failed to create operation:", error)
      }
    } else {
      // Fallback if API not loaded
      const newOperation: Operation = {
        ...operation,
        id: getNextOperationId(),
        dispatchTime: new Date(),
        statusChangedAt: null,
        hasCompletedReko: false,
        rekoSummary: null,
        crewAssignments: new Map(),
        materialAssignments: new Map(),
        vehicleAssignments: new Map(),
      }
      setOperations((ops) => [newOperation, ...ops])
    }
  }

  /**
   * Assigns a person to an operation's crew.
   * Updates both frontend state and persists to the database.
   *
   * @param personId - The ID of the person to assign
   * @param personName - The name of the person (for operation crew list)
   * @param operationId - The ID of the operation to assign the person to
   */
  const assignPersonToOperation = async (personId: string, personName: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    const person = personnel.find(p => p.id === personId)

    if (!operation || !person || person.status === "assigned" || operation.crew.includes(personName)) {
      return
    }

    // Set assignment cooldown to prevent polling from overriding optimistic update
    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) {
      clearTimeout(assignmentCooldownTimerRef.current)
    }
    assignmentCooldownTimerRef.current = setTimeout(() => {
      recentAssignmentRef.current = false
    }, 3000) // Wait 3 seconds before allowing polling again

    // Update frontend state immediately (optimistic update)
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, crew: [...op.crew, personName] } : op))
    )
    setPersonnel((people) =>
      people.map((p) => (p.id === personId ? { ...p, status: "assigned" as PersonStatus } : p))
    )

    // Persist to database via assignment API
    if (isLoaded) {
      try {
        const assignment = await apiClient.assignResource(operationId, {
          resource_type: "personnel",
          resource_id: personId,
        })

        // Store assignment ID for later unassignment
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
        // Revert optimistic update on error
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, crew: op.crew.filter(n => n !== personName) } : op))
        )
        setPersonnel((people) =>
          people.map((p) => (p.id === personId ? { ...p, status: "available" as PersonStatus } : p))
        )

        // Clear assignment cooldown on error so WebSocket updates can refresh if needed
        recentAssignmentRef.current = false
        if (assignmentCooldownTimerRef.current) {
          clearTimeout(assignmentCooldownTimerRef.current)
          assignmentCooldownTimerRef.current = undefined
        }
      }
    }
  }

  /**
   * Assigns material to an operation.
   * Updates both frontend state and persists to the database.
   *
   * @param materialId - The ID of the material to assign
   * @param operationId - The ID of the operation to assign the material to
   */
  const assignMaterialToOperation = async (materialId: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    const material = materials.find(m => m.id === materialId)

    if (!operation || !material || material.status === "assigned" || operation.materials.includes(materialId)) {
      return
    }

    // Set assignment cooldown to prevent polling from overriding optimistic update
    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) {
      clearTimeout(assignmentCooldownTimerRef.current)
    }
    assignmentCooldownTimerRef.current = setTimeout(() => {
      recentAssignmentRef.current = false
    }, 3000) // Wait 3 seconds before allowing polling again

    // Update frontend state immediately (optimistic update)
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, materials: [...op.materials, materialId] } : op))
    )
    setMaterials((mats) =>
      mats.map((m) => (m.id === materialId ? { ...m, status: "assigned" as Material["status"] } : m))
    )

    // Persist to database via assignment API
    if (isLoaded) {
      try {
        const assignment = await apiClient.assignResource(operationId, {
          resource_type: "material",
          resource_id: materialId,
        })

        // Store assignment ID for later unassignment
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
        // Revert optimistic update on error
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, materials: op.materials.filter(id => id !== materialId) } : op))
        )
        setMaterials((mats) =>
          mats.map((m) => (m.id === materialId ? { ...m, status: "available" as Material["status"] } : m))
        )

        // Clear assignment cooldown on error so WebSocket updates can refresh if needed
        recentAssignmentRef.current = false
        if (assignmentCooldownTimerRef.current) {
          clearTimeout(assignmentCooldownTimerRef.current)
          assignmentCooldownTimerRef.current = undefined
        }
      }
    }
  }

  /**
   * Assigns a vehicle to an operation.
   * Updates both frontend state and persists to the database.
   *
   * @param vehicleId - The ID of the vehicle to assign
   * @param vehicleName - The name of the vehicle (for operation vehicles list)
   * @param operationId - The ID of the operation to assign the vehicle to
   */
  const assignVehicleToOperation = async (vehicleId: string, vehicleName: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)

    if (!operation || operation.vehicles.includes(vehicleName)) {
      return
    }

    // Validate vehicleId before proceeding
    if (!vehicleId || vehicleId.trim() === '') {
      console.error('[ERROR] Invalid vehicleId:', { vehicleId, vehicleName, operationId })
      toast.error("Fehler", {
        description: `Fahrzeug "${vehicleName}" hat keine gültige ID. Bitte laden Sie die Seite neu.`
      })
      return
    }

    // Set assignment cooldown to prevent polling from overriding optimistic update
    recentAssignmentRef.current = true
    if (assignmentCooldownTimerRef.current) {
      clearTimeout(assignmentCooldownTimerRef.current)
    }
    assignmentCooldownTimerRef.current = setTimeout(() => {
      recentAssignmentRef.current = false
    }, 3000) // Wait 3 seconds before allowing polling again

    // Update frontend state immediately (optimistic update)
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, vehicles: [...op.vehicles, vehicleName] } : op))
    )

    // Persist to database via assignment API
    if (isLoaded) {
      try {
        const assignment = await apiClient.assignResource(operationId, {
          resource_type: "vehicle",
          resource_id: vehicleId,
        })

        // Store assignment ID for later unassignment
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
        // Revert optimistic update on error
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, vehicles: op.vehicles.filter(name => name !== vehicleName) } : op))
        )

        // Clear assignment cooldown on error so WebSocket updates can refresh if needed
        recentAssignmentRef.current = false
        if (assignmentCooldownTimerRef.current) {
          clearTimeout(assignmentCooldownTimerRef.current)
          assignmentCooldownTimerRef.current = undefined
        }
      }
    }
  }

  /**
   * Removes a vehicle from an operation (unassigns it).
   * Updates frontend state and persists to the database.
   *
   * @param operationId - The ID of the operation to remove the vehicle from
   * @param vehicleName - The name of the vehicle to remove
   */
  const removeVehicle = (operationId: string, vehicleName: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    // Get assignment ID from the map
    const assignmentId = operation.vehicleAssignments.get(vehicleName)
    if (!assignmentId) {
      console.warn(`No assignment ID found for vehicle ${vehicleName}`)
      return
    }

    // Update frontend state immediately
    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const newVehicleAssignments = new Map(op.vehicleAssignments)
          newVehicleAssignments.delete(vehicleName)
          return {
            ...op,
            vehicles: op.vehicles.filter((name) => name !== vehicleName),
            vehicleAssignments: newVehicleAssignments,
          }
        }
        return op
      })
    )

    // Call unassignment API
    if (isLoaded) {
      apiClient.unassignResource(operationId, assignmentId)
        .catch(err => {
          console.error("Failed to unassign vehicle:", err)
          toast.error("Fehler beim Entfernen", {
            description: "Das Fahrzeug konnte nicht entfernt werden. Bitte versuchen Sie es erneut."
          })
        })
    }
  }

  /**
   * Deletes an operation from the system.
   * Updates frontend state and persists to the database.
   * Also releases any assigned personnel and materials.
   *
   * @param operationId - The ID of the operation to delete
   */
  const deleteOperation = async (operationId: string): Promise<void> => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) {
      console.error("Operation not found:", operationId)
      return
    }

    try {
      // Delete from backend first
      if (isLoaded) {
        await apiClient.deleteIncident(operationId)
      }

      // Release assigned personnel
      for (const crewName of operation.crew) {
        const person = personnel.find(p => p.name === crewName)
        if (person) {
          const stillAssigned = operations.some(op => op.id !== operationId && op.crew.includes(crewName))
          if (!stillAssigned) {
            setPersonnel((people) =>
              people.map((p) => (p.id === person.id ? { ...p, status: "available" as PersonStatus } : p))
            )
            if (isLoaded) {
              apiClient.updatePersonnel(person.id, {
                availability: "available",
              }).catch(err => console.error("Failed to update person:", err))
            }
          }
        }
      }

      // Release assigned materials
      for (const materialId of operation.materials) {
        const material = materials.find(m => m.id === materialId)
        if (material) {
          const stillAssigned = operations.some(op => op.id !== operationId && op.materials.includes(materialId))
          if (!stillAssigned) {
            setMaterials((mats) =>
              mats.map((m) => (m.id === material.id ? { ...m, status: "available" as Material["status"] } : m))
            )
            if (isLoaded) {
              apiClient.updateMaterialResource(material.id, {
                status: "available",
              }).catch(err => console.error("Failed to update material:", err))
            }
          }
        }
      }

      // Remove from frontend state
      setOperations((ops) => ops.filter((op) => op.id !== operationId))
    } catch (error) {
      console.error("Failed to delete operation:", error)
      throw error
    }
  }

  /**
   * Format a location for display based on home city setting.
   * @param fullAddress - The complete address to format
   * @returns Formatted address string
   */
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
        updateOperation,
        createOperation,
        getNextOperationId,
        assignPersonToOperation,
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
 * Returns a subset of the operations context data without assignment tracking
 */
export function useIncidents() {
  const context = useContext(OperationsContext)
  const { selectedEvent } = useEvent()

  if (context === undefined) {
    throw new Error("useIncidents must be used within an OperationsProvider")
  }

  // Map operation status to incident status
  const operationToIncidentStatus: Record<OperationStatus, string> = {
    "incoming": "eingegangen",
    "ready": "reko",
    "enroute": "disponiert",
    "active": "einsatz",
    "returning": "einsatz_beendet",
    "complete": "abschluss",
  }

  // Convert operations to incidents format for compatibility
  const incidents = context.operations.map((op) => ({
    id: op.id,
    event_id: selectedEvent?.id || "", // Use selected event's ID
    title: op.location,
    type: op.incidentType as any,
    priority: op.priority as "low" | "medium" | "high",
    location_address: op.location,
    location_lat: op.coordinates?.[0] ?? null,
    location_lng: op.coordinates?.[1] ?? null,
    status: operationToIncidentStatus[op.status] as any,
    description: op.notes,
    created_at: op.dispatchTime,
    updated_at: op.dispatchTime,
    created_by: null,
    completed_at: op.status === "complete" ? new Date() : null,
    status_changed_at: op.statusChangedAt,
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
    setIncidents: () => {}, // No-op for compatibility
    setPersonnel: context.setPersonnel,
    setMaterials: context.setMaterials,
    setTrainingMode: (_trainingMode: boolean) => {}, // No-op for compatibility
    formatLocation: context.formatLocation,
    createIncident: async (data: any) => {
      // Convert frontend IncidentCreate to ApiIncidentCreate (number coords -> string coords)
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
      // Convert frontend IncidentUpdate to ApiIncidentUpdate (number coords -> string coords)
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
    updateIncidentStatus: async () => {}, // Not needed by map/form
    getStatusHistory: async () => [],
  }
}
