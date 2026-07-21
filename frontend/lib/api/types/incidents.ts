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
  | 'eingegangen'
  | 'reko'
  | 'reko_done'
  | 'disponiert'
  | 'einsatz'
  | 'einsatz_beendet'
  | 'abschluss'

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
