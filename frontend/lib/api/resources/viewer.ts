/**
 * Share links: the read-only viewer and the token-gated alarm intake.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type {
  ApiEvent,
  ApiEventSpecialFunctionResponse,
  ApiEventFigures,
  ApiPersonnel,
  ApiVehicle,
  ApiVehiclePosition,
  ApiMaterialResource,
  ApiAssignment,
  IncidentType,
  IncidentPriority,
  ApiIncident,
  ApiIncidentGroup,
  ApiGroupAssignment,
  ApiViewerRekoSummary,
} from '../types'

/**
 * The share-link view of an incident – the situation, never the Melder.
 *
 * Mirrors the backend's `schemas.ViewerIncident`: `contact`, `contact_phone`
 * and `internal_notes` are not in the payload, and neither is the workflow
 * bookkeeping (rapport flags, `pickup_note`, field/user ids). `pickup_needed` /
 * `pickup_requested_at` are the exception and are here on purpose: a crew that
 * cannot get itself back is the situation, and the flag names nobody. Built
 * with `Pick` on purpose – a field is in the share payload only if it is named
 * here, and adding one to `ApiIncident` cannot leak it onto a wall by itself.
 */
export type ApiViewerIncident = Pick<
  ApiIncident,
  | 'id'
  | 'event_id'
  | 'title'
  | 'type'
  | 'priority'
  | 'status'
  | 'location_address'
  | 'location_display'
  | 'location_lat'
  | 'location_lng'
  | 'description'
  | 'source'
  | 'nachbarhilfe'
  | 'nachbarhilfe_note'
  | 'am_warten'
  | 'am_warten_note'
  | 'zu_fuss'
  | 'pickup_needed'
  | 'pickup_requested_at'
  | 'group_id'
  | 'group_position'
  | 'created_at'
  | 'updated_at'
  | 'completed_at'
  | 'status_changed_at'
  | 'assigned_vehicles'
  | 'has_completed_reko'
  | 'reko_arrived_at'
> & {
  /** Never sent – the operator behind a card is not part of a shared situation.
   *  Declared (as absent) so the mappers that read it stay honest and compile. */
  created_by?: null
}

/** Roster row on a shared display: enough to name and sort a person, no more.
 *  Availability is derived from this event's assignments, so the raw status
 *  column and the Divera link flag (`divera_linked`) stay behind. */
export type ApiViewerPersonnel = Pick<ApiPersonnel, 'id' | 'name' | 'role' | 'role_sort_order' | 'tags'> & {
  divera_linked?: null
}

/** Material panel row on a shared display.
 *
 *  `out_of_service` rides along and the legacy `status` mirror does not: the
 *  display derives «im Einsatz» from this event's assignments, but readiness is
 *  a station-wide fact it cannot reconstruct — and a wall that cannot tell
 *  «im Einsatz» from «defekt» paints a broken pump green. */
export type ApiViewerMaterial = Pick<
  ApiMaterialResource,
  'id' | 'name' | 'type' | 'location' | 'location_sort_order' | 'consumable' | 'group_id' | 'out_of_service'
>

/** Which resource sits on which incident – never who put it there, or when.
 *  `is_leader` rides along: the crew's names are already in the payload, and it
 *  only marks which of them leads (the display sorts the crew leader-first). */
export type ApiViewerAssignment = Pick<
  ApiAssignment,
  'id' | 'resource_type' | 'resource_id' | 'driver_stay' | 'is_leader'
>

/** Reko / driver / Magazin roles for the event. */
export type ApiViewerSpecialFunction = Pick<
  ApiEventSpecialFunctionResponse,
  'personnel_id' | 'function_type' | 'vehicle_id' | 'vehicle_name'
>

/** A resource an Auftrag owns, as the shared board names it. */
export type ApiViewerGroupAssignment = Pick<
  ApiGroupAssignment,
  'id' | 'resource_type' | 'resource_id' | 'unassigned_at' | 'driver_stay' | 'is_leader'
