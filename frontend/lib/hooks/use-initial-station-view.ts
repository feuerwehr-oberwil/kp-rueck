import { useEffect, useRef } from 'react'
import { DEFAULT_CENTER_LATLNG, type LatLngPoint } from '@/lib/map-view'

interface StationMap {
  getCenter(): { lat: number; lng: number }
  jumpTo(options: { center: [number, number] }): unknown
}

/** Apply asynchronously loaded station coordinates once on an untouched, empty map. */
export function useInitialStationView(
  map: StationMap | null,
  coordinates: LatLngPoint,
  settingsReady: boolean,
  hasLocatedIncidents: boolean,
) {
  const applied = useRef(false)
  useEffect(() => {
    if (!map || !settingsReady || applied.current) return
    applied.current = true
    if (hasLocatedIncidents) return
    const center = map.getCenter()
    // A person may already have panned while settings were loading. Keep their view.
    if (Math.abs(center.lat - DEFAULT_CENTER_LATLNG[0]) > 1e-7
      || Math.abs(center.lng - DEFAULT_CENTER_LATLNG[1]) > 1e-7) return
    map.jumpTo({ center: [coordinates[1], coordinates[0]] })
  }, [map, coordinates, settingsReady, hasLocatedIncidents])
}
