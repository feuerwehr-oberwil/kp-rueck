"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { apiClient, type ApiMaterialGroup, type ApiMaterialResource, type ApiPersonnel } from "@/lib/api-client"
import { isValidUUID } from "@/lib/utils/validation"
import type { Person, PersonRole } from "../personnel-context"
import type { Material, MaterialGroup } from "../materials-context"

/**
 * The roster and the depot, as state of the ONE board provider. They used to be
 * two providers of their own (PersonnelProvider, MaterialsProvider) that loaded on
 * an Ereignis switch – and then the board load fetched both again and replaced
 * their state: two requests, one flicker guard. Now only the board load fills
 * them (`useBoardSync`, with `skipStateUpdate`), and `usePersonnel()` /
 * `useMaterials()` are selectors over `useOperations()`.
 *
 * `refreshX()` without options still writes the raw list into state – the
 * attendance dialog does that after a check-in, until the next board load
 * reconciles it.
 */

const apiPersonToPerson = (apiPerson: ApiPersonnel): Person => ({
  id: String(apiPerson.id),
  name: apiPerson.name,
  role: apiPerson.role as PersonRole,
  status: apiPerson.status === "unavailable" ? "unavailable" : "available",
  tags: apiPerson.tags || [],
  roleSortOrder: apiPerson.role_sort_order,
  diveraLinked: apiPerson.divera_linked ?? false,
  checkedInAt: apiPerson.checked_in_at ?? null,
})

// `status` is seeded from the legacy mirror and then OVERWRITTEN per Ereignis by
// the board (deployment). Readiness is carried separately in `outOfService`,
// which nothing recomputes — that is the whole point: the board used to derive
// one field from the assignments and thereby erase the defect.
const apiMaterialToMaterial = (apiMat: ApiMaterialResource): Material => ({
  id: String(apiMat.id),
  name: apiMat.name,
  category: apiMat.location || "General",
  type: apiMat.type || "Sonstiges",
  status: apiMat.status === "available" ? "available" : "assigned",
  outOfService: apiMat.out_of_service ?? false,
  outOfServiceSince: apiMat.out_of_service_since ?? null,
  categorySortOrder: apiMat.location_sort_order,
  consumable: apiMat.consumable ?? false,
  groupId: apiMat.group_id ? String(apiMat.group_id) : null,
})

const apiGroupToGroup = (apiGroup: ApiMaterialGroup): MaterialGroup => ({
  id: String(apiGroup.id),
  name: apiGroup.name,
  description: apiGroup.description,
  location: apiGroup.location,
  materialIds: apiGroup.materials.map((m) => String(m.id)),
})

type RefreshOptions = {
  /**
   * Return the list without writing it to state — the board load owns the state
   * and writes the reconciled, event-scoped list in one go (no flicker where
   * every person briefly reads as available). With it, a failed fetch REJECTS
   * instead of resolving to [].
   */
  skipStateUpdate?: boolean
}

/** The checked-in roster of the selected Ereignis. */
export function usePersonnelList(eventId: string | null) {
  const [personnel, setPersonnel] = useState<Person[]>([])
  // Deduplicate the "failed to load" toast across one outage — the board load
  // runs on every poll and broadcast, so an outage would fire it dozens of
  // times a minute.
  const hasShownLoadErrorRef = useRef(false)

  const refreshPersonnel = useCallback(
    async (options?: RefreshOptions): Promise<Person[]> => {
      if (!eventId || !isValidUUID(eventId)) {
        if (!options?.skipStateUpdate) setPersonnel([])
        return []
      }
      try {
        const apiPersonnel = await apiClient.getAllPersonnel({ checked_in_only: true, event_id: eventId })
        const personnelList = apiPersonnel.map(apiPersonToPerson)
        if (!options?.skipStateUpdate) setPersonnel(personnelList)
        hasShownLoadErrorRef.current = false
        return personnelList
      } catch (error) {
        console.error("Failed to load personnel:", error)
        if (!hasShownLoadErrorRef.current) {
          hasShownLoadErrorRef.current = true
          toast.error(translateOutsideReact("notifications.personnel.loadFailedTitle"), {
            description: translateOutsideReact("notifications.personnel.loadFailedDescription"),
          })
        }
        // The board (skipStateUpdate) owns the state and must see the failure:
        // an empty list here would read as «nobody checked in» and strip every
        // crew off every card on the next reload.
        if (options?.skipStateUpdate) throw error
        return []
      }
    },
    [eventId],
  )

  return { personnel, setPersonnel, refreshPersonnel }
}

