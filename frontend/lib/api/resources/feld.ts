/**
 * The login-less /feld surface: link, Feld-Code door, person claim and the field actions.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { getApiUrl } from '../../env'
import { translateOutsideReact } from '../../i18n-messages'
import {
  markRestReachable,
  markRestUnreachable,
  request as httpRequest,
  REQUEST_TIMEOUT_MS,
} from '../http'
import { errorCodeOf } from '../error-codes'
import {
  ApiError,
  NetworkError,
  type ApiFeldDuplicateCandidatesResponse,
  type ApiFieldRequestCreate,
  type ApiFeldPersonnelListResponse,
  type ApiFeldAssignmentsResponse,
  type ApiFeldAccessState,
  type ApiFeldContextResponse,
  type ApiFeldUnlockResponse,
  type ApiFeldClaimResponse,
  type ApiFeldIncidentCreate,
  type ApiFeldIncidentCreated,
  type ApiFeldIncidentUpdate,
  type ApiFeldOwnReport,
  type ApiFeldMaterialResponse,
  type ApiFieldReportState,
  type ApiFieldReportUpdate,
} from '../types'
import { duplicateQuery } from './incidents'

/**
 * Why the Feld-Code was refused — the four causes the door can produce.
 *
 * They are kept apart because the crew's next move differs for each: type it
 * again, wait, get a fresh link, or step outside and retry. `/feld` used to
 * collapse all four into one red «Falscher Code», which is the right answer in
 * exactly one of them.
 */
export type FeldUnlockFailure =
  /** The digits did not match. `attemptsLeft` is null against an older backend. */
  | { kind: 'wrong'; attemptsLeft: number | null }
  /** Too many failures from this IP — and a station NATs every phone, so this
   *  can be somebody else's typing. */
  | { kind: 'locked'; retryAfterSeconds: number }
  /** The link token expired (30 days). The code cannot fix this. */
  | { kind: 'expired' }
  /** The address is not the poster's link any more (backend `feld_reopen_qr`): scan the QR again. */
  | { kind: 'reopen' }
  /** The request never reached the server, so nothing was checked. */
  | { kind: 'offline' }

/** What `unlockFeld` rejects with — always this, never a bare `Error`. */
export class FeldUnlockError extends Error {
  constructor(readonly failure: FeldUnlockFailure) {
    super(`feld unlock refused: ${failure.kind}`)
    this.name = 'FeldUnlockError'
  }
}

// The four field actions. Every one is token + assignment gated server-side;
// none of them writes an assignment, which is what keeps /feld out of the
// board's conflict model.
export function feldQuery(incidentId: string, action: string, personnelId: string, token: string): string {
  return (
    `/api/feld/incidents/${incidentId}/${action}` +
    `?token=${encodeURIComponent(token)}&personnel_id=${encodeURIComponent(personnelId)}`
  )
}

export class FeldApi {
  // Feld (/feld) – the login-less field surface. One global link per Ereignis.
  //
  // Since plan 26 the link alone opens nothing: it is exchanged for an unlocked
  // token via the Feld-Code (`unlockFeld`), and that for a person-bound one when
  // somebody names themselves (`claimFeldPerson`). The phone stores the bound
  // token and stops using the link.
  /** `valid_until` is the link's own expiry (ISO), so a printed poster can say
   *  when it becomes waste paper. Absent on a backend older than that. */
  async generateFeldLink(eventId: string): Promise<{ token: string; link: string; full_url: string; qr_code_data: string; valid_until?: string }> {
    return httpRequest<{ token: string; link: string; full_url: string; qr_code_data: string; valid_until?: string }>(
      `/api/feld/generate-link?event_id=${encodeURIComponent(eventId)}`,
      {
        method: 'POST',
      }
    )
  }

