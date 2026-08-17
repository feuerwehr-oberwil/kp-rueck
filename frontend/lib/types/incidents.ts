/**
 * Frontend types for Incident and Event management
 * Maps to backend incident/event schema with client-side convenience
 */

import type {
  IncidentType as ApiIncidentType,
  IncidentPriority as ApiIncidentPriority,
  IncidentStatus as ApiIncidentStatus,
} from '@/lib/api-client'

// Re-export API types for consistency
export type IncidentType = ApiIncidentType
export type IncidentPriority = ApiIncidentPriority
export type IncidentStatus = ApiIncidentStatus

/**
 * Event (Ereignis) - High-level container for emergency scenarios
 */
export interface Event {
  id: string // UUID
  name: string
  training_flag: boolean
  created_at: Date
  updated_at: Date
  archived_at: Date | null
  last_activity_at: Date
  incident_count: number
}

/**
 * Event creation payload
 */
export interface EventCreate {
  name: string
  training_flag: boolean
}

/**
 * Event update payload (all fields optional)
 */
export interface EventUpdate {
  name?: string
  training_flag?: boolean
  archived_at?: Date | null
}

/**
 * Assigned vehicle with details
 */
export interface AssignedVehicle {
  assignment_id: string // UUID of assignment record
  vehicle_id: string // UUID of vehicle
  name: string // Vehicle name (e.g., "TLF 1")
  type: string // Vehicle type (e.g., "TLF", "DLK")
  assigned_at: Date
  driver_stay: boolean // Whether driver+car should stay on scene
}

/**
 * Frontend incident representation
 * Coordinates are parsed to numbers, dates to Date objects
 */
export interface Incident {
  id: string // UUID
  event_id: string // UUID - reference to parent event
  title: string
  type: IncidentType
  priority: IncidentPriority
  location_address: string | null
  location_lat: number | null
  location_lng: number | null
  status: IncidentStatus
  description: string | null
  source?: string // Origin: "operator" (dashboard) or "intake" (public token form). Absent on locally-built incidents.
  nachbarhilfe: boolean // Neighboring station assistance flag
  am_warten: boolean // Delayed/waiting emergency
  zu_fuss: boolean // Personnel go by foot (not by vehicle)
  created_at: Date
  updated_at: Date
  created_by: string | null // UUID
  completed_at: Date | null
  status_changed_at: Date | null // Timestamp of last status transition
  assigned_vehicles: AssignedVehicle[] // List of assigned vehicles
  has_completed_reko?: boolean // Whether a non-draft reko report exists
  reko_arrived_at?: Date | null // When reko personnel arrived on site
  /** Server-computed short label for location_address (home city stripped). */
  location_display?: string | null
}

/**
 * Incident creation payload
 */
export interface IncidentCreate {
  event_id: string // UUID - required for all new incidents
  title: string
  type: IncidentType
  priority: IncidentPriority
  location_address?: string | null
  location_lat?: number | null
  location_lng?: number | null
  status?: IncidentStatus
  description?: string | null
  nachbarhilfe?: boolean
  am_warten?: boolean
  zu_fuss?: boolean
}

/**
 * Incident update payload (all fields optional)
 */
export interface IncidentUpdate {
  title?: string
  type?: IncidentType
  priority?: IncidentPriority
  location_address?: string | null
  location_lat?: number | null
  location_lng?: number | null
  status?: IncidentStatus
  description?: string | null
  nachbarhilfe?: boolean
  am_warten?: boolean
  am_warten_note?: string | null
  zu_fuss?: boolean
}

/**
 * Status transition record
 */
export interface StatusTransition {
  id: string
  incident_id: string
  from_status: IncidentStatus
  to_status: IncidentStatus
  timestamp: Date
  user_id: string | null
  notes: string | null
}

/**
 * Human-readable labels for incident types
 */
export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  brandbekaempfung: 'Brandbekämpfung',
  elementarereignis: 'Elementarereignis',
  strassenrettung: 'Strassenrettung',
  technische_hilfeleistung: 'Technische Hilfeleistung',
  oelwehr: 'Ölwehr',
  chemiewehr: 'Chemiewehr',
  strahlenwehr: 'Strahlenwehr',
  einsatz_bahnanlagen: 'Einsatz Bahnanlagen',
  bma_unechte_alarme: 'BMA / Unechte Alarme',
  dienstleistungen: 'Dienstleistungen',
  diverse_einsaetze: 'Diverse Einsätze',
  gerettete_menschen: 'Gerettete Menschen',
  gerettete_tiere: 'Gerettete Tiere',
}

/**
 * Narrow an API string back into the union, rather than casting it.
 *
 * The wire carries a plain `string` for the type; anything unrecognised falls
 * back to the same default a new Meldung starts on, so an unknown value shows a
 * label instead of `undefined` on a phone at 02:00.
 */
export function asIncidentType(value: string | undefined): IncidentType {
  return value && value in INCIDENT_TYPE_LABELS ? (value as IncidentType) : 'elementarereignis'
}

/**
 * Human-readable labels for status values
 */
export const STATUS_LABELS: Record<IncidentStatus, string> = {
  incoming: 'Eingegangen',
  reko: 'Reko',
  reko_done: 'Reko abgeschlossen',
  enroute: 'Disponiert',
  active: 'Einsatz',
  returning: 'Einsatz beendet',
  complete: 'Abschluss',
}

/**
 * Status groups for map filtering
 * Groups incident statuses by workflow stage
 */
export type StatusGroup = 'open' | 'active' | 'completed'

/**
 * Map individual statuses to their group
 */
export const STATUS_TO_GROUP: Record<IncidentStatus, StatusGroup> = {
  incoming: 'open',
  reko: 'open',
  reko_done: 'open',
  enroute: 'active',
  active: 'active',
  returning: 'completed',
  complete: 'completed',
}

/**
 * Human-readable labels for status groups
 */
export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  open: 'Offen',
  active: 'Aktiv',
  completed: 'Beendet',
}

/**
 * Border style for status groups on map markers
 * Uses stroke-dasharray values for SVG
 */
export const STATUS_GROUP_BORDER_STYLE: Record<StatusGroup, { dasharray: string; opacity: number }> = {
  open: { dasharray: '4,3', opacity: 1 },      // Dashed border - needs attention
  active: { dasharray: 'none', opacity: 1 },   // Solid border - in progress
  completed: { dasharray: '2,2', opacity: 0.6 }, // Dotted border with reduced opacity - done
}
