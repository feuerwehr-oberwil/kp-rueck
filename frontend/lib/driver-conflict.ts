/**
 * Where a person's Fahrer role puts them, for the Doppelbelegung prompt.
 *
 * The driver role is Ereignis-wide (one vehicle per person), not an incident
 * assignment, but the person is wherever that vehicle stands – the 2× marker
 * (`computeDoubleBookedPersons`) has counted it that way for a while. The prompt
 * did not: «Hierher verschieben» took the person off the crew and left them
 * driving the Mowa on the old Einsatz, still 2×. The prompt names that row
 * («fährt Mowa») and the move releases the role too.
 *
 * Read by `ResourceConflictPrompt` (the row) and the conflict resolution in
 * `resource-actions.ts` (the release), so both answer from the same state.
 */

interface DrivingPerson {
  id: string
  isDriver?: boolean
  driverVehicleId?: string
  driverVehicleName?: string
}

interface PlacedOperation {
  id: string
  vehicles: readonly { vehicleId: string }[]
}

export interface DrivenElsewhere {
  vehicleId: string
  vehicleName: string
  /** The Einsatz the driven vehicle stands on. */
  operationId: string
}

/** The Einsatz – other than `targetOperationId` – where the vehicle this person drives stands, or null. */
export function drivenElsewhere(
  person: DrivingPerson | undefined,
  operations: readonly PlacedOperation[],
  targetOperationId: string,
): DrivenElsewhere | null {
  if (!person?.isDriver || !person.driverVehicleId || !person.driverVehicleName) return null
  const { driverVehicleId: vehicleId, driverVehicleName: vehicleName } = person
  const op = operations.find((o) => o.vehicles.some((v) => v.vehicleId === vehicleId))
  if (!op || op.id === targetOperationId) return null
  return { vehicleId, vehicleName, operationId: op.id }
}
