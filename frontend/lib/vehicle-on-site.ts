/**
 * Is a vehicle standing at this Schadenplatz? The board's copy of the server's rule
 * (`backend crud.feld.vehicle_on_site`, owner round 23.11.2026, #7).
 *
 * On site = one of the Einsatz's own vehicles whose driver is NOT «kehrt zurück», or
 * any vehicle of its Auftrag – a route vehicle travels with the crew, and its stay
 * flag is not a decision anybody made (`FeldVehicleLine.stays`). While one is there,
 * nobody has to fetch the crew: «Abholung nötig» is not offered (and the server
 * refuses it), and moving to Rückfahrt needs no «Kein Fahrzeug» question.
 *
 * An own vehicle whose assign POST has not answered yet (`driverStay` undefined)
 * does not count: the server's default for it is «kehrt zurück».
 */

import type { Operation, OperationVehicle } from '@/lib/contexts/operations/types'
import type { GroupResources, IncidentGroup } from '@/lib/types/groups'
import { findAuftragForStop } from '@/lib/kanban-utils'

/** The name of a vehicle on site, or null. Own vehicles first, then the route's. */
export function vehicleOnSite(
  vehicles: readonly Pick<OperationVehicle, 'name' | 'driverStay'>[],
  routeVehicles: readonly { name: string }[] = [],
): string | null {
  return vehicles.find((vehicle) => vehicle.driverStay === true)?.name ?? routeVehicles[0]?.name ?? null
}

/** `vehicleOnSite` for a card, its route resolved the way the status workflow does
 *  (`findAuftragForStop`: a stop's own groupId lags a stop that was just added). */
export function operationVehicleOnSite(
  operation: Pick<Operation, 'id' | 'groupId' | 'vehicles'>,
  groups: IncidentGroup[],
  getGroupResources: (groupId: string) => GroupResources,
): string | null {
  const auftrag = findAuftragForStop(groups, operation)
  return vehicleOnSite(operation.vehicles, auftrag ? getGroupResources(auftrag.id).vehicles : [])
}
