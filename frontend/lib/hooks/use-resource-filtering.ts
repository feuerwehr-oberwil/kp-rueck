import { useMemo } from 'react'
import type { Person, Material, PersonRole } from '@/lib/contexts/operations-context'

/**
 * Shared hook for filtering and grouping personnel and materials
 * Used across Kanban, Map, and Combined views
 */
export function useResourceFiltering(
  personnel: Person[],
  materials: Material[],
  personnelQuery: string,
  materialQuery?: string
) {
  const effectiveMaterialQuery = materialQuery ?? personnelQuery

  const filteredPersonnel = useMemo(
    () => {
      if (!personnelQuery) return personnel
      const q = personnelQuery.toLowerCase()
      return personnel.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q) ||
        (p.isReko && 'reko'.includes(q)) ||
        (p.isDriver && ('fahrer'.includes(q) || 'driver'.includes(q))) ||
        (p.driverVehicleName && p.driverVehicleName.toLowerCase().includes(q)) ||
        (p.isMagazin && 'magazin'.includes(q)) ||
        (p.tags && p.tags.some(t => t.toLowerCase().includes(q)))
      )
    },
    [personnel, personnelQuery]
  )

  const filteredMaterials = useMemo(
    () => {
      if (!effectiveMaterialQuery) return materials
      const q = effectiveMaterialQuery.toLowerCase()
      return materials.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
      )
    },
    [materials, effectiveMaterialQuery]
  )

  const groupedPersonnel = useMemo(
    () => filteredPersonnel.reduce(
      (acc, person) => {
        if (!acc[person.role]) acc[person.role] = []
        acc[person.role].push(person)
        return acc
      },
      {} as Record<PersonRole, Person[]>
    ),
    [filteredPersonnel]
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
