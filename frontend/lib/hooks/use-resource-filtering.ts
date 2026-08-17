import { useMemo } from 'react'
import type { Person, Material, PersonRole } from '@/lib/contexts/operations-context'
import { isPersonOccupied, materialResourceState } from '@/lib/resource-status'
import { compareByRankThenName } from '@/lib/roster-order'

/**
 * Shared hook for filtering and grouping personnel and materials
 * Used across Kanban, Map, and Combined views
 */
export function useResourceFiltering(
  personnel: Person[],
  materials: Material[],
  personnelQuery: string,
  materialQuery?: string,
  /** Group label for personnel without a role (e.g. quick-added walk-ins). */
  roleFallbackLabel: string = 'Andere',
  /** Sidebar toggles: drop everything that is currently tied up. Availability is
   *  read exactly as the cards draw it — `isPersonOccupied` counts Fahrer/Reko/
   *  Magazin as busy, consumables always count as available. */
  availableOnly: { personnel?: boolean; materials?: boolean } = {},
) {
  const effectiveMaterialQuery = materialQuery ?? personnelQuery
  const personnelAvailableOnly = !!availableOnly.personnel
  const materialsAvailableOnly = !!availableOnly.materials

  const filteredPersonnel = useMemo(
    () => {
      const base = personnelAvailableOnly
        ? personnel.filter((p) => !isPersonOccupied(p))
        : personnel
      if (!personnelQuery) return base
      const q = personnelQuery.toLowerCase()
      return base.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        // role is null for quick-added people — don't crash the search
        (!!p.role && p.role.toLowerCase().includes(q)) ||
        (p.isReko && 'reko'.includes(q)) ||
        (p.isDriver && ('fahrer'.includes(q) || 'driver'.includes(q))) ||
        (p.driverVehicleName && p.driverVehicleName.toLowerCase().includes(q)) ||
        (p.isMagazin && 'magazin'.includes(q)) ||
        (p.tags && p.tags.some(t => t.toLowerCase().includes(q)))
      )
    },
    [personnel, personnelQuery, personnelAvailableOnly]
  )

  const filteredMaterials = useMemo(
    () => {
      const base = materialsAvailableOnly
        ? materials.filter((m) => materialResourceState(m) === 'available')
        : materials
      if (!effectiveMaterialQuery) return base
      const q = effectiveMaterialQuery.toLowerCase()
      return base.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
      )
    },
    [materials, effectiveMaterialQuery, materialsAvailableOnly]
  )

  /**
   * Grouped by Grad, in the station's own order, alphabetical inside a group.
   *
   * This used to be a bare `reduce`: both the group order and the order inside
   * each group were whatever the API happened to return — which is the DATABASE
   * collation, not `de-CH`. The crew sidebar and the assignment dialog then
   * showed the same roster in two different orders on the same screen, and an
   * Ö or an ä landed in a different place in each.
   */
  const groupedPersonnel = useMemo(
    () => {
      const ranked = [...filteredPersonnel].sort(compareByRankThenName)
      return ranked.reduce(
        (acc, person) => {
          // Fall back to a labelled group so a null role never renders as "null".
          const key = person.role || roleFallbackLabel
          if (!acc[key]) acc[key] = []
          acc[key].push(person)
          return acc
        },
        {} as Record<PersonRole, Person[]>
      )
    },
    [filteredPersonnel, roleFallbackLabel]
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
    groupedPersonnel,
    groupedMaterials,
  }
}
