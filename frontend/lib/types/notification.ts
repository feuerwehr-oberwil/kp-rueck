import type { Out } from '@/lib/api/wire'

export type NotificationSeverity = Out<'NotificationSeverity'>

/** What the backend's `NotificationType` enum sends. A row's facts are `params`, one shape
 *  per type (backend/app/services/notification_params.py), worded by
 *  lib/notification-format.ts. */
export type NotificationType = Out<'NotificationType'>

/** A bell row as the board holds it: the wire row (`NotificationResponse`) with
 *  `created_at` parsed. `message` is the backend's German sentence, shown only when
 *  `params` is absent or not understood. */
export type Notification = Omit<Out<'NotificationResponse'>, 'created_at'> & { created_at: Date }

export type NotificationSettings = Out<'NotificationSettings'>

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  // Live mode thresholds
  live_eingegangen_min: 60,
  live_reko_min: 60,
  live_disponiert_min: 20,
  live_einsatz_hours: 2,
  live_rueckfahrt_min: 20,
  live_archive_hours: 1,

  // Training mode thresholds
  training_eingegangen_min: 90,
  training_reko_min: 90,
  training_disponiert_min: 30,
  training_einsatz_hours: 3,
  training_rueckfahrt_min: 30,
  training_archive_hours: 2,

  // Resource thresholds
  fatigue_hours: 4,
  material_depletion_threshold: {},

  // Event size limits
  database_size_limit_gb: 5,
  photo_size_limit_gb: 5,

  // Geofence settings
  enabled_geofence_alerts: true,
  geofence_radius_meters: 200,

  // Enabled alerts
  enabled_time_alerts: true,
  enabled_resource_alerts: true,
  enabled_data_quality_alerts: true,
  enabled_event_alerts: true,

  // Toast display
  toast_duration_seconds: 8,

  // Re-alarm: off
  re_alarm_interval_min: 0,
}
