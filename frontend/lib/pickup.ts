/**
 * "Abholung nötig" — the crew is finished here and cannot get back on its own
 * (plan 25, decision 24).
 *
 * Not a status: a Schadenplatz can be finished and still have three people
 * standing in the rain. The flag deliberately survives the card moving to
 * `complete`, because completing an incident auto-releases the personnel while
 * they are physically still at the address — the one moment the board would
 * otherwise forget them.
 *
 * The formatting lives here rather than in the badge because the same chip is
 * rendered on the kanban card, in the detail header and on the map, and at
 * 02:00 the operationally decisive fact is *how long* they have been waiting.
 */

import { getActiveLocale } from '@/lib/i18n-messages'

/** Minutes since the pickup was requested, or null when it never was. */
export function pickupWaitingMinutes(since: Date | null | undefined, now: Date = new Date()): number | null {
  if (!since) return null
  const ms = now.getTime() - since.getTime()
  if (Number.isNaN(ms)) return null
  // A clock skew between the server and this device must not render "-3 Min".
  return Math.max(0, Math.floor(ms / 60000))
}

/** The clock time the pickup was asked for: "23:14". Empty when unknown. */
export function formatPickupSince(since: Date | null | undefined, locale?: string): string {
  if (!since || Number.isNaN(since.getTime())) return ''
  return since.toLocaleTimeString(locale ?? getActiveLocale(), { hour: '2-digit', minute: '2-digit' })
}

/**
 * How long they have been waiting: "42 Min", "1 h 20", "3 h".
 *
 * Switches to hours at 60 minutes because a three-digit minute count is the
 * kind of thing an operator has to stop and divide, which is exactly what a
 * glanceable chip must not ask for.
 */
export function formatPickupWaiting(since: Date | null | undefined, now: Date = new Date()): string {
  const minutes = pickupWaitingMinutes(since, now)
  if (minutes === null) return ''
  if (minutes < 60) return `${minutes} Min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`
}

/**
 * Settings key + shipped default for the `/feld` Freitext-Meldung chips
 * (decision 20).
 *
 * Station config, deliberately NOT i18n — the same reasoning that already makes
 * the outbound message bodies deployment config rather than translation. Stored
 * one chip per line, because the settings table is string-valued and the
 * Einstellungen page edits it in the same Textarea shape as the templates next
 * to it. The default must match `DEFAULT_SETTINGS` in
 * `backend/app/services/settings.py`.
 */
export const FELD_MESSAGE_CHIPS_KEY = 'feld.message_chips'

export const DEFAULT_FELD_MESSAGE_CHIPS = [
  'Verstärkung nötig',
  'Material nötig',
  'fertig in ~30 Min',
  'Einsatzstelle übergeben',
].join('\n')
