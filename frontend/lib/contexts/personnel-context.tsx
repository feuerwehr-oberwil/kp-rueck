"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react"
import { toast } from "sonner"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { apiClient, type ApiPersonnel } from "@/lib/api-client"
import { isValidUUID } from "@/lib/utils/validation"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"

// Types
/**
 * The three states a person can be in on the board.
 *
 * `available` / `unavailable` is what the API stores on `Personnel.status` — «im Dienst /
 * nicht im Dienst», the same field vehicles and materials have. `assigned` is never stored:
 * it is derived per event from `incident_assignments` and written onto the person by
 * operations-context.
 *
 * `unavailable` used to be missing here while the API mapping cast the raw field to this
 * type anyway — so an off-duty person carried a value the type said could not exist.
 */
export type PersonStatus = "available" | "assigned" | "unavailable"
export type PersonRole = string

export interface Person {
  id: string
  name: string
  role: PersonRole
  status: PersonStatus
  tags?: string[]
  isReko?: boolean
  /**
   * On an Auftrag's crew. Set by the board from the groups context, not by the
   * operations context — a route assignment lives on the group, and
   * `GroupsProvider` sits INSIDE `OperationsProvider`, so the reconciliation
   * that produces `status` cannot see it. Same reasoning as `isReko`: the
   * person is spoken for without being on any incident's `crew`.
   */
  isOnAuftrag?: boolean
  isDriver?: boolean
  driverVehicleId?: string
  driverVehicleName?: string
  isMagazin?: boolean
  isTelefondienst?: boolean
  isKommandoposten?: boolean
  roleSortOrder: number
  /** Divera user_cluster_relation id — present only when linked to Divera. */
  diveraUserId?: number | null
  /** Whether the person is linked to Divera (addressable for outbound alarms). */
  diveraLinked?: boolean
}

interface PersonnelContextType {
  personnel: Person[]
  setPersonnel: React.Dispatch<React.SetStateAction<Person[]>>
  isLoading: boolean
  /**
   * Fetch personnel from the API.
   * @param options.skipStateUpdate When true, returns the list without writing
   *   to local state — used by operations-context to avoid a flicker where
   *   raw API personnel (duty-status-based) is briefly shown before the
   *   reconciled event-scoped status is applied.
   */
  refreshPersonnel: (options?: { skipStateUpdate?: boolean }) => Promise<Person[]>
}

const PersonnelContext = createContext<PersonnelContextType | undefined>(undefined)

// Helper to convert API type to frontend type
const apiPersonToPerson = (apiPerson: ApiPersonnel): Person => ({
  id: String(apiPerson.id),
  name: apiPerson.name,
  role: apiPerson.role as PersonRole,
  status: apiPerson.status === "unavailable" ? "unavailable" : "available",
  tags: apiPerson.tags || [],
  roleSortOrder: apiPerson.role_sort_order,
  diveraUserId: apiPerson.divera_user_id ?? null,
  diveraLinked: apiPerson.divera_linked ?? false,
})

export function PersonnelProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const { selectedEvent } = useEvent()
  const [personnel, setPersonnel] = useState<Person[]>([])
  const [isLoading, setIsLoading] = useState(false)
  // Deduplicate the "failed to load" toast across a single outage —
  // refreshPersonnel is called by both the kanban polling loop AND
  // WebSocket update handlers, so a real network outage can fire it
  // dozens of times per minute.
  const hasShownLoadErrorRef = useRef(false)

  const refreshPersonnel = useCallback(
    async (options?: { skipStateUpdate?: boolean }): Promise<Person[]> => {
      if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
        if (!options?.skipStateUpdate) setPersonnel([])
        return []
      }

      try {
        setIsLoading(true)
        const apiPersonnel = await apiClient.getAllPersonnel({
          checked_in_only: true,
          event_id: selectedEvent.id,
        })
        const personnelList = apiPersonnel.map(apiPersonToPerson)
        if (!options?.skipStateUpdate) setPersonnel(personnelList)
        hasShownLoadErrorRef.current = false
        return personnelList
      } catch (error) {
        console.error("Failed to load personnel:", error)
        if (!hasShownLoadErrorRef.current) {
          hasShownLoadErrorRef.current = true
          toast.error(translateOutsideReact('notifications.personnel.loadFailedTitle'), {
            description: translateOutsideReact('notifications.personnel.loadFailedDescription'),
          })
        }
        return []
      } finally {
        setIsLoading(false)
      }
    },
    [selectedEvent],
  )

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