  /** The door's proof of place: station + Ereignis, with the LINK token alone.
   *  Plain fetch, silent failure — the code screen renders without the proof
   *  rather than blocking the door on a cosmetic fetch. */
  async getFeldContext(token: string): Promise<ApiFeldContextResponse | null> {
    try {
      const response = await fetch(
        `${getApiUrl()}/api/feld/context?token=${encodeURIComponent(token)}`,
        { credentials: 'include', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      )
      if (!response.ok) return null
      return (await response.json()) as ApiFeldContextResponse
    } catch {
      return null
    }
  }

  /** The Feld-Code, and how many devices redeemed it. Editor only. */
  async getFeldAccess(eventId: string): Promise<ApiFeldAccessState> {
    return httpRequest<ApiFeldAccessState>(`/api/feld/access?event_id=${encodeURIComponent(eventId)}`)
  }

  /** A new code. Logs nobody out — see `revokeFeldDevices` for that. */
  async regenerateFeldCode(eventId: string): Promise<ApiFeldAccessState> {
    return httpRequest<ApiFeldAccessState>(
      `/api/feld/access/regenerate?event_id=${encodeURIComponent(eventId)}`,
      { method: 'POST' }
    )
  }

  /** The emergency brake: every bound device for this Ereignis is logged out. */
  async revokeFeldDevices(eventId: string): Promise<ApiFeldAccessState> {
    return httpRequest<ApiFeldAccessState>(
      `/api/feld/access/revoke-devices?event_id=${encodeURIComponent(eventId)}`,
      { method: 'POST' }
    )
  }

  /** Step 2 of the door: the code buys an unlocked token *and* the picker.
   *
   *  Its own `fetch` rather than `request()`, and both reasons are the screen
   *  behind it (`app/feld/page.tsx`): the four ways this can fail have four
   *  different answers, so the status and the body have to survive the call —
   *  `request()` flattens them into one message and shows a toast. And a 429
   *  must come back as a 429: `request()` treats it as retryable and would
   *  sleep on a locked-out phone before reporting anything at all.
   *
   *  Rejects with `FeldUnlockError` and never with anything else. */
  /**
   * The Feld door for a phone that is logged in to Rück: `/unlock` without a code, let in on
   * the session cookie (server-side; any active account). Null when that is not on — no
   * session, an expired one, an older backend, no network — and the code screen takes over as
   * before; a refused attempt here costs no try. Only an expired LINK is said out loud
   * (`expired`), because no code fixes that either.
   */
  async unlockFeldWithSession(token: string): Promise<ApiFeldUnlockResponse | null> {
    const url = `${getApiUrl()}/api/feld/unlock?token=${encodeURIComponent(token)}`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      return null
    }
    if (response.ok) return (await response.json()) as ApiFeldUnlockResponse
    if (response.status === 401 || response.status === 404) throw new FeldUnlockError({ kind: 'expired' })
    return null
  }

  async unlockFeld(token: string, code: string): Promise<ApiFeldUnlockResponse> {
    const url = `${getApiUrl()}/api/feld/unlock?token=${encodeURIComponent(token)}`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      // No answer at all: a cellar, a Funkloch, a dead uplink. The code was
      // never checked, which is a different sentence from "wrong".
      console.warn('[API] Feld unlock did not reach the server:', error)
      markRestUnreachable(true)
      throw new FeldUnlockError({ kind: 'offline' })
    }
    markRestReachable()

    if (response.ok) return (await response.json()) as ApiFeldUnlockResponse

    // `detail` is an object on the two answers that carry numbers and a plain
    // string on everything else (including a backend older than this client).
    const body = (await response.json().catch(() => undefined)) as { detail?: unknown; code?: unknown } | undefined
    const detail = body?.detail
    const field = (name: string): number | null => {
      if (typeof detail !== 'object' || detail === null) return null
      const value = (detail as Record<string, unknown>)[name]
      return typeof value === 'number' ? value : null
    }

