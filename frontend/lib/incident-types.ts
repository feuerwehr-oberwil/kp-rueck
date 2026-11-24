import { translateOutsideReact } from '@/lib/i18n-messages'
import { formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils'
import { INCIDENT_TYPES, isIncidentType, type IncidentType } from '@/lib/types/incidents'

/** The incident types in picker order (`INCIDENT_TYPES`). */
export const incidentTypeKeys: readonly IncidentType[] = INCIDENT_TYPES

// Helper function to format incident types to localized labels
export function getIncidentTypeLabel(type: string): string {
  return isIncidentType(type) ? translateOutsideReact(`incidents.types.${type}`) : type
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

// Home town is stripped server-side (locationDisplay); the client formatter
// only covers ops the server hasn't labelled yet.
function homeStrippedLocation(op: { location: string; locationDisplay?: string }): string {
  return op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())
}

/**
 * `getIncidentRefLabel` in its two halves, for a note that sets them on two lines (the
 * assignment dialog's «where is it now»): `head` = number · address – what the place is found
 * by – and `detail` = «Einsatzart: Meldung», '' when there is none; `place` = `head` without
 * the number. When the address was ONLY the home town the detail moves up into `head` (raw
 * location as last resort).
 */
export function getIncidentRefParts(
  op: IncidentRefSource,
  maxMeldungLength = 60,
): { head: string; detail: string; place: string } {
  const type = op.incidentType ? getIncidentTypeLabel(op.incidentType) : ""
  const meldung = (op.notes ?? "").trim()
  const shortMeldung = meldung.length > maxMeldungLength
    ? `${meldung.slice(0, maxMeldungLength).trimEnd()}…`
    : meldung
  const detail = [type, shortMeldung].filter(Boolean).join(": ")
  const location = homeStrippedLocation(op)
  const place = location || detail || op.location
  // The Einsatz number leads wherever an Einsatz is named in running text —
  // the Doppelbelegung prompt's «Bisher/Neu», bindings, pickers — so it reads
  // the same as on the card and in ⌘K.
  const head = op.number != null ? `${op.number} · ${place}` : place
  return { head, detail: location ? detail : "", place }
}

/** What a window is about: an Einsatz's number and its place (`SubjectLine`). */
export interface Subject {
  number?: number | null
  place: string
}

/**
 * The Einsatz a window is about, for its header line (`SubjectLine`): the number apart, so the
 * line can set it in muted mono, and the place as in `getIncidentRefParts` («14» · «Hauptstrasse 4»).
 */
export function incidentSubject(op: IncidentRefSource): Subject {
  return { number: op.number, place: getIncidentRefParts(op).place }
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
  return homeStrippedLocation(op) || getIncidentTypeLabel(op.incidentType)
}
