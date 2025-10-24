"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from "react"
import { apiClient, type ApiIncident, type ApiPerson, type ApiMaterial } from "@/lib/api-client"
import type {
  Incident,
  IncidentCreate,
  IncidentUpdate,
  IncidentStatus,
  StatusTransition,
} from "@/lib/types/incidents"

// Re-export personnel and material types from operations-context for consistency
export type PersonStatus = "available" | "assigned"
export type PersonRole = "Mannschaft" | "Fahrer" | "Reko/EL/FU"

export interface Person {
  id: string
  name: string
  role: PersonRole
  status: PersonStatus
}

export interface Material {
  id: string
  name: string
  category: string
  status: "available" | "assigned"
}

/**
 * Context interface for managing incidents, personnel, and materials.
 * All mutation functions automatically persist changes to the database.
 */
interface IncidentsContextType {
  // Data
  incidents: Incident[]
  personnel: Person[]
  materials: Material[]
  isLoading: boolean
  error: string | null
  trainingMode: boolean

  // Setters (for internal use and advanced cases)
  setIncidents: React.Dispatch<React.SetStateAction<Incident[]>>
  setPersonnel: React.Dispatch<React.SetStateAction<Person[]>>
  setMaterials: React.Dispatch<React.SetStateAction<Material[]>>
  setTrainingMode: (mode: boolean) => void

  // Incident CRUD
  createIncident: (data: IncidentCreate) => Promise<Incident | null>
  updateIncident: (id: string, data: IncidentUpdate) => Promise<void>
  deleteIncident: (id: string) => Promise<void>
  refreshIncidents: () => Promise<void>

  // Status management
  updateIncidentStatus: (id: string, newStatus: IncidentStatus, notes?: string) => Promise<void>
  getStatusHistory: (id: string) => Promise<StatusTransition[]>

  // Legacy support (for gradual migration from operations)
  assignPersonToOperation?: (personId: string, personName: string, operationId: string) => void
  assignMaterialToOperation?: (materialId: string, operationId: string) => void
  removeCrew?: (operationId: string, crewName: string) => void
  removeMaterial?: (operationId: string, materialId: string) => void
}

const IncidentsContext = createContext<IncidentsContextType | undefined>(undefined)

