/**
 * One board load, reconciled: the fetched incidents, roster, depot, fleet,
 * special functions, assignments, Reko summaries and Aufträge of ONE Ereignis
 * turned into the cards, the event-scoped roster, the material deployment and
 * the routes the board draws. `deriveAuftragState` then reads what the routes
 * mean for the rest of the board – on every state change, not only per load,
 * because the Auftrag actions write the routes optimistically.
 *
 * Pure — no fetches, no refs, no state. Moved out of the provider's
 * `loadData` verbatim (2026-09-23): the fetches, the stale-load and
 * mutation-epoch checks and the module-level mirrors stay in the provider,
 * in the order they always ran; only the transform between them lives here.
 */

import type {
  ApiAssignment,
  ApiEventRekoSummariesResponse,
  ApiEventSpecialFunctionResponse,
  ApiIncident,
  ApiIncidentGroup,
  ApiVehicle,
} from "@/lib/api-client"
import type { GroupResourceType, GroupResources, IncidentGroup } from "@/lib/types/groups"
import type { Material, Operation, Person, PersonStatus } from "../operations-context"
import { apiIncidentGroupToGroup, apiIncidentToOperation, rekoDangerTypes } from "./mapping"

/** What one board load fetched, as `loadData` hands it over. */
export interface EventSnapshot {
  apiIncidents: ApiIncident[]
  personnelList: Person[]
  materialsList: Material[]
  vehiclesList: ApiVehicle[]
  specialFunctions: ApiEventSpecialFunctionResponse[]
  assignmentsByIncident: Record<string, ApiAssignment[]>
  rekoSummaries: ApiEventRekoSummariesResponse
  apiGroups: ApiIncidentGroup[]
}

export interface EventState {
  ops: Operation[]
  eventScopedPersonnel: Person[]
  eventScopedMaterials: Material[]
  /** The Aufträge, in `position` order. */
  groups: IncidentGroup[]
}

export function buildEventState({
  apiIncidents,
  personnelList,
  materialsList,
  vehiclesList,
  specialFunctions,
  assignmentsByIncident,
  rekoSummaries,
  apiGroups,
}: EventSnapshot): EventState {
  const ops = apiIncidents.map(apiIncidentToOperation)

  const rekoPersonnelIds = new Set<string>()
  const driverPersonnelIds = new Map<string, { vehicleId: string; vehicleName: string }>()
  const magazinPersonnelIds = new Set<string>()
  const telefondienstPersonnelIds = new Set<string>()
  const kommandopostenPersonnelIds = new Set<string>()
  const assignedPersonIds = new Set<string>()
  const assignedMaterialIds = new Set<string>()

  // Process special functions (single fetch, used for both reko filtering and availability)
  for (const func of specialFunctions) {
    if (func.function_type === 'reko') rekoPersonnelIds.add(func.personnel_id)
    else if (func.function_type === 'driver') {
      driverPersonnelIds.set(func.personnel_id, { vehicleId: func.vehicle_id || '', vehicleName: func.vehicle_name || '' })
      assignedPersonIds.add(func.personnel_id)
    } else if (func.function_type === 'magazin') {
      magazinPersonnelIds.add(func.personnel_id)
      assignedPersonIds.add(func.personnel_id)
    } else if (func.function_type === 'telefondienst') {
      telefondienstPersonnelIds.add(func.personnel_id)
      assignedPersonIds.add(func.personnel_id)
    } else if (func.function_type === 'kommandoposten') {
      kommandopostenPersonnelIds.add(func.personnel_id)
      assignedPersonIds.add(func.personnel_id)
    } else {
      assignedPersonIds.add(func.personnel_id)
    }
  }

  // Process assignments. Identity is the resource id throughout — two people
  // (or vehicles) may share a name, and both must show as assigned.
  const personById = new Map(personnelList.map(p => [p.id, p]))
  const vehicleById = new Map(vehiclesList.map(v => [v.id, v]))
  ops.forEach((operation) => {
    const assignments = assignmentsByIncident[operation.id] || []
    for (const assignment of assignments) {
      if (assignment.resource_type === "personnel") {
        const person = personById.get(assignment.resource_id)
        if (person) {
          if (rekoPersonnelIds.has(person.id)) {
            // Every row of a Reko-function person is drawn as their Reko – a crew row too.
            // The row and its persisted purpose go along, so a release names exactly it.
            operation.assignedReko = {
              id: person.id,
              name: person.name,
              assignmentId: assignment.id,
              purpose: assignment.purpose ?? "crew",
            }
            operation.rekoPosition = assignment.reko_position ?? null
            continue
          }
          operation.crew.push({ personnelId: person.id, assignmentId: assignment.id, name: person.name })
          assignedPersonIds.add(person.id)
          if (assignment.is_leader) {
            operation.leaderId = person.id
            operation.leaderName = person.name
          }
        }
      } else if (assignment.resource_type === "material") {
        operation.materials.push(assignment.resource_id)
        operation.materialAssignments.set(assignment.resource_id, assignment.id)
        assignedMaterialIds.add(assignment.resource_id)
      } else if (assignment.resource_type === "vehicle") {
        const vehicle = vehicleById.get(assignment.resource_id)
        if (vehicle) {
          operation.vehicles.push({
            vehicleId: vehicle.id,
            assignmentId: assignment.id,
            name: vehicle.name,
            callsign: vehicle.radio_call_sign || null,
            driverStay: assignment.driver_stay || false,
          })
        }
      }
    }
  })

  // Show vehicles in their configured display order everywhere (radio text,
  // Divera/WhatsApp messages, cards) instead of assignment order.
  {
    const vehicleOrder = new Map(vehiclesList.map(v => [v.id, v.display_order]))
    ops.forEach(op => op.vehicles.sort((a, b) => (vehicleOrder.get(a.vehicleId) ?? 0) - (vehicleOrder.get(b.vehicleId) ?? 0)))
  }

  // Process reko summaries
  ops.forEach(op => {
    const summary = rekoSummaries.summaries[op.id]
    if (summary?.has_completed_reko) {
      const dangerTypes = rekoDangerTypes(summary.dangers_json)
      op.hasCompletedReko = true
      op.rekoSummary = {
        isRelevant: summary.is_relevant ?? null,
        hasDangers: dangerTypes.length > 0,
        dangerTypes,
        personnelCount: summary.effort_json?.personnel_count ?? null,
        estimatedDuration: summary.effort_json?.estimated_duration_hours ?? null,
        summaryText: summary.summary_text ?? null,
        photos: summary.photos_json ?? [],
      }
    }
  })

  const eventScopedPersonnel = personnelList.map(person => ({
    ...person,
    status: assignedPersonIds.has(person.id) ? "assigned" as PersonStatus : "available" as PersonStatus,
    isReko: rekoPersonnelIds.has(person.id),
    isDriver: driverPersonnelIds.has(person.id),
    driverVehicleId: driverPersonnelIds.get(person.id)?.vehicleId || undefined,
    driverVehicleName: driverPersonnelIds.get(person.id)?.vehicleName || undefined,
    isMagazin: magazinPersonnelIds.has(person.id),
    isTelefondienst: telefondienstPersonnelIds.has(person.id),
    isKommandoposten: kommandopostenPersonnelIds.has(person.id),
  }))

  // Update material DEPLOYMENT based on the assignments of this Ereignis.
  //
  // Only deployment. This used to be the whole state — a plain ternary over
  // the assignments — which silently overwrote the readiness a station had
  // recorded: a Tauchpumpe entered as defective came back green and
  // draggable on the next load. `outOfService` is carried through untouched
  // by the spread and beats this field wherever the state is read (see
  // `materialResourceState`).
  const eventScopedMaterials = materialsList.map(material => ({
    ...material,
    status: assignedMaterialIds.has(material.id) ? "assigned" as Material["status"] : "available" as Material["status"]
  }))

  return { ops, eventScopedPersonnel, eventScopedMaterials, groups: apiGroups.map(apiIncidentGroupToGroup) }
}

