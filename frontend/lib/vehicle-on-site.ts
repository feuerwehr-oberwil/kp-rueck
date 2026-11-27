/**
 * Is a vehicle standing at this Schadenplatz? The board's copy of the server's rule
 * (`backend crud.feld.vehicle_on_site`, owner round 23.11.2026, #7).
 *
 * On site = one of the Einsatz's own vehicles whose driver is NOT «kehrt zurück», or
 * any vehicle of its Auftrag – a route vehicle travels with the crew, and its stay
 * flag is not a decision anybody made (`FeldVehicleLine.stays`). While one is there,
 * the crew most likely drives back itself: the KP «Abholung nötig» row names the
 * vehicle (a hint, never a lock – the pill may be wrong), and moving to Rückfahrt
 * needs no «Kein Fahrzeug» question.
 *
 * An own vehicle whose assign POST has not answered yet (`driverStay` undefined)
 * does not count: the server's default for it is «kehrt zurück».
 */

import type { Operation } from '@/lib/contexts/operations/types'

/** The name of a vehicle on site, or null. Own vehicles first, then the route's. */
export function vehicleOnSite(operation: Pick<Operation, 'vehicles' | 'auftragResources'>): string | null {
  return (
    operation.vehicles.find((vehicle) => vehicle.driverStay === true)?.name ??
    operation.auftragResources?.vehicles[0]?.name ??
    null
  )
}
