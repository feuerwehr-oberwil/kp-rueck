import type { CrewMember, OperationVehicle } from "@/lib/contexts/operations-context"

/** A crew row for an `Operation` fixture. The ids derive from the name unless
 *  given — pass `personnelId` to build two people who share a name. */
export function crewMember(name: string, personnelId = `p-${name}`): CrewMember {
  return { personnelId, assignmentId: `a-${personnelId}`, name }
}

/** A vehicle row for an `Operation` fixture; ids derive from the name unless overridden. */
export function assignedVehicle(name: string, overrides: Partial<OperationVehicle> = {}): OperationVehicle {
  const vehicleId = overrides.vehicleId ?? `v-${name}`
  return { vehicleId, assignmentId: `a-${vehicleId}`, name, callsign: null, ...overrides }
}
