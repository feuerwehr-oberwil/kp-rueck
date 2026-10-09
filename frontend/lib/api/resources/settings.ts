/**
 * Audit log, station settings, the alarm-webhook secret and the report logo.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { getApiUrl } from '../../env'
import { request as httpRequest } from '../http'
import type { ApiAuditLog, ApiAlarmWebhookSecret } from '../types'

export class SettingsApi {
  // Audit Logs
  async getAuditLogs(params?: {
    resource_type?: string
    resource_id?: string
    user_id?: string
    action_type?: string
    start_date?: string
    end_date?: string
    limit?: number
    offset?: number
  }): Promise<ApiAuditLog[]> {
    const queryParams = new URLSearchParams()

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.append(key, value.toString())
        }
      })
    }

    const endpoint = `/api/audit${queryParams.toString() ? `?${queryParams.toString()}` : ''}`
    return httpRequest<ApiAuditLog[]>(endpoint)
  }

  async getResourceHistory(resourceType: string, resourceId: string): Promise<ApiAuditLog[]> {
    return httpRequest<ApiAuditLog[]>(`/api/audit/resource/${resourceType}/${resourceId}`)
  }

  // Settings
  async getAllSettings(): Promise<Record<string, string>> {
    return httpRequest<Record<string, string>>('/api/settings/')
  }

  async getSetting(key: string): Promise<{ key: string; value: string }> {
    return httpRequest<{ key: string; value: string }>(`/api/settings/${key}`)
  }

  async updateSetting(key: string, value: string): Promise<{ key: string; value: string }> {
    return httpRequest<{ key: string; value: string }>(`/api/settings/${key}`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
    })
  }

  /**
   * Reveal the alarm-webhook secret (admin only, rate-limited, and written to the
   * audit trail as a `read` – the value never is). Deliberately NOT part of
   * `getAllSettings()`: credential-valued keys are masked there and refused by
   * `GET /api/settings/{key}`, so this is the only way to see it.
   *
   * Resolves to `undefined` when the request never reached the backend: `request()`
   * lets a failed GET degrade softly so polling callers keep their last known state
   * (see the network-error branch above), and `skipToast` means it does so without a
   * word. That is right for a poll and wrong for a button, so the type says it out
   * loud – the caller has to decide what "no answer" looks like. HTTP failures
   * (401/403/404) still reject with an `ApiError` carrying the backend's detail.
   */
  async getAlarmWebhookSecret(): Promise<ApiAlarmWebhookSecret | undefined> {
    return httpRequest<ApiAlarmWebhookSecret | undefined>('/api/settings/alarm-webhook-secret', {
      skipToast: true,
    })
  }

  /**
   * Generate a new secret. Rejects with a 409 `ApiError` when `source` is `env`
   * – the caller shows that message, it names the file to edit.
   *
   * Unlike the GET above this never resolves to nothing on a dead connection:
   * `request()` throws `NetworkError` for mutations, precisely so a write that
   * was never sent cannot be mistaken for one that succeeded.
   */
  async rotateAlarmWebhookSecret(): Promise<ApiAlarmWebhookSecret> {
    return httpRequest<ApiAlarmWebhookSecret>('/api/settings/alarm-webhook-secret/rotate', {
      method: 'POST',
      skipToast: true,
    })
  }

  /**
   * URL of the station logo used on printed exports – an <img src>, not a fetch:
   * the backend answers with image bytes, and 404 (no logo set) is a normal answer
   * the <img> reports through onError rather than an exception nobody asked for.
   *
   * The cache-buster is what makes a replaced logo visible immediately; the browser
   * would otherwise keep showing the old one from the in-memory image cache.
   */
  getReportLogoUrl(cacheBuster?: string | number): string {
    const suffix = cacheBuster === undefined ? '' : `?v=${cacheBuster}`
    return `${getApiUrl()}/api/settings/branding/logo${suffix}`
  }

  async uploadReportLogo(file: File): Promise<{ size: number }> {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(this.getReportLogoUrl(), {
      method: 'PUT',
      credentials: 'include',
      body: formData,
      signal: AbortSignal.timeout(60000),
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => null)
      throw new Error(detail?.detail || `Upload fehlgeschlagen (${response.status})`)
    }
    return response.json()
  }

  async deleteReportLogo(): Promise<void> {
    await httpRequest<void>('/api/settings/branding/logo', { method: 'DELETE' })
  }
}
