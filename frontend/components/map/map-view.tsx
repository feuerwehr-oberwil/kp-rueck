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
 * resize, GL recovery — belongs to `<BaseMap>`; this file only contributes content. Its parts
 * live next to it in components/map/: the incident pins and labels, the same-address lists, the
 * count bubbles, the camera, the label and pill placement passes, the map's own controls.
 */

import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react"
import type { Map as MlMap } from "maplibre-gl"
import { NavigationControl, type MapLayerMouseEvent } from "react-map-gl/maplibre"
import { useIncidents, useOperations, type Operation } from "@/lib/contexts/operations-context"
import type { StatusGroup } from "@/lib/types/incidents"
import type { MapIncident } from "@/lib/map-incident"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import { STATUS_TO_GROUP } from "@/lib/types/incidents"
import type { ApiVehiclePosition, ApiVehicle } from "@/lib/api-client"
import { MapLegend } from "@/components/map-legend"
import { GpsSimBanner } from "@/components/gps-sim-banner"
import { colorAccent, type ColorByDimension, type ColorGroup } from "@/lib/kanban-utils"
import { incidentPinSize } from "@/lib/map-colors"
import { chromeFitPadding, DEFAULT_CENTER_LATLNG, type LatLngPoint } from "@/lib/map-view"
import { groupSpots, spotNumberText } from "@/lib/map-spots"
import { Warehouse } from "lucide-react"
import { usePathname } from "next/navigation"
import { PILL_HEIGHT, vehicleStackScale } from "@/lib/map-vehicles"
import { isDisplayPath } from "@/lib/utils/display-retry"
import { useTranslations } from "next-intl"
import { useInitialStationView } from "@/lib/hooks/use-initial-station-view"
import { useCompactMap } from "@/lib/hooks/use-compact-map"
import { labelMode, pickVisibleLabels, placeLabelSides } from "@/lib/map-labels"
import { useWeather } from "@/lib/hooks/use-weather"
import { activeWarnings, radarIsStale } from "@/lib/weather"
import { stationPoint } from "@/lib/station-point"
import { AssignmentLines } from "./assignment-lines"
import { BaseMap } from "./base-map"
import { ClusterMarker } from "./cluster-marker"
import { FIRESTATION_STYLE, GlyphMarker, MAGAZIN_STYLE } from "./glyph-marker"
import { shortAddressOf } from "./incident-marker"
import { IncidentSpotMarker } from "./incident-spot-marker"
import { FitAllButton, MissingLocationsWarning } from "./map-controls"
import { GroupRoutes } from "./group-routes"
import { RekoRouteLine, type RekoRoute } from "./reko-route"
import { SpotList } from "./spot-list"
import { useLabelPass, type LabelSource } from "./use-label-pass"
import { pad, useFitBoundsOnce, useMapZoom, usePanToSelected, usePanToVehicle, useResetZoom, type FitPadding } from "./use-map-camera"
import { usePinClusters } from "./use-pin-clusters"
import { useVehicleMarks } from "./use-vehicle-marks"
import { mapChromeBoxes, useVehiclePlacement } from "./use-vehicle-placement"
import { VehicleSpotMarker } from "./vehicle-marker"
import { VehicleTrails } from "./vehicle-trails"
import { WeatherRadarLayer } from "./weather-radar"
import { WeatherRadarControls, useRadarPlayback } from "./weather-radar-controls"
import { WeatherWarningChip } from "./weather-warning-chip"

// Grace period before an abandoned card closes — long enough to cross the seam
// into the next label, short enough that a card never lingers on its own.
const LABEL_HOVER_CLOSE_MS = 200

// Leaflet's tooltip look, as a shared gap: the arrow's 6px margin sat on top of every `offset`.
const TOOLTIP_ARROW = 6

// Stable empties: the route overlay must stay MOUNTED even with nothing to draw, or react-map-gl
// re-appends its source on the next `styledata` and lands it on top of everything (plan 28).
const NO_GROUPS: IncidentGroup[] = []
const NO_OPERATIONS = new Map<string, Operation>()

