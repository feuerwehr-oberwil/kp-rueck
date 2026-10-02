/**
 * Release undo — «<Ressource> von <Einsatz> gelöst · Rückgängig».
 *
 * A mis-tap on a small chip used to mean finding the resource in the sidebar
 * and assigning it again. Now every deliberate release (crew, vehicle,
 * material, a route stop, a route-owned resource) offers a one-shot undo.
 *
 * The undo is a NEW assignment through the ordinary assign functions — never a
 * snapshot restore — so it runs every check an assignment runs (availability,
 * «nicht einsatzbereit», permissions and conflicts on the server). Before it
 * tries, `checkRestore` looks at the CURRENT board: if another device has put
 * the resource somewhere else meanwhile, the undo does not move it back (that
 * would undo somebody's newer work) and says where it is instead.
 *
 * Completing an Einsatz releases many resources at once and has its own flow;
 * it does not come through here.
 */

export type Released =
  | { kind: "personnel"; operationId: string; personId: string; name: string; targetLabel: string }
  | { kind: "material"; operationId: string; materialId: string; name: string; targetLabel: string }
  | { kind: "vehicle"; operationId: string; vehicleId: string; name: string; targetLabel: string }
  | {
      kind: "stop"
      groupId: string
      incidentId: string
      name: string
      targetLabel: string
      /** Where in the route it was, to put it back there (best effort). */
      position?: number
    }
  | {
      kind: "routeResource"
      groupId: string
      resourceType: "personnel" | "vehicle" | "material"
      resourceId: string
      name: string
      targetLabel: string
    }

/** The slice of board state the check reads (structural, so tests can build it by hand). */
export interface RestoreState {
  operations: readonly {
    id: string
    status: string
    crew: readonly string[]
    vehicles: readonly string[]
    materials: readonly string[]
    groupId: string | null
  }[]
  groups: readonly {
    id: string
    name: string
    stopIds: readonly string[]
    assignments: readonly { resourceType: string; resourceId: string }[]
  }[]
  personnel: readonly { id: string; name: string; status: string }[]
  materials: readonly { id: string; consumable: boolean; outOfService: boolean }[]
  outOfServiceVehicleIds: ReadonlySet<string>
  /** Short label of an incident for «inzwischen bei …». */
  labelOf: (operationId: string) => string
}

export type RestoreBlock =
  | { reason: "targetGone" }
  | { reason: "targetClosed" }
  | { reason: "alreadyBack" }
  | { reason: "elsewhere"; where: string }
  | { reason: "outOfService" }
  | { reason: "resourceGone" }
  | { reason: "unavailable" }

const CLOSED = new Set(["complete"])

/** Why the undo cannot (or need not) re-assign, or null when it may try. */
export function checkRestore(released: Released, state: RestoreState): RestoreBlock | null {
  if (released.kind === "stop" || released.kind === "routeResource") {
    const group = state.groups.find((g) => g.id === released.groupId)
    if (!group) return { reason: "targetGone" }

    if (released.kind === "stop") {
      const op = state.operations.find((o) => o.id === released.incidentId)
      if (!op) return { reason: "resourceGone" }
      if (group.stopIds.includes(released.incidentId) || op.groupId === released.groupId) return { reason: "alreadyBack" }
      const other = op.groupId ? state.groups.find((g) => g.id === op.groupId) : undefined
      if (other) return { reason: "elsewhere", where: other.name }
      return null
    }

    const { resourceType, resourceId } = released
    if (group.assignments.some((a) => a.resourceType === resourceType && a.resourceId === resourceId)) {
      return { reason: "alreadyBack" }
    }
    if (resourceType === "vehicle" && state.outOfServiceVehicleIds.has(resourceId)) return { reason: "outOfService" }
    if (resourceType === "material") {
      const material = state.materials.find((m) => m.id === resourceId)
      if (!material) return { reason: "resourceGone" }
      if (material.outOfService) return { reason: "outOfService" }
      if (material.consumable) return null
    }
    const otherRoute = state.groups.find(
      (g) => g.id !== group.id && g.assignments.some((a) => a.resourceType === resourceType && a.resourceId === resourceId),
    )
    if (otherRoute) return { reason: "elsewhere", where: otherRoute.name }
    return null
  }

  const op = state.operations.find((o) => o.id === released.operationId)
  if (!op) return { reason: "targetGone" }
  if (CLOSED.has(op.status)) return { reason: "targetClosed" }

  const elsewhere = (holds: (o: RestoreState["operations"][number]) => boolean): RestoreBlock | null => {
    const holder = state.operations.find((o) => o.id !== op.id && !CLOSED.has(o.status) && holds(o))
    return holder ? { reason: "elsewhere", where: state.labelOf(holder.id) } : null
  }

  switch (released.kind) {
    case "personnel": {
      if (op.crew.includes(released.name)) return { reason: "alreadyBack" }
      const person = state.personnel.find((p) => p.id === released.personId)
      if (!person) return { reason: "resourceGone" }
      if (person.status === "unavailable") return { reason: "unavailable" }
      return elsewhere((o) => o.crew.includes(released.name))
    }
    case "vehicle": {
      if (op.vehicles.includes(released.name)) return { reason: "alreadyBack" }
      if (state.outOfServiceVehicleIds.has(released.vehicleId)) return { reason: "outOfService" }
      return elsewhere((o) => o.vehicles.includes(released.name))
    }
    case "material": {
      if (op.materials.includes(released.materialId)) return { reason: "alreadyBack" }
      const material = state.materials.find((m) => m.id === released.materialId)
      if (!material) return { reason: "resourceGone" }
      if (material.outOfService) return { reason: "outOfService" }
      // A consumable is drawn by several incidents at once — never a conflict.
      if (material.consumable) return null
      return elsewhere((o) => o.materials.includes(released.materialId))
    }
  }
}
