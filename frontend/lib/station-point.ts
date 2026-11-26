/**
 * The station's own point (the Magazin) as `[lat, lng]`, or null when none is set – the
 * frontend twin of the backend's `get_station_coordinates`, in its key order: a complete legacy
 * `gps.station_*` pair wins (a geofence set up there must not silently move), the Allgemein
 * `firestation_*` pair is the fallback. The geocoder bias, the route start, the map's station
 * marker and the GPS settings read this one answer.
 */
export function stationPoint(settings: Readonly<Record<string, string | undefined>>): [number, number] | null {
  for (const [latKey, lngKey] of [
    ["gps.station_lat", "gps.station_lng"],
    ["firestation_latitude", "firestation_longitude"],
  ] as const) {
    const lat = Number.parseFloat(settings[latKey] ?? "")
    const lng = Number.parseFloat(settings[lngKey] ?? "")
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng]
  }
  return null
}
