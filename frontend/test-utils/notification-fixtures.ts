import type { Notification } from '@/lib/types/notification'

/** The fields of a bell row a test does not care about, as the server sends them when they
 *  are empty. Spread first: `{ ...UNSET_NOTIFICATION_FIELDS, id, type, … }`. */
export const UNSET_NOTIFICATION_FIELDS = {
  params: null,
  incident_id: null,
  event_id: null,
  dismissed: false,
  dismissed_at: null,
  dismissed_by: null,
} satisfies Partial<Notification>
