/** The Lagekarte's camera: MapView's fits, flights and live zoom, and the padding they share. */

import { useEffect, useRef, useState } from "react"
import type { Map as MlMap } from "maplibre-gl"
import type { ApiVehiclePosition } from "@/lib/api-client"
import { isLocatedIncident, type MapIncident } from "@/lib/map-incident"
import { fitTo, type LatLngPoint } from "@/lib/map-view"
import { focusOffset } from "@/lib/map-labels"
import { useEffectEvent } from "@/lib/hooks/use-effect-event"
import { SELECTED_LABEL_ATTR } from "./incident-label"
import { INCIDENT_DOT_SIZE } from "./use-label-pass"

/** Every located incident as a `[lat, lng]` point — what `fitTo` frames. */
export function locatedPoints(incidents: MapIncident[]): LatLngPoint[] {
  return incidents
    .filter(isLocatedIncident)
    .map((inc): LatLngPoint => [inc.location_lat, inc.location_lng])
}

/** Leaflet's `padding: [x, y]`, in MapLibre's per-edge shape. */
export const pad = (value: number) => ({ top: value, bottom: value, left: value, right: value })

/** The fit padding for a base inset, measured at the moment of the fit (`chromeFitPadding`):
 *  the open legend and the top-right chip row widen their edges. */
export type FitPadding = (base: number) => ReturnType<typeof pad>

/** Live zoom level, so the vehicle pills can shrink when the operator zooms out. */
export function useMapZoom(map: MlMap | null, fallback: number): number {
  const [zoom, setZoom] = useState(fallback)
  useEffect(() => {
    if (!map) return
    const handler = () => setZoom(map.getZoom())
    handler()
    map.on("zoomend", handler)
    return () => { map.off("zoomend", handler) }
  }, [map])
  return zoom
}

/**
 * Auto-fit to every incident. Fits exactly once — the first time a locatable incident exists —
 * but keeps watching until then: on a cold cache the incidents arrive well after the map mounts,
 * and a mount-only effect would leave the operator at the default zoom forever.
 */
export function useFitBoundsOnce(map: MlMap | null, incidents: MapIncident[], padding: FitPadding) {
  const done = useRef(false)
  useEffect(() => {
    if (!map) return
    const points = locatedPoints(incidents)
    if (done.current || points.length === 0) return
    fitTo(map, points, { padding: padding(50), maxZoom: 15, duration: 0 })
    done.current = true
  }, [map, incidents, padding])
}

/**
 * The band a focused incident is readable in — see `usePanToSelected`.
 *
 * Below 13 a marker sits somewhere in the Baselbiet with no street to read it
 * against; above 17 the map is one building and the operator loses the
 * neighbours. Between the two, whatever scale they chose is the right one.
 */
const MIN_FOCUS_ZOOM = 13
export const MAX_FOCUS_ZOOM = 17

/** The phone camera's margin around pin + card, inside the map's own chrome. */
const FOCUS_MARGIN = 12

/**
 * Pin + the selected label (its card on the board) as a box around the pin's anchor, px – read
 * from the rendered bubble, so the card's real width, side and height count, not a guess. Just
 * the pin when no label is drawn (the pin sits in an overlap bubble, say).
 */
function selectedLabelBox(map: MlMap, lngLat: [number, number]) {
  const half = INCIDENT_DOT_SIZE / 2
  const box = { left: -half, top: -half, right: half, bottom: half }
  const bubble = map.getContainer().querySelector(`[${SELECTED_LABEL_ATTR}]`)
  if (!bubble) return box
  const container = map.getContainer().getBoundingClientRect()
  const rect = bubble.getBoundingClientRect()
  const anchor = map.project(lngLat)
  return {
    left: Math.min(box.left, rect.left - container.left - anchor.x),
    top: Math.min(box.top, rect.top - container.top - anchor.y),
    right: Math.max(box.right, rect.right - container.left - anchor.x),
    bottom: Math.max(box.bottom, rect.bottom - container.top - anchor.y),
  }
}

