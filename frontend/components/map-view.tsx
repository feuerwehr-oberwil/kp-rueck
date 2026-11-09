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
import { useIncidents, useOperations, type Operation } from "@/lib/contexts/operations-context"
import type { Incident, IncidentStatus, StatusGroup } from "@/lib/types/incidents"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import { BaseMap } from "./map/base-map"
import { MapTooltip } from "./map/map-tooltip"
import { VehicleSpotMarker, pillTexts } from "./map/vehicle-marker"
import { GroupRoutes } from "./map/group-routes"
import { STATUS_TO_GROUP, STATUS_GROUP_BORDER_STYLE } from "@/lib/types/incidents"
import type { ApiVehiclePosition, ApiVehicle } from "@/lib/api-client"
import { MapLegend } from "./map-legend"
import { GpsSimBanner } from "./gps-sim-banner"
import { colorAccent, type ColorByDimension, type ColorGroup } from "@/lib/kanban-utils"
import { AssignmentLines } from "./map/assignment-lines"
import { OperationHoverCard } from "./map/operation-hover-card"
import { MAP_COLORS, PRIORITY_MARKER_COLORS, STATUS_RING, incidentPinRings, incidentPinSize } from "@/lib/map-colors"
import { markerGlyphInk, priorityGlyphPath } from "@/lib/map-priority"
import { boundsOfLatLng, chromeFitPadding, DEFAULT_CENTER_LATLNG, fitTo, incidentZ, Z, type LatLngPoint } from "@/lib/map-view"
import { CLUSTER_MAX_ZOOM, clusterPins, type PinCluster } from "@/lib/map-clusters"
import { clusterableSpots, groupSpots, spotNumberText, type MapSpot } from "@/lib/map-spots"
import { CLUSTER_BUBBLE_SIZE, ClusterBubble } from "./map/cluster-bubble"
import { PinCountBadge, pinBadgeCircle } from "./map/pin-count-badge"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { VehicleTrails } from "./map/vehicle-trails"
import { ChevronDown, Maximize, AlertTriangle, Truck, Users, X } from "lucide-react"
import { usePathname } from "next/navigation"
import {
  GPS_STALE_SETTING,
  PILL_HEIGHT,
  clusterVehicles,
  estimatePillWidth,
  parseStaleMinutes,
  pillFace,
  placeVehiclePills,
  vehicleStackScale,
  type PillOffset,
  type ScreenBox,
} from "@/lib/map-vehicles"
import { normalizeVehicleName } from "@/lib/vehicle-positions"
import { haversineKm } from "@/lib/utils/route-geo"
import { useCurrentTime } from "@/lib/hooks/use-current-time"
import { isDisplayPath } from "@/lib/utils/display-retry"
import { useVehiclePositions } from "@/lib/hooks/use-vehicle-positions"
import { useTranslations } from "next-intl"
import { useInitialStationView } from "@/lib/hooks/use-initial-station-view"
import { useCompactMap } from "@/lib/hooks/use-compact-map"
import { estimateLabelWidth, labelMode, pickVisibleLabels, placeLabelSides, type LabelCandidate, type LabelSide } from "@/lib/map-labels"
import { Reveal } from "@/components/ui/reveal"
import { WeatherRadarLayer } from "./map/weather-radar"
import { WeatherRadarControls, useRadarPlayback } from "./map/weather-radar-controls"
import { WeatherWarningChip } from "./map/weather-warning-chip"
import { useWeather } from "@/lib/hooks/use-weather"
import { activeWarnings, radarIsStale } from "@/lib/weather"

// Permanent incident labels: the bubble sits to the RIGHT of the dot (on the desktop, the left when
// the right is taken – `placeLabelSides`), its near edge this far from it — the arrow's tip at
// `LABEL_ANCHOR_X`, 2px clear of the 32px pin at rest (desktop and phone alike, STATUS_RING), plus
// the 6px arrow.
const LABEL_HEIGHT = 32
const LABEL_ANCHOR_X = incidentPinSize(false, false) / 2 + 2
const LABEL_OFFSET_X = LABEL_ANCHOR_X + 6
// Grace period before an abandoned card closes — long enough to cross the seam
// into the next label, short enough that a card never lingers on its own.
const LABEL_HOVER_CLOSE_MS = 200

// Leaflet's tooltip look, as a shared gap: the arrow's 6px margin sat on top of every `offset`.
const TOOLTIP_ARROW = 6

// Stable empties: the route overlay must stay MOUNTED even with nothing to draw, or react-map-gl
// re-appends its source on the next `styledata` and lands it on top of everything (plan 28).
const NO_GROUPS: IncidentGroup[] = []
const NO_OPERATIONS = new Map<string, Operation>()

// --- Marker visuals ---------------------------------------------------------

/**
 * One incident's dot: priority (or «Färben nach») fill, white ring, and an outer ring whose
 * DASH STYLE — solid / dashed / dotted — carries the status group. Never colour alone: the
 * board's priority chevron / dash sits in the fill (`lib/map-priority.ts`), under any colouring.
 */
function IncidentPin({
  incident,
  highlighted,
  compact,
  accentColor,
  ariaLabel,
  expanded,
  onActivate,
}: {
  incident: Incident
  highlighted: boolean
  /** Phone geometry (`STATUS_RING.phone`): 3px frame, spaced dashes / round dots. */
  compact: boolean
  accentColor?: string | null
  /** A same-address pin names all of its incidents (`view.spotAria`); default: this one. */
  ariaLabel?: string
  /** A same-address pin: whether its list is open. */
  expanded?: boolean
  onActivate: () => void
}) {
  const t = useTranslations('map')
  // When a "Färben nach" dimension is active, the marker fill is overridden with
  // that group's colour; otherwise it falls back to the priority colour.
  const priorityColor =
    PRIORITY_MARKER_COLORS[incident.priority as keyof typeof PRIORITY_MARKER_COLORS] ?? MAP_COLORS.offline
  const fillColor = accentColor || priorityColor
  const size = incidentPinSize(highlighted, compact)

  const statusGroup = STATUS_TO_GROUP[incident.status as IncidentStatus] || 'open'
  const borderStyle = STATUS_GROUP_BORDER_STYLE[statusGroup]
  const rings = incidentPinRings(size, compact, statusGroup)

  // D8: tabbable + screen-reader-friendly marker. Enter/Space activate it directly now —
  // under Leaflet the icon was an HTML string, so the key had to be caught on the map wrapper
  // and re-dispatched as a synthetic click.
  const a11yLabel = incident.number != null ? `${incident.number} · ${shortAddressOf(incident)}` : shortAddressOf(incident)
  const shadowId = `marker-shadow-${incident.id}`

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel ?? t('view.markerAria', { label: a11yLabel })}
      aria-expanded={expanded}
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
        cx={rings.r}
        cy={rings.r}
        r={rings.fillR}
        fill={fillColor}
        stroke={highlighted ? MAP_COLORS.info : "white"}
        strokeWidth={rings.halo}
        filter={`url(#${shadowId})`}
      />

      {/* Priority glyph: ▲ Hoch, – Mittel, ▼ Niedrig, as on the board's cards. */}
      <path
        d={priorityGlyphPath(incident.priority, rings.r, rings.r, size / 24)}
        fill="none"
        stroke={markerGlyphInk(fillColor)}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Status border ring (outer) */}
      <circle
        cx={rings.r}
        cy={rings.r}
        r={rings.ringR}
        fill="none"
        stroke={STATUS_RING.color}
        strokeWidth={rings.ringWidth}
        strokeDasharray={rings.dasharray}
        strokeLinecap={rings.linecap}
      />
    </svg>
  )
}

/**
 * A double-click on a marker or its label opens the Einsatz (`onOpen`) — and only that.
 *
 * Native listener, not React's `onDoubleClick`: MapLibre's double-click zoom listens on the
 * canvas container, which the DOM markers sit in, and React's synthetic events are handled at
 * the root — after the container already zoomed. Stopping the native event here keeps the map
 * where it is while the detail opens.
 */
