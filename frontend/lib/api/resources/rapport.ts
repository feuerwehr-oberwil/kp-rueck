/**
 * The Schadenplatz-Rapport and its photos, from both doors (/feld and the board).
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { getApiUrl } from '../../env'
import { request as httpRequest } from '../http'
import type {
  ApiSchadenplatzRapport,
  ApiRapportUpdate,
  ApiMaterialReturnResponse,
  ApiRapportPhotosResponse,
} from '../types'
import { uploadPhotoFile, type PhotoUploadProgress } from './upload'
import { feldQuery } from './feld'

export class RapportApi {
  // The Schadenplatz-Rapport, from both doors. Same CRUD module underneath, so
  // the four calls below are two pairs of the same thing with a different
  // identity – which is exactly what lets one form component mount twice.

  /** The Rapport as the crew sees it. Prefilled when nothing has been filed yet. */
  async getFeldRapport(incidentId: string, personnelId: string, token: string): Promise<ApiSchadenplatzRapport> {
    return httpRequest<ApiSchadenplatzRapport>(feldQuery(incidentId, 'rapport', personnelId, token))
  }

  /** Autosave (`is_draft: true`) or file it (`false`). */
  async saveFeldRapport(
    incidentId: string,
    personnelId: string,
    token: string,
    update: ApiRapportUpdate
  ): Promise<ApiSchadenplatzRapport> {
    return httpRequest<ApiSchadenplatzRapport>(feldQuery(incidentId, 'rapport', personnelId, token), {
      method: 'PUT',
      body: JSON.stringify(update),
    })
  }

  /** The same Rapport from the board – the radio-message case. */
  async getIncidentRapport(incidentId: string): Promise<ApiSchadenplatzRapport> {
    return httpRequest<ApiSchadenplatzRapport>(`/api/incidents/${incidentId}/rapport`)
  }

  async saveIncidentRapport(incidentId: string, update: ApiRapportUpdate): Promise<ApiSchadenplatzRapport> {
    return httpRequest<ApiSchadenplatzRapport>(`/api/incidents/${incidentId}/rapport`, {
      method: 'PUT',
      body: JSON.stringify(update),
    })
  }

  // Rapport photos, from both doors (§6.1). The crew photographs the cellar; the
  // KP attaches the photo that arrived by WhatsApp. Same storage, same files –
  // but a feld token never opens the Reko photo endpoints and vice versa.

  async uploadFeldPhoto(
    incidentId: string,
    personnelId: string,
    token: string,
    file: File,
    onProgress?: PhotoUploadProgress,
  ): Promise<ApiRapportPhotosResponse> {
    return uploadPhotoFile<ApiRapportPhotosResponse>(
      feldQuery(incidentId, 'photos', personnelId, token),
      file,
      {},
      onProgress,
    )
  }

  async deleteFeldPhoto(
    incidentId: string,
    personnelId: string,
    token: string,
    filename: string
  ): Promise<ApiRapportPhotosResponse> {
    return httpRequest<ApiRapportPhotosResponse>(
      feldQuery(incidentId, `photos/${encodeURIComponent(filename)}`, personnelId, token),
      { method: 'DELETE' }
    )
  }

  /**
   * The `<img src>` for a rapport photo on `/feld` – an absolute URL, because it
   * goes into markup rather than through `request()`.
   *
   * The board's `GET /api/photos/...` needs a session cookie and `/feld` has
   * none, so it answered every field photo with a 401. This is the same
   * two-step (event token + assigned personnel) as every other feld call.
   */
  feldPhotoUrl(incidentId: string, personnelId: string, token: string, filename: string): string {
    return (
      getApiUrl() +
      feldQuery(incidentId, `photos/${encodeURIComponent(filename)}`, personnelId, token)
    )
  }

  async uploadRapportPhoto(incidentId: string, file: File): Promise<ApiRapportPhotosResponse> {
    return uploadPhotoFile<ApiRapportPhotosResponse>(`/api/incidents/${incidentId}/rapport/photos`, file)
  }

  async deleteRapportPhoto(incidentId: string, filename: string): Promise<ApiRapportPhotosResponse> {
    return httpRequest<ApiRapportPhotosResponse>(
      `/api/incidents/${incidentId}/rapport/photos/${encodeURIComponent(filename)}`,
      { method: 'DELETE' }
    )
  }

  /**
   * "Material zurück – freigeben" (decision 17): what the board MAY release.
   *
   * A read. The releasing itself goes through `unassignResource`, one unit at a
   * time – a field form must not silently write assignments, and the decision
   * stays with the operator.
   */
  async getRapportMaterialReturn(
    incidentId: string,
    options: { includeDraft?: boolean } = {},
  ): Promise<ApiMaterialReturnResponse> {
    // `includeDraft` is the completion gate's flag and nobody else's (§18.23):
    // that dialog only PREFILLS and the operator still confirms, while this
    // endpoint's other caller releases assignments on one click and must not
    // reach a half-typed checklist by accident. Server-side default is strict.
    const query = options.includeDraft ? '?include_draft=true' : ''
    return httpRequest<ApiMaterialReturnResponse>(`/api/incidents/${incidentId}/rapport/material-return${query}`)
  }

  /**
   * The completion gate's write-back: where the KP decided each unit stays.
   * «Vor Ort» sets `left_on_site` on the rapport's checklist row (or a
   * "Weiteres Material" entry, addressed by `name`), «Magazin» clears it — so
   * the Restliste reflects the confirmed decision, not only the crew's tick.
   * `applied` is false when the incident has no rapport row to write to.
   */
  async applyRapportMaterialDecisions(
    incidentId: string,
    decisions: { material_id?: string | null; name?: string | null; left_on_site: boolean }[],
  ): Promise<{ applied: boolean }> {
    return httpRequest<{ applied: boolean }>(`/api/incidents/${incidentId}/rapport/material-return`, {
      method: 'PATCH',
      body: JSON.stringify({ decisions }),
    })
  }
}