/**
 * The phone Lagekarte's floating family (consistency 9): MapLibre's zoom group and ⓘ in the
 * shape of our own floating controls – 44px, `rounded-md`, the card surface. The zoom group sits
 * under the search row on the right (its corner moved down to 52px + its own 10px margin = 62px,
 * 8px under the 44px row at 10px); the ⓘ keeps the bottom-right corner, a 44px square. The
 * selectors name the corner, so they outrank base-map's CONTROL_LOOK (both `!`). The hairline
 * ring stays the border, under the family's `shadow-md`.
 */
const FLOATING_FAMILY =
  '[&_.maplibregl-ctrl-top-right]:top-[52px]! ' +
  '[&_.maplibregl-ctrl-top-right_.maplibregl-ctrl-group]:rounded-md! ' +
  '[&_.maplibregl-ctrl-top-right_.maplibregl-ctrl-group]:shadow-[0_0_0_1px_var(--border),0_4px_6px_-1px_rgb(0_0_0/0.1),0_2px_4px_-2px_rgb(0_0_0/0.1)]! ' +
  '[&_.maplibregl-ctrl-top-right_.maplibregl-ctrl-group_button]:size-11! ' +
  '[&_.maplibregl-ctrl-bottom-right_.maplibregl-ctrl-attrib.maplibregl-compact]:min-h-10! ' +
  '[&_.maplibregl-ctrl-bottom-right_.maplibregl-ctrl-attrib.maplibregl-compact]:pr-11! ' +
  '[&_.maplibregl-ctrl-bottom-right_.maplibregl-ctrl-attrib.maplibregl-compact]:rounded-md! ' +
  '[&_.maplibregl-ctrl-bottom-right_.maplibregl-ctrl-attrib.maplibregl-compact]:shadow-[0_0_0_1px_var(--border),0_4px_6px_-1px_rgb(0_0_0/0.1),0_2px_4px_-2px_rgb(0_0_0/0.1)]! ' +
  '[&_.maplibregl-ctrl-bottom-right_.maplibregl-ctrl-attrib-button]:size-11! ' +
  '[&_.maplibregl-ctrl-bottom-right_.maplibregl-ctrl-attrib-button]:rounded-md!'

