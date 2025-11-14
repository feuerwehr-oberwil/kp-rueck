export type NotificationSeverity = 'critical' | 'warning' | 'info'

export type NotificationType =
  | 'time_overdue'
  | 'no_personnel'
  | 'no_materials'
  | 'fatigue_warning'
  | 'missing_location'
  | 'event_size_limit'

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

  // Enabled alerts (can toggle individual types)
  enabled_time_alerts: boolean
  enabled_resource_alerts: boolean
  enabled_data_quality_alerts: boolean
  enabled_event_alerts: boolean
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
  material_depletion_threshold: {
    'Tauchpumpen': -1,
    'Wassersauger': -1,
    'Sägen': -1,
    'Generatoren': -1,
    'Anhänger': -1,
    'Elektrowerkzeug': -1,
  },

  // Event size limits
  database_size_limit_gb: 5,
  photo_size_limit_gb: 5,

  // Enabled alerts
  enabled_time_alerts: true,
  enabled_resource_alerts: true,
  enabled_data_quality_alerts: true,
  enabled_event_alerts: true,
}
