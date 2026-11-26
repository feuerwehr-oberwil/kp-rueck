"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { useOperations, type Person, type Material } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { getIncidentRefLabel, getIncidentRefParts } from "@/lib/incident-types"
import type { OccupancyLabel } from "@/components/kanban/assignment-list-section"

/**
 * One place a resource is currently held, with enough to RELEASE it again.
 *
 * The dialog used to keep only a display label per resource, which is why its
 * own «Doppelbelegung?» could not offer «Verschieben» — it had no idea which
 * incident to take the person off. `id` is an incident id for `kind: 'incident'`
 * and an Auftrag id for `kind: 'route'`; a route release additionally needs the
 * group-assignment id.
 */
export type Binding = OccupancyLabel & {
  kind: 'incident' | 'route'
  id: string
  assignmentId?: string
}

/**
 * Where each resource is held OUTSIDE the target of `ResourceAssignmentDialog`: the bindings
 * its Doppelbelegung prompt releases, and the amber where-note each tile shows. The dialog
 * calls it once per render with its target and its props.
 */
export function useAssignmentOccupancy({
  assignTarget,
  operationId,
  materials,
  assignedPersonnelIds,
  assignedVehicleIds,
  assignedMaterials,
  occupiedPersonnelIds,
  occupiedVehicleIds,
  occupiedMaterialIds,
}: {
  assignTarget: 'incident' | 'route'
  operationId: string | null
  materials: Material[]
  assignedPersonnelIds: string[]
  assignedVehicleIds: string[]
  assignedMaterials: string[]
  occupiedPersonnelIds: Set<string>
  occupiedVehicleIds: Set<string>
  occupiedMaterialIds: Set<string>
}) {
  const t = useTranslations('kanban')
  const { operations } = useOperations()
  const { groups, getGroupResources } = useGroups()

  // EVERY place an occupied vehicle/material/person is currently held, resolved
  // from the operations + Auftrag contexts (no prop threading): vehicle id →
  // bindings, material id → bindings, person id → bindings. Each binding carries the card's
  // two lines (`head` = number · address, `detail` = type and Meldung – the note's CSS
  // clamps them), an untruncated `full` for the hover title, and what is needed to release it.
  // The current assign target never counts as "elsewhere" — note operationId
  // holds the GROUP id when assignTarget === 'route'.
  //
  // A LIST, not a single entry: a resource can stand on two Schadenplätze and a
  // route at once, and «Jetzt verschieben» has to release all of them.
  const { vehicleOccupancy, materialOccupancy, personOccupancy } = useMemo(() => {
    const vehicleMap = new Map<string, Binding[]>()
    const materialMap = new Map<string, Binding[]>()
    const personMap = new Map<string, Binding[]>()
    const push = (map: Map<string, Binding[]>, key: string, binding: Binding) => {
      const existing = map.get(key)
      if (existing) existing.push(binding)
      else map.set(key, [binding])
    }
    for (const op of operations) {
      if (assignTarget === 'incident' && op.id === operationId) continue
      const label = { ...getIncidentRefParts(op, 1000), full: getIncidentRefLabel(op, 1000) }
      for (const v of op.vehicles) push(vehicleMap, v.vehicleId, { ...label, kind: 'incident', id: op.id })
      for (const id of op.materials) push(materialMap, id, { ...label, kind: 'incident', id: op.id })
      for (const m of op.crew) push(personMap, m.personnelId, { ...label, kind: 'incident', id: op.id })
    }
    for (const group of groups) {
      if (assignTarget === 'route' && group.id === operationId) continue
      const res = getGroupResources(group.id)
      const label = { head: group.name, full: group.name, swatch: group.color ?? null }
      for (const v of res.vehicles) push(vehicleMap, v.resourceId, { ...label, kind: 'route', id: group.id, assignmentId: v.assignmentId })
      for (const m of res.materials) push(materialMap, m.resourceId, { ...label, kind: 'route', id: group.id, assignmentId: m.assignmentId })
      for (const p of res.personnel) push(personMap, p.resourceId, { ...label, kind: 'route', id: group.id, assignmentId: p.assignmentId })
    }
    return { vehicleOccupancy: vehicleMap, materialOccupancy: materialMap, personOccupancy: personMap }
  }, [operations, groups, getGroupResources, assignTarget, operationId])

  // Materials bound to ANOTHER incident/Auftrag (never the current target —
  // anything in assignedMaterials is "here"). Status doubles as a fallback flag
  // for occupancy we can't resolve to a concrete incident/route.
  const occupiedElsewhereMaterialIds = useMemo(() => {
    const set = new Set<string>()
    for (const m of materials) {
      // Verbrauchsmaterial has no stock limit – being on another incident says
      // nothing about this one, so no amber flag and no double-booking confirm.
      if (m.consumable) continue
      if (assignedMaterials.includes(m.id)) continue
      if (materialOccupancy.has(m.id) || occupiedMaterialIds.has(m.id) || m.status === 'assigned') set.add(m.id)
    }
    return set
  }, [materials, assignedMaterials, materialOccupancy, occupiedMaterialIds])

  // Where a vehicle/material/person is bound elsewhere ("Im Einsatz" when the
  // exact spot can't be resolved), or null when it's free or already on this
  // target.
  const genericElsewhereLabel = (): OccupancyLabel => {
    const generic = t('assignmentDialog.occupiedElsewhere')
    return { head: generic, full: generic }
  }
  const vehicleElsewhereLabel = (vehicle: { id: string; name: string }): OccupancyLabel | null => {
    if (assignedVehicleIds.includes(vehicle.id)) return null
    const placed = vehicleOccupancy.get(vehicle.id)?.[0]
    if (placed) return placed
    if (occupiedVehicleIds.has(vehicle.id)) return genericElsewhereLabel()
    return null
  }
  const materialElsewhereLabel = (material: Material): OccupancyLabel | null => {
    if (!occupiedElsewhereMaterialIds.has(material.id)) return null
    return materialOccupancy.get(material.id)?.[0] ?? genericElsewhereLabel()
  }
  const personElsewhereLabel = (person: Person): OccupancyLabel | null => {
    if (assignedPersonnelIds.includes(person.id)) return null
    const placed = personOccupancy.get(person.id)?.[0]
    if (placed) return placed
    // Deliberately NOT falling back on `status === 'assigned'`: the context sets
    // that flag for special-function people too (Fahrer, Telefondienst, …), and
    // the generic «Im Einsatz» next to their function badge claimed an incident
    // that does not exist. If somebody IS on an incident or Auftrag, the two
    // lookups above name it (short address / route name).
    if (occupiedPersonnelIds.has(person.id)) return genericElsewhereLabel()
    return null
  }

  return {
    materialOccupancy,
    personOccupancy,
    occupiedElsewhereMaterialIds,
    vehicleElsewhereLabel,
    materialElsewhereLabel,
    personElsewhereLabel,
  }
}
