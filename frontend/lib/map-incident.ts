import type { Operation } from "@/lib/contexts/operations-context"
import { asIncidentType, type Incident } from "@/lib/types/incidents"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"

/**
 * What the maps (`MapView`, the map page, the wall map) draw of an Einsatz – only that.
 * Built from the board's `Operation` by `toMapIncident`, on a signed-in map and on a
 * share-link map alike (whose operations come from `buildSituationData`), so the two read the
 * same and nothing here is a placeholder.
 */
export type MapIncident = Pick<
  Incident,
  | "id"
  | "title"
  | "type"
  | "priority"
  | "status"
  | "location_address"
  | "location_display"
  | "location_lat"
  | "location_lng"
  | "description"
  | "created_at"
  | "status_changed_at"
> & {
  number: number | null
  /** The vehicles on it, by name: the map matches a GPS pill to an Einsatz by name. */
  assigned_vehicles: ReadonlyArray<{ name: string }>
  /** How many people are on its own crew (the pin's crew counter). */
  crewCount: number
}

/** A MapIncident with coordinates – one the map can place. */
export type LocatedIncident = MapIncident & { location_lat: number; location_lng: number }

/** `incidents.filter(isLocatedIncident)`: the ones the map can place. */
export function isLocatedIncident(incident: MapIncident): incident is LocatedIncident {
  return incident.location_lat !== null && incident.location_lng !== null
}

/** The map's view of one board card. */
export function toMapIncident(op: Operation): MapIncident {
  return {
    id: op.id,
    number: op.number ?? null,
    title: op.location,
    type: asIncidentType(op.incidentType),
    priority: op.priority,
    status: op.status,
    location_address: op.location,
    location_display: op.locationDisplay ?? null,
    location_lat: op.coordinates?.[0] ?? null,
    location_lng: op.coordinates?.[1] ?? null,
    description: op.notes,
    created_at: op.dispatchTime,
    status_changed_at: op.statusChangedAt,
    assigned_vehicles: op.vehicles.map((vehicle) => ({ name: vehicle.name })),
    crewCount: op.crew.length,
  }
}

/** What a short label (and the marker's aria-label) calls the incident. */
export function shortAddressOf(incident: MapIncident): string {
  return (
    (incident.location_display ?? formatLocationForDisplay(incident.location_address ?? '', getGlobalHomeCity()))
    || incident.title
  )
}
