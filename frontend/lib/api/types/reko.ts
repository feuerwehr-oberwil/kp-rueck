/**
 * Reko (reconnaissance) report + dashboard types.
 */

import type { In, Out } from '../wire'

export type ApiDangersAssessment = Out<'DangersAssessment'>

export type ApiEffortEstimation = Out<'EffortEstimation'>

/** «Stromversorgung»: the four answers (backend `PowerSupply`). */
export type ApiPowerSupply = NonNullable<Out<'RekoReportResponse'>['power_supply']>

/** The body of a field write (`POST /api/reko/`): the report's fields, the incident and the
 *  link's token. No `is_draft` — only the `submit` query param may change it. */
export type ApiRekoReportCreate = In<'RekoReportCreate'>

/** The body of a KP write: the report's fields and nothing else. No token — the session is
 *  the identity (plan 26 §5.1). The nested assessments are partial: the server merges them. */
export type ApiRekoReportUpdate = Omit<In<'RekoReportUpdate'>, 'dangers_json' | 'effort_json'> & {
  dangers_json?: Partial<ApiDangersAssessment> | null
  effort_json?: Partial<ApiEffortEstimation> | null
}

/** A stored report. Provenance (plan 26 §5.3): `submitted_by_personnel_id` is the field
 *  side, the three `*_user_id` the KP side, and a mixed report carries both. All null
 *  means the report came in through the form link, which is the normal case. */
export type ApiRekoReportResponse = Out<'RekoReportResponse'>

/** What `POST /api/incidents/{id}/reko-arrived` answers. */
export type ApiRekoArrivedState = Out<'RekoArrivedState'>

/** `GET /api/reko/form`: the same report shape. */
export type ApiRekoFormResponse = ApiRekoReportResponse

// Bulk Reko Summary Types (performance optimization)
export type ApiRekoSummary = Out<'RekoSummary'>

/** The Reko result as the public share link carries it (`/api/viewer/data`).
 *
 *  Narrower than `ApiRekoSummary` on purpose — that endpoint has no session
 *  behind it: no free-text danger note, no submitter. Photo FILENAMES do ride
 *  along; the share token opens `/api/photos` for its own event (`rekoPhotoUrl`).
 *  Mirrors `ViewerRekoSummary` on the backend. */
export type ApiViewerRekoSummary = Out<'ViewerRekoSummary'>

export type ApiEventRekoSummariesResponse = Out<'EventRekoSummariesResponse'>

export type ApiRekoOpenAssignmentInfo = Out<'RekoOpenAssignmentInfo'>

export type ApiAvailableRekoPersonnel = Out<'AvailableRekoPersonnel'>

export type ApiAvailableRekoPersonnelResponse = Out<'AvailableRekoPersonnelResponse'>

/** The stored name of an uploaded Reko photo – what the form keeps and later deletes. */
export type ApiRekoPhotoUploaded = Out<'RekoPhotoUploaded'>

export type ApiRekoTransferResult = Out<'RekoTransferResult'>
