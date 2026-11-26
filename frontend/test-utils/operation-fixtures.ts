import type { CrewMember, Operation, OperationVehicle } from "@/lib/contexts/operations-context"

/** A complete board `Operation` for a test, as the board load makes a fresh incident;
 *  pass only what the test is about. Every required field has its default here, so a
 *  new required field on `Operation` fails to compile in this one place. */
export function makeOperation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "op-1",
    number: null,
    location: "Dorfstrasse 1",
    vehicles: [],
    incidentType: "elementarereignis",
    dispatchTime: new Date("2026-11-25T20:00:00"),
    crew: [],
    priority: "medium",
    status: "incoming",
    coordinates: null,
    materials: [],
    notes: "",
    contact: "",
    contactPhone: "",
    internalNotes: "",
    nachbarhilfe: false,
    nachbarhilfeNote: "",
    amWarten: false,
    amWartenNote: "",
    zuFuss: false,
    groupId: null,
    groupPosition: 0,
    statusChangedAt: null,
    hasCompletedReko: false,
    rekoArrivedAt: null,
    rekoSummary: null,
    assignedReko: null,
    leaderId: null,
    leaderName: null,
    materialAssignments: new Map(),
    ...overrides,
  }
}

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
