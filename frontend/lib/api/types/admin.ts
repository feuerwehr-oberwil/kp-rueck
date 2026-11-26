/**
 * Admin / training import-export types.
 */

import type { Out } from '../wire'

/** `merge` used to be accepted here and did exactly what `replace` does. It is a 400 now. */
export type ExcelImportMode = Out<'ExcelImportPreview'>['mode']

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
export type ApiExcelImportDeletions = Out<'ExcelImportDeletions'>

/** One spreadsheet row of the import preview, keyed by column: a cell is text, a number or empty. */
export type ApiExcelPreviewRow = Record<string, string | number | boolean | null>

/** The backend publishes the preview rows as `dict[str, Any]`: one sheet row, cell by cell. */
export type ApiExcelImportPreview = Omit<
  Out<'ExcelImportPreview'>,
  'personnel_preview' | 'vehicles_preview' | 'materials_preview'
> & {
  personnel_preview: ApiExcelPreviewRow[]
  vehicles_preview: ApiExcelPreviewRow[]
  materials_preview: ApiExcelPreviewRow[]
}

export type ApiExcelImportResult = Out<'ExcelImportResult'>

/**
 * The shared secret a dispatch provider signs its alarm webhooks with
 * (`GET /api/settings/alarm-webhook-secret`, admin only).
 *
 * `source` decides whether the value can be rotated from the UI at all:
 * `env` means `ALARM_WEBHOOK_SECRET` is pinned in the deployment's `.env` and
 * wins over the database, so a rotation here would report success and change
 * nothing the webhook actually checks – the backend answers 409 instead.
 */
export type ApiAlarmWebhookSecret = Out<'AlarmWebhookSecret'>

export type ApiEmergencyTemplate = Out<'EmergencyTemplateResponse'>

export type ApiTrainingLocation = Out<'TrainingLocationResponse'>

/** The training Automatik (`PUT /api/training/events/{id}/autogen`, the Regie state): the switch, and its run – the Übung it
 *  feeds, since when (the «heisse Phase» counts from there), and `stopped: 'max'` once it switched
 *  itself off at the maximum. `run` is null before the first start. */
export type ApiAutogenState = Out<'AutogenStateResponse'>

/** Übungstempo of the Regie: scales the Autopilot's dwell times, the Automatik interval and
 *  the GPS drive speed (Ruhig 0.5 · Normal 1 · Sturm 2). */
export type ApiRegieTempo = Out<'RegieStateResponse'>['tempo']

/** One field step of an incident, the server's lifecycle (primary first). */
export type ApiRegieStepKey =
  | 'reko_arrived'
  | 'reko_report'
  | 'drive_to_incident'
  | 'vehicle_on_scene'
  | 'field_complete'
  | 'drive_to_magazin'
  | 'rapport'

export type ApiRegieStep = Out<'RegieStep'>

export type ApiRegieIncident = Out<'RegieIncident'>

/** One line of «Vorhin»: what the Regie did, newest first. `text` is German (server-built). */
export type ApiRegieHistoryItem = Out<'RegieHistoryItem'>

/** `GET /api/training/events/{id}/regie`: the Übungs-Steuerung's whole state, computed on read. */
export type ApiRegieState = Out<'RegieStateResponse'>

/** One simulated Schadenplatz-Rapport, as the Übungssteuerung reports it back
 *  (plan 25 §16). `filed_by` is null when the incident had nobody assigned and
 *  the KP had to enter it – the honest provenance for that case. */
export type ApiSimulatedRapport = Out<'SimulateRapportResponse'>

/** The bulk inject. `skipped` is not a failure count: those gaps are the
 *  Restliste, and finding them is the exercise. */
export type ApiSimulatedRapportBulk = Out<'SimulateBulkRapportResponse'>
