"use client"

/**
 * MapView — the Lagekarte, on MapLibre (plan 28, phase C).
 *
 * Serves both `/map` (the operating surface) and `/display/map` (the token wall display, which
 * feeds its data in through the `*Override` props and makes no authenticated call of its own).
 *
 * Everything that used to be a Leaflet `divIcon` HTML string is a real React component here, and
 * everything a Leaflet child component did with `useMap()` is a hook driven by the map instance
 * `<BaseMap>` hands over on load. The basemap itself — mode, style, offline fallback, dark look,
 * resize, GL recovery — belongs to `<BaseMap>`; this file only contributes content.
 */

import { Fragment, useState, useEffect, useMemo, useRef, useCallback, type CSSProperties, type ReactNode } from "react"
import type { Map as MlMap } from "maplibre-gl"
import { Marker, NavigationControl, type MapLayerMouseEvent } from "react-map-gl/maplibre"
import { useIncidents, type Operation } from "@/lib/contexts/operations-context"
import type { Incident, IncidentStatus, StatusGroup } from "@/lib/types/incidents"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import { BaseMap } from "./map/base-map"
import { MapTooltip } from "./map/map-tooltip"
import { GroupRoutes } from "./map/group-routes"
import { STATUS_TO_GROUP, STATUS_GROUP_BORDER_STYLE } from "@/lib/types/incidents"
import { apiClient, ApiVehiclePosition, ApiVehicle } from "@/lib/api-client"
import { MapLegend } from "./map-legend"
import { GpsSimBanner } from "./gps-sim-banner"
import { colorAccent, type ColorByDimension, type ColorGroup } from "@/lib/kanban-utils"
import { AssignmentLines } from "./map/assignment-lines"
import { OperationHoverCard } from "./map/operation-hover-card"
import { MAP_COLORS, PRIORITY_MARKER_COLORS } from "@/lib/map-colors"
import { DEFAULT_CENTER_LATLNG, fitTo, Z, type LatLngPoint } from "@/lib/map-view"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { VehicleTrails } from "./map/vehicle-trails"
import { Maximize, Truck, Users } from "lucide-react"
import { wsClient, type WebSocketStatus } from "@/lib/websocket-client"
import { useTranslations } from "next-intl"

// Status border color (dark gray for all statuses)
const STATUS_BORDER_COLOR = "#374151" // gray-700

// Permanent incident labels: the bubble sits to the RIGHT of the dot, its near edge this far
// from it — Leaflet's own `offset` (14) plus the 6px arrow margin it added on top. The leader
// line of a stepped label bridges exactly that distance back to the dot.
const LABEL_HEIGHT = 32
const LABEL_ANCHOR_X = 14
const LABEL_LEADER_DX = LABEL_ANCHOR_X + 6
// Grace period before an abandoned card closes — long enough to cross the seam
// into the next label, short enough that a card never lingers on its own.
const LABEL_HOVER_CLOSE_MS = 200

// Pill dimensions for vehicle markers (used by icon + tooltip offset).
const VEHICLE_PILL_HEIGHT = 24
function vehiclePillWidth(name: string): number {
  // 13px bold caps ≈ 8px/char + 16px horizontal padding. Floor at 28px.
  return Math.max(28, name.length * 8 + 16)
}

// Leaflet's tooltip look, as a shared gap: the arrow's 6px margin sat on top of every `offset`.
const TOOLTIP_ARROW = 6

/**
 * Above this speed a vehicle counts as MOVING – the floor for the km/h line in the hover
 * tooltip, and for the heading arrow beside the pill.
 *
 * A parked tracker still reports a metre of GPS jitter per fix, which arrives as a fraction of a
 * km/h with whatever `course` the noise happened to point at. Rendering that would make the
 * whole depot twitch.
 */
const MOVING_SPEED_KMH = 1

// Stable empties: the route overlay must stay MOUNTED even with nothing to draw, or react-map-gl
// re-appends its source on the next `styledata` and lands it on top of everything (plan 28).
const NO_GROUPS: IncidentGroup[] = []
const NO_OPERATIONS = new Map<string, Operation>()

// --- Marker visuals ---------------------------------------------------------

/**
 * One incident's dot: priority (or «Färben nach») fill, white ring, and an outer ring whose
 * DASH STYLE — solid / dashed / dotted — carries the status group. Never colour alone.
 */
function IncidentPin({
  incident,
  highlighted,
  accentColor,
  onActivate,
}: {
  incident: Incident
  highlighted: boolean
  accentColor?: string | null
  onActivate: () => void
}) {
  const t = useTranslations('map')
  // When a "Färben nach" dimension is active, the marker fill is overridden with
  // that group's colour; otherwise it falls back to the priority colour.
  const priorityColor =
    PRIORITY_MARKER_COLORS[incident.priority as keyof typeof PRIORITY_MARKER_COLORS] ?? MAP_COLORS.offline
  const fillColor = accentColor || priorityColor
  const size = highlighted ? 32 : 24

  const statusGroup = STATUS_TO_GROUP[incident.status as IncidentStatus] || 'open'
  const borderStyle = STATUS_GROUP_BORDER_STYLE[statusGroup]

  const borderRadius = size / 2
  const innerRadius = borderRadius - 3 // Leave space for border
  const strokeWidth = 2.5
  const borderOffset = strokeWidth / 2

  // D8: tabbable + screen-reader-friendly marker. Enter/Space activate it directly now —
  // under Leaflet the icon was an HTML string, so the key had to be caught on the map wrapper
  // and re-dispatched as a synthetic click.
  const a11yLabel =
    (incident.location_display ?? formatLocationForDisplay(incident.location_address ?? '', getGlobalHomeCity()))
    || incident.title
  const shadowId = `marker-shadow-${incident.id}`

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      tabIndex={0}
      role="button"
      aria-label={t('view.markerAria', { label: a11yLabel })}
      // The pulse used to be a `@keyframes` block injected into every single icon's HTML.
      className={highlighted ? "animate-pulse" : undefined}
      style={{ display: "block", transition: "all 0.2s ease", opacity: borderStyle.opacity, outline: "none" }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        onActivate()
      }}
    >
      <defs>
        <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy={highlighted ? 2 : 1}
            stdDeviation={highlighted ? 2 : 1}
            floodOpacity={highlighted ? 0.4 : 0.25}
          />
        </filter>
      </defs>

      {/* Priority fill circle with white border */}
      <circle
        cx={borderRadius}
        cy={borderRadius}
        r={innerRadius}
        fill={fillColor}
        stroke={highlighted ? MAP_COLORS.info : "white"}
        strokeWidth={3}
        filter={`url(#${shadowId})`}
      />

      {/* Status border ring (outer) */}
      <circle
        cx={borderRadius}
        cy={borderRadius}
        r={borderRadius - borderOffset}
        fill="none"
        stroke={STATUS_BORDER_COLOR}
        strokeWidth={strokeWidth}
        strokeDasharray={borderStyle.dasharray}
      />
    </svg>
  )
}

