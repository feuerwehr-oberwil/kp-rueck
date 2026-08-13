/**
 * Shared helpers for the read-only display views (/display/*?token=…).
 *
 * The share-token payload carries raw API rows; these helpers rebuild the same
 * event-scoped view-model the logged-in board derives from its contexts:
 * assignments → crew/material/vehicle per incident, special functions →
 * reko/driver flags, and "assigned vs. available" statuses computed from the
 * assignments rather than the (never event-scoped) availability column.
 */

import { type ApiViewerData, type ApiViewerIncident, type ApiViewerRekoSummary } from "@/lib/api-client"
import { personResourceState } from "@/lib/resource-status"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { type Operation, type RekoSummary } from "@/lib/contexts/operations-context"
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

/**
 * The Reko result as an Operation carries it. Same labels, same order, as the
 * logged-in board builds in operations-context — the share link and the board
 * have to read identically, photos included: the payload carries the filenames
 * and the display resolves them with its own token (`rekoPhotoUrl`).
 */
function viewerRekoSummary(summary: ApiViewerRekoSummary): RekoSummary {
  const dangerTypes: string[] = []
  const dangers = summary.dangers_json
  if (dangers) {
    if (dangers.fire) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.fire'))
    if (dangers.fire_danger) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.fireDanger'))
    if (dangers.explosion) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.explosion'))
    if (dangers.collapse) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.collapse'))
    if (dangers.chemical) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.chemical'))
    if (dangers.electrical) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.electrical'))
  }
  return {
    isRelevant: summary.is_relevant ?? false,
    hasDangers: dangerTypes.length > 0,
    dangerTypes,
    personnelCount: summary.personnel_count ?? null,
    estimatedDuration: summary.estimated_duration_hours ?? null,
    summaryText: summary.summary_text ?? null,
    photos: summary.photos_json ?? [],
  }
}

/**
 * Map an API incident (from the share-token payload) onto an Operation.
 *
 * The share payload is narrower than the board's own row on purpose: the Melder
 * (`contact` / `contact_phone`) and the `internal_notes` are not in it, so the
 * three Operation fields that carry them stay empty here and the display's
 * Melder block and Notiz section simply do not render. See
 * `backend/app/schemas/viewer.py` for the full allowlist.
 */
export function viewerIncidentToOperation(a: ApiViewerIncident, reko?: ApiViewerRekoSummary): Operation {
  return {
    id: a.id,
    location: a.location_address || a.title,
    locationDisplay: a.location_display ?? undefined,
    vehicle: "" as unknown as Operation["vehicle"],
    vehicles: (a.assigned_vehicles ?? []).map((v) => v.name),
    incidentType: a.type,
    dispatchTime: new Date(a.created_at),
    crew: [],
    priority: a.priority,
    status: a.status,
    coordinates: apiCoordinatesToTuple(a.location_lat, a.location_lng),
    materials: [],
    notes: a.description ?? "",
    // Not in the share payload — a resident's name, phone number and the KP's
    // internal notes are not part of a shared situation.
    contact: "",
    contactPhone: "",
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
    rekoSummary: reko ? viewerRekoSummary(reko) : null,
    assignedReko: null,
    leaderName: null,
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
    // Not in the share payload: who created the route is not part of it.
    createdBy: null,
    stopIds: group.stop_ids.map(String),
    assignments: [],
    progress: group.progress ?? { total: group.stop_ids.length, done: 0 },
    // Viewers never make a Funkdurchsage, so the payload doesn't carry one.
    lastAnnounced: null,
  }))
}

/** Build the full display view-model from a share-token payload. */
export function buildSituationData(payload: ApiViewerData): SituationData {
  const rekoSummaries = payload.reko_summaries ?? {}
  const operations: Operation[] = payload.incidents.map((incident) =>
    viewerIncidentToOperation(incident, rekoSummaries[incident.id])
  )

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
    // Not in the share payload — an account id in another system is nothing a
    // display draws, and it identifies a person across events.
    diveraUserId: null,
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
    // same rule as the live board: a Reko is an Auftrag, not availability
    personnelAssigned: personnel.filter((p) => personResourceState(p) === "assigned").length,
    personnelAvailable: personnel.filter((p) => personResourceState(p) === "available").length,
  }

  return { stats, vehicleStatus, operations, personnel, materials }
}
