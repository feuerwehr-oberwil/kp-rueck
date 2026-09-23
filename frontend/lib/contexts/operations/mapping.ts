/**
 * The API → board mapping, pure: an `ApiIncident` becomes a card, the
 * Restliste becomes the «vor Ort» index, a Reko's danger checkboxes become
 * the chips on a card.
 *
 * Moved out of `operations-context.tsx` verbatim (2026-09-23) so it can be
 * tested without the provider; the context re-exports `rekoDangerTypes`, which
 * the display pages import from there.
 */

import type { ApiDangersAssessment, ApiEventRestliste, ApiIncident } from "@/lib/api-client"
import { apiCoordinatesToTuple } from "@/lib/coordinate-parser"
import { translateOutsideReact } from "@/lib/i18n-messages"
import type { Operation } from "../operations-context"

/** Just the checkboxes — the `/api/viewer/data` payload drops `other_notes`,
 *  so the shared derivation below must not insist on it. */
type RekoDangerFlags = Omit<ApiDangersAssessment, "other_notes">

/**
 * The danger chips a completed Reko puts on a card, in reading order.
 *
 * ONE derivation, deliberately: the board's two load paths each carried their
 * own copy and they drifted — the poll path forgot `fire_danger`, so a Reko
 * whose only danger was Brandgefahr showed its chips after a manual refresh and
 * lost them again ~5s later, on the card, the wall display and the mobile
 * warning triangle alike.
 *
 * `fire` is kept for reports written before the Reko form dropped it: the form
 * only ever writes `fire_danger` now, and hard-codes `fire: false` (a burning
 * building doesn't need a scout).
 */
export function rekoDangerTypes(dangers: RekoDangerFlags | null | undefined): string[] {
  if (!dangers) return []
  const dangerTypes: string[] = []
  if (dangers.fire) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.fire'))
  if (dangers.fire_danger) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.fireDanger'))
  if (dangers.explosion) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.explosion'))
  if (dangers.collapse) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.collapse'))
  if (dangers.chemical) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.chemical'))
  if (dangers.electrical) dangerTypes.push(translateOutsideReact('notifications.operations.dangerTypes.electrical'))
  return dangerTypes
}

/** The Restliste's material half, indexed for the board.
 *
 * Untracked entries ("Weiteres Material" the crew named by hand) carry no
 * material id and are skipped: they are on the Abholliste like everything else,
 * but the sidebar has no row to mark for a thing the station never owned.
 */
export function toMaterialOnSite(
  restliste: ApiEventRestliste | null,
): Map<string, { incidentId: string; address: string | null; since: string | null }> {
  const map = new Map<string, { incidentId: string; address: string | null; since: string | null }>()
  for (const unit of restliste?.material_on_site ?? []) {
    if (!unit.material_id) continue
    map.set(unit.material_id, {
      incidentId: unit.incident_id,
      address: unit.location_address ?? unit.incident_title ?? null,
      since: unit.since,
    })
  }
  return map
}

/** Helper to convert Incident to Operation. Assignments, crew, vehicles and the
 *  Reko summary are folded in afterwards by the board load. */
export function apiIncidentToOperation(incident: ApiIncident): Operation {

  return {
    id: incident.id,
    location: incident.location_address || incident.title,
    locationDisplay: incident.location_display ?? undefined,
    vehicle: null,
    vehicles: [],
    incidentType: incident.type || "elementarereignis",
    dispatchTime: new Date(incident.created_at),
    crew: [],
    priority: incident.priority as "high" | "medium" | "low",
    status: incident.status,
    coordinates: apiCoordinatesToTuple(incident.location_lat, incident.location_lng),
    materials: [],
    notes: incident.description || "",
    contact: incident.contact || "",
    contactPhone: incident.contact_phone || "",
    internalNotes: incident.internal_notes || "",
    nachbarhilfe: incident.nachbarhilfe || false,
    nachbarhilfeNote: incident.nachbarhilfe_note || "",
    amWarten: incident.am_warten || false,
    amWartenNote: incident.am_warten_note || "",
    zuFuss: incident.zu_fuss || false,
    groupId: incident.group_id ?? null,
    groupPosition: incident.group_position ?? 0,
    source: incident.source || "operator",
    fromRealAlarm: incident.from_real_alarm ?? false,
    statusChangedAt: incident.status_changed_at ? new Date(incident.status_changed_at) : null,
    hasCompletedReko: incident.has_completed_reko || false,
    rekoArrivedAt: incident.reko_arrived_at ? new Date(incident.reko_arrived_at) : null,
    rekoArrivedByKp: incident.reko_arrived_by_kp ?? false,
    fieldCompleteReportedAt: incident.field_complete_reported_at ? new Date(incident.field_complete_reported_at) : null,
    fieldCompleteReportedBy: incident.field_complete_reported_by ?? null,
    fieldArrivedAt: incident.field_arrived_at ? new Date(incident.field_arrived_at) : null,
    fieldArrivedBy: incident.field_arrived_by ?? null,
    fieldArrivedByAutomation: incident.field_arrived_by_automation ?? false,
    pickupNeeded: incident.pickup_needed ?? false,
    pickupNote: incident.pickup_note || "",
    pickupRequestedAt: incident.pickup_requested_at ? new Date(incident.pickup_requested_at) : null,
    pickupRequestedBy: incident.pickup_requested_by ?? null,
    hasSchadenplatzRapport: incident.has_schadenplatz_rapport ?? false,
    hasSchadenplatzRapportDraft: incident.has_schadenplatz_rapport_draft ?? false,
    hasBeenDispatched: incident.has_been_dispatched ?? false,
    rekoSummary: null,
    assignedReko: null,
    // The backend's effective leader; the assignment loop below overwrites
    // it with the live `is_leader` flag whenever one exists.
    leaderName: incident.leader_name ?? null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map(),
    vehicleDriverStay: new Map(),
  }
}