    if (response.status === 429) {
      // The header says the same thing, but CORS hides it from a split-origin
      // deployment — so the body is the source and the header the fallback.
      const header = Number(response.headers.get('Retry-After'))
      const seconds = field('retry_after') ?? (Number.isFinite(header) && header > 0 ? header : 300)
      throw new FeldUnlockError({ kind: 'locked', retryAfterSeconds: seconds })
    }
    // The link token itself is gone: a poster that has hung there for 31 days.
    // No code helps, so the page must stop asking for one.
    if (response.status === 401 || response.status === 404) {
      throw new FeldUnlockError({ kind: 'expired' })
    }
    // The URL carries a device credential, not the poster's link (a bookmarked or
    // shared address after unlocking). No code opens that door — it used to read
    // «Falscher Code», which sent people typing the right digits again and again.
    if (errorCodeOf(body) === 'feld_reopen_qr') throw new FeldUnlockError({ kind: 'reopen' })
    throw new FeldUnlockError({ kind: 'wrong', attemptsLeft: field('attempts_left') })
  }

  /** Revoke this field device before deleting its local credential. A 401 is already revoked.
   * Uses its own fetch so a field-only 401 cannot sign out the interactive app's user. */
  async logoutFeld(token: string): Promise<void> {
    let response: Response
    try {
      response = await fetch(`${getApiUrl()}/api/feld/logout?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        credentials: 'include',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      markRestUnreachable(true)
      throw new NetworkError()
    }
    markRestReachable()
    if (response.ok || response.status === 401) return
    throw new ApiError(translateOutsideReact('feld.access.failed'), response.status)
  }

  /** Step 3: this device is that person from now on. */
  async claimFeldPerson(token: string, personnelId: string): Promise<ApiFeldClaimResponse> {
    return httpRequest<ApiFeldClaimResponse>(`/api/feld/claim?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      body: JSON.stringify({ personnel_id: personnelId }),
    })
  }

  /**
   * «Neue Meldung» — a Schadenplatz reported by somebody standing in front of it.
   *
   * `take_over` is the crew saying they will do it now; the response says which
   * of the three shapes that took (a stop on their Auftrag, a new Auftrag, or
   * just them), so the confirmation can be specific instead of "gespeichert".
   */
  /** «Möglicherweise dasselbe wie …» before a Meldung is sent from the field. */
  async getFeldDuplicateCandidates(
    personnelId: string,
    token: string,
    params: { lat: number; lng: number; address?: string | null },
  ): Promise<ApiFeldDuplicateCandidatesResponse> {
    const query = duplicateQuery(params)
    query.set('token', token)
    query.set('personnel_id', personnelId)
    return httpRequest<ApiFeldDuplicateCandidatesResponse>(`/api/feld/duplicates?${query.toString()}`, {
      skipToast: true,
      maxRetries: 0,
    })
  }

  async createFeldIncident(
    personnelId: string,
    token: string,
    payload: ApiFeldIncidentCreate,
  ): Promise<ApiFeldIncidentCreated> {
    return httpRequest<ApiFeldIncidentCreated>(
      `/api/feld/incidents?token=${encodeURIComponent(token)}&personnel_id=${personnelId}`,
      { method: 'POST', body: JSON.stringify(payload) },
    )
  }

  /**
   * Correct a Meldung you sent in yourself, while it is still «Eingegangen».
   *
   * 409 once the KP has disponiert it — at that point a crew is driving to the
   * address and it stops being the reporter's to change from a phone.
   */
  async updateFeldReport(
    incidentId: string,
    personnelId: string,
    token: string,
    payload: ApiFeldIncidentUpdate,
  ): Promise<ApiFeldOwnReport> {
    return httpRequest<ApiFeldOwnReport>(feldQuery(incidentId, 'report', personnelId, token), {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  /**
   * Check yourself in or out of the Ereignis from the field (decision 10).
   *
   * The individual half of `/check-in`, which stays a page for the shared
   * tablet at the door. Same attendance row either way — one roll call.
   */
  async setFeldAttendance(personnelId: string, token: string, present: boolean): Promise<void> {
    await httpRequest<unknown>(
      `/api/feld/attendance/${personnelId}?token=${encodeURIComponent(token)}&present=${present}`,
      { method: 'POST' },
    )
  }

  /** A short-lived form token so the Reko form can mount inside `/feld`. */
  async mintFeldRekoLink(
    incidentId: string,
    personnelId: string,
    token: string
  ): Promise<{ incident_id: string; token: string; link: string }> {
    return httpRequest<{ incident_id: string; token: string; link: string }>(
      feldQuery(incidentId, 'reko-link', personnelId, token),
      { method: 'POST' }
    )
  }

  async getFeldPersonnel(token: string): Promise<ApiFeldPersonnelListResponse> {
    return httpRequest<ApiFeldPersonnelListResponse>(
      `/api/feld/personnel?token=${encodeURIComponent(token)}`
    )
  }

  async getFeldAssignments(personnelId: string, token: string): Promise<ApiFeldAssignmentsResponse> {
    return httpRequest<ApiFeldAssignmentsResponse>(
      `/api/feld/assignments/${personnelId}?token=${encodeURIComponent(token)}`
    )
  }

  /**
   * Every material in the station and where it is — the Magazin's own view.
   *
   * The one read on this door that is not "only what is yours": a Materialwart
   * who sees only the units hanging off their own Schadenplätze cannot answer
   * "wo ist die zweite Tauchpumpe?". Gated on holding `magazin` in the Ereignis,
   * so it 403s for anybody else and the page never offers them the section.
   */
  async getFeldMaterial(personnelId: string, token: string): Promise<ApiFeldMaterialResponse> {
    return httpRequest<ApiFeldMaterialResponse>(
      `/api/feld/material?token=${encodeURIComponent(token)}&personnel_id=${personnelId}`
    )
  }

  /** "Angekommen". Idempotent – a second tap does not move the timestamp. */
  async feldReportArrived(incidentId: string, personnelId: string, token: string): Promise<ApiFieldReportState> {
    return httpRequest<ApiFieldReportState>(feldQuery(incidentId, 'arrived', personnelId, token), {
      method: 'POST',
    })
  }

  /** "Einsatz beendet". Does NOT close the card – that stays the KP's call. */
  async feldReportComplete(incidentId: string, personnelId: string, token: string): Promise<ApiFieldReportState> {
    return httpRequest<ApiFieldReportState>(feldQuery(incidentId, 'complete', personnelId, token), {
      method: 'POST',
    })
  }

  /** "Abholung nötig" / "abgeholt" – also the answer to the beendet follow-up. */
  async feldReportPickup(
    incidentId: string,
    personnelId: string,
    token: string,
    needed: boolean,
    note?: string | null
  ): Promise<ApiFieldReportState> {
    return httpRequest<ApiFieldReportState>(feldQuery(incidentId, 'pickup', personnelId, token), {
      method: 'POST',
      body: JSON.stringify({ needed, note: note ?? null }),
    })
  }

  /** Freitext-Meldung an den KP – a chip or a typed sentence. */
  async feldSendMessage(
    incidentId: string,
    personnelId: string,
    token: string,
    message: string | ApiFieldRequestCreate,
  ): Promise<void> {
    // A plain string is the chip / typed sentence every phone has always sent;
    // the object form is a structured «Material nötig» / «Verstärkung nötig» (R13).
    const body = typeof message === 'string' ? { message } : message
    await httpRequest<void>(feldQuery(incidentId, 'message', personnelId, token), {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /** The KP twin (decision 28): the same three reports, dictated over the radio. */
  async setIncidentFieldReport(incidentId: string, update: ApiFieldReportUpdate): Promise<ApiFieldReportState> {
    return httpRequest<ApiFieldReportState>(`/api/incidents/${incidentId}/field-report`, {
      method: 'POST',
      body: JSON.stringify(update),
    })
  }
}
