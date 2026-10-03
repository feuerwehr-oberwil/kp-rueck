import { Binoculars, Radio, Siren, Timer, Truck, type LucideIcon } from 'lucide-react'

import type { NotificationSource } from '@/lib/notification-format'

/**
 * The source of a notification is said by its glyph (and to screen readers),
 * not in the text — the toast and the bell draw the same one. `system` has
 * none: it keeps the severity glyph.
 */
export const NOTIFICATION_SOURCE_ICON: Partial<Record<NotificationSource, LucideIcon>> = {
  feld: Radio, // the field-report glyph on the board too (FieldStatusNudge)
  reko: Binoculars, // Reko carries the Binoculars everywhere in the app
  vehicle: Truck,
  alarm: Siren,
  time: Timer,
}
