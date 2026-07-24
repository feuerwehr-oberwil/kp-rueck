/**
 * Shared helpers for the read-only display views (/display/*?token=…).
 *
 * The share-token payload carries raw API rows; these helpers rebuild the same
 * event-scoped view-model the logged-in board derives from its contexts:
 * assignments → crew/material/vehicle per incident, special functions →
 * reko/driver flags, and "assigned vs. available" statuses computed from the
 * assignments rather than the (never event-scoped) availability column.
 */

import { type ApiViewerData, type ApiIncident } from "@/lib/api-client"
import { type Operation, type OperationStatus } from "@/lib/contexts/operations-context"
import { type Person, type PersonStatus } from "@/lib/contexts/personnel-context"
import { type Material } from "@/lib/contexts/materials-context"
import { type IncidentGroup } from "@/lib/types/groups"
import { type VehicleWithStatus, type StatusStats } from "@/lib/hooks/use-status-data"
import { columns } from "@/lib/kanban-utils"
import { apiCoordinatesToTuple } from "@/lib/coordinate-parser"

/** The view-model the display pages render — fed by useStatusData (auth) or a token payload. */
export interface SituationData {
  stats: StatusStats
  vehicleStatus: VehicleWithStatus[]
  operations: Operation[]
  personnel: Person[]
  materials: Material[]
}

const API_STATUS_TO_INTERNAL: Record<string, OperationStatus> = {
  eingegangen: "incoming",
  reko: "ready",
  reko_done: "rekoDone",
  disponiert: "enroute",
  einsatz: "active",
  einsatz_beendet: "returning",
  abschluss: "complete",
}

/** Map an API incident (from the share-token payload) onto an Operation. */
export function viewerIncidentToOperation(a: ApiIncident): Operation {
  return {
    id: a.id,
    location: a.location_address || a.title,
    vehicle: "" as unknown as Operation["vehicle"],
    vehicles: (a.assigned_vehicles ?? []).map((v) => v.name),
    incidentType: a.type,
    dispatchTime: new Date(a.created_at),
    crew: [],
    priority: a.priority,
    status: API_STATUS_TO_INTERNAL[a.status] ?? "incoming",
    coordinates: apiCoordinatesToTuple(a.location_lat, a.location_lng),
    materials: [],
    notes: a.description ?? "",
    contact: a.contact ?? "",
    contactPhone: a.contact_phone ?? "",
    internalNotes: "",
    nachbarhilfe: a.nachbarhilfe ?? false,
    nachbarhilfeNote: a.nachbarhilfe_note ?? "",
    amWarten: a.am_warten ?? false,
    amWartenNote: a.am_warten_note ?? "",
    zuFuss: a.zu_fuss ?? false,
    groupId: a.group_id ?? null,
    groupPosition: a.group_position ?? 0,
    source: a.source,
    statusChangedAt: a.status_changed_at ? new Date(a.status_changed_at) : null,
    hasCompletedReko: a.has_completed_reko,
    rekoArrivedAt: a.reko_arrived_at ? new Date(a.reko_arrived_at) : null,
    rekoSummary: null,
    assignedReko: null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map(),
    vehicleDriverStay: new Map(),
  }
}

/** Map the payload's Auftrag rows onto the domain IncidentGroup shape. */
export function viewerGroupsToIncidentGroups(payload: ApiViewerData): IncidentGroup[] {
  return (payload.groups ?? []).map((group) => ({
    id: String(group.id),
    eventId: String(group.event_id),
    name: group.name,
    color: group.color ?? null,
    notes: group.notes ?? null,
    position: group.position,
    createdAt: new Date(group.created_at),
    updatedAt: new Date(group.updated_at),
    createdBy: group.created_by ? String(group.created_by) : null,
    stopIds: group.stop_ids.map(String),
    assignments: [],
    progress: group.progress ?? { total: group.stop_ids.length, done: 0 },
  }))
}