/** The depot (station-wide, deployment per Ereignis) and its material groups. */
export function useMaterialList(eventId: string | null, authReady: boolean) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [materialGroups, setMaterialGroups] = useState<MaterialGroup[]>([])
  // Toast deduplication across an outage, as for the roster.
  const hasShownMaterialsErrorRef = useRef(false)
  const hasShownGroupsErrorRef = useRef(false)
  const hasEvent = !!eventId && isValidUUID(eventId)

  const refreshMaterials = useCallback(
    async (options?: RefreshOptions): Promise<Material[]> => {
      if (!hasEvent) {
        if (!options?.skipStateUpdate) setMaterials([])
        return []
      }
      try {
        const materialsList = (await apiClient.getAllMaterials()).map(apiMaterialToMaterial)
        if (!options?.skipStateUpdate) setMaterials(materialsList)
        hasShownMaterialsErrorRef.current = false
        return materialsList
      } catch (error) {
        console.error("Failed to load materials:", error)
        if (!hasShownMaterialsErrorRef.current) {
          hasShownMaterialsErrorRef.current = true
          toast.error(translateOutsideReact("notifications.materials.loadFailedTitle"), {
            description: translateOutsideReact("notifications.materials.loadFailedDescription"),
          })
        }
        // Same contract as the roster: the board must see the failure.
        if (options?.skipStateUpdate) throw error
        return []
      }
    },
    [hasEvent],
  )

  const refreshMaterialGroups = useCallback(async () => {
    try {
      const apiGroups = await apiClient.getMaterialGroups()
      setMaterialGroups(apiGroups.map(apiGroupToGroup))
      hasShownGroupsErrorRef.current = false
    } catch (error) {
      console.error("Failed to load material groups:", error)
      if (!hasShownGroupsErrorRef.current) {
        hasShownGroupsErrorRef.current = true
        toast.error(translateOutsideReact("notifications.materials.groupsLoadFailed"))
      }
    }
  }, [])

  // The groups are not part of the board load (they change in Einstellungen,
  // not during an Einsatz): once per sign-in and Ereignis.
  useEffect(() => {
    if (!authReady) return
    if (!hasEvent) {
      setMaterialGroups([])
      return
    }
    void refreshMaterialGroups()
  }, [authReady, hasEvent, eventId, refreshMaterialGroups])

  /** Set or clear «Nicht einsatzbereit». The ONE write path for the flag on the
   *  board side — the sidebar's right-click menu calls it, and the
   *  Materialverwaltung sends the same `{ out_of_service }` PUT. Optimistic,
   *  and rolls back on failure. */
  const setMaterialOutOfService = useCallback(
    async (materialId: string, outOfService: boolean) => {
      const previous = materials.find((m) => m.id === materialId)
      // Optimistic: the sidebar row has to change shape under the cursor, not
      // after a round trip. `out_of_service_since` is server-stamped, so the
      // local guess is only good until the response replaces it.
      setMaterials((list) =>
        list.map((m) =>
          m.id === materialId
            ? { ...m, outOfService, outOfServiceSince: outOfService ? new Date().toISOString() : null }
            : m,
        ),
      )
      try {
        const updated = await apiClient.updateMaterialResource(materialId, { out_of_service: outOfService })
        setMaterials((list) =>
          list.map((m) =>
            m.id === materialId
              ? { ...m, outOfService: updated.out_of_service, outOfServiceSince: updated.out_of_service_since }
              : m,
          ),
        )
      } catch (error) {
        console.error("Failed to change material readiness:", error)
        if (previous) {
          setMaterials((list) => list.map((m) => (m.id === materialId ? previous : m)))
        }
        toast.error(translateOutsideReact("notifications.materials.readinessFailedTitle"), {
          description: translateOutsideReact("notifications.materials.readinessFailedDescription"),
        })
      }
    },
    [materials],
  )

  return { materials, setMaterials, materialGroups, refreshMaterials, setMaterialOutOfService }
}
