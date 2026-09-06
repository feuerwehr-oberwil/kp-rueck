"use client"

/**
 * AssignmentLines — the red "ant trail" from a vehicle's GPS fix to the place it is driving to.
 *
 * MapLibre port (plan 28): all lines live in ONE GeoJSON source/line layer instead of a
 * `<Polyline>` each, so a board with twenty assignments is still one draw call. Two things have
 * no GL equivalent and are rebuilt here:
 *  - the marching dashes. Leaflet animated SVG `stroke-dashoffset`; MapLibre has no dash offset
 *    at all, so the phase is stepped into `line-dasharray` itself a few times a second (see
 *    `dashAtPhase`).
 *  - the sticky hover tooltip, which is a DOM `<Marker>` parked at the cursor's lng/lat and
 *    triggered from an invisible fat "hit" line on the same source (see `HIT_PAINT`).
 *
 * Must be rendered as a child of the shared `<BaseMap>`.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import type { Map as MlMap, MapLayerMouseEvent } from "maplibre-gl"
import { Layer, Marker, Source, useMap, type LineLayer } from "react-map-gl/maplibre"
import type { CSSProperties } from "react"
import type { Incident } from "@/lib/types/incidents"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import type { ApiVehiclePosition } from "@/lib/api-client"
import { STATUS_TO_GROUP, type IncidentStatus } from "@/lib/types/incidents"
import { vis, Z, type FeatureCollectionData } from "@/lib/map-view"
import { MapTooltip } from "./map-tooltip"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"

/** The one source/layer pair every assignment line lives in. Exported so a surface can order around it. */
export const ASSIGNMENT_SOURCE_ID = "assignment-lines"
export const ASSIGNMENT_LINE_LAYER_ID = "assignment-lines-line"
/** The invisible fat line under the visible one – see `HIT_PAINT`. This is what hover listens on. */
export const ASSIGNMENT_HIT_LAYER_ID = "assignment-lines-hit"

const LINE_COLOR = "#dc2626"
const LINE_WIDTH_PX = 2.5

// `line-dasharray` counts in LINE WIDTHS, not pixels – Leaflet's `dashArray: "8, 12"` on a
// 2.5px stroke is this. Change the width and both have to be recomputed.
const ANT_DASH = 8 / LINE_WIDTH_PX
const ANT_GAP = 12 / LINE_WIDTH_PX
const ANT_PERIOD = ANT_DASH + ANT_GAP

// Leaflet marched the pattern exactly one period per second (`stroke-dashoffset: -20` on a
// 20px period). MapLibre cannot interpolate a dash phase, so it is stepped – ten stops per
// period reads as motion without repainting the layer on every frame.
const ANT_STEPS = 10
const ANT_CYCLE_MS = 1000

/**
 * The dash pattern of `[ANT_DASH, ANT_GAP]` shifted `phase` units along the line.
 *
 * Four entries, always summing to one period, so the pattern's scale never changes as it walks:
 * inside a dash the remainder is split off to the front and the consumed part trails with a
 * zero-length gap; inside a gap the array opens with a zero-length dash instead.
 */
function dashAtPhase(phase: number): number[] {
  const p = phase % ANT_PERIOD
  return p < ANT_DASH ? [ANT_DASH - p, ANT_GAP, p, 0] : [0, ANT_PERIOD - p, ANT_DASH, p - ANT_DASH]
}

// Static on purpose: react-map-gl skips the whole paint diff while the object identity holds, so
// the interval-driven `line-dasharray` below is never overwritten by a re-render.
//
// The width stays a plain number at every zoom, unlike the routes and the GPS trails. It cannot
// interpolate: `line-dasharray` counts in line widths, so a width that grows with the zoom would
// stretch the dash pattern with it and the ants would march at a different pace on every scale.
const LINE_PAINT: LineLayer["paint"] = {
  "line-color": LINE_COLOR,
  "line-width": LINE_WIDTH_PX,
  "line-opacity": 0.8,
  "line-dasharray": dashAtPhase(0),
}

/**
 * The hover target. A 2.5 px dashed line is a fingernail-thin thing to hit with a mouse, and the
 * operator who cannot land it simply concludes the distance tooltip is broken – so a fully
 * transparent 18 px line rides on the same source, below the visible one, and the mouse listeners
 * bind to *its* id. Same trick as KP Front's `l-draw-hit`. Its width is static: nothing is drawn,
 * so a zoom-interpolated hit target would only make the aim worse when zoomed out.
 */
const HIT_PAINT: LineLayer["paint"] = {
  "line-color": LINE_COLOR,
  "line-width": 18,
  "line-opacity": 0,
}

