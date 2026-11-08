/**
 * Lagekarte: incidents at the SAME address are ONE pin with ONE label (owner, 08.11.2026,
 * «Joining – Both», look 3B). The pin wears the look of its most urgent member (priority glyph,
 * status frame – `byUrgency`) plus a small count badge; the label lists the numbers
 * («6 · 7 · 9 Bahnhofstrasse 1, Coop Center»); hover or a click opens the list to pick one.
 * Every device, every zoom – the overlap bubbles (`lib/map-clusters.ts`) then take a spot as one
 * pin of weight n.
 *
 * Same address = the same coordinates to 6 decimals (≈ 10 cm): a geocoded address lands on one
 * point, two houses next door do not.
 *
 * Pure, so it is unit-tested; drawn by `components/map-view.tsx`.
 */

import { byUrgency } from './map-clusters'
import { STATUS_TO_GROUP, type IncidentStatus } from './types/incidents'

/** What a spot needs of an incident – the board's `Incident` has it all. */
export interface SpotIncident {
  id: string
  /** Absent from a share-link payload. */
  number?: number | null
  priority: string | null | undefined
  status: IncidentStatus
  location_lat: number | null
  location_lng: number | null
}

/** One pin on the map: one incident, or several at one address. */
export interface MapSpot<T extends SpotIncident> {
  /** The coordinates to 6 decimals – stable across polls, the spot's hover/open identity. */
  key: string
  /** Every incident here, by number (the order of the label and the list). */
  incidents: T[]
  /** The most urgent one – the pin's look (`byUrgency`). */
  lead: T
  latitude: number
  longitude: number
}

/** The spot an incident's coordinates fall on. */
export function spotKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}:${longitude.toFixed(6)}`
}

const urgencyOf = (incident: SpotIncident) => ({
  id: incident.id,
  priority: incident.priority,
  statusGroup: STATUS_TO_GROUP[incident.status] ?? 'open',
})

/**
 * Groups the located incidents by address. Spots come in the order their first incident came in;
 * incidents without coordinates are left out (the map lists them in its «ohne Koordinaten» chip).
 */
export function groupSpots<T extends SpotIncident>(incidents: readonly T[]): MapSpot<T>[] {
  const byKey = new Map<string, T[]>()
  for (const incident of incidents) {
    if (incident.location_lat === null || incident.location_lng === null) continue
    const key = spotKey(incident.location_lat, incident.location_lng)
    const members = byKey.get(key)
    if (members) members.push(incident)
    else byKey.set(key, [incident])
  }
  return [...byKey].map(([key, members]) => {
    const sorted = [...members].sort(
      (a, b) =>
        (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
    )
    const lead = [...members].sort((a, b) => byUrgency(urgencyOf(a), urgencyOf(b)))[0]
    return { key, incidents: sorted, lead, latitude: lead.location_lat!, longitude: lead.location_lng! }
  })
}

/**
 * The spots that may merge into an overlap bubble: not one whose member is selected or
 * Reko-highlighted – that is what the operator is looking for. Such a spot stays out WHOLE; it is
 * never split to free the one member.
 */
export function clusterableSpots<T extends SpotIncident>(
  spots: readonly MapSpot<T>[],
  keepApart: ReadonlySet<string>,
): MapSpot<T>[] {
  return spots.filter((spot) => !spot.incidents.some((incident) => keepApart.has(incident.id)))
}

/** At most this many numbers in a label; a longer list ends in «+n». */
export const SPOT_NUMBERS_SHOWN = 4

/**
 * The numbers a same-address label shows: all of them up to `SPOT_NUMBERS_SHOWN`, beyond that
 * one fewer and «+n» for the rest – never «+1», which takes the room of the number it hides.
 * Incidents without a number (a share-link payload) are not counted.
 */
export function spotNumbers(
  incidents: readonly SpotIncident[],
  cap = SPOT_NUMBERS_SHOWN,
): { shown: number[]; more: number } {
  const numbers = incidents.flatMap((incident) => (incident.number != null ? [incident.number] : []))
  if (numbers.length <= cap) return { shown: numbers, more: 0 }
  return { shown: numbers.slice(0, cap - 1), more: numbers.length - (cap - 1) }
}

/** The label's number run: «6 · 7 · 9», «1 · 2 · 3 +4». Empty when nobody has a number. */
export function spotNumberText(incidents: readonly SpotIncident[]): string {
  const { shown, more } = spotNumbers(incidents)
  return shown.join(' · ') + (more > 0 ? ` +${more}` : '')
}
