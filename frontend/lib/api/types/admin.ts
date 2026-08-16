/**
 * Admin / training import-export types.
 */

/** `merge` used to be accepted here and did exactly what `replace` does. It is a 400 now. */
export type ExcelImportMode = 'replace' | 'append'

/** What the previewed import would DELETE. All zero for `append`.
 *
 *  Two different kinds of damage live in here and they must not be read as one list:
 *
 *  - `*_assignments` are rows LEFT BEHIND. An assignment references its resource by a
 *    bare UUID with no foreign key, so nothing cleans it up; it keeps pointing at
 *    personnel / vehicles / material that no longer exist. `incident_group_assignments`
 *    is the same hazard one level up, on Aufträge, whose resources hang off the route
 *    instead of off any of its stops. Both `active_*` are the subsets still on the
 *    board – the backend refuses a `replace` while their SUM is above zero.
 *  - `cascade_*` are rows that are DELETED WITH the resource: `personnel.id` is a real
 *    foreign key with ON DELETE CASCADE there, so they do not dangle, they vanish, and
 *    only a database backup brings them back.
 *
 *  Everything past the first five is optional on purpose: they were added after this
 *  shape shipped and are absent from a backend older than that (they are not in the
 *  schema's `required` list). Treat `undefined` as "not reported", never as zero. */
export interface ApiExcelImportDeletions {
  personnel: number
  vehicles: number
  materials: number
  incident_assignments: number
  active_incident_assignments: number
  incident_group_assignments?: number
  active_incident_group_assignments?: number
  /** Check-ins (Anwesenheiten) of every event, gone with the roster. */
  cascade_event_attendance?: number
  /** Assigned Spezialfunktionen – also cascaded by deleting a vehicle (Fahrer), not personnel-only. */
  cascade_event_special_functions?: number
  /** Links between a person and their alerting-provider account; have to be re-synced. */
  cascade_personnel_identities?: number
}

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
  mode: ExcelImportMode
  deletions: ApiExcelImportDeletions
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

/**
 * The shared secret a dispatch provider signs its alarm webhooks with
 * (`GET /api/settings/alarm-webhook-secret`, admin only).
 *
 * `source` decides whether the value can be rotated from the UI at all:
 * `env` means `ALARM_WEBHOOK_SECRET` is pinned in the deployment's `.env` and
 * wins over the database, so a rotation here would report success and change
 * nothing the webhook actually checks – the backend answers 409 instead.
 */
export interface ApiAlarmWebhookSecret {
  secret: string
  source: 'env' | 'database'
  configured: boolean
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
 *  the KP had to enter it – the honest provenance for that case. */
export interface ApiSimulatedRapport {
  incident_id: string
  incident_title: string
  filed_by: string | null
  /** How many of the incident's vehicles the simulated crew confirmed as present. */
  vehicles_present: number
  materials_ticked: number
  /** Scene photos the simulated crew attached – 0 most of the time, like a real one. */
  photos: number
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
