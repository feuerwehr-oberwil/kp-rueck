"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { apiClient, ApiError, type ApiPlannedAssignment } from "@/lib/api-client"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { isValidUUID } from "@/lib/utils/validation"
import { wsClient } from "@/lib/websocket-client"
import { usePolling } from "@/lib/hooks/use-polling"
import { onAppEvent } from "@/lib/app-events"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"

/**
 * «Danach» – the Ereignis's planned assignments (Jetzt / Danach, owner picks 24.11.2026).
 *
 * A resource is Jetzt where it has an assignment and Danach where it has a plan here: a queue
 * per resource (`position`, 1 = next). `ready` = the resource is free and this is its first
 * Danach – the board shows it as «Danach · jetzt frei» with «Zuteilen»; nothing moves by itself.
 * The rules live on the server (`backend/app/crud/planned_assignments.py`); this only reads the
 * list and sends three writes; planning itself is `planNext` (`lib/planned-actions.ts`). Readiness changes whenever any assignment is released, so the
 * list reloads on assignment, incident and group broadcasts as well as its own.
 */

export type PlannedAssignment = ApiPlannedAssignment
type ResourceType = ApiPlannedAssignment["resource_type"]

interface PlannedContextType {
  planned: PlannedAssignment[]
  /** Plans whose holder is this Einsatz or Auftrag, in planning order. */
  plannedFor: (holderId: string) => PlannedAssignment[]
  /** A resource's queue, first Danach first. */
  queueOf: (resourceType: ResourceType, resourceId: string) => PlannedAssignment[]
  /** «Zuteilen». False after a toast (still busy, gone). */
  promote: (plannedId: string) => Promise<boolean>
  /** «Verwerfen» of the «Danach frei» to-do (true) or its undo. */
  setDismissed: (plannedId: string, dismissed: boolean) => Promise<boolean>
  /** «Vormerkung löschen». */
  remove: (plannedId: string) => Promise<boolean>
}

const PlannedContext = createContext<PlannedContextType | null>(null)

const POLLING_INTERVAL = 5000
const EMPTY: PlannedAssignment[] = []

/** A refused write (409) says why – the server's sentence (`errors.codes.*`). Every other failure
 *  was toasted by the transport already (`lib/api/http.ts`). */
function toastFailure(error: unknown, titleKey: string) {
  if (!(error instanceof ApiError) || error.status !== 409) return
  toast.error(translateOutsideReact(titleKey), { description: error.message })
}

export function PlannedProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const { selectedEvent } = useEvent()
  const [planned, setPlanned] = useState<PlannedAssignment[]>(EMPTY)
  const scopeEventId = selectedEvent && isValidUUID(selectedEvent.id) ? selectedEvent.id : null
  const authReady = !authLoading && isAuthenticated
  const activeEventIdRef = useRef<string | null>(null)
  const sequenceRef = useRef(0)

  const load = useCallback(async () => {
    const eventId = scopeEventId
    if (!eventId) return
    const sequence = ++sequenceRef.current
    try {
      const list = await apiClient.getPlannedAssignments(eventId)
      if (activeEventIdRef.current !== eventId || sequence !== sequenceRef.current) return
      setPlanned(list)
    } catch (error) {
      console.error("Failed to load Danach:", error)
    }
  }, [scopeEventId])

  useEffect(() => {
    activeEventIdRef.current = scopeEventId
    sequenceRef.current++
    setPlanned(EMPTY)
  }, [scopeEventId])

  usePolling(load, { intervalMs: POLLING_INTERVAL, enabled: authReady && scopeEventId !== null, skipWhileWsConnected: true })

  useEffect(() => {
    if (!authReady || !scopeEventId) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timeout) return
      timeout = setTimeout(() => {
        timeout = undefined
        void load()
      }, 25)
    }
    const off = ["planned_assignment_update", "assignment_update", "incident_update", "group_update"].map((event) =>
      wsClient.on(event, schedule),
    )
    off.push(onAppEvent("kp:planned-changed", schedule))
    return () => {
      off.forEach((unsubscribe) => unsubscribe())
      if (timeout) clearTimeout(timeout)
    }
  }, [authReady, scopeEventId, load])

  const plannedFor = useCallback(
    (holderId: string) => planned.filter((p) => p.incident_id === holderId || p.incident_group_id === holderId),
    [planned],
  )
  const queueOf = useCallback(
    (resourceType: ResourceType, resourceId: string) =>
      planned.filter((p) => p.resource_type === resourceType && p.resource_id === resourceId),
    [planned],
  )

  const promote = useCallback(
    async (plannedId: string) => {
      try {
        await apiClient.promotePlanned(plannedId)
        await load()
        return true
      } catch (error) {
        toastFailure(error, "notifications.planned.promoteFailed")
        await load()
        return false
      }
    },
    [load],
  )

  const setDismissed = useCallback(
    async (plannedId: string, dismissed: boolean) => {
      try {
        await apiClient.setPlannedDismissed(plannedId, dismissed)
        await load()
        return true
      } catch (error) {
        toastFailure(error, "notifications.planned.saveFailed")
        return false
      }
    },
    [load],
  )

  const remove = useCallback(
    async (plannedId: string) => {
      try {
        await apiClient.removePlanned(plannedId)
      } catch (error) {
        // Gone already is what the operator wanted.
        if (!(error instanceof ApiError && error.status === 404)) {
          toastFailure(error, "notifications.planned.saveFailed")
          return false
        }
      }
      await load()
      return true
    },
    [load],
  )

  const value = useMemo(
    () => ({ planned, plannedFor, queueOf, promote, setDismissed, remove }),
    [planned, plannedFor, queueOf, promote, setDismissed, remove],
  )
  return <PlannedContext.Provider value={value}>{children}</PlannedContext.Provider>
}

const NO_PLANS: PlannedContextType = {
  planned: EMPTY,
  plannedFor: () => EMPTY,
  queueOf: () => EMPTY,
  promote: async () => false,
  setDismissed: async () => false,
  remove: async () => false,
}

/** The Danach store. Outside `PlannedProvider` (share-link displays, a card rendered on its own)
 *  there are no plans: the band and the prompt's queue line simply stay empty. */
export function usePlanned(): PlannedContextType {
  return useContext(PlannedContext) ?? NO_PLANS
}
