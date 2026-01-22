"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react"
import { apiClient, type ApiMaterialResource } from "@/lib/api-client"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"

// Simple UUID validation
const isValidUUID = (id: string | undefined | null): id is string => {
  if (!id) return false
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

// Types
export interface Material {
  id: string
  name: string
  category: string
  status: "available" | "assigned"
}

interface MaterialsContextType {
  materials: Material[]
  setMaterials: React.Dispatch<React.SetStateAction<Material[]>>
  isLoading: boolean
  refreshMaterials: () => Promise<Material[]>
}

const MaterialsContext = createContext<MaterialsContextType | undefined>(undefined)

// Helper to convert API type to frontend type
const apiMaterialToMaterial = (apiMat: ApiMaterialResource): Material => ({
  id: String(apiMat.id),
  name: apiMat.name,
  category: apiMat.location || "General",
  status: (apiMat.status === "available" ? "available" : "assigned") as "available" | "assigned",
})

export function MaterialsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const { selectedEvent } = useEvent()
  const [materials, setMaterials] = useState<Material[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refreshMaterials = useCallback(async (): Promise<Material[]> => {
    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      setMaterials([])
      return []
    }

    try {
      setIsLoading(true)
      const apiMats = await apiClient.getAllMaterials()
      const materialsList = apiMats.map(apiMaterialToMaterial)
      setMaterials(materialsList)
      return materialsList
    } catch (error) {
      console.error("Failed to load materials:", error)
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
      setMaterials([])
      setIsLoading(false)
      return
    }

    refreshMaterials()
  }, [authLoading, isAuthenticated, selectedEvent, refreshMaterials])

  return (
    <MaterialsContext.Provider
      value={{
        materials,
        setMaterials,
        isLoading,
        refreshMaterials,
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