function useOpenOnDoubleClick(onOpen?: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef(onOpen)
  useEffect(() => { latest.current = onOpen }, [onOpen])
  const enabled = !!onOpen
  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) return
    const handler = (event: MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
      latest.current?.()
    }
    element.addEventListener("dblclick", handler)
    return () => element.removeEventListener("dblclick", handler)
  }, [enabled])
  return ref
}

/** The incident dot as a map marker – or a same-address pin, which is its lead's dot plus a count
 *  badge (`count`). A component for readability only – the hover state lives in the parent, so
 *  hovering one marker re-renders them all. Fine at a board's handful of pins. */
function IncidentMarker({
  incident,
  highlighted,
  compact,
  accentColor,
  count = 1,
  ariaLabel,
  expanded,
  zIndex,
  onSelect,
  onOpen,
  onHoverStart,
  onHoverEnd,
}: {
  incident: Incident
  highlighted: boolean
  /** Phone geometry – see IncidentPin. */
  compact: boolean
  accentColor?: string | null
  /** Incidents at this spot: from 2 on the pin wears the count badge. */
  count?: number
  ariaLabel?: string
  expanded?: boolean
  zIndex: number
  onSelect: () => void
  /** Double-click: open the Einsatz (see useOpenOnDoubleClick). */
  onOpen?: () => void
  onHoverStart: () => void
  onHoverEnd: () => void
}) {
  const size = incidentPinSize(highlighted, compact)
  const doubleClickRef = useOpenOnDoubleClick(onOpen)
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
      <div
        ref={doubleClickRef}
        style={{ position: "relative", width: size, height: size }}
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
      >
        <IncidentPin
          incident={incident}
          highlighted={highlighted}
          compact={compact}
          accentColor={accentColor}
          ariaLabel={ariaLabel}
          expanded={expanded}
          onActivate={onSelect}
        />
        {count > 1 && <PinCountBadge count={count} />}
      </div>
    </Marker>
  )
}

/** Pill chrome for the Magazin marker – the shape of the vehicle pills (components/map/vehicle-marker.tsx). */
function pillStyle(background: string, width: number | string): CSSProperties {
  return {
    width,
    height: PILL_HEIGHT,
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
  background: MAP_COLORS.station,
  color: "white",
  border: "2px solid white",
  borderRadius: "50%",
  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
  fontSize: 14,
}

// Magazin (GPS-Heimatbasis) — a little home icon shaped like the vehicle pills so it reads as
// "where the vehicles live", in the station ink rather than their blue: blue is the Auftrag's
// (and a reporting vehicle's), and a blue ⌂ read as part of a route (hill climb r18). Only
// rendered when gps.station_lat/lng are set (Settings → GPS).
const MAGAZIN_STYLE: CSSProperties = { ...pillStyle(MAP_COLORS.station, 24), fontSize: 14 }

// --- Permanent labels -------------------------------------------------------

/**
 * Leaflet's tooltip bubble, rebuilt as a marker child.
 *
 * MapLibre has no tooltip of its own, and `<MapTooltip>` (which shares this look for the hover
 * bubbles) is deliberately inert: a label is CLICKABLE, opaque, and a same-address one carries a
 * list under it — so it gets its own chrome here.
 *
 * The app's own surface, not Leaflet's white: card / card-foreground / border tokens (so a dark
 * board gets a dark label, light stays light), Sora — `font-sans` beats the Helvetica MapLibre
 * sets on its container — the small-control radius and a restrained shadow. 6px padding + 18px
 * line + the 1px border each side = LABEL_HEIGHT.
 */
const LABEL_BUBBLE =
  "absolute left-0 top-0 cursor-pointer whitespace-nowrap rounded-sm border border-border bg-card p-1.5 " +
  "font-sans text-xs leading-[18px] text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.25)]"

/** The 6px triangle on the bubble's near edge, pointing back at the dot – in the bubble's fill. */
const LABEL_ARROW: Record<LabelSide, CSSProperties> = {
  right: {
    position: "absolute",
    top: "50%",
    left: -12,
    marginTop: -6,
    border: "6px solid transparent",
    borderRightColor: "var(--card)",
    pointerEvents: "none",
  },
  left: {
    position: "absolute",
    top: "50%",
    right: -12,
    marginTop: -6,
    border: "6px solid transparent",
    borderLeftColor: "var(--card)",
    pointerEvents: "none",
  },
}

/**
 * One pin's permanent map label — its own DOM marker at the pin's coordinates.
 *
 * Under Leaflet this was a tooltip instance that had to be mutated by hand (react-leaflet builds
 * a `<Tooltip>` once and ignores every later prop change), plus a DOM re-append to bring the
 * hovered one to the front. Here the side, the hover state and the stacking are all just props.
 *
 * Labels are never walked away from their markers: resolving every collision that way moved
 * addresses hundreds of pixels off, and the address you then read next to a dot was somebody
 * else's. The most they do is flip to the other side of their own pin (desktop,
 * `placeLabelSides`); where neither side is free they overlap, and the one pointed at comes to the
 * front. Incidents at one address share ONE label (`lib/map-spots.ts`), and that one may carry
 * the list of them (`below`).
 *
 * The bubble hangs off a zero-sized wrapper, so the wrapper's origin IS the pin's anchor point.
 */
function IncidentLabel({
  latitude,
  longitude,
  side,
  zIndex,
  onSelect,
  onOpen,
  onHoverStart,
  onHoverEnd,
  below,
  children,
}: {
  latitude: number
  longitude: number
  /** Which side of the pin the bubble hangs on (`placeLabelSides`). */
  side: LabelSide
  /** `incidentZ('label', …)`: under every resting pin, in front once pointed at or selected. */
  zIndex: number
  onSelect: () => void
  /** Double-click: open the Einsatz, like a double-click on its dot. */
  onOpen?: () => void
  onHoverStart: () => void
  onHoverEnd: () => void
  /** Hung under the bubble, on the same side: a same-address pin's list (`SpotList`). Its own
   *  clicks are its own – they do not count as a click on the label. */
  below?: ReactNode
  children: ReactNode
}) {
  const doubleClickRef = useOpenOnDoubleClick(onOpen)
  const shift = side === "right" ? `${LABEL_OFFSET_X}px` : `calc(-100% - ${LABEL_OFFSET_X}px)`
  return (
    <Marker
      longitude={longitude}
      latitude={latitude}
      style={{ zIndex }}
      // Like every marker here, the click must not reach the map underneath.
      onClick={(event) => event.originalEvent.stopPropagation()}
    >
      <div style={{ position: "relative", width: 0, height: 0 }}>
        {/* The label is as tappable as the dot (selection, Reko-Modus assignment, …). */}
        <div
          ref={doubleClickRef}
          className={LABEL_BUBBLE}
          style={{ transform: `translate(${shift}, -50%)` }}
          onClick={onSelect}
          onMouseEnter={onHoverStart}
          onMouseLeave={onHoverEnd}
        >
          <span style={LABEL_ARROW[side]} />
          {children}
        </div>
        {below && (
          <div
            className="absolute left-0"
            style={{ top: LABEL_HEIGHT / 2 + 6, transform: `translateX(${shift})` }}
            onMouseEnter={onHoverStart}
            onMouseLeave={onHoverEnd}
          >
            {below}
          </div>
        )}
      </div>
    </Marker>
  )
}

/** What a short label (and the marker's aria-label) calls the incident. */
function shortAddressOf(incident: Incident): string {
  return (
    (incident.location_display ?? formatLocationForDisplay(incident.location_address ?? '', getGlobalHomeCity()))
    || incident.title
  )
}

const NO_LABELS: ReadonlySet<string> = new Set()
// The incident dot at rest (IncidentPin), which no kept label may cover – 32px on either surface.
const INCIDENT_DOT_SIZE = incidentPinSize(false, false)

/** A label pass over the screen: the phone's `pickVisibleLabels` (who may draw) or the desktop's
 *  `placeLabelSides` (who flips left). Both answer with a set of ids. */
type LabelPass = typeof pickVisibleLabels

/** One pin's label as the passes need it: where the pin is and what the bubble says. */
interface LabelSource {
  /** The spot key (`lib/map-spots.ts`). */
  id: string
  latitude: number
  longitude: number
  text: string
  crewCounters: number
  priority: string | null | undefined
}

/**
 * Runs a label pass (`lib/map-labels.ts`) at the current view – the phone's collision-checked
 * labels (mode `fit`) or the desktop's flipped sides (mode `all`). Recomputed when the map comes
 * to rest – the DOM labels ride along with their markers while it moves, so nothing jumps
 * mid-gesture. The count bubbles (`bubbles`) and the vehicle pills where they stand (`pills`,
 * after stepping aside) are marks no label may cover.
 */
function useLabelPass(
  map: MlMap | null,
  active: boolean,
  pass: LabelPass,
  sources: LabelSource[],
  bubbles: IncidentCluster[],
  pills: PlacedPill[],
): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(NO_LABELS)
  useEffect(() => {
    if (!map || !active) return
    const compute = () => {
      const container = map.getContainer()
      const candidates = sources.map((source): LabelCandidate => {
        const point = map.project([source.longitude, source.latitude])
        return {
          id: source.id,
          x: point.x,
          y: point.y,
          width: estimateLabelWidth(source.text, source.crewCounters),
          priority: source.priority,
        }
      })
      const next = pass(candidates, {
        labelOffsetX: LABEL_OFFSET_X,
        labelHeight: LABEL_HEIGHT,
        dotSize: INCIDENT_DOT_SIZE,
        viewport: { width: container.clientWidth, height: container.clientHeight },
        obstacles: [
          ...bubbles.map((bubble) => ({
            ...map.project([bubble.longitude, bubble.latitude]),
            width: CLUSTER_BUBBLE_SIZE,
            height: CLUSTER_BUBBLE_SIZE,
          })),
          ...pillBoxes(map, pills),
        ],
      })
      // Same answer, same object: the incident list is a new array on every poll (and every
      // render of the context), so a fresh Set each time would re-render forever.
      setIds((previous) =>
        previous.size === next.size && [...next].every((id) => previous.has(id)) ? previous : next,
      )
    }
    compute()
    map.on("moveend", compute)
    return () => { map.off("moveend", compute) }
  }, [map, active, pass, sources, bubbles, pills])
  return active ? ids : NO_LABELS
}

