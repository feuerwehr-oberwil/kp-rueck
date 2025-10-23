"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useRef } from "react"
import { apiClient, type ApiOperation, type ApiPerson, type ApiMaterial } from "@/lib/api-client"

// Types
export type PersonStatus = "available" | "assigned"
export type PersonRole = "Mannschaft" | "Fahrer" | "Reko/EL/FU"

export interface Person {
  id: string
  name: string
  role: PersonRole
  status: PersonStatus
}

export type OperationStatus = "incoming" | "ready" | "enroute" | "active" | "returning" | "complete"
export type VehicleType = "TLF" | "Pio" | "Unimog" | "Trawa" | "Mawa" | null

export interface Operation {
  id: string
  location: string
  vehicle: VehicleType
  incidentType: string
  dispatchTime: Date
  crew: string[]
  priority: "high" | "medium" | "low"
  status: OperationStatus
  coordinates: [number, number]
  materials: string[]
  notes: string
  contact: string
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
  /** Remove a crew member from an operation (persists to DB) */
  removeCrew: (operationId: string, crewName: string) => void
  /** Remove material from an operation (persists to DB) */
  removeMaterial: (operationId: string, materialId: string) => void
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
}

const OperationsContext = createContext<OperationsContextType | undefined>(undefined)

export function OperationsProvider({ children }: { children: ReactNode }) {
  const [personnel, setPersonnel] = useState<Person[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [operations, setOperations] = useState<Operation[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const updateTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  // Helper functions to convert between API and frontend types
  const apiOperationToOperation = (apiOp: ApiOperation): Operation => ({
    id: String(apiOp.id),
    location: apiOp.location,
    vehicle: apiOp.vehicle as VehicleType,
    incidentType: apiOp.incident_type,
    dispatchTime: new Date(apiOp.dispatch_time),
    crew: apiOp.crew,
    priority: apiOp.priority as "high" | "medium" | "low",
    status: apiOp.status as OperationStatus,
    coordinates: [apiOp.coordinates[0], apiOp.coordinates[1]] as [number, number],
    materials: apiOp.materials,
    notes: apiOp.notes,
    contact: apiOp.contact,
  })

  const operationToApiOperation = (op: Operation) => ({
    location: op.location,
    vehicle: op.vehicle,
    incident_type: op.incidentType,
    dispatch_time: op.dispatchTime.toISOString(),
    crew: op.crew,
    priority: op.priority,
    status: op.status,
    coordinates: op.coordinates,
    materials: op.materials,
    notes: op.notes,
    contact: op.contact,
  })

  const apiPersonToPerson = (apiPerson: ApiPerson): Person => ({
    id: String(apiPerson.id),
    name: apiPerson.name,
    role: apiPerson.role as PersonRole,
    status: apiPerson.status as PersonStatus,
  })

  const apiMaterialToMaterial = (apiMat: ApiMaterial): Material => ({
    id: String(apiMat.id),
    name: apiMat.name,
    category: apiMat.category,
    status: apiMat.status as "available" | "assigned",
  })

  // Load initial data from API
  useEffect(() => {
    const loadData = async () => {
      try {
        const [apiOps, apiPersonnel, apiMats] = await Promise.all([
          apiClient.getOperations(),
          apiClient.getPersonnel(),
          apiClient.getMaterials(),
        ])

        setOperations(apiOps.map(apiOperationToOperation))
        setPersonnel(apiPersonnel.map(apiPersonToPerson))
        setMaterials(apiMats.map(apiMaterialToMaterial))
        setIsLoaded(true)
      } catch (error) {
        console.error("Failed to load data from API:", error)
        // Leave arrays empty if API fails - no fallback data
        setIsLoaded(true)
      }
    }

    loadData()
  }, [])

  const removeCrew = (operationId: string, crewName: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const updatedOp = {
      ...operation,
      crew: operation.crew.filter((name) => name !== crewName),
    }

    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? updatedOp : op))
    )

    // Update API
    if (isLoaded) {
      apiClient.updateOperation(parseInt(operationId), {
        crew: updatedOp.crew,
      }).catch(err => console.error("Failed to update operation:", err))
    }

    const person = personnel.find((p) => p.name === crewName)
    if (person) {
      const stillAssigned = operations.some(op => op.id !== operationId && op.crew.includes(crewName))
      if (!stillAssigned) {
        setPersonnel((people) =>
          people.map((p) => (p.id === person.id ? { ...p, status: "available" as PersonStatus } : p)),
        )
        // Update API
        if (isLoaded) {
          apiClient.updatePerson(parseInt(person.id), {
            status: "available",
          }).catch(err => console.error("Failed to update person:", err))
        }
      }
    }
  }

  const removeMaterial = (operationId: string, materialId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const updatedOp = {
      ...operation,
      materials: operation.materials.filter((id) => id !== materialId),
    }

    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? updatedOp : op))
    )

    // Update API
    if (isLoaded) {
      apiClient.updateOperation(parseInt(operationId), {
        materials: updatedOp.materials,
      }).catch(err => console.error("Failed to update operation:", err))
    }

    const material = materials.find((m) => m.id === materialId)
    if (material) {
      const stillAssigned = operations.some(op => op.id !== operationId && op.materials.includes(materialId))
      if (!stillAssigned) {
        setMaterials((mats) =>
          mats.map((m) => (m.id === material.id ? { ...m, status: "available" as Material["status"] } : m)),
        )
        // Update API
        if (isLoaded) {
          apiClient.updateMaterial(parseInt(material.id), {
            status: "available",
          }).catch(err => console.error("Failed to update material:", err))
        }
      }
    }
  }

  const updateOperation = (operationId: string, updates: Partial<Operation>) => {
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, ...updates } : op)),
    )

    // Debounce API updates to avoid too many requests
    if (isLoaded) {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
      updateTimeoutRef.current = setTimeout(() => {
        const apiUpdates: any = {}
        if (updates.location !== undefined) apiUpdates.location = updates.location
        if (updates.vehicle !== undefined) apiUpdates.vehicle = updates.vehicle
        if (updates.incidentType !== undefined) apiUpdates.incident_type = updates.incidentType
        if (updates.dispatchTime !== undefined) apiUpdates.dispatch_time = updates.dispatchTime.toISOString()
        if (updates.crew !== undefined) apiUpdates.crew = updates.crew
        if (updates.priority !== undefined) apiUpdates.priority = updates.priority
        if (updates.status !== undefined) apiUpdates.status = updates.status
        if (updates.coordinates !== undefined) apiUpdates.coordinates = updates.coordinates
        if (updates.materials !== undefined) apiUpdates.materials = updates.materials
        if (updates.notes !== undefined) apiUpdates.notes = updates.notes
        if (updates.contact !== undefined) apiUpdates.contact = updates.contact

        apiClient.updateOperation(parseInt(operationId), apiUpdates)
          .catch(err => console.error("Failed to update operation:", err))
      }, 500)
    }
  }

  const getNextOperationId = () => {
    const maxId = Math.max(...operations.map(op => parseInt(op.id) || 0))
    return String(maxId + 1)
  }

  const createOperation = async (operation: Omit<Operation, "id" | "dispatchTime">) => {
    if (isLoaded) {
      try {
        const apiOp = await apiClient.createOperation({
          location: operation.location,
          vehicle: operation.vehicle,
          incident_type: operation.incidentType,
          dispatch_time: new Date().toISOString(),
          crew: operation.crew,
          priority: operation.priority,
          status: operation.status,
          coordinates: operation.coordinates,
          materials: operation.materials,
          notes: operation.notes,
          contact: operation.contact,
        })
        const newOperation = apiOperationToOperation(apiOp)
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
  const assignPersonToOperation = (personId: string, personName: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    const person = personnel.find(p => p.id === personId)

    if (!operation || !person || person.status === "assigned" || operation.crew.includes(personName)) {
      return
    }

    // Update frontend state
    const updatedCrew = [...operation.crew, personName]
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, crew: updatedCrew } : op))
    )
    setPersonnel((people) =>
      people.map((p) => (p.id === personId ? { ...p, status: "assigned" as PersonStatus } : p))
    )

    // Persist to database
    if (isLoaded) {
      apiClient.updateOperation(parseInt(operationId), {
        crew: updatedCrew,
      }).catch(err => console.error("Failed to update operation crew:", err))

      apiClient.updatePerson(parseInt(personId), {
        status: "assigned",
      }).catch(err => console.error("Failed to update person status:", err))
    }
  }

  /**
   * Assigns material to an operation.
   * Updates both frontend state and persists to the database.
   *
   * @param materialId - The ID of the material to assign
   * @param operationId - The ID of the operation to assign the material to
   */
  const assignMaterialToOperation = (materialId: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    const material = materials.find(m => m.id === materialId)

    if (!operation || !material || material.status === "assigned" || operation.materials.includes(materialId)) {
      return
    }

    // Update frontend state
    const updatedMaterials = [...operation.materials, materialId]
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, materials: updatedMaterials } : op))
    )
    setMaterials((mats) =>
      mats.map((m) => (m.id === materialId ? { ...m, status: "assigned" as Material["status"] } : m))
    )

    // Persist to database
    if (isLoaded) {
      apiClient.updateOperation(parseInt(operationId), {
        materials: updatedMaterials,
      }).catch(err => console.error("Failed to update operation materials:", err))

      apiClient.updateMaterial(parseInt(materialId), {
        status: "assigned",
      }).catch(err => console.error("Failed to update material status:", err))
    }
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
        removeCrew,
        removeMaterial,
        updateOperation,
        createOperation,
        getNextOperationId,
        assignPersonToOperation,
        assignMaterialToOperation,
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
