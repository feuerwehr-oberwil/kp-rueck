import { useMemo } from 'react'
import type { Person, Material } from '@/lib/contexts/operations-context'
import { materialResourceState, personMatchesQuery } from '@/lib/resource-status'

/**
 * The board's search over personnel and materials, and the materials grouped by category.
 * The crew sidebar groups and sorts its own list, in `lib/personnel-view.ts`.
 */
export function useResourceFiltering(
  personnel: Person[],
  materials: Material[],
  personnelQuery: string,
  materialQuery?: string,
  /** The material sidebar's toggle: drop what is currently tied up. Availability is
   *  read exactly as the cards draw it — consumables count as available, and «Nicht
   *  einsatzbereit» counts as neither (materialResourceState returns "unavailable").
   *  The crew sidebar's filters run after the search, in `lib/personnel-view.ts`. */
  availableOnly: { materials?: boolean } = {},
) {
  const effectiveMaterialQuery = materialQuery ?? personnelQuery
  const materialsAvailableOnly = !!availableOnly.materials

  const filteredPersonnel = useMemo(
    () => {
      if (!personnelQuery) return personnel
      // Shared matcher (name / rank / tags / special functions incl.
      // Telefondienst + Kommandoposten) — see lib/resource-status.ts.
      return personnel.filter((p) => personMatchesQuery(p, personnelQuery))
    },
    [personnel, personnelQuery]
  )

  const filteredMaterials = useMemo(
    () => {
      const base = materialsAvailableOnly
        ? materials.filter((m) => materialResourceState(m) === 'available')
        : materials
      if (!effectiveMaterialQuery) return base
      const q = effectiveMaterialQuery.toLowerCase()
      // All three axes, under the names the UI now uses everywhere: the device
      // itself, its Typ ("alle Sägen") and its Standort ("alles auf dem Pio").
      // Only the second question could be asked before, and the column asking
      // it was headed «Kategorie».
      return base.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.type.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
      )
    },
    [materials, effectiveMaterialQuery, materialsAvailableOnly]
  )

  const groupedMaterials = useMemo(
    () => {
      const groups: Record<string, Material[]> = {}
      for (const material of filteredMaterials) {
        const key = material.category || 'Sonstige'
        if (!groups[key]) groups[key] = []
        groups[key].push(material)
      }
      return groups
    },
    [filteredMaterials]
  )

  return {
    filteredPersonnel,
    filteredMaterials,
    groupedMaterials,
  }
}