/** A vehicle pill as the passes need it: its fix, its drawn size at the current zoom (unscaled ×
 *  `vehicleStackScale`) and where it stepped to. */
interface PlacedPill {
  key: string
  latitude: number
  longitude: number
  /** Unscaled px (`estimatePillWidth`, `PILL_HEIGHT`). */
  width: number
  offset: PillOffset | undefined
}

/** The pills' boxes on screen now: fix + offset, scaled. */
function pillBoxes(map: MlMap, pills: PlacedPill[]): ScreenBox[] {
  const scale = vehicleStackScale(map.getZoom())
  return pills.map((pill) => {
    const fix = map.project([pill.longitude, pill.latitude])
    return {
      x: fix.x + (pill.offset?.dx ?? 0),
      y: fix.y + (pill.offset?.dy ?? 0),
      width: pill.width * scale,
      height: PILL_HEIGHT * scale,
    }
  })
}

const NO_OFFSETS: ReadonlyMap<string, PillOffset> = new Map()

/** Everything that floats over the map: MapLibre's controls and our own map chrome – which all
 *  stands on `z-map-chrome` / `z-map-control` – but of the top-right row only its items (the row
 *  itself spans the map's width). */
const MAP_CHROME =
  ".maplibregl-ctrl, [data-map-top-row] > *, :is(.z-map-chrome, .z-map-control):not([data-map-top-row])"

/** The map chrome under `root` (`MAP_CHROME`) as boxes in the map container's px – what a vehicle
 *  pill and its list keep clear of, because it draws above them. */
function mapChromeBoxes(root: HTMLElement | null, container: HTMLElement): ScreenBox[] {
  if (!root) return []
  const origin = container.getBoundingClientRect()
  return [...root.querySelectorAll(MAP_CHROME)].flatMap((element) => {
    const r = element.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return []
    return [{ x: r.left - origin.left + r.width / 2, y: r.top - origin.top + r.height / 2, width: r.width, height: r.height }]
  })
}

/**
 * Where each vehicle pill stands (`placeVehiclePills`): off the incident pins (`pins`, one per
 * visible spot) and the count bubbles, out from under the map chrome (`chrome`), and off each
 * other. Recomputed when the map comes to rest, like the labels – the pills ride along with their
 * fixes while it moves.
 */
function useVehiclePlacement(
  map: MlMap | null,
  pills: PlacedPill[],
  pins: { latitude: number; longitude: number; size: number }[],
  bubbles: IncidentCluster[],
  chrome: () => ScreenBox[],
): ReadonlyMap<string, PillOffset> {
  const [offsets, setOffsets] = useState<ReadonlyMap<string, PillOffset>>(NO_OFFSETS)
  useEffect(() => {
    if (!map) return
    const compute = () => {
      const container = map.getContainer()
      const scale = vehicleStackScale(map.getZoom())
      const box = (latitude: number, longitude: number, size: number): ScreenBox => ({
        ...map.project([longitude, latitude]),
        width: size,
        height: size,
      })
      const next = placeVehiclePills(
        pills.map((pill) => ({
          key: pill.key,
          ...map.project([pill.longitude, pill.latitude]),
          width: pill.width * scale,
          height: PILL_HEIGHT * scale,
        })),
        {
          obstacles: [
            ...pins.map((pin) => box(pin.latitude, pin.longitude, pin.size)),
            ...bubbles.map((bubble) => box(bubble.latitude, bubble.longitude, CLUSTER_BUBBLE_SIZE)),
          ],
          chrome: chrome(),
          viewport: { width: container.clientWidth, height: container.clientHeight },
        },
      )
      // Same answer, same object – positions arrive as a new array every poll.
      setOffsets((previous) =>
        previous.size === next.size &&
        [...next].every(([key, o]) => {
          const before = previous.get(key)
          return before?.dx === o.dx && before.dy === o.dy && before.crowded === o.crowded
        })
          ? previous
          : next.size === 0 ? NO_OFFSETS : next,
      )
    }
    compute()
    map.on("moveend", compute)
    return () => { map.off("moveend", compute) }
  }, [map, pills, pins, bubbles, chrome])
  return offsets
}

// --- Same-address pins and overlap bubbles ----------------------------------

type IncidentSpot = MapSpot<Incident>

/** A bubble on the map: its pins' incidents, drawn at their geographic centre. */
interface IncidentCluster {
  key: string
  /** The spot keys merged into it – their pins and labels are left out. */
  spotKeys: string[]
  incidents: Incident[]
  lead: Incident
  latitude: number
  longitude: number
}

const NO_CLUSTERS: IncidentCluster[] = []

/**
 * The count bubbles (`lib/map-clusters.ts`), phone and desktop: which pins merge at the current
 * view, below `CLUSTER_MAX_ZOOM`. A same-address pin takes part as one pin of weight n. Recomputed
 * when the map comes to rest, like the labels. `keepApart` (the selected and the Reko-highlighted
 * incidents) keeps their spots pins of their own (`clusterableSpots`).
 */
