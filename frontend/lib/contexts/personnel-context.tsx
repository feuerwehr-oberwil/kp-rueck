"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react"
import { apiClient, type ApiPersonnel } from "@/lib/api-client"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"

// Simple UUID validation
const isValidUUID = (id: string | undefined | null): id is string => {
  if (!id) return false
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

// Types
export type PersonStatus = "available" | "assigned"
export type PersonRole = string

export interface Person {
  id: string
  name: string
  role: PersonRole
  status: PersonStatus
  tags?: string[]
  isReko?: boolean
  isDriver?: boolean
  driverVehicleName?: string
  isMagazin?: boolean
  roleSortOrder: number
}

interface PersonnelContextType {
  personnel: Person[]
  setPersonnel: React.Dispatch<React.SetStateAction<Person[]>>
  isLoading: boolean
  refreshPersonnel: () => Promise<Person[]>
}

const PersonnelContext = createContext<PersonnelContextType | undefined>(undefined)

// Helper to convert API type to frontend type
const apiPersonToPerson = (apiPerson: ApiPersonnel): Person => ({
  id: String(apiPerson.id),
  name: apiPerson.name,
  role: apiPerson.role as PersonRole,
  status: apiPerson.availability as PersonStatus,
  tags: apiPerson.tags || [],
  roleSortOrder: apiPerson.role_sort_order,
})

export function PersonnelProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const { selectedEvent } = useEvent()
  const [personnel, setPersonnel] = useState<Person[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refreshPersonnel = useCallback(async (): Promise<Person[]> => {
    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      setPersonnel([])
      return []
    }

    try {
      setIsLoading(true)
      const apiPersonnel = await apiClient.getAllPersonnel({
        checked_in_only: true,
        event_id: selectedEvent.id,
      })
      const personnelList = apiPersonnel.map(apiPersonToPerson)
      setPersonnel(personnelList)
      return personnelList
    } catch (error) {
      console.error("Failed to load personnel:", error)
      return []
    } finally {
      setIsLoading(false)
    }
  }, [selectedEvent])

  // Load initial data
  useEffect(() => {
    if (authLoading || !isAuthenticated) {
      setIsLoading(false)
      return
    }

    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      setPersonnel([])
      setIsLoading(false)
      return
    }

    refreshPersonnel()
  }, [authLoading, isAuthenticated, selectedEvent, refreshPersonnel])

  return (
    <PersonnelContext.Provider
      value={{
        personnel,
        setPersonnel,
        isLoading,
        refreshPersonnel,
      }}
    >
      {children}
    </PersonnelContext.Provider>
  )
}

export function usePersonnel() {
  const context = useContext(PersonnelContext)
  if (context === undefined) {
    throw new Error("usePersonnel must be used within a PersonnelProvider")
  }
  return context
}
