import { useMemo } from 'react'
import type { Person, Material, PersonRole } from '@/lib/contexts/operations-context'

/**
 * Shared hook for filtering and grouping personnel and materials
 * Used across Kanban, Map, and Combined views
 */
export function useResourceFiltering(
  personnel: Person[],
  materials: Material[],
  personnelSearchQuery: string,
  materialSearchQuery: string
) {
  const filteredPersonnel = useMemo(
    () => personnel.filter((p) =>
      p.name.toLowerCase().includes(personnelSearchQuery.toLowerCase()) ||
      p.role.toLowerCase().includes(personnelSearchQuery.toLowerCase())
    ),
    [personnel, personnelSearchQuery]
  )

  const filteredMaterials = useMemo(
    () => materials.filter((m) =>
      m.name.toLowerCase().includes(materialSearchQuery.toLowerCase()) ||
      m.category.toLowerCase().includes(materialSearchQuery.toLowerCase())
    ),
    [materials, materialSearchQuery]
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
    () => filteredMaterials.reduce(
      (acc, material) => {
        if (!acc[material.category]) acc[material.category] = []
        acc[material.category].push(material)
        return acc
      },
      {} as Record<string, Material[]>
    ),
    [filteredMaterials]
  )

  return {
    filteredPersonnel,
    filteredMaterials,
    groupedPersonnel,
    groupedMaterials,
  }
}
