/**
 * Admin / training import-export types.
 */

export interface ApiExcelImportPreview {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  personnel_preview: Array<Record<string, any>>
  personnel_total: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vehicles_preview: Array<Record<string, any>>
  vehicles_total: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  materials_preview: Array<Record<string, any>>
  materials_total: number
}

export interface ApiExcelImportResult {
  success: boolean
  mode: string
  counts: {
    personnel: number
    vehicles: number
    materials: number
  }
  timestamp: string
}

export interface ApiEmergencyTemplate {
  id: string // UUID
  title_pattern: string
  incident_type: string
  category: 'normal' | 'critical'
  message_pattern: string
  title_variations: string[] | null
  message_variations: string[] | null
  created_at: string
  is_active: boolean
}

export interface ApiTrainingLocation {
  id: string // UUID
  street: string
  house_number: string
  postal_code: string
  city: string
  building_type: string | null
  latitude: number | null
  longitude: number | null
  is_active: boolean
}

/** One simulated Schadenplatz-Rapport, as the Übungssteuerung reports it back
 *  (plan 25 §16). `filed_by` is null when the incident had nobody assigned and
 *  the KP had to enter it — the honest provenance for that case. */
export interface ApiSimulatedRapport {
  incident_id: string
  incident_title: string
  filed_by: string | null
  /** How many of the incident's vehicles the simulated crew confirmed as present. */
  vehicles_present: number
  materials_ticked: number
  message: string
}

/** The bulk inject. `skipped` is not a failure count: those gaps are the
 *  Restliste, and finding them is the exercise. */
export interface ApiSimulatedRapportBulk {
  candidates: number
  covered: number
  skipped: number
  rapports: ApiSimulatedRapport[]
  message: string
}
