/**
 * One board load, reconciled: the fetched incidents, roster, depot, fleet,
 * special functions, assignments and Reko summaries of ONE Ereignis turned
 * into the cards, the event-scoped roster and the material deployment the
 * board draws.
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
  ApiVehicle,
} from "@/lib/api-client"
import type { Material, Operation, Person, PersonStatus } from "../operations-context"
import { apiIncidentToOperation, rekoDangerTypes } from "./mapping"

/** What one board load fetched, as `loadData` hands it over. */
export interface EventSnapshot {
  apiIncidents: ApiIncident[]
  personnelList: Person[]
  materialsList: Material[]
  vehiclesList: ApiVehicle[]
  specialFunctions: ApiEventSpecialFunctionResponse[]
  assignmentsByIncident: Record<string, ApiAssignment[]>
  rekoSummaries: ApiEventRekoSummariesResponse
}

export interface EventState {
  ops: Operation[]
  eventScopedPersonnel: Person[]
  eventScopedMaterials: Material[]
}

export function buildEventState({
  apiIncidents,
  personnelList,
  materialsList,
  vehiclesList,
  specialFunctions,
  assignmentsByIncident,
  rekoSummaries,
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

  // Process assignments
  ops.forEach((operation) => {
    const assignments = assignmentsByIncident[operation.id] || []
    for (const assignment of assignments) {
      if (assignment.resource_type === "personnel") {
        const person = personnelList.find(p => p.id === assignment.resource_id)
        if (person) {
          if (rekoPersonnelIds.has(person.id)) {
            operation.assignedReko = { id: person.id, name: person.name }
            continue
          }
          operation.crew.push(person.name)
          operation.crewAssignments.set(person.name, assignment.id)
          if (assignment.is_leader) operation.leaderName = person.name
        }
      } else if (assignment.resource_type === "material") {
        operation.materials.push(assignment.resource_id)
        operation.materialAssignments.set(assignment.resource_id, assignment.id)
      } else if (assignment.resource_type === "vehicle") {
        const vehicle = vehiclesList.find(v => v.id === assignment.resource_id)
        if (vehicle) {
          operation.vehicles.push(vehicle.name)
          operation.vehicleAssignments.set(vehicle.name, assignment.id)
          if (vehicle.radio_call_sign) {
            operation.vehicleCallsigns.set(vehicle.name, vehicle.radio_call_sign)
          }
          operation.vehicleDriverStay.set(vehicle.name, assignment.driver_stay || false)
        }
      }
    }
  })

  // Show vehicles in their configured display order everywhere (radio text,
  // Divera/WhatsApp messages, cards) instead of assignment order.
  {
    const vehicleOrder = new Map(vehiclesList.map(v => [v.name, v.display_order]))
    ops.forEach(op => op.vehicles.sort((a, b) => (vehicleOrder.get(a) ?? 0) - (vehicleOrder.get(b) ?? 0)))
  }

  // Process reko summaries
  ops.forEach(op => {
    const summary = rekoSummaries.summaries[op.id]
    if (summary?.has_completed_reko) {
      const dangerTypes = rekoDangerTypes(summary.dangers_json)
      op.hasCompletedReko = true
      op.rekoSummary = {
        isRelevant: summary.is_relevant ?? false,
        hasDangers: dangerTypes.length > 0,
        dangerTypes,
        personnelCount: summary.effort_json?.personnel_count ?? null,
        estimatedDuration: summary.effort_json?.estimated_duration_hours ?? null,
        summaryText: summary.summary_text ?? null,
        photos: summary.photos_json ?? [],
      }
    }
  })

  // Calculate availability from assignments

  ops.forEach(operation => {
    operation.crew.forEach(crewName => {
      const person = personnelList.find(p => p.name === crewName)
      if (person) assignedPersonIds.add(person.id)
    })
    operation.materials.forEach(materialId => assignedMaterialIds.add(materialId))
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

  return { ops, eventScopedPersonnel, eventScopedMaterials }
}
