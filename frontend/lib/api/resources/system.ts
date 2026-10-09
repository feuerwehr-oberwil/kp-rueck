/**
 * Deployment role, demo mode and the first-run setup.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type { ApiDeployment, ApiSetupStatus, ApiSetupClaim, ApiSetupResult, DemoStatus } from '../types'

export class SystemApi {
  /**
   * What this deployment is allowed to do to the outside world.
   *
   * Public, and read at runtime rather than baked in at build time: the same image runs in
   * production and on staging, so the role can only come from the server it is talking to.
   * Returns null when the backend cannot be reached – the caller then assumes production,
   * which changes nothing on screen.
   */
  async getDeployment(): Promise<ApiDeployment | null> {
    try {
      return await httpRequest<ApiDeployment>('/api/deployment', { skipToast: true })
    } catch {
      return null
    }
  }

  // Demo Mode
  async getDemoStatus(): Promise<DemoStatus | null> {
    try {
      const result = await httpRequest<DemoStatus>('/api/demo/status', { skipToast: true })
      return result.demo ? result : null
    } catch {
      return null
    }
  }

  async createDemoSandbox(): Promise<{ event_id: string; name: string; reused: boolean }> {
    return httpRequest<{ event_id: string; name: string; reused: boolean }>('/api/demo/sandbox', {
      method: 'POST',
      skipToast: true,
    })
  }

  // First-run setup (unauthenticated — the wizard at /setup)

  /**
   * Whether this deployment has been claimed by a station yet. Returns null when the
   * backend cannot be reached — callers fail open (the login page stays a login page).
   */
  async getSetupStatus(): Promise<ApiSetupStatus | null> {
    // No retries and a short timeout, unlike every other GET: the setup and
    // login pages block their first paint on this answer, and "fail open into
    // the form after a few seconds" beats a minute of spinner behind the
    // default 3×20s retry ladder when the backend is down or still booting.
    try {
      return (
        (await httpRequest<ApiSetupStatus>('/api/setup/status', {
          skipToast: true,
          maxRetries: 0,
          signal: AbortSignal.timeout(4_000),
        })) ?? null
      )
    } catch {
      return null
    }
  }

  /**
   * Claim the board: names the station and creates the admin account.
   * Rejects with a 409 `ApiError` when someone else already claimed it,
   * 422 when the password is too short, 403 when the Einrichtungscode is
   * missing or wrong, 429 after too many wrong codes.
   */
  async claimSetup(data: ApiSetupClaim): Promise<ApiSetupResult> {
    return httpRequest<ApiSetupResult>('/api/setup', {
      method: 'POST',
      body: JSON.stringify(data),
      skipToast: true,
    })
  }
}