interface MapViewProps {
  /** Once, when the map has drawn its first complete frame (MapLibre `idle`): style, the
   *  visible tiles and the overlays. The Lagekarte's launch cover waits for it. */
  onFirstIdle?: () => void
  /** A page's own map controls (the wall display's status pills + «Ansicht»). They share ONE
   *  top-right row with the map's «ohne Koordinaten» chip, which wraps instead of overlapping —
   *  laid over the map separately, the two piled onto each other (owner, 03.10.). */
  topRightControls?: ReactNode
  /** The phone Lagekarte (owner pick 3A, 24.11.2026). The map fills its box edge to edge and
   *  `top` (search + «Ansicht») floats over its top edge. The map's own controls are ONE floating
   *  family (consistency 9): 44px tall, one corner (`rounded-md`), one surface – zoom and fit-all
   *  on the right under `top`, the Legende above the ⓘ bottom-right. The chip row
   *  (`topRightControls`, Unwetter, «ohne Koordinaten») moves to the left under `top`. `foot`
   *  (the Einsatz peek) lies over the map's foot; every flight keeps its points above it. */
  floating?: { top: ReactNode; foot?: ReactNode }
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
  /** Reko-Editor: the selected person's open Rekos in their order – enlarged pins with their
   *  number inside, joined by a dotted line in the person's colour (`map/reko-route.tsx`). */
  rekoRoute?: RekoRoute | null
  colorBy?: ColorByDimension // active "Färben nach" dimension (for the legend)
  colorGroups?: ColorGroup[] // legend entries for the active dimension
  // Aufträge (incident group) routes — read-only polyline display + Auftrags-Editor.
  showGroupRoutes?: boolean // draw the numbered route polylines (off by default)
  groups?: IncidentGroup[] // Aufträge to draw
  /** Resolves a route's own crew/vehicles, so the hover card of any stop can
   *  show who is on it. Omitted outside the groups provider (token/display). */
  groupResourcesFor?: (groupId: string) => GroupResources
  operationsById?: Map<string, Operation> // stop lookup (stops are real incidents)
  focusGroupId?: string | null // emphasize one route, dim the rest (planning)
  highlightGroupStopId?: string | null // highlight one stop marker (focused stop)
  /** True while a tap-mode (Reko, Auftrags-Editor) runs: hovering must NOT swap
   *  the label for the detail card. The swap replaced the click target mid-tap
   *  — the first tap died in the DOM churn and «remove» needed two. */
  hoverCardsDisabled?: boolean
  onGroupStopMarkerClick?: (incidentId: string) => void // click a numbered stop marker
  onMapClick?: (lat: number, lng: number) => void // empty-map click (add-stop mode)
  // Token/read-only display: feed data directly instead of auth-only contexts
  // and API fetches. When incidentsOverride is set, the map runs in token mode
  // (no getVehicles/getVehiclePositions/getAllSettings/WS).
  incidentsOverride?: MapIncident[]
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
  rekoRoute = null,
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
  floating,
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
    // Finite or the default: a NaN here reaches the station <Marker>, whose render throws.
    const lat = parseFloat(stationSettings.firestation_latitude ?? "")
    const lng = parseFloat(stationSettings.firestation_longitude ?? "")
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : DEFAULT_CENTER_LATLNG
  }, [stationSettings])
  const firestationSettingsReady = boardLoaded
  // Magazin/homebase — null until configured (`stationPoint`: the backend's key order).
  const magazinCoords = useMemo(() => stationPoint(stationSettings), [stationSettings])
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

  const unattended = isDisplayPath(usePathname())
  // KP Rück vehicles for mapping Traccar device names → vehicle names
  const vehicles = vehiclesOverride ?? (tokenMode ? NO_VEHICLES : boardVehicles)
  const compactMap = useCompactMap()
  const {
    traccarConfigured,
    mappedVehiclePositions,
    vehicleNameFor,
    vehicleAssignmentFor,
    staleMinutes,
    vehicleNow,
    vehicleMarks,
    vehiclePlacementInput,
  } = useVehicleMarks({
    tokenMode,
    unattended,
    positionsOverride,
    vehicles,
    vehicleStaleMinutes,
    stationSettings,
    magazinCoords,
    incidents,
    compactMap,
    onGpsAvailabilityChange,
  })

  // Filter incidents with valid coordinates and based on status filters.
  // `filterExceptionId` (a deep link to a closed incident) passes the status
  // gate unconditionally — it is rendered on top of the filters, not by them.
  const mappableIncidents = useMemo(
    () =>
      incidents.filter((inc) => {
        if (inc.location_lat === null || inc.location_lng === null) return false
        if (inc.id === filterExceptionId) return true
        const group = STATUS_TO_GROUP[inc.status]
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
        const group = STATUS_TO_GROUP[inc.status]
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
  // The Reko-Editor order: incident id → its number (1-based), and the dotted line's points.
  const rekoSequence = useMemo(
    () => new Map((rekoRoute?.incidentIds ?? []).map((id, index) => [id, index + 1])),
    [rekoRoute],
  )
  const rekoRoutePoints = useMemo(() => {
    const byId = new Map(mappableIncidents.map((inc) => [inc.id, inc]))
    return (rekoRoute?.incidentIds ?? []).flatMap((id): [number, number][] => {
      const inc = byId.get(id)
      return inc ? [[inc.location_lat!, inc.location_lng!]] : []
    })
  }, [rekoRoute, mappableIncidents])
  // Below street level overlapping pins merge into count bubbles, phone and desktop. The selected
  // and the Reko-highlighted incidents stay pins – they are what the operator is looking for.
  const keepApart = useMemo(() => {
    const ids = new Set(rekoSequence.keys())
    if (selectedIncidentId) ids.add(selectedIncidentId)
    return ids
  }, [rekoSequence, selectedIncidentId])
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
          const personnel = single ? spot.lead.crewCount : 0
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
  // …and so does a selection made elsewhere (a search hit, the Abholung chip) of an Einsatz that is
  // not in the open list. Set during render, React's pattern for state that follows another value.
  const [spotSelection, setSpotSelection] = useState(selectedIncidentId)
  if (spotSelection !== selectedIncidentId) {
    setSpotSelection(selectedIncidentId)
    const open = spots.find((spot) => spot.key === openSpotKey)
    if (open && selectedIncidentId && !open.incidents.some((member) => member.id === selectedIncidentId)) setOpenSpotKey(null)
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
    // The phone: the chip row stands under the floating search row – the lower of the two that
    // holds anything is the top cover.
    const chipRow = topRowRef.current?.getBoundingClientRect()
    const floatTop = root.querySelector("[data-map-float-top]")?.getBoundingClientRect()
    return chromeFitPadding(base, root.getBoundingClientRect(), {
      legend: root.querySelector("[data-map-legend-panel]")?.getBoundingClientRect(),
      topRow: chipRow && chipRow.height > 0 ? chipRow : floatTop,
      foot: root.querySelector("[data-map-foot]")?.getBoundingClientRect(),
    })
  }, [])
  useFitBoundsOnce(map, mappableIncidents, fitPadding)
  usePanToSelected(map, selectedIncidentId ?? null, mappableIncidents, panTrigger, compactMap, fitPadding)
  usePanToVehicle(map, focusVehicleName, focusVehicleTrigger, mappedVehiclePositions)
  useResetZoom(map, resetZoomTrigger, mappableIncidents, fitPadding)

  // Auftrags-Editor: an empty-map click adds a stop. Every marker stops its own click from
  // reaching the canvas, so only genuinely empty map arrives here.
  const handleMapClick = useCallback(
    (event: MapLayerMouseEvent) => onMapClick?.(event.lngLat.lat, event.lngLat.lng),
    [onMapClick],
  )

  const vehicleScale = vehicleStackScale(mapZoom)

  // The pins a pill steps off: every visible spot's dot (a same-address pin with room for its
  // count badge) – plus the count bubbles.
  const vehicleObstaclePins = useMemo(() => {
    const dot = incidentPinSize(false, compactMap)
    return spots
      .filter((spot) => !clusteredKeys.has(spot.key))
      .map((spot) => ({ latitude: spot.latitude, longitude: spot.longitude, size: spot.incidents.length > 1 ? dot + 8 : dot }))
  }, [spots, clusteredKeys, compactMap])
  const chromeBoxes = useCallback(() => (map ? mapChromeBoxes(rootRef.current, map.getContainer()) : []), [map])
  const vehicleOffsets = useVehiclePlacement(map, vehiclePlacementInput, vehicleObstaclePins, clusters, chromeBoxes, rootRef)
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
      // The legend keeps clear of the top-right chip row while that row holds anything – on the
      // phone Lagekarte of the zoom buttons and fit-all on its own right edge.
      className={`relative isolate w-full h-full overflow-hidden ${floating ? `${FLOATING_FAMILY} [--legend-top:17rem]` : 'rounded-lg [&:has([data-map-top-row]>*)]:[--legend-top:6rem]'}`}
      role="region"
      aria-label={t('view.mapAria')}
    >
      <BaseMap
        initialViewState={initialViewState}
        onLoad={setMap}
        onClick={onMapClick ? handleMapClick : undefined}
      >
        {/* Leaflet's `zoomControl` — <BaseMap> deliberately ships none of its own. */}
        <NavigationControl position={floating ? "top-right" : "top-left"} showCompass={false} />

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
          // Independent of «Aufträge»: that switch draws the route
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

        {/* The Reko-Editor order: a dotted line through the selected person's Rekos. */}
        <RekoRouteLine color={rekoRoute?.color ?? null} points={rekoRoutePoints} />

        {/* Vehicle breadcrumb trails */}
        <VehicleTrails enabled={traccarConfigured} pauseWhenHidden={!unattended} />

        {/* Firestation marker (no label — operators know where they are) */}
        <GlyphMarker
          coordinates={firestationCoords}
          label={firestationName}
          style={FIRESTATION_STYLE}
          gap={TOOLTIP_ARROW + 12}
          glyph="⌂"
        />

        {/* Magazin (GPS-Heimatbasis) marker */}
        {magazinCoords && (
          <GlyphMarker
            coordinates={magazinCoords}
            label={t('view.magazin')}
            style={MAGAZIN_STYLE}
            gap={TOOLTIP_ARROW + PILL_HEIGHT / 2}
            glyph={<Warehouse aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />}
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
            short={compactMap}
          />
        ))}

        {/* Overlapping pins as count bubbles (their pins are left out below) */}
        {clusters.map((cluster) => (
          <ClusterMarker key={cluster.key} cluster={cluster} map={map} compact={compactMap} padding={fitPadding} />
        ))}

        {/* Incident pins (one per address) + their permanent labels */}
        {spots.map((spot) =>
          clusteredKeys.has(spot.key) ? null : (
            <IncidentSpotMarker
              key={spot.key}
              spot={spot}
              map={map}
              compactMap={compactMap}
              floating={!!floating}
              selectedIncidentId={selectedIncidentId}
              rekoSequence={rekoSequence}
              hoveredSpotKey={hoveredSpotKey}
              handleHoverStart={handleHoverStart}
              handleHoverEnd={handleHoverEnd}
              permanentLabels={permanentLabels}
              fitLabelIds={fitLabelIds}
              leftLabelIds={leftLabelIds}
              effectiveMarkerAccents={effectiveMarkerAccents}
              openSpotKey={openSpotKey}
              setOpenSpotKey={setOpenSpotKey}
              pickFromSpot={pickFromSpot}
              closeSpot={closeSpot}
              onMarkerClick={onMarkerClick}
              onMarkerDoubleClick={onMarkerDoubleClick}
              hoverCardsDisabled={hoverCardsDisabled}
              operationsById={operationsById}
              groups={groups}
              groupResourcesFor={groupResourcesFor}
              chromeBoxes={chromeBoxes}
              rootRef={rootRef}
            />
          ),
        )}
      </BaseMap>

      {/* Fit-all sits over the map, not inside it — the map's own children are markers. */}
      <FitAllButton map={map} incidents={mappableIncidents} padding={fitPadding} floating={!!floating} />

      {/* The phone Lagekarte's search row (see `floating`). Chrome: vehicle pills keep clear of it. */}
      {floating && (
        <div data-map-float-top data-map-chrome className="absolute inset-x-2.5 top-2.5 z-map-float flex items-start gap-2">
          {floating.top}
        </div>
      )}

      {/* Top-right control row: the page's controls, then the warning for incidents without a
          location. One flex row that wraps (right-aligned) and keeps clear of the zoom buttons
          (`left-16`), so nothing in it can overlap at any width. Only its children take clicks. */}
      <div
        ref={topRowRef}
        data-map-top-row
        className={`pointer-events-none absolute z-map-chrome flex flex-wrap items-start gap-2 [&>*]:pointer-events-auto ${
          floating ? 'top-[62px] left-2.5 right-16 justify-start' : 'top-2.5 right-2.5 left-16 justify-end'
        }`}
      >
        {topRightControls}
        {weather && <WeatherWarningChip weather={weather} warnings={warnings} now={now} />}
        <MissingLocationsWarning
          incidents={incidentsWithoutLocation}
          onIncidentClick={onMarkerClick}
          isExpanded={missingListOpen}
          setIsExpanded={setMissingOpen}
          alignStart={!!floating}
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
        floating={!!floating}
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

      {/* The phone Lagekarte's Einsatz peek, over everything on the map's foot (the ⓘ, the
          Legende, the radar controls). Measured by `fitPadding`. It steps aside while a shared
          pin's list is docked on the same foot – that list is what the tap asked for. */}
      {floating?.foot && !dockedSpot && (
        <div data-map-foot data-map-chrome className="absolute inset-x-0 bottom-0 z-map-float">
          {floating.foot}
        </div>
      )}
    </div>
  )
}