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

/**
 * Incident reference for conflict prompts, badges and similar cross-incident
 * mentions: "Hauptstrasse 5 (Brandbekämpfung: Rauch aus Fenster…)". Address
 * alone loses the operator once several incidents run in the same street, so
 * the type and (truncated) Meldung ride along whenever they exist.
 */
export function getIncidentRefLabel(
  op: { location: string; incidentType?: string; notes?: string },
  maxMeldungLength = 60,
): string {
  const type = op.incidentType ? getIncidentTypeLabel(op.incidentType) : ""
  const meldung = (op.notes ?? "").trim()
  const shortMeldung = meldung.length > maxMeldungLength
    ? `${meldung.slice(0, maxMeldungLength).trimEnd()}…`
    : meldung
  const detail = [type, shortMeldung].filter(Boolean).join(": ")
  // Strip the home town ("…, 4104 Oberwil") like everywhere else. When the
  // address was ONLY the home town the formatted location is empty — then the
  // detail alone is the label (raw location as last resort).
  const location = formatLocationForDisplay(op.location, getGlobalHomeCity())
  if (!location) return detail || op.location
  return detail ? `${location} (${detail})` : location
}