function usePinClusters(
  map: MlMap | null,
  spots: IncidentSpot[],
  keepApart: ReadonlySet<string>,
  compact: boolean,
): IncidentCluster[] {
  const [clusters, setClusters] = useState<IncidentCluster[]>(NO_CLUSTERS)
  useEffect(() => {
    if (!map) return
    const byKey = new Map(spots.map((spot) => [spot.key, spot]))
    const compute = () => {
      if (map.getZoom() >= CLUSTER_MAX_ZOOM) {
        setClusters(NO_CLUSTERS)
        return
      }
      const pins = clusterableSpots(spots, keepApart).map((spot) => {
        const point = map.project([spot.longitude, spot.latitude])
        return {
          id: spot.key,
          x: point.x,
          y: point.y,
          priority: spot.lead.priority,
          statusGroup: STATUS_TO_GROUP[spot.lead.status as IncidentStatus] || "open",
          count: spot.incidents.length,
        }
      })
      const pinSize = incidentPinSize(false, compact)
      const next = clusterPins(pins, {
        pinSize,
        bubbleSize: CLUSTER_BUBBLE_SIZE,
        badge: pinBadgeCircle(pinSize),
      }).map((cluster: PinCluster): IncidentCluster => {
        const joined = cluster.pins.map((pin) => byKey.get(pin.id)!)
        return {
          key: cluster.pins.map((pin) => pin.id).join(","),
          spotKeys: cluster.pins.map((pin) => pin.id),
          incidents: joined.flatMap((spot) => spot.incidents),
          lead: byKey.get(cluster.lead.id)!.lead,
          // The plain mean of the joined PINS – where `clusterPins` tested the bubble for
          // overlap. Weighted by incidents, a 3-incident pin would pull it onto a neighbour.
          latitude: joined.reduce((sum, spot) => sum + spot.latitude, 0) / joined.length,
          longitude: joined.reduce((sum, spot) => sum + spot.longitude, 0) / joined.length,
        }
      })
      // Same grouping, same array: the incident list is a new array on every poll. The members
      // count too – a status filter can hide one of a joined spot's incidents, keeping key + lead.
      setClusters((previous) => {
        const same =
          previous.length === next.length &&
          previous.every(
            (cluster, i) =>
              cluster.key === next[i].key &&
              cluster.lead === next[i].lead &&
              cluster.incidents.length === next[i].incidents.length &&
              cluster.incidents.every((incident, j) => incident.id === next[i].incidents[j].id),
          )
        return same ? previous : next.length === 0 ? NO_CLUSTERS : next
      })
    }
    compute()
    map.on("moveend", compute)
    return () => { map.off("moveend", compute) }
  }, [map, spots, keepApart, compact])
  return clusters
}

/**
 * One count bubble. A click or tap zooms to its incidents – at least one step, so a group that
 * still overlaps at its own fit opens up a little more with every click – and never past the
 * focus band.
 */
function ClusterMarker({
  cluster,
  map,
  compact,
  padding,
}: {
  cluster: IncidentCluster
  map: MlMap | null
  compact: boolean
  padding: FitPadding
}) {
  const t = useTranslations("map")
  const priority = cluster.lead.priority
  const name = t("view.clusterAria", { count: cluster.incidents.length, priority: priorityName(t, priority) })
  const zoomIn = () => {
    if (!map) return
    const bounds = boundsOfLatLng(cluster.incidents.map((inc) => [inc.location_lat!, inc.location_lng!] as LatLngPoint))
    if (!bounds) return
    const camera = map.cameraForBounds(bounds, { padding: padding(60) })
    const zoom = Math.min(Math.max(camera?.zoom ?? 0, map.getZoom() + 1), MAX_FOCUS_ZOOM)
    map.flyTo({ center: camera?.center ?? [cluster.longitude, cluster.latitude], zoom, duration: 600 })
  }
  return (
    <Marker
      longitude={cluster.longitude}
      latitude={cluster.latitude}
      style={{ zIndex: incidentZ("pin", priority, { hovered: false, highlighted: false }) }}
      // Like every marker: the click must not reach the map canvas underneath.
      onClick={(event) => event.originalEvent.stopPropagation()}
    >
      <button type="button" className="block rounded-full" aria-label={name} title={name} onClick={zoomIn}>
        <ClusterBubble
          count={cluster.incidents.length}
          priority={priority}
          group={STATUS_TO_GROUP[cluster.lead.status as IncidentStatus] || "open"}
          compact={compact}
        />
      </button>
    </Marker>
  )
}

/** «Hohe Priorität» & co. for an accessible name – the glyph alone says nothing to a reader. */
function priorityName(t: ReturnType<typeof useTranslations<"map">>, priority: string | null | undefined): string {
  return priority === "high" ? t("common.priorityHigh") : priority === "medium" ? t("common.priorityMedium") : t("common.priorityLow")
}

/**
 * The list under a same-address label (look 3B): the address, then one row per incident –
 * priority glyph, number, Meldung (else Einsatzart), status. A row click is a click on that incident's pin (select;
 * in Reko-Modus / Routenplanung: assign / add it), a double-click opens it. The selected one is
 * marked. Desktop: hung under the label while the pin or its label is pointed at, after a click
 * on the pin, and while one of its incidents is selected. Phone (`docked`): after a tap on the
 * pin, docked along the map's bottom edge – a 320px list off a pin does not fit a 390px map –
 * with a ✕.
 */
