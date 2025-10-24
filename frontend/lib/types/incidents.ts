/**
 * Frontend types for Incident management
 * Maps to backend incident schema with client-side convenience
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
 * Frontend incident representation
 * Coordinates are parsed to numbers, dates to Date objects
 */
export interface Incident {
  id: string // UUID
  title: string
  type: IncidentType
  priority: IncidentPriority
  location_address: string | null
  location_lat: number | null
  location_lng: number | null
  status: IncidentStatus
  training_flag: boolean
  description: string | null
  created_at: Date
  updated_at: Date
  created_by: string | null // UUID
  completed_at: Date | null
}

/**
 * Incident creation payload
 */
export interface IncidentCreate {
  title: string
  type: IncidentType
  priority: IncidentPriority
  location_address?: string | null
  location_lat?: number | null
  location_lng?: number | null
  status?: IncidentStatus
  training_flag?: boolean
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
  critical: 'Kritisch',
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
 */
export const KANBAN_COLUMNS = [
  {
    id: 'eingegangen',
    title: 'EINGEGANGEN',
    status: ['eingegangen'] as IncidentStatus[],
    color: 'bg-zinc-800/50',
  },
  {
    id: 'reko',
    title: 'REKO',
    status: ['reko'] as IncidentStatus[],
    color: 'bg-green-800/30',
  },
  {
    id: 'disponiert',
    title: 'DISPONIERT',
    status: ['disponiert'] as IncidentStatus[],
    color: 'bg-blue-900/30',
  },
  {
    id: 'einsatz',
    title: 'EINSATZ',
    status: ['einsatz'] as IncidentStatus[],
    color: 'bg-orange-900/30',
  },
  {
    id: 'einsatz_beendet',
    title: 'EINSATZ BEENDET',
    status: ['einsatz_beendet'] as IncidentStatus[],
    color: 'bg-blue-800/30',
  },
  {
    id: 'abschluss',
    title: 'ABSCHLUSS',
    status: ['abschluss'] as IncidentStatus[],
    color: 'bg-zinc-900/50',
  },
] as const
