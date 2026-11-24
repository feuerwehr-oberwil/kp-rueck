import { useMemo } from 'react'
import type { Person, Material } from '@/lib/contexts/operations-context'
import type { PersonPlaces } from '@/lib/person-places'
import { personMatchesQuery } from '@/lib/resource-status'

/**
 * The board's search over personnel and materials. Each sidebar filters, groups and sorts
 * what it leaves itself (`lib/personnel-view.ts`, `lib/material-view.ts`).
 */
export function useResourceFiltering(
  personnel: Person[],
  materials: Material[],
  personnelQuery: string,
  materialQuery?: string,
  /** Where each person is bound now (`usePersonPlaces`), so the search finds «12» or «Sturmholz». */
  places?: ReadonlyMap<string, PersonPlaces>,
) {
  const effectiveMaterialQuery = materialQuery ?? personnelQuery

  const filteredPersonnel = useMemo(
    () => {
      if (!personnelQuery) return personnel
      // Shared matcher (name / rank / tags / special functions incl.
      // Telefondienst + Kommandoposten / current place) — see lib/resource-status.ts.
      return personnel.filter((p) => personMatchesQuery({ ...p, places: places?.get(p.id) }, personnelQuery))
    },
    [personnel, personnelQuery, places]
  )

  const filteredMaterials = useMemo(
    () => {
      if (!effectiveMaterialQuery) return materials
      const q = effectiveMaterialQuery.toLowerCase()
      // All three axes, under the names the UI now uses everywhere: the device
      // itself, its Typ ("alle Sägen") and its Standort ("alles auf dem Pio").
      // Only the second question could be asked before, and the column asking
      // it was headed «Kategorie».
      return materials.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.type.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
      )
    },
    [materials, effectiveMaterialQuery]
  )

  return {
    filteredPersonnel,
    filteredMaterials,
  }
}