/** The incident dot as a map marker. A component for readability only – the hover state lives in
 *  the parent, so hovering one marker re-renders them all. Fine at a board's handful of pins. */
function IncidentMarker({
  incident,
  highlighted,
  accentColor,
  zIndex,
  onSelect,
  onHoverStart,
  onHoverEnd,
}: {
  incident: Incident
  highlighted: boolean
  accentColor?: string | null
  zIndex: number
  onSelect: () => void
  onHoverStart: () => void
  onHoverEnd: () => void
}) {
  const size = highlighted ? 32 : 24
  return (
    <Marker
      longitude={incident.location_lng!}
      latitude={incident.location_lat!}
      style={{ zIndex }}
      // A click on a DOM marker also reaches the map canvas under it (Leaflet swallowed it),
      // where it would count as an empty-map click and add a route stop.
      onClick={(event) => {
        event.originalEvent.stopPropagation()
        onSelect()
      }}
    >
      {/* `.custom-marker` is what the small-screen scale-down in globals.css hangs on. */}
      <div
        className="custom-marker"
        style={{ position: "relative", width: size, height: size }}
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
      >
        <IncidentPin
          incident={incident}
          highlighted={highlighted}
          accentColor={accentColor}
          onActivate={onSelect}
        />
      </div>
    </Marker>
  )
}

/** Shared pill chrome for the vehicle + Magazin markers. */
function pillStyle(background: string, width: number | string): CSSProperties {
  return {
    width,
    height: VEHICLE_PILL_HEIGHT,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background,
    color: "white",
    border: "2px solid white",
    borderRadius: 4,
    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
    whiteSpace: "nowrap",
    padding: "0 8px",
    boxSizing: "border-box",
  }
}

/**
 * Scale vehicle markers down at lower zoom levels so a stack of them doesn't dominate the town.
 * Full size only when fully zoomed in (zoom ≥ 15); at default Lagekarte zoom (13) they sit at
 * ~0.68, floored at 0.35 when fully zoomed out.
 */
function vehicleStackScale(zoom: number): number {
  if (zoom >= 15) return 1
  if (zoom <= 11) return 0.35
  return 0.35 + ((zoom - 11) / 4) * 0.65
}

// Clearance between the pill's edge and the tip of the heading arrow.
const HEADING_ARROW_GAP = 4

/**
 * Which way a moving vehicle is pointing: a small white triangle just outside the pill's edge,
 * rotated to the GPS `course` (0 = north, clockwise — Traccar's convention, and CSS's).
 *
 * A DOM element, not a MapLibre symbol layer: a style reload — which is exactly what the
 * auto→offline tile fallback does — drops every image registered on the GL map, and an
 * SDF/icon arrow would silently vanish with it. No counter-rotation is needed either, the board's
 * maps are north-up (`dragRotate` off, bearing pinned at 0).
 *
 * It sits at the pill's EDGE along the heading rather than on a fixed circle: the pill is a wide
 * rectangle, so a constant radius would park an eastbound arrow in the middle of the name.
 */
function HeadingArrow({ course, pillWidth }: { course: number; pillWidth: number }) {
  const radians = (course * Math.PI) / 180
  const sin = Math.abs(Math.sin(radians))
  const cos = Math.abs(Math.cos(radians))
  // Where the heading ray leaves the pill rectangle, measured from its centre.
  const distance =
    Math.min(
      sin === 0 ? Infinity : pillWidth / 2 / sin,
      cos === 0 ? Infinity : VEHICLE_PILL_HEIGHT / 2 / cos,
    ) + HEADING_ARROW_GAP

  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: 0,
        height: 0,
        // A CSS border triangle, pointing up at `rotate(0)` — i.e. north.
        borderLeft: "5px solid transparent",
        borderRight: "5px solid transparent",
        borderBottom: "6px solid #fff",
        filter: "drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45))",
        // Centre on the pill, turn to the heading, then step out along it.
        transform: `translate(-50%, -50%) rotate(${course}deg) translateY(-${distance}px)`,
        pointerEvents: "none",
      }}
    />
  )
}

/**
 * One GPS spot: a single vehicle's pill, or — when several share it — ONE counting pill
 * («5 Fahrzeuge»). Five idle vehicles at the depot used to blanket the village; the hover
 * tooltip still lists every one of them by name.
 */