/**
 * Pan to the selected incident, KEEPING the operator's zoom. On the desktop the pin is centred; on
 * a phone (`compact`) the pin AND its card are – the pin lands left of centre so the card ends
 * inside the map, clear of the chrome (`focusOffset`, owner pick 6A).
 */
export function usePanToSelected(
  map: MlMap | null,
  selectedIncidentId: string | null,
  incidents: MapIncident[],
  trigger: number,
  compact: boolean,
  padding: FitPadding,
) {
  // The incidents are read, not depended on: a poll tick must not re-fly the map.
  const incidentsRef = useRef(incidents)
  useEffect(() => { incidentsRef.current = incidents }, [incidents])

  // The surface and the chrome are read at the moment of the flight: turning the phone or opening
  // the legend must not re-fly the map.
  const focusOffsetFor = useEffectEvent((center: [number, number]) =>
    compact && map
      ? focusOffset({
          width: map.getContainer().clientWidth,
          height: map.getContainer().clientHeight,
          padding: padding(FOCUS_MARGIN),
          box: selectedLabelBox(map, center),
        })
      : undefined,
  )

  useEffect(() => {
    if (!map || !selectedIncidentId) return
    const incident = incidentsRef.current.find((inc) => inc.id === selectedIncidentId)
    if (!incident || !incident.location_lat || !incident.location_lng) return

    // This used to fly to 16 every time, so clicking down a list of incidents zoomed in, out, in
    // again — the operator set a working scale and every click threw it away. The zoom is only
    // touched when it is outside the band where a marker is actually readable.
    const clamped = Math.min(Math.max(map.getZoom(), MIN_FOCUS_ZOOM), MAX_FOCUS_ZOOM)
    const center: [number, number] = [incident.location_lng, incident.location_lat]
    // Measured before the flight, at the current zoom: the card is screen-sized, so its box
    // around the pin is the same at the zoom the flight ends on. Left OUT when there is none:
    // MapLibre spreads the options over its `offset: [0, 0]`, so an explicit `undefined` wins
    // and `Point.convert(undefined)` throws – the «Kartenfehler» on every desktop hop from a
    // selected card to the map (19.11.2026).
    const offset = focusOffsetFor(center)
    map.flyTo({ center, zoom: clamped, ...(offset ? { offset } : {}), duration: 800 })
  }, [map, selectedIncidentId, trigger])
}

/** Zoom in on a specific vehicle by name (keyboard shortcuts 1-5). */
export function usePanToVehicle(
  map: MlMap | null,
  vehicleName: string | null,
  trigger: number,
  positions: ApiVehiclePosition[],
) {
  const positionsRef = useRef(positions)
  useEffect(() => { positionsRef.current = positions }, [positions])

  useEffect(() => {
    if (!map || !vehicleName || !trigger) return
    const vp = positionsRef.current.find(
      (p) => p.device_name.toLowerCase() === vehicleName.toLowerCase()
    )
    if (!vp) return
    map.flyTo({ center: [vp.longitude, vp.latitude], zoom: 17, duration: 800 })
  }, [map, vehicleName, trigger])
}

/** Reset zoom to show all incidents (the `z` shortcut / panel resize). */
export function useResetZoom(map: MlMap | null, trigger: number, incidents: MapIncident[], padding: FitPadding) {
  const incidentsRef = useRef(incidents)
  useEffect(() => { incidentsRef.current = incidents }, [incidents])

  useEffect(() => {
    if (!map || trigger === 0) return
    // The trigger also fires on a panel resize. `<BaseMap>` watches the container itself, so this
    // is only a belt-and-braces nudge — it replaces Leaflet's `invalidateSize()` double-timeout.
    map.resize()
    fitTo(map, locatedPoints(incidentsRef.current), { padding: padding(50), maxZoom: 15, duration: 800 })
  }, [map, trigger, padding])
}
