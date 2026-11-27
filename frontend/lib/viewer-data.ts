/**
 * Shared helpers for the read-only display views (/display/*?token=…).
 *
 * The share-token payload carries raw API rows, narrower than the board's own (the
 * allowlist is explicit: `ApiViewer*` in lib/api/resources/viewer.ts and
 * backend/app/schemas/viewer.py). These helpers map them onto the board's shapes and run
 * the board's own reconciliation, so a shared display shows what the board shows.
 */

import type { VehicleDriver } from "@/lib/hooks/use-vehicle-drivers"
import { type ApiViewerData, type ApiViewerGroup, type ApiViewerIncident, type ApiViewerRekoSummary } from "@/lib/api-client"
import { personResourceState } from "@/lib/resource-status"
import { rekoDangerTypes, type Operation, type RekoSummary } from "@/lib/contexts/operations-context"
import { auftragOccupancy, reconcileEvent, withAuftragCrew, withAuftragResources } from "@/lib/contexts/operations/reconcile"
import { type Person } from "@/lib/contexts/personnel-context"
import { type Material, withAuftragDeployment } from "@/lib/contexts/materials-context"
import { type GroupResources, type IncidentGroup } from "@/lib/types/groups"
import { type VehicleWithStatus, type StatusStats } from "@/lib/hooks/use-status-data"
import { columns } from "@/lib/kanban-utils"
import { darkenForWhiteText } from "@/lib/map-colors"
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
 *
 * The danger chips come from the board's own `rekoDangerTypes`, not a copy of
 * it: this file held a third copy of that if-chain, and the two in
 * operations-context had already drifted apart (the poll path had lost
 * `fire_danger`) before they were merged into one. The share payload drops
 * `other_notes`, which is why that function takes the flags-only shape.
 */