function VehicleClusterMarker({
  vehicles,
  centroid,
  scale,
  groupLabel,
  nameFor,
}: {
  vehicles: ApiVehiclePosition[]
  centroid: [number, number]
  scale: number
  /** Set only when more than one vehicle shares the spot. */
  groupLabel?: string
  nameFor: (vehicle: ApiVehiclePosition) => string
}) {
  const t = useTranslations('map')
  const [hovered, setHovered] = useState(false)
  const label = groupLabel ?? vehicles[0].device_name
  const online = vehicles.some((vehicle) => vehicle.status === 'online')
  // Heading is a single vehicle's property. A counting pill speaks for several vehicles that may
  // well be driving in different directions, so it never wears an arrow.
  const single = vehicles.length === 1 && !groupLabel ? vehicles[0] : null
  const heading =
    single &&
    single.course !== null &&
    Number.isFinite(single.course) &&
    single.speed !== null &&
    single.speed > MOVING_SPEED_KMH
      ? single.course
      : null

  return (
    <Marker
      longitude={centroid[1]}
      latitude={centroid[0]}
      style={{ zIndex: Z.vehicle }}
      onClick={(event) => event.originalEvent.stopPropagation()}
    >
      {/* `transform: scale` leaves the LAYOUT box at its natural size, so the marker keeps
          centring the same point the unscaled pill was centred on. */}
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={{ transform: `scale(${scale})` }}>
          <div
            style={{
              ...pillStyle(online ? MAP_COLORS.info : MAP_COLORS.offline, vehiclePillWidth(label)),
              // Anchors the heading arrow to the pill itself, whatever the label's width.
              position: "relative",
            }}
          >
            {label}
            {heading !== null && <HeadingArrow course={heading} pillWidth={vehiclePillWidth(label)} />}
          </div>
        </div>
        {hovered && (
          <MapTooltip side="top" gap={TOOLTIP_ARROW + (VEHICLE_PILL_HEIGHT * scale) / 2 + 4}>
            <div className="text-sm space-y-1">
              {vehicles.map((vehicle) => (
                <div key={vehicle.device_id}>
                  <div className="font-semibold">{nameFor(vehicle)}</div>
                  {vehicle.speed !== null && vehicle.speed > MOVING_SPEED_KMH && (
                    <div className="text-xs text-muted-foreground">{Math.round(vehicle.speed)} km/h</div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {vehicle.status === 'online' ? t('common.online') : t('common.offline')}
                  </div>
                </div>
              ))}
            </div>
          </MapTooltip>
        )}
      </div>
    </Marker>
  )
}

/** A round marker carrying a single glyph — the firestation and the Magazin/GPS homebase. */
function GlyphMarker({
  coordinates,
  label,
  style,
  gap,
}: {
  coordinates: LatLngPoint
  label: string
  style: CSSProperties
  /** Anchor → tooltip edge. Half the glyph's height plus Leaflet's arrow margin. */
  gap: number
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <Marker
      longitude={coordinates[1]}
      latitude={coordinates[0]}
      style={{ zIndex: Z.station }}
      onClick={(event) => event.originalEvent.stopPropagation()}
    >
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={style}>⌂</div>
        {hovered && (
          <MapTooltip side="top" gap={gap}>
            <span>{label}</span>
          </MapTooltip>
        )}
      </div>
    </Marker>
  )
}

const FIRESTATION_STYLE: CSSProperties = {
  width: 24,
  height: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#dc2626",
  color: "white",
  border: "2px solid white",
  borderRadius: "50%",
  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
  fontSize: 14,
}

// Magazin (GPS-Heimatbasis) — a little home icon styled like the vehicle pills so it reads as
// "where the vehicles live". Only rendered when gps.station_lat/lng are set (Settings → GPS).
const MAGAZIN_STYLE: CSSProperties = { ...pillStyle(MAP_COLORS.info, 24), fontSize: 14 }

// --- Permanent labels -------------------------------------------------------

/**
 * Leaflet's tooltip bubble, rebuilt as a marker child.
 *
 * MapLibre has no tooltip of its own, and `<MapTooltip>` (which reproduces the same look for the
 * hover bubbles) is deliberately inert: a label is CLICKABLE, opaque, and may carry a leader line
 * instead of an arrow — so it gets its own chrome here.
 */
const LABEL_BUBBLE: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  padding: 6,
  background: "#fff",
  border: "1px solid #fff",
  borderRadius: 3,
  color: "#222",
  whiteSpace: "nowrap",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.4)",
  cursor: "pointer",
}

/** The 6px triangle on the bubble's left edge, pointing back at the dot. */
const LABEL_ARROW: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: -12,
  marginTop: -6,
  border: "6px solid transparent",
  borderRightColor: "#fff",
  pointerEvents: "none",
}

/**
 * Vertical offset per label. Empty for all but one case: a label sits at its own
 * dot, full stop.
 *
 * The exception is several incidents at exactly the same address. Their markers
 * are one dot on the screen, so their labels stack downwards from it — the only
 * place a leader line is needed, and a short one.
 *
 * Labels of *different* addresses may overlap. Keeping them apart was worse:
 * resolving every collision walked addresses hundreds of pixels away from their
 * markers with leader lines crossing half the town, and the address you then
 * read next to a dot was somebody else's. Whichever label is pointed at comes
 * to the front (see IncidentLabel).
 */
function stackSharedAddresses(incidents: Incident[]): Map<string, number> {
  const STEP = LABEL_HEIGHT + 2
  const offsets = new Map<string, number>()
  const seen = new Map<string, number>()
  for (const incident of incidents) {
    // 6 decimals ≈ 10cm: the same address, not merely the same neighbourhood.
    const spot = `${incident.location_lat!.toFixed(6)}:${incident.location_lng!.toFixed(6)}`
    const index = seen.get(spot) ?? 0
    seen.set(spot, index + 1)
    if (index > 0) offsets.set(incident.id, index * STEP)
  }
  return offsets
}

/**
 * Leader line for a label that had to step aside. Drawn inside the bubble, from its left edge
 * (which stays vertically centred on the label, even when it swells into the hover card) back to
 * the marker — so the address always names its own dot, never the nearest one.
 */
function LabelLeader({ dy }: { dy: number }) {
  const height = Math.abs(dy)
  return (
    <svg
      width={LABEL_LEADER_DX}
      height={height}
      style={{
        position: "absolute",
        overflow: "visible",
        pointerEvents: "none",
        opacity: 0.75,
        left: -LABEL_LEADER_DX,
        top: dy > 0 ? `calc(50% - ${height}px)` : "50%",
      }}
      aria-hidden="true"
    >
      {/* White underlay first: a 1px grey hairline disappears into a busy map. */}
      {["#ffffff", "#4b5563"].map((stroke, i) => (
        <line
          key={stroke}
          x1={0}
          y1={dy > 0 ? 0 : height}
          x2={LABEL_LEADER_DX}
          y2={dy > 0 ? height : 0}
          stroke={stroke}
          strokeWidth={i === 0 ? 3 : 1}
          strokeLinecap="round"
        />
      ))}
    </svg>
  )
}

/**
 * One incident's permanent map label — its own DOM marker at the incident's coordinates.
 *
 * Under Leaflet this was a tooltip instance that had to be mutated by hand (react-leaflet builds
 * a `<Tooltip>` once and ignores every later prop change), plus a DOM re-append to bring the
 * hovered one to the front. Here the step, the hover state and the stacking are all just props.
 *
 * The bubble hangs off a zero-sized wrapper, so the wrapper's origin IS the incident's anchor
 * point and the offsets read like Leaflet's did.
 */
