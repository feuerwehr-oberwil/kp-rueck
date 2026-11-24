/**
 * One generated training incident – what «Normal», «Kritisch» and «Telefon» send. The
 * Übungs-Steuerung (`regie-provider.tsx`) and the phone board's footer menu
 * (`phone-intake-footer.tsx`) fire the same request and say it with the same toast.
 */

import { apiClient, type ApiIncident } from '@/lib/api-client'
import { formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils'

export type TrainingAlarm = 'normal' | 'critical' | 'phone'

/** The success toast's title, a key under `training.controls`. */
export const TRAINING_ALARM_TOAST = {
  normal: 'toastGenerated',
  critical: 'toastGeneratedCritical',
  phone: 'toastPhoneGenerated',
} as const satisfies Record<TrainingAlarm, string>

/** Generates one incident: a Telefon alarm arrives as an intake to check, the others as Normal
 *  or Kritisch. */
export async function generateTrainingAlarm(eventId: string, kind: TrainingAlarm): Promise<ApiIncident> {
  const [incident] = await apiClient.generateTrainingEmergency(
    eventId,
    kind === 'phone' ? { count: 1, source: 'intake' } : { category: kind, count: 1 },
  )
  return incident
}

/** The toast's line under the title: «Titel @ Ort». */
export function trainingAlarmLine(incident: ApiIncident): string {
  const location =
    incident.location_display ?? formatLocationForDisplay(incident.location_address ?? '', getGlobalHomeCity())
  return location ? `${incident.title} @ ${location}` : incident.title
}
