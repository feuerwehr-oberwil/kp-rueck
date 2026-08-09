/**
 * Incident + status-transition + timeline types.
 */

import type { ApiAssignedVehicle } from './vehicles'

export type IncidentType =
  | 'brandbekaempfung'
  | 'elementarereignis'
  | 'strassenrettung'
  | 'technische_hilfeleistung'
  | 'oelwehr'
  | 'chemiewehr'
  | 'strahlenwehr'
  | 'einsatz_bahnanlagen'
  | 'bma_unechte_alarme'
  | 'dienstleistungen'
  | 'diverse_einsaetze'
  | 'gerettete_menschen'
  | 'gerettete_tiere'

export type IncidentPriority = 'low' | 'medium' | 'high'

export type IncidentStatus =
  | 'incoming'
  | 'reko'
  | 'reko_done'
  | 'enroute'
  | 'active'
  | 'returning'
  | 'complete'

export interface ApiIncident {
  id: string // UUID
  event_id: string // UUID - reference to parent event
  title: string
  type: IncidentType
  priority: IncidentPriority
  location_address: string | null
  /** Decimal as string */
  location_lat: string | null
  /** Decimal as string */
  location_lng: string | null
  status: IncidentStatus
  /** Manual sort order within a status column (lower = higher on the board) */
  position: number
  /** Auftrag (incident group) this stop belongs to, or null when ungrouped. */
  group_id: string | null
  /** Order of this stop within its Auftrag (lower = earlier). 0 when ungrouped. */
  group_position: number
  /** Origin of the alarm: "operator" (dashboard), "intake" (public token form),
   *  "divera", or the source slug of a generic-webhook sender. */
  source: string
  /** The alarm's id in the delivering system, when created from a pool alarm. */
  source_ref?: string | null
  description: string | null
  contact: string | null
  contact_phone: string | null
  internal_notes: string | null
  /** Neighboring station assistance flag */
  nachbarhilfe: boolean
  nachbarhilfe_note: string | null
  /** Delayed/waiting emergency */
  am_warten: boolean
  am_warten_note: string | null
  /** Personnel go by foot (not by vehicle) */
  zu_fuss: boolean
  created_at: string
  updated_at: string
  /** UUID */
  created_by: string | null
  completed_at: string | null
  /** Timestamp of last status transition */
  status_changed_at: string | null
  assigned_vehicles: ApiAssignedVehicle[]
  /** Whether a non-draft reko report exists */
  has_completed_reko: boolean
  /** When reko personnel arrived on site (before submitting) */
  reko_arrived_at: string | null
  /** When the field crew reported the incident finished (operator decides to close) */
  field_complete_reported_at: string | null
  /** Who reported it. null = the KP took it over the radio — provenance is
   *  never faked, so "im KP erfasst" is the absence of a personnel id. */
  field_complete_reported_by?: string | null
  /** "Angekommen" from /feld (lives on the Schadenplatz-Rapport row). */
  field_arrived_at?: string | null
  /** Who reported the arrival. null = im KP erfasst. */
  field_arrived_by?: string | null
  /** A submitted Schadenplatz-Rapport exists (the "kein Rapport" marker reads
   *  this; it lands with the form in phase 2). */
  has_schadenplatz_rapport?: boolean
  /** "Abholung nötig": the crew is finished and cannot get back on its own.
   *  NOT a status, and deliberately NOT cleared when the card is completed —
   *  that transition releases the personnel while they are still standing at
   *  the address, which is exactly when this has to survive. */
  pickup_needed?: boolean
  pickup_note?: string | null
  pickup_requested_at?: string | null
  pickup_requested_by?: string | null
  /** Server-computed short label for location_address (home city stripped).
   *  "" when the address is only the home city; null/absent when no address. */
  location_display?: string | null
}

export interface ApiIncidentCreate {
  /** UUID - required for all new incidents */
  event_id: string
  title: string
  type: IncidentType
  priority: IncidentPriority
  location_address?: string | null
  location_lat?: string | null
  location_lng?: string | null
  status?: IncidentStatus
  description?: string | null
  contact?: string | null
  contact_phone?: string | null
  internal_notes?: string | null
  nachbarhilfe?: boolean
  nachbarhilfe_note?: string | null
  /** Attach the new incident to an Auftrag (incident group) on creation. */
  group_id?: string | null
}

export interface ApiIncidentUpdate {
  title?: string
  type?: IncidentType
  priority?: IncidentPriority
  location_address?: string | null
  location_lat?: string | null
  location_lng?: string | null
  status?: IncidentStatus
  description?: string | null
  contact?: string | null
  contact_phone?: string | null
  internal_notes?: string | null
  nachbarhilfe?: boolean
  nachbarhilfe_note?: string | null
  am_warten?: boolean
  am_warten_note?: string | null
  zu_fuss?: boolean
}

export interface ApiStatusTransition {
  id: string
  incident_id: string
  from_status: string
  to_status: string
  timestamp: string
  user_id: string | null
  notes: string | null
}

export interface ApiIncidentTimelineEvent {
  event_type: 'status_change' | 'assignment'
  timestamp: string
  actor_name: string | null
  // status_change fields
  from_status?: string | null
  to_status?: string | null
  notes?: string | null
  // assignment fields
  assignment_action?: 'assigned' | 'unassigned' | null
  resource_type?: 'personnel' | 'vehicle' | 'material' | null
  resource_name?: string | null
}

export interface ApiIncidentTimelineResponse {
  events: ApiIncidentTimelineEvent[]
}

/**
 * One resource that was on an incident at some point — the "Beteiligt" roll-up.
 * One entry per resource, not per assignment: someone taken off and put back on
 * appears once, with `stints` counting how many separate times.
 */
export interface ApiIncidentParticipant {
  resource_type: 'personnel' | 'vehicle' | 'material'
  resource_id: string
  /** null when the resource has since been deleted from the roster. */
  name: string | null
  first_assigned_at: string
  /** null while still assigned. */
  last_released_at: string | null
  stints: number
  /** Personnel only: held the Reko function for the event. */
  is_reko: boolean
  /** Personnel only: led the incident (or its Auftrag) while assigned. */
  is_leader: boolean
}

export interface ApiIncidentParticipantsResponse {
  participants: ApiIncidentParticipant[]
}