function IncidentLabel({
  latitude,
  longitude,
  dy,
  hovered,
  selected,
  onSelect,
  onHoverStart,
  onHoverEnd,
  children,
}: {
  latitude: number
  longitude: number
  /** Downward step for a label sharing its address with another (see stackSharedAddresses). */
  dy: number
  hovered: boolean
  /** Selected on the map or highlighted from the list/Reko — the label belongs
   *  in front of its neighbours then too, not only under the pointer. */
  selected: boolean
  onSelect: () => void
  onHoverStart: () => void
  onHoverEnd: () => void
  children: ReactNode
}) {
  return (
    <Marker
      longitude={longitude}
      latitude={latitude}
      style={{ zIndex: hovered ? Z.labelHovered : selected ? Z.labelSelected : Z.label }}
      // The label is as tappable as the dot (selection, Reko-Modus assignment, …) — and, like
      // every marker here, must not let the click through to the map underneath.
      onClick={(event) => {
        event.originalEvent.stopPropagation()
        onSelect()
      }}
    >
      <div style={{ position: "relative", width: 0, height: 0 }}>
        <div
          style={{ ...LABEL_BUBBLE, transform: `translate(${LABEL_LEADER_DX}px, calc(-50% + ${dy}px))` }}
          onMouseEnter={onHoverStart}
          onMouseLeave={onHoverEnd}
        >
          {/* A stepped label is no longer level with its marker, so its arrow would point at
              empty map — the leader line takes over that job. */}
          {dy === 0 ? <span style={LABEL_ARROW} /> : <LabelLeader dy={dy} />}
          {children}
        </div>
      </div>
    </Marker>
  )
}

// --- Map controls -----------------------------------------------------------

/** Every located incident as a `[lat, lng]` point — what `fitTo` frames. */
function locatedPoints(incidents: Incident[]): LatLngPoint[] {
  return incidents
    .filter((inc) => inc.location_lat !== null && inc.location_lng !== null)
    .map((inc) => [inc.location_lat!, inc.location_lng!] as LatLngPoint)
}

/** Leaflet's `padding: [x, y]`, in MapLibre's per-edge shape. */
const pad = (value: number) => ({ top: value, bottom: value, left: value, right: value })