/** What names a route's resources: the fleet, the depot and everybody who could be on a route. */
export interface AuftragNames {
  vehicles: readonly ApiVehicle[]
  /** id → name, checked-out people too: a route assignment outlives a check-out. */
  personnelNames: ReadonlyMap<string, string>
  materials: readonly Material[]
  /** The name of a resource none of the lists knows – never its id. */
  unknown: string
}

/** What the Aufträge mean for the rest of the board. */
export interface AuftragState {
  /** Auftrag id → its route-owned resources, named and split by kind. */
  resourcesByGroup: ReadonlyMap<string, GroupResources>
  /** Every resource that stands on some Auftrag, by kind. */
  occupiedResourceIds: Record<GroupResourceType, ReadonlySet<string>>
}

/**
 * The routes' resources, named once for every surface. A route holds its crew, vehicles and
 * material itself (the stops carry none), so this is the only place they are read off it.
 */
export function deriveAuftragState(groups: readonly IncidentGroup[], names: AuftragNames): AuftragState {
  const vehicleById = new Map(names.vehicles.map((v) => [String(v.id), v]))
  const materialById = new Map(names.materials.map((m) => [m.id, m]))
  const occupied = { vehicle: new Set<string>(), personnel: new Set<string>(), material: new Set<string>() }
  const resourcesByGroup = new Map<string, GroupResources>()
  for (const group of groups) {
    const resources: GroupResources = { vehicles: [], personnel: [], materials: [] }
    // `|| unknown` on a TRIMMED name: an empty name would render as a blank chip, which looks
    // like nothing is assigned at all. The name also goes into the Funkspruch and the printout.
    for (const a of group.assignments) {
      occupied[a.resourceType].add(a.resourceId)
      if (a.resourceType === "vehicle") {
        const v = vehicleById.get(a.resourceId)
        resources.vehicles.push({
          assignmentId: a.id,
          resourceId: a.resourceId,
          name: v?.name?.trim() || names.unknown,
          callsign: v?.radio_call_sign?.trim() || null,
          driverStay: a.driverStay,
        })
      } else if (a.resourceType === "personnel") {
        resources.personnel.push({
          assignmentId: a.id,
          resourceId: a.resourceId,
          name: names.personnelNames.get(a.resourceId)?.trim() || names.unknown,
          isLeader: a.isLeader,
        })
      } else {
        const m = materialById.get(a.resourceId)
        resources.materials.push({
          assignmentId: a.id,
          resourceId: a.resourceId,
          name: m?.name?.trim() || names.unknown,
          location: m?.category?.trim() || undefined,
        })
      }
    }
    resourcesByGroup.set(group.id, resources)
  }
  return { resourcesByGroup, occupiedResourceIds: occupied }
}

/** The roster with «steht auf einem Auftrag» folded in (`isOnAuftrag`): the event-scoped
 *  reconciliation reads incident rows only, and a route's crew is held on the route. */
export function withAuftragCrew(personnel: Person[], onAuftrag: ReadonlySet<string>): Person[] {
  if (onAuftrag.size === 0) return personnel
  return personnel.map((person) => (onAuftrag.has(person.id) ? { ...person, isOnAuftrag: true } : person))
}