function viewerRekoSummary(summary: ApiViewerRekoSummary): RekoSummary {
  const dangerTypes = rekoDangerTypes(summary.dangers_json)
  return {
    isRelevant: summary.is_relevant ?? null,
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
 *
 * `pickupNeeded` / `pickupRequestedAt` DO arrive: a crew waiting to be collected
 * is the situation, not the office's bookkeeping, so `PickupBadge` renders on a
 * shared board. `pickupNote` does not — unbounded operator free text that only
 * shows in a tooltip, and nobody hovers a wall display. `leaderId` is filled
 * in `buildSituationData` from `assignment.is_leader`, exactly as the board does.
 *
 * What still stays at its empty value, because the allowlist does not carry it:
 *
 * * `hasSchadenplatzRapport` / `…Draft` — whether the KP has filed its
 *   paperwork is the office's state, not the situation's. Left off.
 */
function viewerIncidentToOperation(a: ApiViewerIncident, reko?: ApiViewerRekoSummary): Operation {
  return {
    id: a.id,
    location: a.location_address || a.title,
    locationDisplay: a.location_display ?? undefined,
    // From the assignments, as on the board (`reconcileEvent`).
    vehicles: [],
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
    pickupNeeded: a.pickup_needed ?? false,
    // The note stays out of the share payload; the badge reads the time only.
    pickupNote: "",
    pickupRequestedAt: a.pickup_requested_at ? new Date(a.pickup_requested_at) : null,
    groupId: a.group_id ?? null,
    groupPosition: a.group_position ?? 0,
    auftragResources: null,
    source: a.source,
    statusChangedAt: a.status_changed_at ? new Date(a.status_changed_at) : null,
    hasCompletedReko: a.has_completed_reko,
    rekoArrivedAt: a.reko_arrived_at ? new Date(a.reko_arrived_at) : null,
    rekoSummary: reko ? viewerRekoSummary(reko) : null,
    assignedReko: null,
    leaderId: null,
    leaderName: null,
    materialAssignments: new Map(),
  }
}

/** Map the payload's Auftrag rows onto the domain IncidentGroup shape (colour as drawn, like
 *  `groups-context`). The route's resources come along without the released rows: they are
 *  what says a vehicle or a person is out on that Auftrag – with none, a share link showed a
 *  vehicle on a route as «frei». */
export function viewerGroupsToIncidentGroups(payload: ApiViewerData): IncidentGroup[] {
  return (payload.groups ?? []).map((group) => ({
    id: String(group.id),
    eventId: String(group.event_id),
    name: group.name,
    color: group.color ? darkenForWhiteText(group.color) : null,
    notes: group.notes ?? null,
    position: group.position,
    createdAt: new Date(group.created_at),
    updatedAt: new Date(group.updated_at),
    // Not in the share payload: who created the route is not part of it.
    createdBy: null,
    stopIds: group.stop_ids.map(String),
    assignments: liveGroupAssignments(group).map((a) => ({
      id: String(a.id),
      resourceType: a.resource_type,
      resourceId: String(a.resource_id),
      driverStay: a.driver_stay,
      isLeader: a.is_leader,
    })),
    progress: group.progress ?? { total: group.stop_ids.length, done: 0 },
    // Viewers never make a Funkdurchsage, so the payload doesn't carry one.
    lastAnnounced: null,
  }))
}

/**
 * Each Auftrag's resources, named from the payload's own roster, fleet and depot (no extra
 * request). An id none of them knows is skipped rather than printed as a UUID: the roster is
 * checked-in-only, the same rule the incident crew mapping follows.
 */
export function viewerGroupResources(payload: ApiViewerData): Map<string, GroupResources> {
  const resolved = new Map<string, GroupResources>()
  const nameById = new Map<string, string>()
  for (const person of payload.personnel) nameById.set(String(person.id), person.name)
  const callsignById = new Map<string, string>()
  for (const vehicle of payload.vehicles) {
    nameById.set(String(vehicle.id), vehicle.name)
    if (vehicle.radio_call_sign) callsignById.set(String(vehicle.id), vehicle.radio_call_sign)
  }
  for (const material of payload.materials) nameById.set(String(material.id), material.name)
  for (const group of payload.groups ?? []) {
    const resources: GroupResources = { vehicles: [], personnel: [], materials: [] }
    for (const assignment of liveGroupAssignments(group)) {
      const resourceId = String(assignment.resource_id)
      const name = nameById.get(resourceId)
      if (!name) continue
      const item = { assignmentId: String(assignment.id), resourceId, name }
      if (assignment.resource_type === "vehicle") resources.vehicles.push({ ...item, callsign: callsignById.get(resourceId) ?? null, driverStay: assignment.driver_stay })
      else if (assignment.resource_type === "personnel") resources.personnel.push({ ...item, isLeader: assignment.is_leader })
      else resources.materials.push(item)
    }
    resolved.set(String(group.id), resources)
  }
  return resolved
}

/** What a route still owns: its assignments without the released ones. */
function liveGroupAssignments(group: ApiViewerGroup) {
  return (group.assignments ?? []).filter((assignment) => !assignment.unassigned_at)
}

/**
 * Build the full display view-model from a share-token payload: the rows mapped onto the
 * board's own shapes, then the board's own reconciliation (`reconcileEvent`) – crew, Reko,
 * leader, vehicles in display order, Telefondienst/KP flags – and its Auftrag folds, so the
 * QR wall reads like the board.
 */
export function buildSituationData(payload: ApiViewerData): SituationData {
  const rekoSummaries = payload.reko_summaries ?? {}
  const operations: Operation[] = payload.incidents.map((incident) =>
    viewerIncidentToOperation(incident, rekoSummaries[incident.id])
  )
  const roster: Person[] = payload.personnel.map((p) => ({
    id: String(p.id),
    name: p.name,
    kennung: p.kennung ?? null,
    role: p.role ?? "",
    // Event-scoped below, from this Ereignis's assignments.
    status: "available",
    tags: p.tags ?? undefined,
    roleSortOrder: p.role_sort_order,
    // Not in the share payload — whether a person is linked to another system
    // is nothing a display draws, and a viewer never sends alarms.
    diveraLinked: false,
  }))
  const depot: Material[] = payload.materials.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.location || "General",
    type: m.type || "Sonstiges",
    // Event-scoped below, from this Ereignis's assignments.
    status: "available",
    // Readiness comes down the wire now (`ViewerMaterial.out_of_service`) — the
    // one availability fact a display cannot derive from this event's
    // assignments, and the reason a defective pump used to draw green here.
    outOfService: m.out_of_service ?? false,
    // The «seit» timestamp deliberately stays out of the share payload: the wall
    // says WHETHER something is einsatzbereit, the Verwaltung says since when.
    outOfServiceSince: null,
    categorySortOrder: m.location_sort_order,
    consumable: m.consumable ?? false,
    groupId: m.group_id,
  }))

  const { eventScopedPersonnel, eventScopedMaterials } = reconcileEvent(operations, {
    personnelList: roster,
    materialsList: depot,
    vehiclesList: payload.vehicles,
    specialFunctions: payload.special_functions ?? [],
    assignmentsByIncident: payload.assignments ?? {},
  })
  // A vehicle archived since its assignment is not in the share payload's fleet, but the
  // incident row still names it (`assigned_vehicles`): drawn last, without a call sign.
  payload.incidents.forEach((incident, index) => {
    const op = operations[index]
    for (const v of incident.assigned_vehicles ?? []) {
      if (op.vehicles.some((known) => known.vehicleId === v.vehicle_id)) continue
      op.vehicles.push({ vehicleId: v.vehicle_id, assignmentId: v.assignment_id, name: v.name, callsign: null, driverStay: v.driver_stay })
    }
  })
  // A route's crew and material live on the Auftrag, not on its stops.
  const groups = viewerGroupsToIncidentGroups(payload)
  const cards = withAuftragResources(operations, groups, viewerGroupResources(payload))
  const onAuftrag = auftragOccupancy(groups)
  const personnel = withAuftragCrew(eventScopedPersonnel, onAuftrag.personnel)
  const materials = withAuftragDeployment(eventScopedMaterials, onAuftrag.material)

  const driverByVehicleId = new Map<string, VehicleDriver>()
  for (const person of personnel) {
    if (person.isDriver && person.driverVehicleId) {
      driverByVehicleId.set(person.driverVehicleId, { name: person.name, personnelId: person.id })
    }
  }

  const vehicleStatus: VehicleWithStatus[] = payload.vehicles
    .map((v) => {
      const assignedOperation = cards.find((op) => op.vehicles.some((av) => av.vehicleId === String(v.id)))
      const gps = payload.vehicle_positions.find(
        (vp) => vp.device_name.toLowerCase() === v.name.toLowerCase()
      )
      return {
        id: v.id,
        name: v.name,
        type: v.type,
        status: v.status,
        // «Nicht einsatzbereit», read from the field that means it rather than
        // from the legacy `status` mirror — see vehicleResourceState.
        outOfService: v.out_of_service ?? false,
        displayOrder: v.display_order,
        assignedOperation,
        gps,
        driver: driverByVehicleId.get(String(v.id)) ?? null,
      }
    })
    .sort((a, b) => a.displayOrder - b.displayOrder)

  const byStatus: Record<string, Operation[]> = {}
  columns.forEach((col) => { byStatus[col.id] = [] })
  cards.forEach((op) => {
    const col = columns.find((c) => c.id === op.status)
    if (col) byStatus[col.id].push(op)
  })
  const activeOps = cards.filter((op) => op.status !== "complete")
  const stats: StatusStats = {
    byStatus,
    totalOperations: cards.length,
    activeOperations: activeOps.length,
    incomingCount: byStatus["incoming"]?.length || 0,
    completedCount: byStatus["complete"]?.length || 0,
    personnelTotal: personnel.length,
    // same rule as the live board: a Reko is an Auftrag, not availability
    personnelAssigned: personnel.filter((p) => personResourceState(p) === "assigned").length,
    personnelAvailable: personnel.filter((p) => personResourceState(p) === "available").length,
  }

  return { stats, vehicleStatus, operations: cards, personnel, materials }
}
