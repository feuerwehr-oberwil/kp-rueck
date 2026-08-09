export type NotificationSeverity = 'critical' | 'warning' | 'info'

export type NotificationType =
  | 'time_overdue'
  | 'no_personnel'
  | 'no_materials'
  | 'fatigue_warning'
  | 'missing_location'
  | 'event_size_limit'
  | 'vehicle_arrived'
  | 'vehicle_returned'
  // Field reporting (/feld, plan 25). The sidebar renders by severity, so these
  // need no card of their own — but the union has to know them, or a field
  // notification arrives typed as something it is not.
  // `field_pickup` is the only warning of the group: a crew waiting to be
  // collected is the one field event that is time-critical for the KP.
  | 'rapport_submitted'
  | 'field_arrived'
  | 'field_complete'
  | 'field_message'
  | 'field_pickup'

export interface Notification {
  id: string
  type: NotificationType
  severity: NotificationSeverity
  message: string
  incident_id?: string
  created_at: Date
  dismissed: boolean
}

export interface NotificationSettings {
  // Time thresholds (in minutes/hours)
  live_eingegangen_min: number
  live_reko_min: number
  live_disponiert_min: number
  live_einsatz_hours: number
  live_rueckfahrt_min: number
  live_archive_hours: number

  training_eingegangen_min: number
  training_reko_min: number
  training_disponiert_min: number
  training_einsatz_hours: number
  training_rueckfahrt_min: number
  training_archive_hours: number

  // Resource thresholds
  fatigue_hours: number
  material_depletion_threshold: Record<string, number>

  // Event size limits
  database_size_limit_gb: number
  photo_size_limit_gb: number

  // Geofence settings
  enabled_geofence_alerts: boolean
  geofence_radius_meters: number

  // Enabled alerts (can toggle individual types)
  enabled_time_alerts: boolean
  enabled_resource_alerts: boolean
  enabled_data_quality_alerts: boolean
  enabled_event_alerts: boolean

  // How long non-critical toasts stay on screen (seconds)
  toast_duration_seconds: number
}

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
}
