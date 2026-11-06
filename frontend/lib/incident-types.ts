import { translateOutsideReact } from '@/lib/i18n-messages'
import { formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils'

// Incident types mapping - matches database constraint
export const incidentTypeLabels: Record<string, string> = {
  brandbekaempfung: 'Brandbekämpfung',
  elementarereignis: 'Elementarereignis',
  strassenrettung: 'Strassenrettung',
  technische_hilfeleistung: 'Technische Hilfeleistung',
  oelwehr: 'Ölwehr',
  chemiewehr: 'Chemiewehr',
  strahlenwehr: 'Strahlenwehr',
  einsatz_bahnanlagen: 'Einsatz Bahnanlagen',
  bma_unechte_alarme: 'BMA / Unechte Alarme',
  dienstleistungen: 'Dienstleistungen',
  diverse_einsaetze: 'Diverse Einsätze',
  gerettete_menschen: 'Gerettete Menschen',
  gerettete_tiere: 'Gerettete Tiere',
}

// Get all incident type keys for dropdowns, sorted alphabetically with Elementarereignis first
export const incidentTypeKeys = (() => {
  const keys = Object.keys(incidentTypeLabels)

  // Sort alphabetically by German label
  const sorted = keys.sort((a, b) =>
    incidentTypeLabels[a].localeCompare(incidentTypeLabels[b], 'de')
  )

  // Move Elementarereignis to the front
  const elementarIndex = sorted.indexOf('elementarereignis')
  if (elementarIndex > -1) {
    sorted.splice(elementarIndex, 1)
    sorted.unshift('elementarereignis')
  }

  return sorted
})()

// Helper function to format incident types to localized labels
export function getIncidentTypeLabel(type: string): string {
  return type in incidentTypeLabels ? translateOutsideReact(`incidents.types.${type}`) : type
}

type IncidentRefSource = { location: string; locationDisplay?: string; incidentType?: string; notes?: string; number?: number | null }

/**
 * Incident reference for conflict prompts, badges and similar cross-incident
 * mentions: "Hauptstrasse 5 (Brandbekämpfung: Rauch aus Fenster…)". Address
 * alone loses the operator once several incidents run in the same street, so
 * the type and (truncated) Meldung ride along whenever they exist.
 */
export function getIncidentRefLabel(
  op: IncidentRefSource,
  maxMeldungLength = 60,
): string {
  const { head, detail } = getIncidentRefParts(op, maxMeldungLength)
  return detail ? `${head} (${detail})` : head
}

/**
 * `getIncidentRefLabel` in its two halves, for a note that sets them on two lines (the
 * assignment dialog's «where is it now»): `head` = number · address – what the place is found
 * by – and `detail` = «Einsatzart: Meldung», '' when there is none. When the address was ONLY
 * the home town the detail moves up into `head` (raw location as last resort).
 */
export function getIncidentRefParts(
  op: IncidentRefSource,
  maxMeldungLength = 60,
): { head: string; detail: string } {
  const type = op.incidentType ? getIncidentTypeLabel(op.incidentType) : ""
  const meldung = (op.notes ?? "").trim()
  const shortMeldung = meldung.length > maxMeldungLength
    ? `${meldung.slice(0, maxMeldungLength).trimEnd()}…`
    : meldung
  const detail = [type, shortMeldung].filter(Boolean).join(": ")
  // Home town is stripped server-side (locationDisplay); the client formatter
  // only covers ops the server hasn't labelled yet.
  const location = op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())
  const place = location || detail || op.location
  // The Einsatz number leads wherever an Einsatz is named in running text —
  // the Doppelbelegung prompt's «Bisher/Neu», bindings, pickers — so it reads
  // the same as on the card and in ⌘K.
  const head = op.number != null ? `${op.number} · ${place}` : place
  return { head, detail: location ? detail : "" }
}

/**
 * Canonical short label for an incident's location: the server-computed
 * home-city-stripped label when present (renders final on first paint — no
 * reformat flash), client-side formatting as fallback, and the incident type
 * when the address carries no information beyond the home city.
 */
export function getIncidentLocationLabel(
  op: { location: string; locationDisplay?: string; incidentType: string },
): string {
  const location = op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())
  return location || getIncidentTypeLabel(op.incidentType)
}
