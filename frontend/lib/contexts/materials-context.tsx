"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react"
import { toast } from "sonner"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { apiClient, type ApiMaterialResource, type ApiMaterialGroup } from "@/lib/api-client"
import { isValidUUID } from "@/lib/utils/validation"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"

// Types
export interface Material {
  id: string
  name: string
  /** The DEPOT the device lies in — «Standort» everywhere in the UI. Carried by
      the API field `location` (the settings table used to head it «Kategorie»). */
  category: string
  /** Second grouping dimension (functional type, e.g. "Tauchpumpen", "Wasser") —
      distinct from `category` (the depot/location). Used for quick-select. */
  type: string
  /** DEPLOYMENT only, recomputed per Ereignis from the incident assignments.
      Readiness lives in `outOfService`; read the two together through
      `materialResourceState` and never this field alone. */
  status: "available" | "assigned"
  /** «Nicht einsatzbereit» — a station-wide flag, not a per-Ereignis one. Beats
      `status`: an out-of-service device is neither free nor assignable. */
  outOfService: boolean
  /** Server-stamped moment the flag was set (ISO), for the «seit 19.08.» line. */
  outOfServiceSince: string | null
  categorySortOrder: number
  consumable: boolean
  groupId: string | null
}

export interface MaterialGroup {
  id: string
  name: string
  description: string | null
  location: string
  materialIds: string[]
}

interface MaterialsContextType {
  materials: Material[]
  setMaterials: React.Dispatch<React.SetStateAction<Material[]>>
  materialGroups: MaterialGroup[]
  isLoading: boolean
  refreshMaterials: (options?: { skipStateUpdate?: boolean }) => Promise<Material[]>
  refreshMaterialGroups: () => Promise<void>
  /** Set or clear «Nicht einsatzbereit». The ONE write path for the flag on the
   *  board side — the sidebar's right-click menu calls it, and the
   *  Materialverwaltung sends the same `{ out_of_service }` PUT. Optimistic,
   *  and rolls back on failure. */
  setMaterialOutOfService: (materialId: string, outOfService: boolean) => Promise<void>
}

const MaterialsContext = createContext<MaterialsContextType | undefined>(undefined)

// Helper to convert API type to frontend type.
//
// `status` is seeded from the legacy mirror and then OVERWRITTEN per Ereignis by
// the operations context (deployment). Readiness is carried separately in
// `outOfService`, which nothing recomputes — that is the whole point: the board
// used to derive one field from the assignments and thereby erase the defect.
const apiMaterialToMaterial = (apiMat: ApiMaterialResource): Material => ({
  id: String(apiMat.id),
  name: apiMat.name,
  category: apiMat.location || "General",
  type: apiMat.type || "Sonstiges",
  status: (apiMat.status === "available" ? "available" : "assigned") as "available" | "assigned",
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
  materialIds: apiGroup.materials.map(m => String(m.id)),
})

export function MaterialsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const { selectedEvent } = useEvent()
  const [materials, setMaterials] = useState<Material[]>([])
  const [materialGroups, setMaterialGroups] = useState<MaterialGroup[]>([])
  const [isLoading, setIsLoading] = useState(false)
  // Toast deduplication across an outage; matches the personnel-context pattern.
  const hasShownMaterialsErrorRef = useRef(false)
  const hasShownGroupsErrorRef = useRef(false)

  const refreshMaterials = useCallback(
    async (options?: { skipStateUpdate?: boolean }): Promise<Material[]> => {
      if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
        if (!options?.skipStateUpdate) setMaterials([])
        return []
      }

      try {
        setIsLoading(true)
        const apiMats = await apiClient.getAllMaterials()
        const materialsList = apiMats.map(apiMaterialToMaterial)
        if (!options?.skipStateUpdate) setMaterials(materialsList)
        hasShownMaterialsErrorRef.current = false
        return materialsList
      } catch (error) {
        console.error("Failed to load materials:", error)
        if (!hasShownMaterialsErrorRef.current) {
          hasShownMaterialsErrorRef.current = true
          toast.error(translateOutsideReact('notifications.materials.loadFailedTitle'), {
            description: translateOutsideReact('notifications.materials.loadFailedDescription'),
          })
        }
        return []
      } finally {
        setIsLoading(false)
      }
    },
    [selectedEvent],
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
        toast.error(translateOutsideReact('notifications.materials.groupsLoadFailed'))
      }
    }
  }, [])

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
        toast.error(translateOutsideReact('notifications.materials.readinessFailedTitle'), {
          description: translateOutsideReact('notifications.materials.readinessFailedDescription'),
        })
      }
    },
    [materials],
  )

  // Load initial data
  useEffect(() => {
    if (authLoading || !isAuthenticated) {
      setIsLoading(false)
      return
    }

    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      setMaterials([])
      setMaterialGroups([])
      setIsLoading(false)
      return
    }

    refreshMaterials()
    refreshMaterialGroups()
  }, [authLoading, isAuthenticated, selectedEvent, refreshMaterials, refreshMaterialGroups])

  return (
    <MaterialsContext.Provider
      value={{
        materials,
        setMaterials,
        materialGroups,
        isLoading,
        refreshMaterials,
        refreshMaterialGroups,
        setMaterialOutOfService,
      }}
    >
      {children}
    </MaterialsContext.Provider>
  )
}

export function useMaterials() {
  const context = useContext(MaterialsContext)
  if (context === undefined) {
    throw new Error("useMaterials must be used within a MaterialsProvider")
  }
  return context
}
