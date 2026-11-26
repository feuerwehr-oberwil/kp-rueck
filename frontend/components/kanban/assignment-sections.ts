"use client"

import { useTranslations } from "next-intl"
import { type Person, type Material } from "@/lib/contexts/operations-context"
import { isPersonOccupied, materialResourceState } from "@/lib/resource-status"
import type { OccupancyLabel } from "@/components/kanban/assignment-list-section"
import type { AssignmentFilters, AssignmentResource } from "@/components/kanban/assignment-filters"
import type { AssignableVehicle } from "@/components/kanban/vehicle-assignment-list"

/**
 * Free first, spoken-for underneath — the dialog's answer to "wen kann ich
 * nehmen".
 *
 * An occupied row was already amber-flagged, and that was the whole of it: the
 * flagged rows sat scattered through the grid, so finding three free people in
 * a roster of forty meant reading all forty. Sinking them under a heading
 * turns that into one eye movement. The rows themselves are neutral tiles now;
 * the small amber note (icon + text) that says *where* somebody is stays.
 *
 * Nothing is hidden and nothing is disabled — the bottom block is still
 * clickable and still opens the Doppelbelegung confirm. This orders the list;
 * it does not take a decision away from the operator.
 *
 * "Busy" is exactly what the row's amber note names: bound to another
 * Schadenplatz or Auftrag, or holding an Ereignis role (a Reko trupp, the
 * TLF 1's driver). A resource on THIS target is never busy — it is selected.
 *
 * Module groups stay whole and stay on top: a module is a unit, and splitting
 * its contents across two headings would be a worse lie than the scatter this
 * fixes. Occupied items inside an expanded module keep the amber note.
 *
 * `ResourceAssignmentDialog` calls it once per render with the filtered lists of
 * `useAssignmentFilters`; the lists draw the blocks, the 1–9 keys count `ordered`.
 * `allBusyText` is the line for a list with no free entry, else null.
 */
export function useAssignmentSections({
  resourceType,
  filters: { sortedFilteredPersonnel, filteredVehicles, groupedFilteredMaterials, emptyReason, query },
  assignedPersonnelIds,
  isVehicleAssigned,
  vehicleElsewhereLabel,
  occupiedElsewhereMaterialIds,
  isMaterialSelected,
}: {
  resourceType: AssignmentResource | null
  filters: AssignmentFilters
  assignedPersonnelIds: string[]
  isVehicleAssigned: (vehicleId: string) => boolean
  vehicleElsewhereLabel: (vehicle: AssignableVehicle) => OccupancyLabel | null
  occupiedElsewhereMaterialIds: Set<string>
  isMaterialSelected: (materialId: string) => boolean
}) {
  const t = useTranslations('kanban')
  const tEmpty = useTranslations('common.emptyState')

  const crewSections = (() => {
    const free: Person[] = []
    const busy: Person[] = []
    for (const person of sortedFilteredPersonnel) {
      // `isPersonOccupied` — the SAME predicate the sidebar list is filtered
      // with and the same one its «N frei» footer counts, so the dialog and the
      // roster two panels away can never disagree about who is available.
      //
      // A standing Ereignis function counts as busy: a Magaziner, a
      // Telefondienst or the TLF's Fahrer is doing a job, and «frei» has to mean
      // «kann ich losschicken». It is a sorting decision, not a gate — the block
      // stays clickable and taking somebody out of it still asks first.
      //
      // EXCEPT on THIS target, which is never «busy» — it is selected. Somebody
      // already on this Einsatz is `status: "assigned"` like anyone else, so
      // without this they sank under «Bereits im Einsatz» and the dialog hid the
      // crew it was opened to edit. `assignedPersonnelIds`, not the live checkbox
      // set: ticking somebody must not make their row jump between blocks under
      // the pointer.
      const onThisTarget = assignedPersonnelIds.includes(person.id)
      ;(!onThisTarget && isPersonOccupied(person) ? busy : free).push(person)
    }
    return { free, busy, ordered: [...free, ...busy] }
  })()

  const vehicleSections = (() => {
    const free: typeof filteredVehicles = []
    const busy: typeof filteredVehicles = []
    for (const vehicle of filteredVehicles) {
      // «Nicht einsatzbereit» is not free. It sinks with the spoken-for block so
      // «4 frei» over the grid keeps meaning what it says.
      const spokenFor = !!vehicleElsewhereLabel(vehicle) || (!!vehicle.outOfService && !isVehicleAssigned(vehicle.id))
      ;(spokenFor ? busy : free).push(vehicle)
    }
    return { free, busy, ordered: [...free, ...busy] }
  })()

  const ungroupedMaterialSections = (() => {
    const free: Material[] = []
    const busy: Material[] = []
    for (const material of groupedFilteredMaterials.ungrouped) {
      const spokenFor =
        occupiedElsewhereMaterialIds.has(material.id) ||
        (materialResourceState(material) === 'unavailable' && !isMaterialSelected(material.id))
      ;(spokenFor ? busy : free).push(material)
    }
    return { free, busy }
  })()

  // (d) Everything there is, is taken: the list is NOT empty — the spoken-for
  // block still lists them and stays clickable — so this is a line where the
  // free block would be, not a replacement for the list.
  const allBusy =
    emptyReason === null &&
    (resourceType === 'crew'
      ? crewSections.free.length === 0 && crewSections.busy.length > 0
      : resourceType === 'vehicles'
        ? vehicleSections.free.length === 0 && vehicleSections.busy.length > 0
        : resourceType === 'materials'
          ? groupedFilteredMaterials.groups.length === 0 &&
            ungroupedMaterialSections.free.length === 0 &&
            ungroupedMaterialSections.busy.length > 0
          : false)
  // With a search, «Niemand ist frei» is wrong when free ones only do not match it (sign-off
  // 24.11.2026): the line says the search found no free one.
  const allBusyText = !allBusy ? null
    : query ? tEmpty('noHitsFor', { query })
    : resourceType === 'crew' ? t('assignmentDialog.allBusyCrew')
      : resourceType === 'vehicles' ? t('assignmentDialog.allBusyVehicles')
        : t('assignmentDialog.allBusyMaterials')

  return { crewSections, vehicleSections, ungroupedMaterialSections, allBusyText }
}