/** Live zoom level, so the vehicle pills can shrink when the operator zooms out. */
function useMapZoom(map: MlMap | null, fallback: number): number {
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
function useFitBoundsOnce(map: MlMap | null, incidents: Incident[]) {
  const done = useRef(false)
  useEffect(() => {
    if (!map) return
    const points = locatedPoints(incidents)
    if (done.current || points.length === 0) return
    fitTo(map, points, { padding: pad(50), maxZoom: 15, duration: 0 })
    done.current = true
  }, [map, incidents])
}

/**
 * The band a focused incident is readable in — see `usePanToSelected`.
 *
 * Below 13 a marker sits somewhere in the Baselbiet with no street to read it
 * against; above 17 the map is one building and the operator loses the
 * neighbours. Between the two, whatever scale they chose is the right one.
 */
const MIN_FOCUS_ZOOM = 13
const MAX_FOCUS_ZOOM = 17

/** Pan to the selected incident, KEEPING the operator's zoom. */
function usePanToSelected(
  map: MlMap | null,
  selectedIncidentId: string | null,
  incidents: Incident[],
  trigger: number,
) {
  // The incidents are read, not depended on: a poll tick must not re-fly the map.
  const incidentsRef = useRef(incidents)
  useEffect(() => { incidentsRef.current = incidents }, [incidents])

  useEffect(() => {
    if (!map || !selectedIncidentId) return
    const incident = incidentsRef.current.find((inc) => inc.id === selectedIncidentId)
    if (!incident || !incident.location_lat || !incident.location_lng) return

    // This used to fly to 16 every time, so clicking down a list of incidents zoomed in, out, in
    // again — the operator set a working scale and every click threw it away. The zoom is only
    // touched when it is outside the band where a marker is actually readable.
    const clamped = Math.min(Math.max(map.getZoom(), MIN_FOCUS_ZOOM), MAX_FOCUS_ZOOM)
    map.flyTo({ center: [incident.location_lng, incident.location_lat], zoom: clamped, duration: 800 })
  }, [map, selectedIncidentId, trigger])
}

/** Zoom in on a specific vehicle by name (keyboard shortcuts 1-5). */
function usePanToVehicle(
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
function useResetZoom(map: MlMap | null, trigger: number, incidents: Incident[]) {
  const incidentsRef = useRef(incidents)
  useEffect(() => { incidentsRef.current = incidents }, [incidents])

  useEffect(() => {
    if (!map || trigger === 0) return
    // The trigger also fires on a panel resize. `<BaseMap>` watches the container itself, so this
    // is only a belt-and-braces nudge — it replaces Leaflet's `invalidateSize()` double-timeout.
    map.resize()
    fitTo(map, locatedPoints(incidentsRef.current), { padding: pad(50), maxZoom: 15, duration: 800 })
  }, [map, trigger])
}

/**
 * «Alle Einsätze einpassen» — the one map control that was missing.
 *
 * The map auto-fits ONCE on mount (see useFitBoundsOnce) and then never again, so the moment a
 * new incident comes in outside the current view, or somebody pans away, getting back to «show me
 * everything» meant pinching around until it looked right.
 *
 * Positioned over the map like the legend. Pointer events are stopped so pressing it never
 * doubles as a map drag.
 */
function FitAllButton({ map, incidents }: { map: MlMap | null; incidents: Incident[] }) {
  const t = useTranslations('map')
  const points = locatedPoints(incidents)
  if (!map || points.length === 0) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        // padding keeps a marker's label off the edge; maxZoom stops a single incident from
        // slamming to street level, which loses all context
        fitTo(map, points, { padding: pad(60), maxZoom: 16, duration: 600 })
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute left-3 top-[88px] z-[1000] flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card/95 shadow-md backdrop-blur-sm hover:bg-card"
      title={t('fitAll')}
      aria-label={t('fitAll')}
    >
      <Maximize className="h-4 w-4 text-foreground" aria-hidden="true" />
    </button>
  )
}

// Warning banner for incidents without valid coordinates
function MissingLocationsWarning({ incidents, onIncidentClick }: { incidents: Incident[]; onIncidentClick?: (incidentId: string) => void }) {
  const t = useTranslations('map')
  const [isExpanded, setIsExpanded] = useState(false)

  if (incidents.length === 0) return null

  return (
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-warning/15 border border-warning text-warning-foreground px-4 py-2 rounded-lg shadow-md z-30 max-w-md backdrop-blur-sm">
      <div
        className="flex items-center gap-2 cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
        title={t('view.clickToExpand')}
      >
        <span className="font-semibold">
          {t('view.missingCoords', { count: incidents.length })}
        </span>
        <span className="text-sm ml-auto">
          {isExpanded ? "▼" : "▶"}
        </span>
      </div>

      {isExpanded && (
        <ul className="mt-3 space-y-1 text-sm border-t border-warning/50 pt-2 max-h-60 overflow-y-auto">
          {incidents.map((incident) => (
            <li
              key={incident.id}
              className="hover:bg-warning/20 px-2 py-1.5 rounded cursor-pointer transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                onIncidentClick?.(incident.id)
              }}
              title={t('view.clickToNavigate')}
            >
              <span className="font-medium">• {incident.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface MapViewProps {
  selectedIncidentId?: string | null
  onMarkerClick?: (incidentId: string) => void
  resetZoomTrigger?: number // Counter to trigger zoom reset
  panTrigger?: number // Counter to trigger pan to selected (for re-clicks)
  statusFilters?: Record<StatusGroup, boolean> // Status group visibility filters
  /** One incident rendered regardless of statusFilters — a deep link
   *  (`?highlight=`) to a closed incident, shown without touching the filters. */
  filterExceptionId?: string | null
  showAssignmentLines?: boolean // Show animated lines from vehicles to assigned incidents
  showDistances?: boolean // Show vehicle→incident distance labels on assignments
  showLabels?: boolean // Show permanent labels on incident markers
  focusVehicleName?: string | null // Vehicle name to zoom to (keys 1-5)
  focusVehicleTrigger?: number // Counter to re-trigger zoom to the same vehicle
  markerAccents?: Map<string, string> // incidentId -> fill colour ("Färben nach")
  highlightIncidentIds?: Set<string> // extra enlarged/pulsing markers (Reko-Modus)
  colorBy?: ColorByDimension // active "Färben nach" dimension (for the legend)
  colorGroups?: ColorGroup[] // legend entries for the active dimension
  // Aufträge (incident group) routes — read-only polyline display + Routenplanung.
  showGroupRoutes?: boolean // draw the numbered route polylines (off by default)
  groups?: IncidentGroup[] // Aufträge to draw
  /** Resolves a route's own crew/vehicles, so the hover card of any stop can
   *  show who is on it. Omitted outside the groups provider (token/display). */
  groupResourcesFor?: (groupId: string) => GroupResources
  operationsById?: Map<string, Operation> // stop lookup (stops are real incidents)
  focusGroupId?: string | null // emphasize one route, dim the rest (planning)
  highlightGroupStopId?: string | null // highlight one stop marker (focused stop)
  /** True while a tap-mode (Reko, Routenplanung) runs: hovering must NOT swap
   *  the label for the detail card. The swap replaced the click target mid-tap
   *  — the first tap died in the DOM churn and «remove» needed two. */
  hoverCardsDisabled?: boolean
  onGroupStopMarkerClick?: (incidentId: string) => void // click a numbered stop marker
  onMapClick?: (lat: number, lng: number) => void // empty-map click (add-stop mode)
  // Token/read-only display: feed data directly instead of auth-only contexts
  // and API fetches. When incidentsOverride is set, the map runs in token mode
  // (no getVehicles/getVehiclePositions/getAllSettings/WS).
  incidentsOverride?: Incident[]
  vehiclesOverride?: ApiVehicle[]
  positionsOverride?: ApiVehiclePosition[]
  /** Reports whether GPS is live (Traccar configured or a simulation running,
   *  positions present in token mode). The map knows this first-hand; the page
   *  around it uses the answer to hide controls that need GPS to do anything. */
  onGpsAvailabilityChange?: (available: boolean) => void
}

export default function MapView({
  selectedIncidentId,
  onMarkerClick,
  resetZoomTrigger = 0,
  panTrigger = 0,
  statusFilters = { open: true, active: true, completed: false },
  filterExceptionId = null,
  showAssignmentLines = true,
  showDistances = false,
  showLabels = true,
  focusVehicleName = null,
  focusVehicleTrigger = 0,
  markerAccents,
  highlightIncidentIds,
  colorBy = "priority",
  colorGroups = [],
  showGroupRoutes = false,
  groups,
  groupResourcesFor,
  operationsById,
  focusGroupId = null,
  highlightGroupStopId = null,
  hoverCardsDisabled = false,
  onGroupStopMarkerClick,
  onMapClick,
  incidentsOverride,
  vehiclesOverride,
  positionsOverride,
  onGpsAvailabilityChange,
}: MapViewProps) {
  const t = useTranslations('map')
  const tokenMode = incidentsOverride !== undefined
  const { incidents: contextIncidents } = useIncidents()
  const incidents = incidentsOverride ?? contextIncidents
  const [firestationName, setFirestationName] = useState<string>(() => t('view.firestationFallback'))
  const [firestationCoords, setFirestationCoords] = useState<LatLngPoint>(DEFAULT_CENTER_LATLNG)
  // Magazin/homebase from the GPS settings (gps.station_lat/lng) — null until configured
  const [magazinCoords, setMagazinCoords] = useState<[number, number] | null>(null)
  // The live map, handed over by <BaseMap> once it has loaded (and again after a GL recovery
  // remount). Everything that used to be a react-leaflet child with `useMap()` hangs off it.
  const [map, setMap] = useState<MlMap | null>(null)
  // Tracks live zoom so vehicle markers can shrink when zoomed out.
  const mapZoom = useMapZoom(map, 13)
  // Hovered incident → its label swaps to the rich detail card.
  const [hoveredIncidentId, setHoveredIncidentId] = useState<string | null>(null)
  // Leaving a label does not close its card at once. The grace period rides out
  // the seam between two labels (and the moment the swelling card redraws under
  // the pointer), so a card never blinks on its way from one address to the next.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  const handleHoverStart = useCallback((incidentId: string) => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setHoveredIncidentId(incidentId)
  }, [])
  const handleHoverEnd = useCallback((incidentId: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setHoveredIncidentId((current) => (current === incidentId ? null : current))
    }, LABEL_HOVER_CLOSE_MS)
  }, [])

  // Vehicle positions from Traccar GPS
  const [vehiclePositions, setVehiclePositions] = useState<ApiVehiclePosition[]>([])
  const [traccarConfigured, setTraccarConfigured] = useState<boolean>(false)
  // KP Rück vehicles for mapping Traccar device names → vehicle names
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([])

  // Token mode: feed vehicles + positions from the override props (no auth fetch).
  useEffect(() => {
    if (vehiclesOverride) setVehicles(vehiclesOverride)
  }, [vehiclesOverride])
  useEffect(() => {
    if (positionsOverride) setVehiclePositions(positionsOverride)
  }, [positionsOverride])

  // Load firestation settings and vehicle list from backend
  useEffect(() => {
    // Token/read-only display has no cookie — skip the auth-only settings +
    // vehicle fetch and keep the default firestation coords.
    if (tokenMode) return
    const loadSettings = async () => {
      try {
        const [settings, vehicleList] = await Promise.all([
          apiClient.getAllSettings(),
          apiClient.getVehicles().catch(() => [] as ApiVehicle[]),
        ])
        if (settings.firestation_name) {
          setFirestationName(settings.firestation_name)
        }
        if (settings.firestation_latitude && settings.firestation_longitude) {
          setFirestationCoords([
            parseFloat(settings.firestation_latitude),
            parseFloat(settings.firestation_longitude),
          ])
        }
        // Same merge as the backend's get_station_coordinates: the legacy
        // gps.* pair wins when set, the Allgemein coordinates are the fallback.
        const magazinLat = parseFloat(settings["gps.station_lat"] || settings.firestation_latitude || "")
        const magazinLng = parseFloat(settings["gps.station_lng"] || settings.firestation_longitude || "")
        if (Number.isFinite(magazinLat) && Number.isFinite(magazinLng)) {
          setMagazinCoords([magazinLat, magazinLng])
        }
        setVehicles(vehicleList)
      } catch (error) {
        console.error("Failed to load firestation settings:", error)
      }
    }

    loadSettings()
  }, [tokenMode])

  // Fetch vehicle positions from Traccar
  const fetchVehiclePositions = useCallback(async () => {
    try {
      const positions = await apiClient.getVehiclePositions()
      setVehiclePositions(positions)
    } catch {
      // Silent by design: Traccar is optional, and a station without it would
      // otherwise get this on every poll tick.
    }
  }, [])

  // Check Traccar status and use WebSocket + polling fallback for positions
  useEffect(() => {
    // Token mode gets positions from the override prop, not auth-only Traccar.
    if (tokenMode) return
    let cancelled = false
    let pollInterval: NodeJS.Timeout | null = null
    let unsubscribePositions: (() => void) | null = null
    let unsubscribeStatus: (() => void) | null = null

    const checkTraccarStatus = async () => {
      try {
        const status = await apiClient.getTraccarStatus()
        // Bail if the component unmounted during the await — otherwise we'd
        // register WS subscriptions after cleanup already ran, leaking them.
        if (cancelled) return
        setTraccarConfigured(status.configured)

        if (status.configured) {
          await fetchVehiclePositions()
          if (cancelled) return

          // Listen for WebSocket position updates (server-side Traccar polling)
          unsubscribePositions = wsClient.on('vehicle_positions_update', (data: { data: ApiVehiclePosition[] }) => {
            setVehiclePositions(data.data)
          })

          // Fallback polling when WebSocket is disconnected
          const startPolling = () => {
            if (!pollInterval) {
              pollInterval = setInterval(fetchVehiclePositions, 10000)
            }
          }

          const stopPolling = () => {
            if (pollInterval) {
              clearInterval(pollInterval)
              pollInterval = null
            }
          }

          unsubscribeStatus = wsClient.onStatusChange((wsStatus: WebSocketStatus) => {
            if (wsStatus === 'disconnected' || wsStatus === 'error') {
              startPolling()
            } else if (wsStatus === 'connected') {
              stopPolling()
            }
          })
        }
      } catch {
        // Same reasoning as fetchVehiclePositions: no Traccar is a normal setup.
        setTraccarConfigured(false)
      }
    }

    checkTraccarStatus()

    return () => {
      cancelled = true
      if (pollInterval) clearInterval(pollInterval)
      unsubscribePositions?.()
      unsubscribeStatus?.()
    }
  }, [fetchVehiclePositions, tokenMode])

  // Map Traccar device names to KP Rück vehicle names for assignment line matching
  // Strategies: exact name match, then display_order match (numeric device name → vehicle at that order)
  const deviceNameToVehicleName = useMemo(() => {
    if (vehicles.length === 0) return new Map<string, string>()

    const vehicleNames = new Set(vehicles.map(v => v.name.toLowerCase()))
    const orderToName = new Map(vehicles.map(v => [String(v.display_order), v.name]))
    const mapping = new Map<string, string>()

    for (const vp of vehiclePositions) {
      // If the device name already matches a vehicle name, map to itself
      if (vehicleNames.has(vp.device_name.toLowerCase())) {
        mapping.set(vp.device_name, vp.device_name)
        continue
      }
      // Try matching by display_order (e.g., device "1" → vehicle with display_order 1)
      const mappedName = orderToName.get(vp.device_name.trim())
      if (mappedName) {
        mapping.set(vp.device_name, mappedName)
      }
    }

    return mapping
  }, [vehiclePositions, vehicles])

  // Positions with mapped names for assignment line matching
  const mappedVehiclePositions = useMemo(() => {
    if (deviceNameToVehicleName.size === 0) return vehiclePositions
    return vehiclePositions.map(vp => {
      const mapped = deviceNameToVehicleName.get(vp.device_name)
      return mapped && mapped !== vp.device_name ? { ...vp, device_name: mapped } : vp
    })
  }, [vehiclePositions, deviceNameToVehicleName])

  // Tell the page whether GPS is live at all. Token mode has no status endpoint,
  // so there the positions themselves are the answer.
  const gpsAvailable = tokenMode ? vehiclePositions.length > 0 : traccarConfigured
  useEffect(() => {
    onGpsAvailabilityChange?.(gpsAvailable)
  }, [gpsAvailable, onGpsAvailabilityChange])

  // Cluster vehicles that share (roughly) the same GPS coord so they collapse into one
  // counting pill instead of piling on top of each other.
  // Epsilon ≈ 0.0005° ≈ ~50m, which is well below firestation-yard scale.
  // Vehicles inside a cluster are sorted by `display_order` so the hover list
  // matches the order shown in the kanban / vehicle sheet / settings.
  const vehicleClusters = useMemo(() => {
    const EPSILON = 0.0005
    const positions = mappedVehiclePositions
    const used = new Set<number>()
    const clusters: { centroid: [number, number]; vehicles: ApiVehiclePosition[] }[] = []

    // device_name (already mapped to vehicle name) → display_order
    const nameToOrder = new Map<string, number>(
      vehicles.map(v => [v.name.toLowerCase(), v.display_order])
    )
    const orderFor = (v: ApiVehiclePosition) =>
      nameToOrder.get(v.device_name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER

    for (let i = 0; i < positions.length; i++) {
      if (used.has(i)) continue
      const group = [positions[i]]
      used.add(i)
      for (let j = i + 1; j < positions.length; j++) {
        if (used.has(j)) continue
        if (
          Math.abs(positions[i].latitude - positions[j].latitude) < EPSILON &&
          Math.abs(positions[i].longitude - positions[j].longitude) < EPSILON
        ) {
          group.push(positions[j])
          used.add(j)
        }
      }
      group.sort((a, b) => orderFor(a) - orderFor(b))
      const lat = group.reduce((s, v) => s + v.latitude, 0) / group.length
      const lng = group.reduce((s, v) => s + v.longitude, 0) / group.length
      clusters.push({ centroid: [lat, lng], vehicles: group })
    }
    return clusters
  }, [mappedVehiclePositions, vehicles])

  // Filter incidents with valid coordinates and based on status filters.
  // `filterExceptionId` (a deep link to a closed incident) passes the status
  // gate unconditionally — it is rendered on top of the filters, not by them.
  const mappableIncidents = useMemo(
    () =>
      incidents.filter((inc) => {
        if (inc.location_lat === null || inc.location_lng === null) return false
        if (inc.id === filterExceptionId) return true
        const group = STATUS_TO_GROUP[inc.status as IncidentStatus]
        return group && statusFilters[group]
      }),
    [incidents, statusFilters, filterExceptionId]
  )

  // Find incidents without valid coordinates (based on same status filters)
  const incidentsWithoutLocation = useMemo(
    () =>
      incidents.filter((inc) => {
        if (inc.location_lat !== null && inc.location_lng !== null) return false
        if (inc.id === filterExceptionId) return true
        const group = STATUS_TO_GROUP[inc.status as IncidentStatus]
        return group && statusFilters[group]
      }),
    [incidents, statusFilters, filterExceptionId]
  )

  const visibleRouteOperations = useMemo(() => {
    if (!operationsById) return undefined
    const visibleIds = new Set(mappableIncidents.map((incident) => incident.id))
    return new Map([...operationsById].filter(([id]) => visibleIds.has(id)))
  }, [operationsById, mappableIncidents])

  // While the routes are drawn, a stop wears the colour of its Auftrag.
  //
  // The numbered pin on top already carries the route colour; without this the
  // marker underneath it stayed the priority fill, so one incident showed two
  // colours — and on /display/map, where routes are on by default and the
  // colouring stays on «Priorität», every stop of every route read as the same
  // static red. Only a fallback: an explicitly chosen «Färben nach» dimension
  // supplies `markerAccents` and keeps precedence.
  const routeAccents = useMemo(() => {
    if (!showGroupRoutes || !groups || groups.length === 0) return undefined
    const accents = new Map<string, string>()
    for (const group of groups) {
      const color = colorAccent(group.id, "auftrag", groups)
      for (const stopId of group.stopIds) accents.set(stopId, color)
    }
    // Aufträge without stops colour nothing – then there is nothing to fall back to.
    return accents.size > 0 ? accents : undefined
  }, [showGroupRoutes, groups])
  const effectiveMarkerAccents = markerAccents ?? routeAccents
  // The legend must describe what the markers actually wear: the route colours
  // only when they are the fallback in use, never over a chosen «Färben nach».
  const legendShowsRoutes = markerAccents === undefined && routeAccents !== undefined
  // Every label hangs on its own marker; only incidents sharing one address
  // stack (see stackSharedAddresses). Overlapping labels are left overlapping,
  // and hovering brings the one being pointed at to the front — the map's job
  // is to say where an incident is, and an address parked next to a stranger's
  // dot does the opposite.
  const labelOffsets = useMemo(() => {
    if (!showLabels) return new Map<string, number>()
    return stackSharedAddresses(mappableIncidents)
  }, [showLabels, mappableIncidents])

  // …and the legend says so, listing the routes by name. A legend that still
  // reads «Priorität» while the markers carry route colours is worse than none.
  const routeColorGroups = useMemo<ColorGroup[]>(() => {
    if (!routeAccents || !groups) return []
    return groups
      .filter((group) => group.stopIds.length > 0)
      .map((group) => ({ key: group.id, label: group.name, color: colorAccent(group.id, "auftrag", groups) }))
  }, [routeAccents, groups])

  // The opening view: the average of the located incidents, or the firestation. Read ONCE (as
  // Leaflet's `center` was — `MapContainer` ignored every later change) and then owned by
  // `useFitBoundsOnce`, which frames the incidents the moment the first one arrives.
  const [initialViewState] = useState(() => {
    const located = mappableIncidents.filter((inc) => inc.location_lat !== null && inc.location_lng !== null)
    const [latitude, longitude] = located.length > 0
      ? [
          located.reduce((sum, inc) => sum + inc.location_lat!, 0) / located.length,
          located.reduce((sum, inc) => sum + inc.location_lng!, 0) / located.length,
        ]
      : firestationCoords
    return { longitude, latitude, zoom: 13 }
  })

  useFitBoundsOnce(map, mappableIncidents)
  usePanToSelected(map, selectedIncidentId ?? null, mappableIncidents, panTrigger)
  usePanToVehicle(map, focusVehicleName, focusVehicleTrigger, mappedVehiclePositions)
  useResetZoom(map, resetZoomTrigger, mappableIncidents)

  // Routenplanung: an empty-map click adds a stop. Every marker stops its own click from
  // reaching the canvas, so only genuinely empty map arrives here.
  const handleMapClick = useCallback(
    (event: MapLayerMouseEvent) => onMapClick?.(event.lngLat.lat, event.lngLat.lng),
    [onMapClick],
  )

  const vehicleNameFor = useCallback(
    (vehicle: ApiVehiclePosition) => deviceNameToVehicleName.get(vehicle.device_name) || vehicle.device_name,
    [deviceNameToVehicleName],
  )

  const vehicleScale = vehicleStackScale(mapZoom)

  return (
    <div
      className="relative w-full h-full rounded-lg overflow-hidden"
      role="region"
      aria-label={t('view.mapAria')}
    >
      <BaseMap
        initialViewState={initialViewState}
        onLoad={setMap}
        onClick={onMapClick ? handleMapClick : undefined}
      >
        {/* Leaflet's `zoomControl` — <BaseMap> deliberately ships none of its own. */}
        <NavigationControl position="top-left" showCompass={false} />

        {/* Overlay layers, bottom to top — the mount order IS the draw order. */}
        <AssignmentLines
          incidents={incidents}
          vehiclePositions={mappedVehiclePositions}
          visible={showAssignmentLines}
          showDistances={showDistances}
          // Independent of «Routen anzeigen»: that switch draws the route
          // itself, this one answers where the vehicles are — a route vehicle
          // should not need a second switch to get the line every other
          // vehicle has.
          groups={groups}
          groupResourcesFor={groupResourcesFor}
        />

        {/* Auftrag (incident group) route polylines + numbered stop markers. Always mounted,
            fed an empty list when the overlay is off, so its source keeps its place in the
            layer order. */}
        <GroupRoutes
          groups={showGroupRoutes && groups ? groups : NO_GROUPS}
          operationsById={visibleRouteOperations ?? NO_OPERATIONS}
          focusGroupId={focusGroupId}
          onMarkerClick={onGroupStopMarkerClick}
          highlightIncidentId={highlightGroupStopId}
          groupResourcesFor={groupResourcesFor}
        />

        {/* Vehicle breadcrumb trails */}
        <VehicleTrails enabled={traccarConfigured} />

        {/* Firestation marker (no label — operators know where they are) */}
        <GlyphMarker
          coordinates={firestationCoords}
          label={firestationName}
          style={FIRESTATION_STYLE}
          gap={TOOLTIP_ARROW + 12}
        />

        {/* Magazin (GPS-Heimatbasis) marker */}
        {magazinCoords && (
          <GlyphMarker
            coordinates={magazinCoords}
            label={t('view.magazin')}
            style={MAGAZIN_STYLE}
            gap={TOOLTIP_ARROW + VEHICLE_PILL_HEIGHT / 2}
          />
        )}

        {/* Vehicle GPS markers — a shared spot collapses to ONE counting pill
            («5 Fahrzeuge»); the hover tooltip lists them all by name. */}
        {vehicleClusters.map((cluster) => (
          <VehicleClusterMarker
            key={`vehicle-cluster-${cluster.vehicles.map((v) => v.device_id).join('-')}`}
            vehicles={cluster.vehicles}
            centroid={cluster.centroid}
            scale={vehicleScale}
            groupLabel={
              cluster.vehicles.length > 1
                ? t('page.vehicleCluster', { count: cluster.vehicles.length })
                : undefined
            }
            nameFor={vehicleNameFor}
          />
        ))}

        {/* Incident markers + their permanent labels */}
        {mappableIncidents.map((incident) => {
          const isHighlighted =
            selectedIncidentId === incident.id || (highlightIncidentIds?.has(incident.id) ?? false)
          // Hover shows the full picture (type, status, crew, reko, …) via the Operation lookup;
          // the permanent label stays short. Token/display mode has no operations — labels stay
          // short there. A CLICK pins the same card: selecting a marker holds the detail open
          // until the marker is clicked again (deselect).
          const pinned = selectedIncidentId === incident.id
          const hovered = hoveredIncidentId === incident.id || pinned
          const hoverOperation =
            hovered && !hoverCardsDisabled ? operationsById?.get(incident.id) : undefined
          // An Auftrag stop owns no resources of its own — they ride on the route — so resolve
          // them here too, not just on the numbered route pins. Same incident, same answer,
          // whichever you hover.
          const hoverGroup = hoverOperation?.groupId
            ? groups?.find((g) => g.id === hoverOperation.groupId)
            : undefined
          const dy = labelOffsets.get(incident.id) ?? 0
          const shortAddress =
            (incident.location_display ?? formatLocationForDisplay(incident.location_address ?? '', getGlobalHomeCity()))
            || incident.title
          // Split, not summed: a bare "(3)" hid whether that was three people,
          // three vehicles or a mix — an icon each answers it without a click.
          const vehicleCount = incident.assigned_vehicles.length
          const personnelCount = ("assigned_personnel" in incident ? incident.assigned_personnel?.length : 0) || 0
          const select = () => onMarkerClick?.(incident.id)
          const hoverStart = () => handleHoverStart(incident.id)
          const hoverEnd = () => handleHoverEnd(incident.id)

          return (
            <Fragment key={incident.id}>
              <IncidentMarker
                incident={incident}
                highlighted={isHighlighted}
                accentColor={effectiveMarkerAccents?.get(incident.id) ?? null}
                // Two markers a few metres apart overlap; the one being pointed at (or
                // selected) belongs on top, not wherever the DOM order put it.
                zIndex={
                  hoveredIncidentId === incident.id
                    ? Z.incidentHovered
                    : isHighlighted
                      ? Z.incidentHighlighted
                      : Z.incident
                }
                onSelect={select}
                onHoverStart={hoverStart}
                onHoverEnd={hoverEnd}
              />

              {/* Labels hidden: no permanent label, but hovering still reveals the detail card
                  when we can resolve the operation. */}
              {(showLabels || hoverOperation) && (
                <IncidentLabel
                  latitude={incident.location_lat!}
                  longitude={incident.location_lng!}
                  dy={showLabels ? dy : 0}
                  hovered={hovered}
                  selected={isHighlighted}
                  onSelect={select}
                  onHoverStart={hoverStart}
                  onHoverEnd={hoverEnd}
                >
                  {hoverOperation ? (
                    <OperationHoverCard
                      operation={hoverOperation}
                      routeName={hoverGroup?.name}
                      routeResources={hoverGroup && groupResourcesFor?.(hoverGroup.id)}
                    />
                  ) : (
                    <>
                      <span style={{ fontSize: '11px', fontWeight: 600 }}>{shortAddress}</span>
                      {(vehicleCount > 0 || personnelCount > 0) && (
                        <span
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginLeft: '5px', fontSize: '10px', color: '#6b7280' }}
                          title={t('view.crewSummary', { vehicles: vehicleCount, personnel: personnelCount })}
                        >
                          {vehicleCount > 0 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                              <Truck style={{ width: '10px', height: '10px' }} aria-hidden />
                              {vehicleCount}
                            </span>
                          )}
                          {personnelCount > 0 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                              <Users style={{ width: '10px', height: '10px' }} aria-hidden />
                              {personnelCount}
                            </span>
                          )}
                        </span>
                      )}
                    </>
                  )}
                </IncidentLabel>
              )}
            </Fragment>
          )
        })}
      </BaseMap>

      {/* Fit-all sits over the map, not inside it — the map's own children are markers. */}
      <FitAllButton map={map} incidents={mappableIncidents} />

      {/* Warning for incidents without location */}
      <MissingLocationsWarning
        incidents={incidentsWithoutLocation}
        onIncidentClick={onMarkerClick}
      />

      {/* Map Legend */}
      {/* An empty position list means no GPS is set up (or nothing is reporting) — the vehicle
          and assignment-line sections then describe marks that cannot appear, so they go. */}
      <MapLegend
        colorBy={legendShowsRoutes ? "auftrag" : colorBy}
        colorGroups={legendShowsRoutes ? routeColorGroups : colorGroups}
        showVehicles={mappedVehiclePositions.length > 0}
        showAssignments={showAssignmentLines && mappedVehiclePositions.length > 0}
      />

      {/* Simulated-drive indicator — map only, so exercises stay realistic elsewhere */}
      <GpsSimBanner />
    </div>
  )
}
