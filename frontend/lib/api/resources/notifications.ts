/**
 * The bell: notifications of one Ereignis, «gesehen», and the station's thresholds.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into the one
 * client object). Every call is quiet (`skipToast`) and keeps a lost answer to itself
 * (`reportsOutage: false`): the notification context says a failure in its own words and
 * has its own «unavailable» state; the board's own loads speak for the connection.
 */

import { request as httpRequest, requestVoid } from '../http'
import type { In, Out } from '../wire'

export type ApiNotification = Out<'NotificationResponse'>
export type ApiNotificationSettings = Out<'NotificationSettings'>
export type ApiNotificationSettingsUpdate = In<'NotificationSettingsUpdate'>

/** See the header: no toast, and no board-wide outage from the bell. */
const QUIET = { skipToast: true, reportsOutage: false } as const

export class NotificationsApi {
  /** The bell's poll: one try per tick, the next tick is the retry. */
  async getNotifications(eventId: string): Promise<ApiNotification[]> {
    return httpRequest<ApiNotification[]>(`/api/notifications/?event_id=${encodeURIComponent(eventId)}`, {
      ...QUIET,
      maxRetries: 0,
    })
  }

  async dismissNotification(id: string): Promise<void> {
    return requestVoid(`/api/notifications/${encodeURIComponent(id)}/dismiss`, {
      method: 'POST',
      ...QUIET,
    })
  }

  /** Awaited by the bell's poll: one try, so a dead settings route never holds up the list. */
  async getNotificationSettings(): Promise<ApiNotificationSettings> {
    return httpRequest<ApiNotificationSettings>('/api/notifications/settings/', { ...QUIET, maxRetries: 0 })
  }

  async updateNotificationSettings(patch: ApiNotificationSettingsUpdate): Promise<ApiNotificationSettings> {
    return httpRequest<ApiNotificationSettings>('/api/notifications/settings/', {
      method: 'PATCH',
      body: JSON.stringify(patch),
      ...QUIET,
    })
  }
}
