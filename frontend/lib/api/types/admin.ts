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
