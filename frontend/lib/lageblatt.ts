/**
 * Das Lageblatt – der PDF-Ausdruck des Boards, den man in der Hand hält, wenn das
 * System nicht mehr da ist (siehe `docs/AUSFALL_SOP.md`).
 *
 * Speicherschlüssel, Takt und der Download selbst liegen hier statt in einer
 * Komponente, weil sie von vier Stellen aus gebraucht werden: der Einstellungszeile,
 * dem Benutzermenü, der Ereignis-Checkliste und dem Abschnitt «Ausfallsicherheit».
 * Vorher importierte `lib/checklist-tasks.ts` einen Schlüssel aus einer Einstellungs-
 * komponente – eine Abhängigkeitsrichtung, die man nicht zweimal erklären will.
 *
 * Der Schalter liegt bewusst im **localStorage**, nicht in der `settings`-Tabelle:
 * er lädt eine Datei auf DIESEN Rechner herunter. Ihn stationsweit zu setzen hiesse,
 * jedem Wanddisplay im Magazin alle 15 Minuten ein PDF in den Download-Ordner zu legen.
 */

import { apiClient } from '@/lib/api-client'

/** localStorage key for the per-device Lageblatt auto-download. */
export const LAGEBLATT_AUTODOWNLOAD_KEY = 'kp-lageblatt-autodownload'
/** localStorage key for the per-device download interval, in minutes. */
export const LAGEBLATT_AUTODOWNLOAD_INTERVAL_KEY = 'kp-lageblatt-autodownload-interval'
/** Default download interval in minutes. */
export const LAGEBLATT_AUTODOWNLOAD_DEFAULT_MIN = 15
/** Fired after either key changes so an already-mounted UserMenu picks it up. */
export const LAGEBLATT_AUTODOWNLOAD_EVENT = 'kp-lageblatt-autodownload-changed'

/** Read + clamp the per-device download interval (minutes) from localStorage. */
export function readLageblattInterval(): number {
  const raw = parseInt(localStorage.getItem(LAGEBLATT_AUTODOWNLOAD_INTERVAL_KEY) || '', 10)
  if (Number.isNaN(raw)) return LAGEBLATT_AUTODOWNLOAD_DEFAULT_MIN
  return Math.max(5, Math.min(120, raw))
}

export function downloadLageblatt(eventId: string, eventName: string) {
  return apiClient.exportEventLageblatt(eventId).then((blob) => {
    const slug =
      eventName
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'ereignis'
    const now = new Date()
    const stamp = `${now.toISOString().slice(0, 10)}-${now.toTimeString().slice(0, 5).replace(':', '')}`
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lageblatt-${slug}-${stamp}.pdf`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  })
}