function SpotList({
  spot,
  address,
  selectedId,
  docked,
  onPick,
  onOpen,
  onClose,
}: {
  spot: IncidentSpot
  address: string
  selectedId: string | null
  docked: boolean
  onPick?: (incidentId: string) => void
  onOpen?: (incidentId: string) => void
  onClose: () => void
}) {
  const t = useTranslations("map")
  return (
    <div
      role="group"
      aria-label={address}
      className={`rounded-lg border border-border bg-popover py-1.5 font-sans text-sm text-popover-foreground shadow-lg ${
        docked ? "absolute inset-x-2 bottom-2 z-map-control flex max-h-[calc(100%-1rem)] flex-col" : "w-80"
      }`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose()
      }}
    >
      <div className="flex shrink-0 items-start gap-2 px-3 pb-1 pt-0.5">
        <p className="min-w-0 flex-1 break-words font-semibold">{address}</p>
        {docked && (
          <button
            type="button"
            className="-mr-1.5 -mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
            aria-label={t("view.spotClose")}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {/* Docked, the rows scroll under the address and the ✕ once they outgrow the map (six
          incidents at one address on a phone). */}
      <div className={docked ? "relative min-h-0 overflow-y-auto overscroll-contain" : undefined}>
        {spot.incidents.map((incident) => (
          <SpotListRow
            key={incident.id}
            incident={incident}
            selected={incident.id === selectedId}
            onPick={onPick}
            onOpen={onOpen}
          />
        ))}
      </div>
      {/* The one thing a row cannot show by itself: a double-click opens it. A finger has no
          double-click here – the selected Einsatz opens from the page's own card. */}
      {!docked && onOpen && (
        <p className="mt-1 border-t border-border px-3 pt-1.5 text-xs text-muted-foreground">{t("view.spotHint")}</p>
      )}
    </div>
  )
}

/** One row of `SpotList`. */
function SpotListRow({
  incident,
  selected,
  onPick,
  onOpen,
}: {
  incident: Incident
  selected: boolean
  onPick?: (incidentId: string) => void
  onOpen?: (incidentId: string) => void
}) {
  const t = useTranslations("map")
  const tKanban = useTranslations("kanban")
  const doubleClickRef = useOpenOnDoubleClick(onOpen ? () => onOpen(incident.id) : undefined)
  const color = PRIORITY_MARKER_COLORS[incident.priority as keyof typeof PRIORITY_MARKER_COLORS] ?? MAP_COLORS.offline
  // What tells them apart at one address: the Meldung, else the Einsatzart. Not the title – that
  // is the address again (the board shows it only where an address is missing).
  const what = incident.description?.trim() || getIncidentTypeLabel(incident.type)
  return (
    <div ref={doubleClickRef}>
      <button
        type="button"
        aria-current={selected || undefined}
        className={`grid w-full grid-cols-[14px_auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1 text-left leading-5 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none pointer-coarse:min-h-11 ${
          selected ? "bg-sel-wash shadow-[inset_2px_0_0_var(--sel-line)]" : ""
        }`}
        onClick={() => onPick?.(incident.id)}
      >
        <svg width={14} height={14} viewBox="0 0 14 14" role="img" aria-label={priorityName(t, incident.priority)}>
          <path
            d={priorityGlyphPath(incident.priority, 7, 7, 1.2)}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-mono text-xs text-muted-foreground">{incident.number}</span>
        <span className="truncate" title={what}>{what}</span>
        <span className="text-xs text-muted-foreground">{tKanban(`columns.${incident.status}`)}</span>
      </button>
    </div>
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

/** The fit padding for a base inset, measured at the moment of the fit (`chromeFitPadding`):
 *  the open legend and the top-right chip row widen their edges. */
type FitPadding = (base: number) => ReturnType<typeof pad>

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
function useFitBoundsOnce(map: MlMap | null, incidents: Incident[], padding: FitPadding) {
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
function useResetZoom(map: MlMap | null, trigger: number, incidents: Incident[], padding: FitPadding) {
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
function FitAllButton({ map, incidents, padding }: { map: MlMap | null; incidents: Incident[]; padding: FitPadding }) {
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
        fitTo(map, points, { padding: padding(60), maxZoom: 16, duration: 600 })
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      // Under the zoom buttons, which are 44px tall each on a touch screen (top-[106px]). It sat
      // at 88px over the «−» for as long as nobody saw it: the button never rendered until the
      // map fired `load`, and that never happened before the worker fix (base-map.tsx).
      className="absolute left-3 top-[88px] pointer-coarse:top-[106px] pointer-coarse:size-11 z-map-control flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card/95 shadow-md backdrop-blur-sm hover:bg-card"
      title={t('fitAll')}
      aria-label={t('fitAll')}
    >
      <Maximize className="h-4 w-4 text-foreground" aria-hidden="true" />
    </button>
  )
}

/**
 * Incidents without valid coordinates: a compact chip in the map's top-right corner.
 *
 * It used to be a centred amber banner that wrapped to three lines on a phone and sat over the
 * middle of the map – exactly where the markers are (owner, iPhone, 02.10.2026). Now one line:
 * the amber glyph carries the tone (the surface stays neutral, like every message surface), the
 * count and «ohne Koordinaten» say what it is, and a tap opens the same list as before. The zoom
 * buttons own the top-left corner, the ⓘ and the legend the bottom-right.
 */
function MissingLocationsWarning({
  incidents,
  onIncidentClick,
  isExpanded,
  setIsExpanded,
}: {
  incidents: Incident[]
  onIncidentClick?: (incidentId: string) => void
  /** Owned by MapView: while the list is open the legend folds to its pill (owner pick r28 2A). */
  isExpanded: boolean
  setIsExpanded: (open: boolean) => void
}) {
  const t = useTranslations('map')

  if (incidents.length === 0) return null

  return (
    // Not positioned itself: it is one item of the map's top-right control row (see MapView), so
    // a page's own controls sit beside it instead of on top of it. The list hangs below the chip.
    <div className="relative flex flex-col items-end">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-label={t('view.missingCoordsAria', { count: incidents.length })}
        title={t('view.missingCoordsAria', { count: incidents.length })}
        className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card/95 pl-2.5 pr-2 text-xs font-medium text-foreground shadow-md backdrop-blur-sm hover:bg-card pointer-coarse:h-9"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span className="tabular-nums">{t('view.missingCoordsChip', { count: incidents.length })}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {/* Slides open/closed (Reveal) — the list used to pop in at full height. */}
      <Reveal open={isExpanded} className="absolute right-0 top-full w-max min-w-48 max-w-[min(18rem,calc(100vw-5rem))]">
        <ul className="mt-1.5 w-full max-h-60 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-card/95 p-1 text-sm text-foreground shadow-md backdrop-blur-sm">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <button
                type="button"
                className="w-full min-w-0 break-words rounded px-2 py-1.5 text-left font-medium transition-colors hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation()
                  onIncidentClick?.(incident.id)
                }}
                title={t('view.clickToNavigate')}
              >
                {incident.title}
              </button>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  )
}

interface MapViewProps {
  /** Once, when the map has drawn its first complete frame (MapLibre `idle`): style, the
   *  visible tiles and the overlays. The Lagekarte's launch cover waits for it. */
  onFirstIdle?: () => void
  /** A page's own map controls (the wall display's status pills + «Ansicht»). They share ONE
   *  top-right row with the map's «ohne Koordinaten» chip, which wraps instead of overlapping —
   *  laid over the map separately, the two piled onto each other (owner, 03.10.). */
  topRightControls?: ReactNode
  selectedIncidentId?: string | null
  onMarkerClick?: (incidentId: string) => void
  /** Double-click on a marker or its label: open the Einsatz (the page decides the surface). */
  onMarkerDoubleClick?: (incidentId: string) => void
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
  /** Token mode: the station's staleness threshold (`gps.stale_after_minutes`), from the payload. */
  vehicleStaleMinutes?: number
  /** Reports whether GPS is live (Traccar configured or a simulation running,
   *  positions present in token mode). The map knows this first-hand; the page
   *  around it uses the answer to hide controls that need GPS to do anything. */
  onGpsAvailabilityChange?: (available: boolean) => void
  /** The «Wetter» layer: precipitation radar + its panel. Official warnings at the station show
   *  as a chip whether this is on or not. */
  showWeather?: boolean
  /** Whether this deployment serves weather at all (WEATHER_ENABLED) – the page offers the
   *  «Wetter» switch only then. */
  onWeatherAvailabilityChange?: (available: boolean) => void
  /** Token mode: the viewer token that lets the wall display read the weather. */
  viewerToken?: string
}

const NO_SETTINGS: Record<string, string> = {}
const NO_VEHICLES: ApiVehicle[] = []

export default function MapView({
  selectedIncidentId,
  onMarkerClick,
  onMarkerDoubleClick,
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
  vehicleStaleMinutes,
  onGpsAvailabilityChange,
  topRightControls,
  onFirstIdle,
  showWeather = false,
  onWeatherAvailabilityChange,
  viewerToken,
}: MapViewProps) {
  const t = useTranslations('map')
  const tokenMode = incidentsOverride !== undefined
  const { incidents: contextIncidents } = useIncidents()
  const incidents = incidentsOverride ?? contextIncidents
  // Station, Magazin and fleet come off the board sync (`useOperations()`), which
  // loads them with every board load. Token/read-only display has no cookie and
  // no board: it keeps the default firestation coords and gets its vehicles
  // through `vehiclesOverride`.
  const { settings: boardSettings, vehicles: boardVehicles, isLoaded: boardLoaded } = useOperations()
  const stationSettings = tokenMode ? NO_SETTINGS : boardSettings
  const firestationName = stationSettings.firestation_name || t('view.firestationFallback')
  const firestationCoords = useMemo<LatLngPoint>(() => {
    const { firestation_latitude: lat, firestation_longitude: lng } = stationSettings
    return lat && lng ? [parseFloat(lat), parseFloat(lng)] : DEFAULT_CENTER_LATLNG
  }, [stationSettings])
  const firestationSettingsReady = boardLoaded
  // Magazin/homebase — null until configured. Same merge as the backend's
  // get_station_coordinates: the legacy gps.* pair wins when set, the Allgemein
  // coordinates are the fallback.
  const magazinCoords = useMemo<[number, number] | null>(() => {
    const magazinLat = parseFloat(stationSettings["gps.station_lat"] || stationSettings.firestation_latitude || "")
    const magazinLng = parseFloat(stationSettings["gps.station_lng"] || stationSettings.firestation_longitude || "")
    return Number.isFinite(magazinLat) && Number.isFinite(magazinLng) ? [magazinLat, magazinLng] : null
  }, [stationSettings])
  // The live map, handed over by <BaseMap> once it has loaded (and again after a GL recovery
  // remount). Everything that used to be a react-leaflet child with `useMap()` hangs off it.
  const [map, setMap] = useState<MlMap | null>(null)
  const onFirstIdleRef = useRef(onFirstIdle)
  onFirstIdleRef.current = onFirstIdle
  useEffect(() => {
    if (!map) return
    const done = () => onFirstIdleRef.current?.()
    // `idle` follows `load` (when <BaseMap> hands the map over); it can also have passed
    // already if nothing was left to fetch.
    if (map.loaded() && map.areTilesLoaded() && !map.isMoving()) done()
    else map.once('idle', done)
    return () => {
      map.off('idle', done)
    }
  }, [map])
  // Tracks live zoom so vehicle markers can shrink when zoomed out.
  const mapZoom = useMapZoom(map, 13)
  // The pointed-at pin (a spot key, `lib/map-spots.ts`) → a single incident's label swaps to the
  // rich detail card, a same-address pin opens its list.
  const [hoveredSpotKey, setHoveredSpotKey] = useState<string | null>(null)
  // Leaving a label does not close its card at once. The grace period rides out
  // the seam between two labels (and the moment the swelling card redraws under
  // the pointer), so a card never blinks on its way from one address to the next.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  const handleHoverStart = useCallback((key: string) => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setHoveredSpotKey(key)
  }, [])
  const handleHoverEnd = useCallback((key: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setHoveredSpotKey((current) => (current === key ? null : current))
    }, LABEL_HOVER_CLOSE_MS)
  }, [])

  // Vehicle positions from Traccar GPS. A wall (`/display/*`) keeps polling while
  // hidden: nobody is there to bring the tab back to the front.
  const unattended = isDisplayPath(usePathname())
  const { positions: livePositions, configured: traccarConfigured } = useVehiclePositions({
    enabled: !tokenMode,
    pauseWhenHidden: !unattended,
  })
  const vehiclePositions = positionsOverride ?? livePositions
  // KP Rück vehicles for mapping Traccar device names → vehicle names
  const vehicles = vehiclesOverride ?? (tokenMode ? NO_VEHICLES : boardVehicles)

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

  // Vehicles that share (roughly) the same GPS coord collapse into one spot, its list in fleet
  // order (kanban, vehicle sheet, settings), online first (`clusterVehicles`).
  const vehicleSpots = useMemo(() => {
    // device_name (already mapped to vehicle name) → display_order
    const nameToOrder = new Map<string, number>(vehicles.map((v) => [v.name.toLowerCase(), v.display_order]))
    return clusterVehicles(
      mappedVehiclePositions,
      (v) => nameToOrder.get(v.device_name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER,
    )
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
  // One pin per address: incidents at the same spot share a pin, its look and ONE label
  // (`lib/map-spots.ts`); the pin's list picks one of them.
  const spots = useMemo(() => groupSpots(mappableIncidents), [mappableIncidents])
  const compactMap = useCompactMap()
  // Below street level overlapping pins merge into count bubbles, phone and desktop. The selected
  // and the Reko-highlighted incidents stay pins – they are what the operator is looking for.
  const keepApart = useMemo(() => {
    const ids = new Set(highlightIncidentIds ?? [])
    if (selectedIncidentId) ids.add(selectedIncidentId)
    return ids
  }, [highlightIncidentIds, selectedIncidentId])
  const clusters = usePinClusters(map, spots, keepApart, compactMap)
  const clusteredKeys = useMemo(() => new Set(clusters.flatMap((cluster) => cluster.spotKeys)), [clusters])
  // Every label hangs on its own pin. A label whose right side is taken flips to the left of its
  // pin (desktop); where neither side is free the labels overlap, and hovering brings the one
  // being pointed at to the front — the map's job is to say where an incident is, and an
  // address parked next to a stranger's dot does the opposite.
  const labelSources = useMemo(
    () =>
      spots
        .filter((spot) => !clusteredKeys.has(spot.key))
        .map((spot): LabelSource => {
          const single = spot.incidents.length === 1
          const numbers = single ? (spot.lead.number != null ? String(spot.lead.number) : "") : spotNumberText(spot.incidents)
          const personnel = single ? ((spot.lead as { assigned_personnel?: unknown[] }).assigned_personnel?.length ?? 0) : 0
          return {
            id: spot.key,
            latitude: spot.latitude,
            longitude: spot.longitude,
            text: `${numbers} ${shortAddressOf(spot.lead)}`.trim(),
            crewCounters: single ? (spot.lead.assigned_vehicles.length > 0 ? 1 : 0) + (personnel > 0 ? 1 : 0) : 0,
            priority: spot.lead.priority,
          }
        }),
    [spots, clusteredKeys],
  )
  // …except on a phone, where thirty permanent bubbles are a heap: no permanent labels at the
  // default zoom (a tap shows the one you want), collision-checked ones from street level.
  const permanentLabels = labelMode({ showLabels, compact: compactMap, zoom: mapZoom })
  // The same-address pin whose list was opened by a click / tap (hover opens it too, desktop).
  // A click on empty map, Escape or a row closes it.
  const [openSpotKey, setOpenSpotKey] = useState<string | null>(null)
  const closeSpot = useCallback(() => setOpenSpotKey(null), [])
  useEffect(() => {
    if (!map) return
    map.on("click", closeSpot)
    return () => { map.off("click", closeSpot) }
  }, [map, closeSpot])
  // A row of the list is a click on that incident's pin; the list then gives way to the selection.
  const pickFromSpot = (incidentId: string) => {
    setOpenSpotKey(null)
    onMarkerClick?.(incidentId)
  }
  const dockedSpot = compactMap
    ? spots.find((spot) => spot.key === openSpotKey && spot.incidents.length > 1 && !clusteredKeys.has(spot.key))
    : undefined

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

  useInitialStationView(map, firestationCoords, tokenMode || firestationSettingsReady, mappableIncidents.length > 0)
  // Every fit of the Lagekarte keeps its points out from under the map's own chrome: the
  // open legend (right) and the top-right chip row (top), measured when the fit happens.
  const rootRef = useRef<HTMLDivElement>(null)
  const topRowRef = useRef<HTMLDivElement>(null)
  const fitPadding = useCallback<FitPadding>((base) => {
    const root = rootRef.current
    if (!root) return pad(base)
    return chromeFitPadding(base, root.getBoundingClientRect(), {
      legend: root.querySelector("[data-map-legend-panel]")?.getBoundingClientRect(),
      topRow: topRowRef.current?.getBoundingClientRect(),
    })
  }, [])
  useFitBoundsOnce(map, mappableIncidents, fitPadding)
  usePanToSelected(map, selectedIncidentId ?? null, mappableIncidents, panTrigger)
  usePanToVehicle(map, focusVehicleName, focusVehicleTrigger, mappedVehiclePositions)
  useResetZoom(map, resetZoomTrigger, mappableIncidents, fitPadding)

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

  // The pill shows a last-report time only once it is older than the station's threshold
  // (Einstellungen → GPS); the wall gets the threshold with its payload.
  const staleMinutes = parseStaleMinutes(tokenMode ? vehicleStaleMinutes : stationSettings[GPS_STALE_SETTING])
  // Half-minute tick: a pill turns stale while nothing else on the map changes.
  const { currentTime } = useCurrentTime(30_000)
  const vehicleNow = currentTime?.getTime() ?? 0
  // Where a vehicle is assigned, for its line in the list: «12 Ringstrasse 11».
  const assignmentByVehicle = useMemo(() => {
    const byName = new Map<string, string>()
    for (const incident of incidents) {
      if (STATUS_TO_GROUP[incident.status as IncidentStatus] === "completed") continue
      const label = `${incident.number ?? ""} ${shortAddressOf(incident)}`.trim()
      for (const vehicle of incident.assigned_vehicles) byName.set(normalizeVehicleName(vehicle.name), label)
    }
    return byName
  }, [incidents])
  const vehicleAssignmentFor = useCallback(
    (vehicle: ApiVehiclePosition) => assignmentByVehicle.get(normalizeVehicleName(vehicleNameFor(vehicle))) ?? null,
    [assignmentByVehicle, vehicleNameFor],
  )
  // A spot within the Magazin's radius is «… · Magazin» in its list.
  const magazinRadiusM = Number.parseFloat(stationSettings["gps.station_radius_meters"] ?? "") || 100
  const vehicleMarks = useMemo(
    () =>
      vehicleSpots.map((spot) => {
        const face = pillFace(spot, vehicleNameFor, vehicleNow, staleMinutes)
        const texts = pillTexts(t, face, vehicleNow)
        return {
          spot,
          face,
          width: estimatePillWidth(face, { primary: texts.label, secondary: texts.offlinePart ?? undefined, time: texts.time ?? undefined }),
          atMagazin:
            !!magazinCoords &&
            haversineKm([spot.latitude, spot.longitude], [magazinCoords[0], magazinCoords[1]]) * 1000 <= magazinRadiusM,
        }
      }),
    [vehicleSpots, vehicleNameFor, vehicleNow, staleMinutes, t, magazinCoords, magazinRadiusM],
  )
  const vehiclePlacementInput = useMemo<PlacedPill[]>(
    () => vehicleMarks.map(({ spot, width }) => ({ key: spot.key, latitude: spot.latitude, longitude: spot.longitude, width, offset: undefined })),
    [vehicleMarks],
  )
  // The pins a pill steps off: every visible spot's dot (a same-address pin with room for its
  // count badge) – plus the count bubbles.
  const vehicleObstaclePins = useMemo(() => {
    const dot = incidentPinSize(false, compactMap)
    return spots
      .filter((spot) => !clusteredKeys.has(spot.key))
      .map((spot) => ({ latitude: spot.latitude, longitude: spot.longitude, size: spot.incidents.length > 1 ? dot + 8 : dot }))
  }, [spots, clusteredKeys, compactMap])
  const chromeBoxes = useCallback(() => (map ? mapChromeBoxes(rootRef.current, map.getContainer()) : []), [map])
  const vehicleOffsets = useVehiclePlacement(map, vehiclePlacementInput, vehicleObstaclePins, clusters, chromeBoxes)
  const placedPills = useMemo(
    () => vehiclePlacementInput.map((pill) => ({ ...pill, offset: vehicleOffsets.get(pill.key) })),
    [vehiclePlacementInput, vehicleOffsets],
  )
  // Labels last: they avoid the pins, the bubbles and the pills where they finally stand.
  const fitLabelIds = useLabelPass(map, permanentLabels === "fit", pickVisibleLabels, labelSources, clusters, placedPills)
  // Desktop: every label, flipped to the left of its pin where the right is taken.
  const leftLabelIds = useLabelPass(map, permanentLabels === "all", placeLabelSides, labelSources, clusters, placedPills)

  // Weather: one poll of our own backend per minute (it does the feed polling). Token mode reads
  // it with the viewer token; without one there is nothing it may read.
  const { weather, now } = useWeather({ active: !tokenMode || !!viewerToken, viewerToken })
  const weatherAvailable = weather?.enabled === true
  useEffect(() => {
    onWeatherAvailabilityChange?.(weatherAvailable)
  }, [weatherAvailable, onWeatherAvailabilityChange])
  const radar = weatherAvailable ? weather?.radar ?? null : null
  const radarStale = radar ? radarIsStale(radar, now) : false
  const radarOn = showWeather && weatherAvailable
  const playback = useRadarPlayback(radar)
  const [radarOpacity, setRadarOpacity] = useState(0.7)
  const warnings = useMemo(() => (weatherAvailable ? activeWarnings(weather, now) : []), [weatherAvailable, weather, now])

  // The «n ohne Koordinaten» list; open only while there is something in it.
  const [missingOpen, setMissingOpen] = useState(false)
  const missingListOpen = missingOpen && incidentsWithoutLocation.length > 0

  return (
    // `isolate`: the fit-all button (`z-map-control`), the hint chip and the legend are map chrome and
    // stay inside the map's layer — see MAP_STACKING in base-map.tsx. No overlay is ever below.
    <div
      ref={rootRef}
      // The legend keeps clear of the top-right chip row while that row holds anything.
      className="relative isolate w-full h-full rounded-lg overflow-hidden [&:has([data-map-top-row]>*)]:[--legend-top:6rem]"
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
        {/* Radar first: weather lies under every line, route and marker. Always mounted (a
            transparent pixel until the first frame) so its place in the order is fixed. */}
        <WeatherRadarLayer
          radar={radar}
          frameIndex={playback.frameIndex}
          visible={radarOn}
          opacity={radarOpacity}
          stale={radarStale}
        />
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
        <VehicleTrails enabled={traccarConfigured} pauseWhenHidden={!unattended} />

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
            gap={TOOLTIP_ARROW + PILL_HEIGHT / 2}
          />
        )}

        {/* Vehicle GPS pills – a shared spot is ONE (split) pill, its list names every vehicle;
            a pill that would lie on a pin steps aside with a leader to its fix. */}
        {vehicleMarks.map(({ spot, face, atMagazin }) => (
          <VehicleSpotMarker
            key={`vehicle-spot-${spot.key}`}
            spot={spot}
            face={face}
            scale={vehicleScale}
            offset={vehicleOffsets.get(spot.key)}
            nameFor={vehicleNameFor}
            assignmentFor={vehicleAssignmentFor}
            atMagazin={atMagazin}
            now={vehicleNow}
            staleMinutes={staleMinutes}
            chrome={chromeBoxes}
          />
        ))}

        {/* Overlapping pins as count bubbles (their pins are left out below) */}
        {clusters.map((cluster) => (
          <ClusterMarker key={cluster.key} cluster={cluster} map={map} compact={compactMap} padding={fitPadding} />
        ))}

        {/* Incident pins (one per address) + their permanent labels */}
        {spots.map((spot) => {
          if (clusteredKeys.has(spot.key)) return null
          const incident = spot.lead
          const shared = spot.incidents.length > 1
          const selectedHere = spot.incidents.some((member) => member.id === selectedIncidentId)
          const isHighlighted =
            selectedHere || spot.incidents.some((member) => highlightIncidentIds?.has(member.id) ?? false)
          const pointedAt = hoveredSpotKey === spot.key
          const shortAddress = shortAddressOf(incident)
          // A permanent label by the surface's rule — or this pin's own, because it is the
          // selected one (a phone's only way to read a label at the default zoom).
          const permanent =
            permanentLabels === "all" || (permanentLabels === "fit" && fitLabelIds.has(spot.key))
          const side = permanent && leftLabelIds.has(spot.key) ? "left" : "right"
          const hoverStart = () => handleHoverStart(spot.key)
          const hoverEnd = () => handleHoverEnd(spot.key)
          const accentColor = effectiveMarkerAccents?.get(incident.id) ?? null

          if (shared) {
            // Several Einsätze at this address: the lead's pin + count, ONE label with the
            // numbers, and the list to pick one – open after a click or tap on the pin and, with
            // a mouse, while pointed at or while one of them is selected. The phone's list is
            // docked at the map's foot (rendered below, outside the map).
            const open = openSpotKey === spot.key || (!compactMap && (selectedHere || pointedAt))
            const numbers = spotNumberText(spot.incidents)
            const allNumbers = spot.incidents.flatMap((member) => (member.number != null ? [member.number] : []))
            const ariaLabel =
              allNumbers.length > 0
                ? t("view.spotAria", { count: spot.incidents.length, numbers: allNumbers.join(", "), address: shortAddress })
                : t("view.spotAriaNoNumbers", { count: spot.incidents.length, address: shortAddress })
            const toggle = () => setOpenSpotKey((current) => (current === spot.key ? null : spot.key))
            // A double-click is two clicks: the list stays open, and the map does not zoom.
            const keepOpen = () => setOpenSpotKey(spot.key)
            return (
              <Fragment key={spot.key}>
                <IncidentMarker
                  incident={incident}
                  highlighted={isHighlighted}
                  compact={compactMap}
                  accentColor={accentColor}
                  count={spot.incidents.length}
                  ariaLabel={ariaLabel}
                  expanded={open}
                  zIndex={incidentZ("pin", incident.priority, { hovered: pointedAt || open, highlighted: isHighlighted })}
                  onSelect={toggle}
                  onOpen={keepOpen}
                  onHoverStart={hoverStart}
                  onHoverEnd={hoverEnd}
                />
                {(permanent || open || selectedHere) && (
                  <IncidentLabel
                    latitude={spot.latitude}
                    longitude={spot.longitude}
                    side={side}
                    zIndex={incidentZ("label", incident.priority, { hovered: pointedAt || open, highlighted: isHighlighted })}
                    onSelect={toggle}
                    onOpen={keepOpen}
                    onHoverStart={hoverStart}
                    onHoverEnd={hoverEnd}
                    below={
                      open && !compactMap && (
                        <SpotList
                          spot={spot}
                          address={shortAddress}
                          selectedId={selectedHere ? selectedIncidentId ?? null : null}
                          docked={false}
                          onPick={onMarkerClick ? pickFromSpot : undefined}
                          onOpen={onMarkerDoubleClick}
                          onClose={closeSpot}
                        />
                      )
                    }
                  >
                    {numbers && <span className="mr-1 font-mono text-2xs font-medium text-muted-foreground">{numbers}</span>}
                    <span className="font-semibold">{shortAddress}</span>
                  </IncidentLabel>
                )}
              </Fragment>
            )
          }

          // Hover shows the full picture (type, status, crew, reko, …) via the Operation lookup;
          // the permanent label stays short. Token/display mode has no operations — labels stay
          // short there. A CLICK pins the same card: selecting a marker holds the detail open
          // until the marker is clicked again (deselect).
          const pinned = selectedHere
          const hovered = pointedAt || pinned
          const hoverOperation =
            hovered && !hoverCardsDisabled ? operationsById?.get(incident.id) : undefined
          // An Auftrag stop owns no resources of its own — they ride on the route — so resolve
          // them here too, not just on the numbered route pins. Same incident, same answer,
          // whichever you hover.
          const hoverGroup = hoverOperation?.groupId
            ? groups?.find((g) => g.id === hoverOperation.groupId)
            : undefined
          // A share-link payload has no number; the board's incidents do.
          const incidentNumber = "number" in incident ? incident.number : null
          // Split, not summed: a bare "(3)" hid whether that was three people,
          // three vehicles or a mix — an icon each answers it without a click.
          const vehicleCount = incident.assigned_vehicles.length
          const personnelCount = ("assigned_personnel" in incident ? incident.assigned_personnel?.length : 0) || 0
          const select = () => onMarkerClick?.(incident.id)
          const openDetail = onMarkerDoubleClick ? () => onMarkerDoubleClick(incident.id) : undefined

          return (
            <Fragment key={spot.key}>
              <IncidentMarker
                incident={incident}
                highlighted={isHighlighted}
                compact={compactMap}
                accentColor={accentColor}
                // Two markers a few metres apart overlap; the one being pointed at (or
                // selected) belongs on top, the rest by priority – not by DOM order – and
                // above every resting label (see Z in lib/map-view.ts).
                zIndex={incidentZ("pin", incident.priority, { hovered: pointedAt, highlighted: isHighlighted })}
                onSelect={select}
                onOpen={openDetail}
                onHoverStart={hoverStart}
                onHoverEnd={hoverEnd}
              />

              {/* No permanent label: hovering still reveals the detail card when we can resolve
                  the operation, and the selected incident always shows its label/card. */}
              {(permanent || pinned || hoverOperation) && (
                <IncidentLabel
                  latitude={spot.latitude}
                  longitude={spot.longitude}
                  side={permanent ? side : "right"}
                  zIndex={incidentZ("label", incident.priority, { hovered, highlighted: isHighlighted })}
                  onSelect={select}
                  onOpen={openDetail}
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
                      {/* Mono 11 number, Sora 12/600 address – the list rail's pairing. */}
                      {incidentNumber != null && (
                        <span className="mr-1 font-mono text-2xs font-medium text-muted-foreground">{incidentNumber}</span>
                      )}
                      {/* Its own element: the address is what a label is found by. */}
                      <span className="font-semibold">{shortAddress}</span>
                      {/* Crew counters: 12px glyph + 11/500 count, 3px inside a pair, 6px
                          between pairs. `align-top` + the line's own 18px height centres them
                          on the address line instead of sitting them on its baseline.
                          `estimateLabelWidth` (lib/map-labels.ts) assumes this geometry. */}
                      {(vehicleCount > 0 || personnelCount > 0) && (
                        <span
                          className="ml-1.5 inline-flex h-[18px] items-center gap-1.5 align-top text-2xs font-medium text-muted-foreground"
                          title={t('view.crewSummary', { vehicles: vehicleCount, personnel: personnelCount })}
                        >
                          {vehicleCount > 0 && (
                            <span className="inline-flex items-center gap-[3px]">
                              <Truck className="size-3" aria-hidden />
                              {vehicleCount}
                            </span>
                          )}
                          {personnelCount > 0 && (
                            <span className="inline-flex items-center gap-[3px]">
                              <Users className="size-3" aria-hidden />
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
      <FitAllButton map={map} incidents={mappableIncidents} padding={fitPadding} />

      {/* Top-right control row: the page's controls, then the warning for incidents without a
          location. One flex row that wraps (right-aligned) and keeps clear of the zoom buttons
          (`left-16`), so nothing in it can overlap at any width. Only its children take clicks. */}
      <div ref={topRowRef} data-map-top-row className="pointer-events-none absolute top-2.5 right-2.5 left-16 z-map-chrome flex flex-wrap items-start justify-end gap-2 [&>*]:pointer-events-auto">
        {topRightControls}
        {weather && <WeatherWarningChip weather={weather} warnings={warnings} now={now} />}
        <MissingLocationsWarning
          incidents={incidentsWithoutLocation}
          onIncidentClick={onMarkerClick}
          isExpanded={missingListOpen}
          setIsExpanded={setMissingOpen}
        />
      </div>

      {/* Map Legend */}
      {/* An empty position list means no GPS is set up (or nothing is reporting) — the vehicle
          and assignment-line sections then describe marks that cannot appear, so they go. */}
      <MapLegend
        colorBy={legendShowsRoutes ? "auftrag" : colorBy}
        colorGroups={legendShowsRoutes ? routeColorGroups : colorGroups}
        showVehicles={mappedVehiclePositions.length > 0}
        showAssignments={showAssignmentLines && mappedVehiclePositions.length > 0}
        staleMinutes={staleMinutes}
        // Both live on the map's right edge: while the «ohne Koordinaten» list is open the legend
        // folds to its pill, and comes back as it was when the list closes. Its pill closes the list.
        folded={missingListOpen}
        onUnfold={() => setMissingOpen(false)}
      />

      {/* Phone: the tapped same-address pin's list, docked along the map's foot – after the
          legend and the fit-all button in the DOM and on their `z-map-control` tier, so it lies
          over both while open (six or more rows reach the top of the map). */}
      {dockedSpot && (
        <SpotList
          spot={dockedSpot}
          address={shortAddressOf(dockedSpot.lead)}
          selectedId={selectedIncidentId ?? null}
          docked
          onPick={onMarkerClick ? pickFromSpot : undefined}
          onOpen={onMarkerDoubleClick}
          onClose={closeSpot}
        />
      )}

      {radarOn && (
        <WeatherRadarControls
          radar={radar}
          frameIndex={playback.frameIndex}
          playing={playback.playing}
          onPick={playback.pick}
          onTogglePlaying={playback.togglePlaying}
          opacity={radarOpacity}
          onOpacityChange={setRadarOpacity}
          stale={radarStale}
          now={now}
        />
      )}

      {/* Simulated-drive indicator — map only, so exercises stay realistic elsewhere */}
      <GpsSimBanner />
    </div>
  )
}