/** Small pill label rendered at the midpoint of an assignment line. */
const DISTANCE_PILL: CSSProperties = {
  display: "inline-block",
  background: "rgba(255, 255, 255, 0.95)",
  color: LINE_COLOR,
  border: `1.5px solid ${LINE_COLOR}`,
  borderRadius: 9999,
  padding: "1px 7px",
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: "nowrap",
  boxShadow: "0 1px 4px rgba(0, 0, 0, 0.25)",
}

interface AssignmentLine {
  vehicleName: string
  vehiclePosition: [number, number]
  incidentPosition: [number, number]
  incidentTitle: string
  distanceMeters: number
}

interface AssignmentLinesProps {
  incidents: Incident[]
  vehiclePositions: ApiVehiclePosition[]
  visible?: boolean
  /** Show the vehicle→incident distance as a label on each assignment. */
  showDistances?: boolean
  /** The Aufträge, so a vehicle assigned to a ROUTE gets a line too — see
   *  `routeTargets`. Without these it drew none at all. */
  groups?: IncidentGroup[]
  /** Resolves a route's own resources (the vehicle names live here, not on the
   *  stops). Same resolver the route overlay and the hover card use. */
  groupResourcesFor?: (groupId: string) => GroupResources
}

/**
 * Which stop of an Auftrag its vehicles are driving to *now*.
 *
 * A route is worked in order, so one line per vehicle — to the stop in hand —
 * says where it is going. Drawing one to every remaining stop would fan five
 * red lines out of one MTW and answer a question nobody asked. A crew already
 * on site (`active`) is the stop in hand even if an earlier one is still open;
 * otherwise it is the first stop that is not finished.
 */
function currentStop(group: IncidentGroup, byId: Map<string, Incident>): Incident | undefined {
  const stops = group.stopIds.map(id => byId.get(id)).filter((stop): stop is Incident => stop !== undefined)
  const located = stops.filter(stop => stop.location_lat != null && stop.location_lng != null)
  return (
    located.find(stop => stop.status === "active")
    ?? located.find(stop => STATUS_TO_GROUP[stop.status as IncidentStatus] !== "completed")
  )
}