export function IncidentsProvider({ children }: { children: ReactNode }) {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [personnel, setPersonnel] = useState<Person[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trainingMode, setTrainingMode] = useState(false)
  const updateTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  // Helper functions to convert between API and frontend types
  const apiIncidentToIncident = (apiIncident: ApiIncident): Incident => ({
    id: apiIncident.id,
    title: apiIncident.title,
    type: apiIncident.type,
    priority: apiIncident.priority,
    location_address: apiIncident.location_address,
    location_lat: apiIncident.location_lat ? parseFloat(apiIncident.location_lat) : null,
    location_lng: apiIncident.location_lng ? parseFloat(apiIncident.location_lng) : null,
    status: apiIncident.status,
    training_flag: apiIncident.training_flag,
    description: apiIncident.description,
    created_at: new Date(apiIncident.created_at),
    updated_at: new Date(apiIncident.updated_at),
    created_by: apiIncident.created_by,
    completed_at: apiIncident.completed_at ? new Date(apiIncident.completed_at) : null,
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

  // Load incidents from API
  const refreshIncidents = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const apiIncidents = await apiClient.getIncidents({
        training_only: trainingMode ? true : undefined,
      })
      setIncidents(apiIncidents.map(apiIncidentToIncident))
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load incidents'
      setError(errorMessage)
      console.error('Failed to load incidents:', err)
    } finally {
      setIsLoading(false)
    }
  }, [trainingMode])

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const [apiIncidents, apiPersonnel, apiMats] = await Promise.all([
          apiClient.getIncidents({
            training_only: trainingMode ? true : undefined,
          }),
          apiClient.getPersonnel(),
          apiClient.getMaterials(),
        ])

        setIncidents(apiIncidents.map(apiIncidentToIncident))
        setPersonnel(apiPersonnel.map(apiPersonToPerson))
        setMaterials(apiMats.map(apiMaterialToMaterial))
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load data'
        setError(errorMessage)
        console.error('Failed to load data:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [trainingMode])

  // Create incident
  const createIncident = async (data: IncidentCreate): Promise<Incident | null> => {
    try {
      const apiData = {
        ...data,
        training_flag: trainingMode,
        location_lat: data.location_lat?.toString() ?? null,
        location_lng: data.location_lng?.toString() ?? null,
      }

      const apiIncident = await apiClient.createIncident(apiData)
      const newIncident = apiIncidentToIncident(apiIncident)
      setIncidents((prev) => [newIncident, ...prev])
      return newIncident
    } catch (err) {
      console.error('Failed to create incident:', err)
      setError(err instanceof Error ? err.message : 'Failed to create incident')
      return null
    }
  }

  // Update incident
  const updateIncident = async (id: string, data: IncidentUpdate): Promise<void> => {
    try {
      const apiData = {
        ...data,
        location_lat: data.location_lat?.toString(),
        location_lng: data.location_lng?.toString(),
      }

      // Get current incident for optimistic locking
      const currentIncident = incidents.find((inc) => inc.id === id)
      const expectedUpdatedAt = currentIncident?.updated_at.toISOString()

      const apiIncident = await apiClient.updateIncident(id, apiData, expectedUpdatedAt)
      const updatedIncident = apiIncidentToIncident(apiIncident)

      setIncidents((prev) =>
        prev.map((inc) => (inc.id === id ? updatedIncident : inc))
      )
    } catch (err) {
      console.error('Failed to update incident:', err)
      // Check if it's a conflict error (409)
      if (err instanceof Error && err.message.includes('409')) {
        setError('Concurrent modification detected. Please refresh and try again.')
        // Refresh the incident
        await refreshIncidents()
      } else {
        setError(err instanceof Error ? err.message : 'Failed to update incident')
      }
      throw err
    }
  }

  // Update incident status
  const updateIncidentStatus = async (
    id: string,
    newStatus: IncidentStatus,
    notes?: string
  ): Promise<void> => {
    try {
      const incident = incidents.find((inc) => inc.id === id)
      if (!incident) {
        throw new Error('Incident not found')
      }

      const apiIncident = await apiClient.updateIncidentStatus(
        id,
        incident.status,
        newStatus,
        notes
      )
      const updatedIncident = apiIncidentToIncident(apiIncident)

      setIncidents((prev) =>
        prev.map((inc) => (inc.id === id ? updatedIncident : inc))
      )
    } catch (err) {
      console.error('Failed to update incident status:', err)
      setError(err instanceof Error ? err.message : 'Failed to update status')
      throw err
    }
  }

  // Get status history
  const getStatusHistory = async (id: string): Promise<StatusTransition[]> => {
    try {
      const apiTransitions = await apiClient.getIncidentStatusHistory(id)
      return apiTransitions.map((t) => ({
        ...t,
        from_status: t.from_status as IncidentStatus,
        to_status: t.to_status as IncidentStatus,
        timestamp: new Date(t.timestamp),
      }))
    } catch (err) {
      console.error('Failed to load status history:', err)
      setError(err instanceof Error ? err.message : 'Failed to load history')
      return []
    }
  }

  // Delete incident
  const deleteIncident = async (id: string): Promise<void> => {
    try {
      await apiClient.deleteIncident(id)
      setIncidents((prev) => prev.filter((inc) => inc.id !== id))
    } catch (err) {
      console.error('Failed to delete incident:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete incident')
      throw err
    }
  }

  const value: IncidentsContextType = {
    incidents,
    personnel,
    materials,
    isLoading,
    error,
    trainingMode,
    setIncidents,
    setPersonnel,
    setMaterials,
    setTrainingMode,
    createIncident,
    updateIncident,
    deleteIncident,
    refreshIncidents,
    updateIncidentStatus,
    getStatusHistory,
  }

  return (
    <IncidentsContext.Provider value={value}>
      {children}
    </IncidentsContext.Provider>
  )
}

export function useIncidents() {
  const context = useContext(IncidentsContext)
  if (context === undefined) {
    throw new Error('useIncidents must be used within an IncidentsProvider')
  }
  return context
}
