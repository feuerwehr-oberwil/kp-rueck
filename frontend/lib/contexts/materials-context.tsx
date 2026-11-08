"use client"

import { useContext, useMemo } from "react"
import { OperationsContext } from "./operations/contexts"
import { useGroups } from "./groups-context"

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
  /** DEPLOYMENT only, recomputed per Ereignis from the incident assignments
      (`buildEventState`) and the Aufträge (`withAuftragDeployment`, folded in by
      `useMaterials`). Readiness lives in `outOfService`; read the two together
      through `materialResourceState` and never this field alone. */
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
 * Material held by an Auftrag is deployed, exactly like material on an Einsatz
 * (owner pick D2, 08.11.2026). A route's resources live on the group, and
 * `GroupsProvider` sits inside `OperationsProvider`, so the board load's
 * reconciliation (`buildEventState`) only ever sees the incident assignments –
 * a Tauchpumpe out on «Sturmtour Nord» read as frei in the sidebar, its counter
 * and on the wall. The same fold `isOnAuftrag` gives a person
 * (`useAuftragRoster`), here straight into `status`, so every reader of
 * `materialResourceState` follows. Unchanged rows keep their identity.
 */
export function withAuftragDeployment(materials: Material[], onAuftrag: ReadonlySet<string>): Material[] {
  if (onAuftrag.size === 0) return materials
  return materials.map((material) =>
    material.status === "available" && onAuftrag.has(material.id) ? { ...material, status: "assigned" } : material,
  )
}

/**
 * The depot with this Ereignis's deployment folded in – incident assignments
 * and Aufträge alike – its material groups and the one write path for «Nicht
 * einsatzbereit». A selector over the board provider (the depot is its state,
 * `lib/contexts/operations/use-resource-lists.ts`) and the groups provider;
 * every surface that draws availability (board sidebar and its counter, the
 * Status wall) reads material through here. `useOperations().materials` is the
 * incident-only half – fine for names, wrong for frei/gebunden.
 */
export function useMaterials() {
  const context = useContext(OperationsContext)
  if (context === undefined) {
    throw new Error("useMaterials must be used within an OperationsProvider")
  }
  const { occupiedResourceIds } = useGroups()
  const depot = context.materials
  const materials = useMemo(
    () => withAuftragDeployment(depot, occupiedResourceIds.material),
    [depot, occupiedResourceIds],
  )
  return {
    materials,
    materialGroups: context.materialGroups,
    setMaterialOutOfService: context.setMaterialOutOfService,
  }
}