/** Build the full display view-model from a share-token payload. */
export function buildSituationData(payload: ApiViewerData): SituationData {
  const operations: Operation[] = payload.incidents.map(viewerIncidentToOperation)

  // Special functions: reko people are tracked per-incident (not crew); every
  // other function (driver, magazin, …) counts its person as assigned —
  // mirrors the logged-in board's reconciliation in operations-context.
  const rekoPersonnelIds = new Set<string>()
  const driverInfoByPerson = new Map<string, { vehicleId: string; vehicleName: string }>()
  const magazinPersonnelIds = new Set<string>()
  const assignedPersonIds = new Set<string>()
  const assignedMaterialIds = new Set<string>()
  for (const func of payload.special_functions ?? []) {
    if (func.function_type === "reko") {
      rekoPersonnelIds.add(func.personnel_id)
    } else {
      assignedPersonIds.add(func.personnel_id)
      if (func.function_type === "driver") {
        driverInfoByPerson.set(func.personnel_id, {
          vehicleId: func.vehicle_id ?? "",
          vehicleName: func.vehicle_name ?? "",
        })
      } else if (func.function_type === "magazin") {
        magazinPersonnelIds.add(func.personnel_id)
      }
    }
  }

  const personnelById = new Map(payload.personnel.map((p) => [String(p.id), p]))
  const vehiclesById = new Map(payload.vehicles.map((v) => [String(v.id), v]))

  // Assignments: populate crew/material/vehicle details per incident and
  // collect the event-scoped "assigned" sets.
  const assignmentsByIncident = payload.assignments ?? {}
  for (const op of operations) {
    for (const assignment of assignmentsByIncident[op.id] ?? []) {
      if (assignment.resource_type === "personnel") {
        const person = personnelById.get(assignment.resource_id)
        if (!person) continue
        if (rekoPersonnelIds.has(String(person.id))) {
          op.assignedReko = { id: String(person.id), name: person.name }
          continue
        }
        op.crew.push(person.name)
        op.crewAssignments.set(person.name, assignment.id)
        assignedPersonIds.add(String(person.id))
      } else if (assignment.resource_type === "material") {
        op.materials.push(assignment.resource_id)
        op.materialAssignments.set(assignment.resource_id, assignment.id)
        assignedMaterialIds.add(assignment.resource_id)
      } else if (assignment.resource_type === "vehicle") {
        const vehicle = vehiclesById.get(assignment.resource_id)
        if (!vehicle) continue
        if (!op.vehicles.includes(vehicle.name)) op.vehicles.push(vehicle.name)
        op.vehicleAssignments.set(vehicle.name, assignment.id)
        if (vehicle.radio_call_sign) op.vehicleCallsigns.set(vehicle.name, vehicle.radio_call_sign)
        op.vehicleDriverStay.set(vehicle.name, assignment.driver_stay || false)
      }
    }
  }

  const personnel: Person[] = payload.personnel.map((p) => ({
    id: String(p.id),
    name: p.name,
    role: p.role ?? "",
    status: (assignedPersonIds.has(String(p.id)) ? "assigned" : "available") as PersonStatus,
    tags: p.tags ?? undefined,
    isReko: rekoPersonnelIds.has(String(p.id)),
    isDriver: driverInfoByPerson.has(String(p.id)),
    driverVehicleId: driverInfoByPerson.get(String(p.id))?.vehicleId || undefined,
    driverVehicleName: driverInfoByPerson.get(String(p.id))?.vehicleName || undefined,
    isMagazin: magazinPersonnelIds.has(String(p.id)),
    roleSortOrder: p.role_sort_order,
    diveraUserId: p.divera_user_id ?? null,
  }))

  const materials: Material[] = payload.materials.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.location || "General",
    type: m.type || "Sonstiges",
    status: (assignedMaterialIds.has(m.id) ? "assigned" : "available") as Material["status"],
    categorySortOrder: m.location_sort_order,
    consumable: m.consumable ?? false,
    groupId: m.group_id,
  }))

  const driverNameByVehicle = new Map<string, string>()
  for (const person of personnel) {
    if (person.isDriver && person.driverVehicleName) {
      driverNameByVehicle.set(person.driverVehicleName.toLowerCase(), person.name)
    }
  }

  const vehicleStatus: VehicleWithStatus[] = payload.vehicles
    .map((v) => {
      const assignedOperation = operations.find((op) =>
        op.vehicles.some((vName) => vName.toLowerCase() === v.name.toLowerCase())
      )
      const gps = payload.vehicle_positions.find(
        (vp) => vp.device_name.toLowerCase() === v.name.toLowerCase()
      )
      return {
        id: v.id,
        name: v.name,
        type: v.type,
        status: v.status,
        displayOrder: v.display_order,
        assignedOperation,
        gps,
        driverName: driverNameByVehicle.get(v.name.toLowerCase()) ?? null,
      }
    })
    .sort((a, b) => a.displayOrder - b.displayOrder)

  const byStatus: Record<string, Operation[]> = {}
  columns.forEach((col) => { byStatus[col.id] = [] })
  operations.forEach((op) => {
    const col = columns.find((c) => c.status.includes(op.status))
    if (col) byStatus[col.id].push(op)
  })
  const activeOps = operations.filter((op) => op.status !== "complete")
  const stats: StatusStats = {
    byStatus,
    totalOperations: operations.length,
    activeOperations: activeOps.length,
    incomingCount: byStatus["incoming"]?.length || 0,
    completedCount: byStatus["complete"]?.length || 0,
    personnelTotal: personnel.length,
    personnelAssigned: personnel.filter((p) => p.status === "assigned").length,
    personnelAvailable: personnel.filter((p) => p.status === "available").length,
  }

  return { stats, vehicleStatus, operations, personnel, materials }
}