>

/** An Auftrag as a display draws it: name, colour, stops, progress and the
 *  resources it owns. No `created_by`, no `assigned_by` on the rows, and no
 *  Funkdurchsage bookkeeping – a display never makes an announcement. */
export type ApiViewerGroup = Pick<
  ApiIncidentGroup,
  'id' | 'event_id' | 'name' | 'color' | 'notes' | 'position' | 'created_at' | 'updated_at' | 'stop_ids' | 'progress'
> & {
  created_by?: null
  assignments: ApiViewerGroupAssignment[]
}

/** Read-only payload behind a share token (board/map/status displays).
 *
 * Every row is the narrow `ApiViewer*` shape, not the board's own – the token in
 * the URL is the only gate here, so what rides along is an allowlist on both
 * sides of the wire (`backend/app/schemas/viewer.py`). */
export interface ApiViewerData {
  event: ApiEvent
  incidents: ApiViewerIncident[]
  personnel: ApiViewerPersonnel[]
  materials: ApiViewerMaterial[]
  /** Full rows: a vehicle carries no personal data, and the fleet panel is what
   *  a status display is read for. */
  vehicles: ApiVehicle[]
  vehicle_positions: ApiVehiclePosition[]
  /** Present when the public viewer endpoint exposes Auftrag data. */
  groups?: ApiViewerGroup[]
  /** incident_id → assignments; lets the displays derive event-scoped
   *  availability (assigned vs. available) like the logged-in board. */
  assignments?: Record<string, ApiViewerAssignment[]>
  special_functions?: ApiViewerSpecialFunction[]
  /** incident_id → what the Reko reported, for incidents with a submitted
   *  report. Photos are not in there: the photo route needs the login. */
  reko_summaries?: Record<string, ApiViewerRekoSummary>
  /** Kennzahlen for the status wall — counts and reaction times only. */
  figures?: ApiEventFigures
}

export class ViewerApi {
  // Viewer (read-only access)
  async generateViewerLink(eventId: string): Promise<{ token: string; link: string; full_url: string; qr_code_data: string }> {
    return httpRequest<{ token: string; link: string; full_url: string; qr_code_data: string }>(
      `/api/viewer/generate-link?event_id=${encodeURIComponent(eventId)}`,
      {
        method: 'POST',
      }
    )
  }

  async getViewerData(token: string): Promise<ApiViewerData> {
    return httpRequest<ApiViewerData>(
      `/api/viewer/data?token=${encodeURIComponent(token)}`
    )
  }

  // Alarm intake (public token-gated alarm creation)
  async generateAlarmLink(eventId: string): Promise<{ token: string; link: string; full_url: string; qr_code_data: string }> {
    return httpRequest<{ token: string; link: string; full_url: string; qr_code_data: string }>(
      `/api/intake/generate-link?event_id=${encodeURIComponent(eventId)}`,
      {
        method: 'POST',
      }
    )
  }

  async getIntakeContext(token: string): Promise<{ event: { id: string; name: string; training_flag: boolean } }> {
    return httpRequest<{ event: { id: string; name: string; training_flag: boolean } }>(
      `/api/intake/context?token=${encodeURIComponent(token)}`,
      { skipToast: true }
    )
  }

  async createIntakeAlarm(token: string, data: {
    title: string
    type: IncidentType
    priority: IncidentPriority
    location_address?: string | null
    location_lat?: string | null
    location_lng?: string | null
    /** The board's «Meldung» — what the caller said the thing is. */
    description?: string | null
    contact?: string | null
    contact_phone?: string | null
    /** The board's «Notizen» — the further hints that came with the call. */
    internal_notes?: string | null
  }): Promise<{ id: string }> {
    return httpRequest<{ id: string }>(
      `/api/intake/alarm?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        body: JSON.stringify(data),
        skipToast: true,
      }
    )
  }
}
