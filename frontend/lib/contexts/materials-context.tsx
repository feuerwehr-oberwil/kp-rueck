"use client"

import { useContext } from "react"
import { OperationsContext } from "./operations/contexts"

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

/**
 * The depot with this Ereignis's deployment folded in, its material groups and
 * the one write path for «Nicht einsatzbereit». A selector over the board
 * provider – the depot is its state (`lib/contexts/operations/use-resource-lists.ts`),
 * not a provider of its own any more.
 */
export function useMaterials() {
  const context = useContext(OperationsContext)
  if (context === undefined) {
    throw new Error("useMaterials must be used within an OperationsProvider")
  }
  return {
    materials: context.materials,
    materialGroups: context.materialGroups,
    setMaterialOutOfService: context.setMaterialOutOfService,
  }
}