// Haversine distance in meters (same formula as the backend geofence checks).
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(meters: number): string {
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`
  return `${(meters / 1000).toFixed(1)} km`
}

/**
 * Normalize a name for fuzzy matching: lowercase, strip whitespace and punctuation.
 * e.g. "TLF 1" → "tlf1", "TLF1" → "tlf1"
 */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_.]+/g, '')
}

/**
 * Try to find a vehicle position matching a given vehicle name.
 * Uses multiple strategies:
 * 1. Exact lowercase match
 * 2. Normalized match (strip whitespace/punctuation)
 * 3. Containment check (device name contains vehicle name or vice versa)
 */
function findMatchingPosition(
  vehicleName: string,
  byExact: Map<string, ApiVehiclePosition>,
  byNormalized: Map<string, ApiVehiclePosition>,
  allPositions: ApiVehiclePosition[]
): ApiVehiclePosition | undefined {
  // Strategy 1: Exact lowercase
  const exact = byExact.get(vehicleName.toLowerCase())
  if (exact) return exact

  // Strategy 2: Normalized (strip whitespace)
  const normalized = byNormalized.get(normalizeName(vehicleName))
  if (normalized) return normalized

  // Strategy 3: Containment — one name contains the other
  const vNameNorm = normalizeName(vehicleName)
  for (const vp of allPositions) {
    const devNorm = normalizeName(vp.device_name)
    if (devNorm.includes(vNameNorm) || vNameNorm.includes(devNorm)) {
      return vp
    }
  }

  return undefined
}

/**
 * `true` while the operating system asks for reduced motion. The ants then stand still: a dashed
 * red line still reads as "this vehicle is driving there", the marching only makes it obvious.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  return reduced
}

/** What the cursor is currently over – the tooltip follows it along the line. */
interface LineHover {
  longitude: number
  latitude: number
  label: string
}

/**
 * Draws animated dashed red lines ("ant trails") from each vehicle's GPS
 * position to its assigned incident location.
 *
 * Only shows lines for:
 * - Vehicles that are online and have GPS coordinates
 * - Active assignments (not completed incidents)
 * - Incidents with valid coordinates
 */
export function AssignmentLines({
  incidents,
  vehiclePositions,
  visible = true,
  showDistances = false,
  groups,
  groupResourcesFor,
}: AssignmentLinesProps) {
  const t = useTranslations('map')
  const { current: map } = useMap()
  const [hover, setHover] = useState<LineHover | null>(null)
  const reducedMotion = usePrefersReducedMotion()

  const lines = useMemo(() => {
    if (!visible && !showDistances) return []

    const result: AssignmentLine[] = []
    // One line per vehicle per place, however the vehicle got there: a route
    // vehicle that is also assigned to the stop itself must not be drawn twice.
    const drawn = new Set<string>()

    // Stops are ordinary incidents; the route only carries their ids.
    const byId = new Map(incidents.map(incident => [incident.id, incident]))

    // Build lookup maps for vehicle positions
    const byExact = new Map<string, ApiVehiclePosition>()
    const byNormalized = new Map<string, ApiVehiclePosition>()
    for (const vp of vehiclePositions) {
      byExact.set(vp.device_name.toLowerCase(), vp)
      byNormalized.set(normalizeName(vp.device_name), vp)
    }

    // For each incident with assigned vehicles, try to find a matching GPS position
    for (const incident of incidents) {
      // Skip incidents without coordinates
      if (incident.location_lat == null || incident.location_lng == null) continue

      // Skip the whole completed group, Rückfahrt included — a drive-home
      // line was tried and dropped: the beendet column is noise on this layer.
      if (STATUS_TO_GROUP[incident.status as IncidentStatus] === "completed") continue

      for (const vehicle of incident.assigned_vehicles) {
        addLine(vehicle.name, incident)
      }
    }

    // The Aufträge: their vehicles belong to the ROUTE and hold no assignment on
    // any single stop, so every one of them was missing from this layer — the
    // squad the KP sent out as one job was the squad with no line on the map.
    for (const group of groups ?? []) {
      const stop = currentStop(group, byId)
      if (!stop) continue
      for (const vehicle of groupResourcesFor?.(group.id)?.vehicles ?? []) {
        addLine(vehicle.name, stop)
      }
    }

    return result

    /** Push one vehicle→place line, once, if that vehicle has a GPS fix. */
    function addLine(vehicleName: string, incident: Incident) {
      if (incident.location_lat == null || incident.location_lng == null) return
      const key = `${normalizeName(vehicleName)}|${incident.id}`
      if (drawn.has(key)) return
      const vp = findMatchingPosition(vehicleName, byExact, byNormalized, vehiclePositions)
      // No match is the normal case for a vehicle without a tracker, so it is
      // silent: logging it fired once per vehicle per render.
      if (!vp) return
      drawn.add(key)

      result.push({
        vehicleName,
        vehiclePosition: [vp.latitude, vp.longitude],
        incidentPosition: [incident.location_lat, incident.location_lng],
        // title is usually the raw address, so strip the home town from either
        incidentTitle: (incident.location_display ?? formatLocationForDisplay(incident.title || incident.location_address || '', getGlobalHomeCity())) || t('assignmentLines.incidentFallback'),
        distanceMeters: distanceMeters(vp.latitude, vp.longitude, incident.location_lat, incident.location_lng),
      })
    }
  }, [incidents, vehiclePositions, visible, showDistances, groups, groupResourcesFor, t])

  // A distance is a property OF a line. Drawn only while «Linien» was on, the labels became red
  // pills floating in open country with nothing to measure — so switching distances on brings
  // the lines with it.
  const drawn = visible || showDistances

  const data = useMemo<FeatureCollectionData>(
    () => ({
      type: "FeatureCollection",
      features: lines.map((line, index) => ({
        type: "Feature",
        id: index,
        // The whole tooltip sentence rides along: a hovered feature answers for itself,
        // without a second lookup back into `lines`.
        properties: {
          label: `${line.vehicleName} → ${line.incidentTitle} (${formatDistance(line.distanceMeters)})`,
        },
        geometry: {
          type: "LineString",
          // GeoJSON is [lng, lat]; the lines are built in [lat, lng].
          coordinates: [
            [line.vehiclePosition[1], line.vehiclePosition[0]],
            [line.incidentPosition[1], line.incidentPosition[0]],
          ],
        },
      })),
    }),
    [lines],
  )

  // The marching dashes. Driven imperatively rather than through the `<Layer>` paint prop: a
  // React re-render ten times a second for a cosmetic phase would walk the whole marker tree
  // with it.
  //
  // A `setInterval` at exactly the step rate, not a 60 Hz `requestAnimationFrame` that throws
  // five of every six frames away: each `setPaintProperty` repaints the entire GL scene, and this
  // board runs for weeks on a wall display. For the same reason the ticking stops outright while
  // the tab is hidden — nobody is watching, and the phase is picked up again on return.
  const animating = drawn && lines.length > 0 && !reducedMotion
  useEffect(() => {
    const instance: MlMap | undefined = map?.getMap()
    if (!instance || !animating) return

    let step = 0
    let timer: ReturnType<typeof setInterval> | undefined

    const advance = () => {
      step = (step + 1) % ANT_STEPS
      try {
        // The layer is gone while a style swap (auto→offline) is in flight.
        if (instance.getLayer(ASSIGNMENT_LINE_LAYER_ID)) {
          instance.setPaintProperty(
            ASSIGNMENT_LINE_LAYER_ID,
            "line-dasharray",
            dashAtPhase((step / ANT_STEPS) * ANT_PERIOD),
          )
        }
      } catch {
        /* the style is reloading — the next tick picks it up again */
      }
    }

    const start = () => {
      timer ??= setInterval(advance, ANT_CYCLE_MS / ANT_STEPS)
    }
    const stop = () => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    }
    const syncToVisibility = () => (document.visibilityState === "visible" ? start() : stop())

    syncToVisibility()
    document.addEventListener("visibilitychange", syncToVisibility)

    return () => {
      document.removeEventListener("visibilitychange", syncToVisibility)
      stop()
    }
  }, [map, animating])

  // Leaflet's `<Tooltip sticky>`: name the assignment while the pointer rides the line.
  // Registered on the raw map because a layer-scoped listener is not part of react-map-gl's
  // `<Map>` props – MapLibre ignores the id until the layer exists, so mount order is free.
  // Bound to the invisible hit layer, not the visible one: same source, same `label` property,
  // eighteen pixels of aim instead of two and a half.
  const handleMove = useCallback((event: MapLayerMouseEvent) => {
    const label = event.features?.[0]?.properties?.label
    setHover(
      typeof label === "string"
        ? { longitude: event.lngLat.lng, latitude: event.lngLat.lat, label }
        : null,
    )
  }, [])

  useEffect(() => {
    const instance: MlMap | undefined = map?.getMap()
    if (!instance) return

    const handleLeave = () => setHover(null)
    instance.on("mousemove", ASSIGNMENT_HIT_LAYER_ID, handleMove)
    instance.on("mouseleave", ASSIGNMENT_HIT_LAYER_ID, handleLeave)

    return () => {
      instance.off("mousemove", ASSIGNMENT_HIT_LAYER_ID, handleMove)
      instance.off("mouseleave", ASSIGNMENT_HIT_LAYER_ID, handleLeave)
    }
  }, [map, handleMove])

  // The source stays mounted even with nothing to show: remounting it would re-append the layer
  // on the next `styledata` and land it back on top of everything drawn after it (plan 28).
  return (
    <>
      <Source id={ASSIGNMENT_SOURCE_ID} type="geojson" data={data}>
        {/* First child = drawn first = underneath. Invisible either way, but it keeps the visible
            line the one that paints. Toggled with `vis()` like its sibling: a layer set to
            `visibility: none` is not hit-tested, which is exactly what we want when the lines
            are off. */}
        <Layer
          id={ASSIGNMENT_HIT_LAYER_ID}
          type="line"
          layout={{ ...vis(drawn), "line-cap": "round", "line-join": "round" }}
          paint={HIT_PAINT}
        />
        <Layer
          id={ASSIGNMENT_LINE_LAYER_ID}
          type="line"
          // Butt caps, unlike Leaflet's round ones: a stepped phase needs zero-length entries in
          // the dash array, and a round cap turns each of those into a dot on the line.
          layout={{ ...vis(drawn), "line-cap": "butt", "line-join": "round" }}
          paint={LINE_PAINT}
        />
      </Source>

      {drawn && hover && (
        <Marker longitude={hover.longitude} latitude={hover.latitude} style={{ pointerEvents: "none" }}>
          <div style={{ position: "relative" }}>
            <MapTooltip side="top">
              <span style={{ fontSize: 12, fontWeight: 500 }}>{hover.label}</span>
            </MapTooltip>
          </div>
        </Marker>
      )}

      {/* Distance labels at the line midpoints */}
      {showDistances &&
        lines.map((line, idx) => (
          <Marker
            key={`distance-${line.vehicleName}-${idx}`}
            longitude={(line.vehiclePosition[1] + line.incidentPosition[1]) / 2}
            latitude={(line.vehiclePosition[0] + line.incidentPosition[0]) / 2}
            style={{ pointerEvents: "none", zIndex: Z.distancePill }}
          >
            <div style={DISTANCE_PILL}>{formatDistance(line.distanceMeters)}</div>
          </Marker>
        ))}
    </>
  )
}
