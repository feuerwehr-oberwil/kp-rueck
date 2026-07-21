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
  category: string
  /** Second grouping dimension (functional type, e.g. "Tauchpumpen", "Wasser") —
      distinct from `category` (the depot/location). Used for quick-select. */
  type: string
  status: "available" | "assigned"
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
}

const MaterialsContext = createContext<MaterialsContextType | undefined>(undefined)

// Helper to convert API type to frontend type
const apiMaterialToMaterial = (apiMat: ApiMaterialResource): Material => ({
  id: String(apiMat.id),
  name: apiMat.name,
  category: apiMat.location || "General",
  type: apiMat.type || "Sonstiges",
  status: (apiMat.status === "available" ? "available" : "assigned") as "available" | "assigned",
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
