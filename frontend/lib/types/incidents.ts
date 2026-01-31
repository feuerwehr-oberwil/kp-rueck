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
  created_at: Date
  updated_at: Date
  created_by: string | null // UUID
  completed_at: Date | null
  status_changed_at: Date | null // Timestamp of last status transition
  assigned_vehicles: AssignedVehicle[] // List of assigned vehicles
  has_completed_reko?: boolean // Whether a non-draft reko report exists
  reko_arrived_at?: Date | null // When reko personnel arrived on site
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
 * Human-readable labels for priority levels
 */
export const PRIORITY_LABELS: Record<IncidentPriority, string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
}

/**
 * Human-readable labels for status values
 */
export const STATUS_LABELS: Record<IncidentStatus, string> = {
  eingegangen: 'Eingegangen',
  reko: 'Reko',
  disponiert: 'Disponiert',
  einsatz: 'Einsatz',
  einsatz_beendet: 'Einsatz beendet',
  abschluss: 'Abschluss',
}

/**
 * Kanban column configuration
 * Colors use light mode defaults with dark: variants
 */
export const KANBAN_COLUMNS = [
  {
    id: 'eingegangen',
    title: 'EINGEGANGEN',
    status: ['eingegangen'] as IncidentStatus[],
    color: 'bg-slate-200/80 dark:bg-zinc-800/50',
  },
  {
    id: 'reko',
    title: 'REKO',
    status: ['reko'] as IncidentStatus[],
    color: 'bg-emerald-100/80 dark:bg-zinc-800/50',
  },
  {
    id: 'disponiert',
    title: 'DISPONIERT',
    status: ['disponiert'] as IncidentStatus[],
    color: 'bg-blue-100/80 dark:bg-blue-900/30',
  },
  {
    id: 'einsatz',
    title: 'EINSATZ',
    status: ['einsatz'] as IncidentStatus[],
    color: 'bg-orange-100/80 dark:bg-orange-900/30',
  },
  {
    id: 'einsatz_beendet',
    title: 'EINSATZ BEENDET',
    status: ['einsatz_beendet'] as IncidentStatus[],
    color: 'bg-sky-100/80 dark:bg-blue-800/30',
  },
  {
    id: 'abschluss',
    title: 'ABSCHLUSS',
    status: ['abschluss'] as IncidentStatus[],
    color: 'bg-gray-200/80 dark:bg-zinc-900/50',
  },
] as const
