"use client"

import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react"
import { MapContainer, TileLayer, Marker, useMap, useMapEvents, Tooltip } from "react-leaflet"
import L, { LatLngExpression } from "leaflet"
import "leaflet/dist/leaflet.css"
import { useIncidents, type Operation } from "@/lib/contexts/operations-context"
import type { Incident, IncidentStatus, StatusGroup } from "@/lib/types/incidents"
import type { IncidentGroup } from "@/lib/types/groups"
import { GroupRoutes } from "./map/group-routes"
import { STATUS_TO_GROUP, STATUS_GROUP_BORDER_STYLE } from "@/lib/types/incidents"
import { apiClient, ApiVehiclePosition, ApiVehicle } from "@/lib/api-client"
import { MapLegend } from "./map-legend"
import { GpsSimBanner } from "./gps-sim-banner"
import { colorAccent, type ColorByDimension, type ColorGroup } from "@/lib/kanban-utils"
import { AssignmentLines } from "./map/assignment-lines"
import { OperationHoverCard } from "./map/operation-hover-card"
import { MAP_COLORS, PRIORITY_MARKER_COLORS } from "@/lib/map-colors"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { VehicleTrails } from "./map/vehicle-trails"
import { useMapMode } from "@/lib/hooks/use-map-mode"
import { Maximize } from "lucide-react"
import { wsClient, type WebSocketStatus } from "@/lib/websocket-client"
import { useTranslations } from "next-intl"
import { translateOutsideReact } from "@/lib/i18n-messages"

// Fix Leaflet default icon issue with Next.js
import icon from "leaflet/dist/images/marker-icon.png"
import iconShadow from "leaflet/dist/images/marker-shadow.png"

const DefaultIcon = L.icon({
  iconUrl: icon.src,
  shadowUrl: iconShadow.src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

L.Marker.prototype.options.icon = DefaultIcon

// Status border color (dark gray for all statuses)
const STATUS_BORDER_COLOR = "#374151" // gray-700

// Create priority-based marker icon with status-based border styling
function createIncidentIcon(incident: Incident, isHighlighted: boolean = false, accentColor?: string | null): L.DivIcon {
  // When a "Färben nach" dimension is active, the marker fill is overridden with
  // that group's colour; otherwise it falls back to the priority colour.
  const priorityColor =
    PRIORITY_MARKER_COLORS[incident.priority as keyof typeof PRIORITY_MARKER_COLORS] ?? MAP_COLORS.offline
  const fillColor = accentColor || priorityColor
  const size = isHighlighted ? 32 : 24
  const pulse = isHighlighted ? 'animation: pulse 2s ease-in-out infinite;' : ''

  // Get status group styling
  const statusGroup = STATUS_TO_GROUP[incident.status as IncidentStatus] || 'open'
  const borderStyle = STATUS_GROUP_BORDER_STYLE[statusGroup]

  // SVG-based marker with status border ring
  const borderRadius = size / 2
  const innerRadius = borderRadius - 3 // Leave space for border
  const strokeWidth = 2.5
  const borderOffset = strokeWidth / 2

  // D8: tabbable + screen-reader-friendly marker. The Enter/Space →
  // click delegation lives on the map container (see useEffect below).
  const a11yLabel = (incident.location_display ?? formatLocationForDisplay(incident.location_address ?? '', getGlobalHomeCity())) || incident.title
  const html = `
    <style>
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.72; }
      }
    </style>
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" tabindex="0" role="button" aria-label="${translateOutsideReact('map.view.markerAria', { label: a11yLabel })}" style="${pulse} transition: all 0.2s ease; opacity: ${borderStyle.opacity}; outline: none;">
      <!-- Drop shadow filter -->
      <defs>
        <filter id="shadow-${incident.id}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="${isHighlighted ? 2 : 1}" stdDeviation="${isHighlighted ? 2 : 1}" flood-opacity="${isHighlighted ? 0.4 : 0.25}"/>
        </filter>
      </defs>

      <!-- Priority fill circle with white border -->
      <circle
        cx="${borderRadius}"
        cy="${borderRadius}"
        r="${innerRadius}"
        fill="${fillColor}"
        stroke="${isHighlighted ? MAP_COLORS.info : 'white'}"
        stroke-width="3"
        filter="url(#shadow-${incident.id})"
      />

      <!-- Status border ring (outer) -->
      <circle
        cx="${borderRadius}"
        cy="${borderRadius}"
        r="${borderRadius - borderOffset}"
        fill="none"
        stroke="${STATUS_BORDER_COLOR}"
        stroke-width="${strokeWidth}"
        stroke-dasharray="${borderStyle.dasharray}"
      />
    </svg>
  `

  return L.divIcon({
    html,
    className: "custom-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// Permanent incident labels: one line of the 11px label plus Leaflet's padding,
// and the tooltip's own horizontal offset from the marker. The leader line has
// to bridge that offset plus Leaflet's 6px arrow margin on a right-hand tooltip.
const LABEL_HEIGHT = 32
const LABEL_ANCHOR_X = 14
const LABEL_LEADER_DX = LABEL_ANCHOR_X + 6
// Grace period before an abandoned card closes — long enough to cross the seam
// into the next label, short enough that a card never lingers on its own.
const LABEL_HOVER_CLOSE_MS = 200

// Pill dimensions for vehicle markers (used by icon + tooltip offset).
const VEHICLE_PILL_HEIGHT = 24
const VEHICLE_PILL_GAP = 3
function vehiclePillWidth(name: string): number {
  // 13px bold caps ≈ 8px/char + 16px horizontal padding. Floor at 28px.
  return Math.max(28, name.length * 8 + 16)
}

// Render a vehicle pill (used inside marker HTML).
function vehiclePillHtml(vehicle: ApiVehiclePosition): string {
  const isOnline = vehicle.status === 'online'
  const width = vehiclePillWidth(vehicle.device_name)
  return `
    <div style="
      width: ${width}px;
      height: ${VEHICLE_PILL_HEIGHT}px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: ${isOnline ? MAP_COLORS.info : MAP_COLORS.offline};
      color: white;
      border: 2px solid white;
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      font-size: 13px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      padding: 0 8px;
      box-sizing: border-box;
    ">${vehicle.device_name}</div>
  `
}

// Stack one or more vehicle pills vertically into a single divIcon.
// When N vehicles share a GPS coord they fan out top→bottom so every
// label stays legible; the stack gets wrapped in a subtle bordered
// container so it reads as "these are all parked together".
const VEHICLE_STACK_PADDING = 4
const VEHICLE_STACK_BORDER = 1

// Scale vehicle markers down at lower zoom levels so a 5-pill stack
// doesn't dominate the town. Full size only when fully zoomed in
// (zoom ≥ 15); at default Lagekarte zoom (13) the stack sits at ~0.68;
// floored at 0.35 when fully zoomed out.
function vehicleStackScale(zoom: number): number {
  if (zoom >= 15) return 1
  if (zoom <= 11) return 0.35
  return 0.35 + ((zoom - 11) / 4) * 0.65
}

function createVehicleStackIcon(
  vehicles: ApiVehiclePosition[],
  scale = 1,
): L.DivIcon {
  const widths = vehicles.map((v) => vehiclePillWidth(v.device_name))
  const pillsWidth = Math.max(...widths)
  const pillsHeight =
    vehicles.length * VEHICLE_PILL_HEIGHT + (vehicles.length - 1) * VEHICLE_PILL_GAP

  const grouped = vehicles.length > 1
  const chrome = grouped ? (VEHICLE_STACK_PADDING + VEHICLE_STACK_BORDER) * 2 : 0
  const naturalWidth = pillsWidth + chrome
  const naturalHeight = pillsHeight + chrome
  const width = naturalWidth * scale
  const totalHeight = naturalHeight * scale

  const innerStack = `
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: ${VEHICLE_PILL_GAP}px;
    ">${vehicles.map(vehiclePillHtml).join("")}</div>
  `

  const inner = grouped
    ? `
      <div style="
        padding: ${VEHICLE_STACK_PADDING}px;
        background: rgba(255, 255, 255, 0.92);
        border: ${VEHICLE_STACK_BORDER}px solid rgba(0, 0, 0, 0.2);
        border-radius: 6px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
        box-sizing: border-box;
      ">${innerStack}</div>
    `
    : innerStack

  // transform-origin top-left keeps the scaled box anchored to (0,0)
  // so iconAnchor math works against scaled dimensions.
  const html = `
    <div style="
      width: ${naturalWidth}px;
      height: ${naturalHeight}px;
      transform: scale(${scale});
      transform-origin: 0 0;
    ">${inner}</div>
  `

  return L.divIcon({
    html,
    className: "vehicle-marker",
    iconSize: [width, totalHeight],
    iconAnchor: [width / 2, totalHeight / 2],
    popupAnchor: [0, -totalHeight / 2],
  })
}

// Create firestation marker icon (no label — operators know where they are)
function createFirestationIcon(): L.DivIcon {
  const html = `
    <div style="
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #dc2626;
      color: white;
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      font-size: 14px;
    ">⌂</div>
  `

  return L.divIcon({
    html,
    className: "firestation-marker",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  })
}

// Magazin (GPS-Heimatbasis) marker — a little home icon styled like the
// vehicle pills so it reads as "where the vehicles live". Only rendered
// when gps.station_lat/lng are configured (Settings → GPS).
function createMagazinIcon(): L.DivIcon {
  const html = `
    <div style="
      width: 24px;
      height: ${VEHICLE_PILL_HEIGHT}px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: ${MAP_COLORS.info};
      color: white;
      border: 2px solid white;
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      font-size: 14px;
      line-height: 1;
    ">⌂</div>
  `

  return L.divIcon({
    html,
    className: "magazin-marker",
    iconSize: [24, VEHICLE_PILL_HEIGHT],
    iconAnchor: [12, VEHICLE_PILL_HEIGHT / 2],
    popupAnchor: [0, -VEHICLE_PILL_HEIGHT / 2],
  })
}

// Routenplanung: forward empty-map clicks to the caller (add-stop mode). Only
// mounted while planning + "Stop hinzufügen" is active; marker clicks don't
// reach here (Leaflet stops their propagation to the map).
function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onClick(e.latlng.lat, e.latlng.lng),
  })
  return null
}

// Component that tracks zoom level for conditional label rendering
function ZoomWatcher({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap()

  useEffect(() => {
    onZoomChange(map.getZoom())
    const handler = () => onZoomChange(map.getZoom())
    map.on("zoomend", handler)
    return () => { map.off("zoomend", handler) }
  }, [map, onZoomChange])

  return null
}

// Component to auto-fit map bounds to show all incidents (only on initial mount)
function FitBounds({ incidents }: { incidents: Incident[] }) {
  const map = useMap()
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    // Only run once on initial mount when we have incidents
    if (hasInitializedRef.current || incidents.length === 0) return

    const validIncidents = incidents.filter(
      (inc) => inc.location_lat !== null && inc.location_lng !== null
    )

    if (validIncidents.length === 0) return

    const bounds = L.latLngBounds(
      validIncidents.map((inc) => [inc.location_lat!, inc.location_lng!] as [number, number])
    )

    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
    hasInitializedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]) // Only depend on map, not incidents (run once when map mounts)

  return null
}

// Component to pan/zoom to selected incident
function PanToSelected({ selectedIncidentId, incidents, trigger }: { selectedIncidentId: string | null; incidents: Incident[]; trigger?: number }) {
  const map = useMap()
  const incidentsRef = useRef(incidents)

  // Update ref when incidents change, but don't trigger effect
  useEffect(() => {
    incidentsRef.current = incidents
  }, [incidents])

  useEffect(() => {
    if (!selectedIncidentId) return

    const incident = incidentsRef.current.find((inc) => inc.id === selectedIncidentId)
    if (!incident || !incident.location_lat || !incident.location_lng) return

    // Pan and zoom to the selected marker (always, even if same ID due to trigger)
    map.flyTo([incident.location_lat, incident.location_lng], 16, {
      duration: 0.8,
    })
  }, [selectedIncidentId, map, trigger]) // Only trigger on selection or trigger change, not incidents

  return null
}

// Component to zoom in on a specific vehicle by name (keyboard shortcuts 1-5)
function PanToVehicle({
  vehicleName,
  trigger,
  positions,
}: {
  vehicleName: string | null
  trigger?: number
  positions: ApiVehiclePosition[]
}) {
  const map = useMap()
  const positionsRef = useRef(positions)

  useEffect(() => {
    positionsRef.current = positions
  }, [positions])

  useEffect(() => {
    if (!vehicleName || !trigger) return

    const vp = positionsRef.current.find(
      (p) => p.device_name.toLowerCase() === vehicleName.toLowerCase()
    )
    if (!vp) return

    map.flyTo([vp.latitude, vp.longitude], 17, { duration: 0.8 })
  }, [vehicleName, trigger, map])

  return null
}

// Component to reset zoom to show all incidents and handle map resize
function ResetZoom({ trigger, incidents }: { trigger: number; incidents: Incident[] }) {
  const map = useMap()
  const incidentsRef = useRef(incidents)

  // Update ref when incidents change, but don't trigger effect
  useEffect(() => {
    incidentsRef.current = incidents
  }, [incidents])

  useEffect(() => {
    if (trigger === 0) return

    // Always invalidate size when trigger changes (handles panel resize)
    setTimeout(() => {
      map.invalidateSize()
    }, 100)

    const currentIncidents = incidentsRef.current
    if (currentIncidents.length === 0) return

    const validIncidents = currentIncidents.filter(
      (inc) => inc.location_lat !== null && inc.location_lng !== null
    )

    if (validIncidents.length === 0) return

    const bounds = L.latLngBounds(
      validIncidents.map((inc) => [inc.location_lat!, inc.location_lng!] as [number, number])
    )

    // Delay to ensure size is invalidated first
    setTimeout(() => {
      map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 15, duration: 0.8 })
    }, 200)
  }, [trigger, map]) // Only trigger on explicit trigger change, not incidents

  return null
}

/**
 * «Alle Einsätze einpassen» — the one map control that was missing.
 *
 * The map auto-fits ONCE on mount (see FitBounds) and then never again, so the moment a new
 * incident comes in outside the current view, or somebody pans away, getting back to «show me
 * everything» meant pinching around until it looked right. The fit itself already existed for
 * the panel-resize path; it just had no button.
 *
 * Rendered inside MapContainer so it can reach the map, but positioned over it like the legend.
 * Pointer events are stopped so pressing it never doubles as a map drag.
 */
function FitAllButton({ incidents }: { incidents: Incident[] }) {
  const t = useTranslations('map')
  const map = useMap()
  const withCoords = incidents.filter((inc) => inc.location_lat !== null && inc.location_lng !== null)
  if (withCoords.length === 0) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        const bounds = L.latLngBounds(
          withCoords.map((inc) => [inc.location_lat!, inc.location_lng!] as [number, number]),
        )
        // padding keeps a marker's label off the edge; maxZoom stops a single incident from
        // slamming to street level, which loses all context
        map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 16, duration: 0.6 })
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
 * One incident's permanent map label.
 *
 * react-leaflet builds a Tooltip once and ignores every later prop change, so
 * both the step a label takes (the zoom re-shuffles which labels collide) and
 * the hovered state have to be pushed onto the live Leaflet instance by hand —
 * otherwise the bubble keeps a stale place while its leader line already points
 * elsewhere, and the detail card stays behind its neighbours.
 *
 * Hover is bound with native mouseenter/mouseleave on the bubble: Leaflet's own
 * mouseover/mouseout fire again for every child node, so swapping the address
 * for the card instantly "left" it and the label only flickered.
 */
function IncidentLabel({
  incidentId,
  offset,
  hovered,
  selected,
  onHoverStart,
  onHoverEnd,
  children,
}: {
  incidentId: string
  offset: [number, number]
  hovered: boolean
  /** Selected on the map or highlighted from the list/Reko — the label belongs
   *  in front of its neighbours then too, not only under the pointer. */
  selected: boolean
  onHoverStart: (incidentId: string) => void
  onHoverEnd: (incidentId: string) => void
  children: ReactNode
}) {
  const tooltipRef = useRef<L.Tooltip | null>(null)
  const [dx, dy] = offset

  useEffect(() => {
    const tooltip = tooltipRef.current
    if (!tooltip) return
    tooltip.options.offset = new L.Point(dx, dy)
    // A stepped label's arrow would point at empty map — the leader line takes
    // over that job (see LabelLeader).
    tooltip.getElement()?.classList.toggle("incident-label--stepped", dy !== 0)
    tooltip.update()
  }, [dx, dy])

  useEffect(() => {
    const bubble = tooltipRef.current?.getElement()
    if (!bubble) return
    bubble.classList.toggle("incident-label--hovered", hovered)
    // The card is the thing being read: it belongs in front of every
    // neighbouring address, whatever the DOM order happens to be.
    if (hovered) bubble.parentNode?.appendChild(bubble)
  }, [hovered])

  useEffect(() => {
    const bubble = tooltipRef.current?.getElement()
    if (!bubble) return
    bubble.classList.toggle("incident-label--selected", selected)
    if (selected) bubble.parentNode?.appendChild(bubble)
  }, [selected])

  useEffect(() => {
    const bubble = tooltipRef.current?.getElement()
    if (!bubble) return
    const enter = () => onHoverStart(incidentId)
    const leave = () => onHoverEnd(incidentId)
    bubble.addEventListener("mouseenter", enter)
    bubble.addEventListener("mouseleave", leave)
    return () => {
      bubble.removeEventListener("mouseenter", enter)
      bubble.removeEventListener("mouseleave", leave)
    }
  }, [incidentId, onHoverStart, onHoverEnd])

  return (
    <Tooltip
      ref={tooltipRef}
      direction="right"
      offset={offset}
      permanent={true}
      // Forward clicks to the marker so the label is as tappable as the dot
      // (selection, Reko-Modus assignment, …).
      interactive={true}
      className="incident-label"
    >
      {children}
    </Tooltip>
  )
}

/**
 * Leader line for a label that had to step aside. Drawn inside the tooltip, from
 * its left edge (which Leaflet keeps vertically centred on the anchor point,
 * even when the label swells into the hover card) back to the marker — so the
 * address always names its own dot, never the nearest one.
 */
function LabelLeader({ dy }: { dy: number }) {
  if (dy === 0) return null
  const height = Math.abs(dy)
  return (
    <svg
      className="incident-label__leader"
      width={LABEL_LEADER_DX}
      height={height}
      style={{
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

interface MapViewProps {
  selectedIncidentId?: string | null
  onMarkerClick?: (incidentId: string) => void
  resetZoomTrigger?: number // Counter to trigger zoom reset
  panTrigger?: number // Counter to trigger pan to selected (for re-clicks)
  statusFilters?: Record<StatusGroup, boolean> // Status group visibility filters
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
  operationsById?: Map<string, Operation> // stop lookup (stops are real incidents)
  focusGroupId?: string | null // emphasize one route, dim the rest (planning)
  highlightGroupStopId?: string | null // highlight one stop marker (focused stop)
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
  operationsById,
  focusGroupId = null,
  highlightGroupStopId = null,
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
  const [firestationCoords, setFirestationCoords] = useState<[number, number]>([
    47.51637699933488, 7.561800450458299,
  ])
  // Magazin/homebase from the GPS settings (gps.station_lat/lng) — null until configured
  const [magazinCoords, setMagazinCoords] = useState<[number, number] | null>(null)
  // Tracks live zoom so vehicle markers can shrink when zoomed out.
  const [mapZoom, setMapZoom] = useState<number>(13)
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
  // Map mode management
  const {
    handleTileError,
    getTileUrl,
    getAttribution,
  } = useMapMode()

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
        const magazinLat = parseFloat(settings["gps.station_lat"] ?? "")
        const magazinLng = parseFloat(settings["gps.station_lng"] ?? "")
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

  // Cluster vehicles that share (roughly) the same GPS coord so their
  // labels stack vertically instead of piling on top of each other.
  // Epsilon ≈ 0.0005° ≈ ~50m, which is well below firestation-yard scale.
  // Vehicles inside a cluster are sorted by `display_order` so the stack
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

  // Filter incidents with valid coordinates and based on status filters
  const mappableIncidents = useMemo(
    () =>
      incidents.filter((inc) => {
        if (inc.location_lat === null || inc.location_lng === null) return false
        const group = STATUS_TO_GROUP[inc.status as IncidentStatus]
        return group && statusFilters[group]
      }),
    [incidents, statusFilters]
  )

  // Find incidents without valid coordinates (based on same status filters)
  const incidentsWithoutLocation = useMemo(
    () =>
      incidents.filter((inc) => {
        if (inc.location_lat !== null && inc.location_lng !== null) return false
        const group = STATUS_TO_GROUP[inc.status as IncidentStatus]
        return group && statusFilters[group]
      }),
    [incidents, statusFilters]
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
    return accents
  }, [showGroupRoutes, groups])
  const effectiveMarkerAccents = markerAccents ?? routeAccents
  // Every label hangs on its own marker; only incidents sharing one address
  // stack (see stackSharedAddresses). Overlapping labels are left overlapping,
  // and hovering brings the one being pointed at to the front — the map's job
  // is to say where an incident is, and an address parked next to a stranger's
  // dot does the opposite.
  const labelOffsets = useMemo(() => {
    const offsets = new Map<string, [number, number]>()
    if (!showLabels) return offsets
    for (const [id, dy] of stackSharedAddresses(mappableIncidents)) {
      offsets.set(id, [LABEL_ANCHOR_X, dy])
    }
    return offsets
  }, [showLabels, mappableIncidents])

  // …and the legend says so, listing the routes by name. A legend that still
  // reads «Priorität» while the markers carry route colours is worse than none.
  const routeColorGroups = useMemo<ColorGroup[]>(() => {
    if (!routeAccents || !groups) return []
    return groups
      .filter((group) => group.stopIds.length > 0)
      .map((group) => ({ key: group.id, label: group.name, color: colorAccent(group.id, "auftrag", groups) }))
  }, [routeAccents, groups])

  // Calculate center point (average of all incidents or firestation)
  const center: LatLngExpression = useMemo(() => {
    if (mappableIncidents.length > 0) {
      const avgLat =
        mappableIncidents.reduce((sum, inc) => sum + (inc.location_lat || 0), 0) /
        mappableIncidents.length
      const avgLng =
        mappableIncidents.reduce((sum, inc) => sum + (inc.location_lng || 0), 0) /
        mappableIncidents.length
      return [avgLat, avgLng]
    }
    return firestationCoords
  }, [mappableIncidents, firestationCoords])

  // Zoom to selected incident
  useEffect(() => {
    if (selectedIncidentId) {
      const incident = mappableIncidents.find((inc) => inc.id === selectedIncidentId)
      if (incident && incident.location_lat && incident.location_lng) {
        // Note: We need access to the map instance here
        // This is handled by the parent component passing the selectedIncidentId
      }
    }
  }, [selectedIncidentId, mappableIncidents])

  // D8: delegate Enter/Space on a focused marker to its click handler.
  // Leaflet doesn't expose a per-marker keypress hook; this listener
  // intercepts at the map-wrapper level and dispatches a synthetic click
  // when the focused element is a marker icon.
  const mapWrapperRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const wrapper = mapWrapperRef.current
    if (!wrapper) return
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return
      const target = event.target as HTMLElement | null
      if (!target?.closest?.(".leaflet-marker-icon")) return
      const marker = target.closest(".leaflet-marker-icon") as HTMLElement
      event.preventDefault()
      marker.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    }
    wrapper.addEventListener("keydown", handler)
    return () => wrapper.removeEventListener("keydown", handler)
  }, [])

  return (
    <div
      ref={mapWrapperRef}
      className="relative w-full h-full rounded-lg overflow-hidden"
      role="region"
      aria-label={t('view.mapAria')}
    >
      <MapContainer
        center={center}
        zoom={13}
        className="w-full h-full z-0"
        zoomControl={true}
        keyboard
        keyboardPanDelta={80}
      >
        <TileLayer
          key={getTileUrl()}
          attribution={getAttribution()}
          url={getTileUrl()}
          eventHandlers={{
            tileerror: handleTileError,
          }}
        />

        {/* Firestation marker */}
        <Marker
          position={firestationCoords}
          icon={createFirestationIcon()}
          zIndexOffset={-100}
        >
          <Tooltip direction="top" offset={[0, -12]}>
            <span>{firestationName}</span>
          </Tooltip>
        </Marker>

        {/* Magazin (GPS-Heimatbasis) marker */}
        {magazinCoords && (
          <Marker
            position={magazinCoords}
            icon={createMagazinIcon()}
            zIndexOffset={-100}
          >
            <Tooltip direction="top" offset={[0, -VEHICLE_PILL_HEIGHT / 2]}>
              <span>{t('view.magazin')}</span>
            </Tooltip>
          </Marker>
        )}

        {/* Incident Markers */}
        {mappableIncidents.map((incident) => {
          const isHighlighted =
            selectedIncidentId === incident.id || (highlightIncidentIds?.has(incident.id) ?? false)
          const shortAddress = (incident.location_display ?? formatLocationForDisplay(incident.location_address ?? '', getGlobalHomeCity())) || incident.title
          const crewCount = incident.assigned_vehicles.length + (("assigned_personnel" in incident ? incident.assigned_personnel?.length : 0) || 0)
          return (
            <Marker
              key={incident.id}
              position={[incident.location_lat!, incident.location_lng!]}
              icon={createIncidentIcon(incident, isHighlighted, effectiveMarkerAccents?.get(incident.id) ?? null)}
              // Two markers a few metres apart overlap; the one being pointed at
              // (or selected) belongs on top, not wherever the DOM order put it.
              zIndexOffset={hoveredIncidentId === incident.id ? 600 : isHighlighted ? 300 : 0}
              eventHandlers={{
                click: () => onMarkerClick?.(incident.id),
                mouseover: () => handleHoverStart(incident.id),
                mouseout: () => handleHoverEnd(incident.id),
              }}
            >
              {(() => {
                // Hover shows the full picture (type, status, crew, reko, …)
                // via the Operation lookup; the permanent label stays short.
                // Token/display mode has no operations — labels stay short there.
                const hovered = hoveredIncidentId === incident.id
                const hoverOperation = hovered ? operationsById?.get(incident.id) : undefined
                const offset = labelOffsets.get(incident.id) ?? [LABEL_ANCHOR_X, 0]
                if (showLabels) {
                  return (
                    <IncidentLabel
                      incidentId={incident.id}
                      offset={offset}
                      hovered={hovered}
                      selected={isHighlighted}
                      onHoverStart={handleHoverStart}
                      onHoverEnd={handleHoverEnd}
                    >
                      <LabelLeader dy={offset[1]} />
                      {hoverOperation ? (
                        <OperationHoverCard operation={hoverOperation} />
                      ) : (
                        <>
                          <span style={{ fontSize: '11px', fontWeight: 600 }}>{shortAddress}</span>
                          {crewCount > 0 && (
                            <span style={{ fontSize: '10px', color: '#6b7280', marginLeft: '4px' }}>({crewCount})</span>
                          )}
                        </>
                      )}
                    </IncidentLabel>
                  )
                }
                // Labels hidden: no permanent label, but hovering still reveals
                // the detail card when we can resolve the operation.
                return hoverOperation ? (
                  <IncidentLabel
                    incidentId={incident.id}
                    offset={[LABEL_ANCHOR_X, 0]}
                    hovered={true}
                    selected={isHighlighted}
                    onHoverStart={handleHoverStart}
                    onHoverEnd={handleHoverEnd}
                  >
                    <OperationHoverCard operation={hoverOperation} />
                  </IncidentLabel>
                ) : null
              })()}
            </Marker>
          )
        })}

        {/* Vehicle GPS Markers — clustered when overlapping */}
        {vehicleClusters.map((cluster, idx) => {
          const grouped = cluster.vehicles.length > 1
          const chrome = grouped ? (VEHICLE_STACK_PADDING + VEHICLE_STACK_BORDER) * 2 : 0
          const scale = vehicleStackScale(mapZoom)
          const totalHeight =
            (cluster.vehicles.length * VEHICLE_PILL_HEIGHT +
              (cluster.vehicles.length - 1) * VEHICLE_PILL_GAP +
              chrome) *
            scale
          return (
            <Marker
              key={`vehicle-cluster-${idx}-${cluster.vehicles.map(v => v.device_id).join('-')}`}
              position={cluster.centroid}
              icon={createVehicleStackIcon(cluster.vehicles, scale)}
            >
              <Tooltip permanent={false} direction="top" offset={[0, -totalHeight / 2 - 4]}>
                <div className="text-sm space-y-1">
                  {cluster.vehicles.map((vehicle) => (
                    <div key={vehicle.device_id}>
                      <div className="font-semibold">
                        {deviceNameToVehicleName.get(vehicle.device_name) || vehicle.device_name}
                      </div>
                      {vehicle.speed !== null && vehicle.speed > 1 && (
                        <div className="text-xs text-muted-foreground">
                          {Math.round(vehicle.speed)} km/h
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {vehicle.status === 'online' ? t('common.online') : t('common.offline')}
                      </div>
                    </div>
                  ))}
                </div>
              </Tooltip>
            </Marker>
          )
        })}

        {/* Assignment lines (vehicle GPS → incident) */}
        <AssignmentLines
          incidents={incidents}
          vehiclePositions={mappedVehiclePositions}
          visible={showAssignmentLines}
          showDistances={showDistances}
        />

        {/* Auftrag (incident group) route polylines + numbered stop markers */}
        {showGroupRoutes && groups && visibleRouteOperations && (
          <GroupRoutes
            groups={groups}
            operationsById={visibleRouteOperations}
            focusGroupId={focusGroupId}
            onMarkerClick={onGroupStopMarkerClick}
            highlightIncidentId={highlightGroupStopId}
          />
        )}

        {/* Routenplanung: empty-map click adds a stop (only when a handler is set) */}
        {onMapClick && <MapClickHandler onClick={onMapClick} />}

        {/* Vehicle breadcrumb trails */}
        <VehicleTrails enabled={traccarConfigured} />

        {/* Auto-fit bounds to show all incidents */}
        <FitBounds incidents={mappableIncidents} />

        {/* Pan to selected incident */}
        <PanToSelected selectedIncidentId={selectedIncidentId ?? null} incidents={mappableIncidents} trigger={panTrigger} />

        {/* Zoom to a vehicle by name (keyboard shortcuts 1-5) */}
        <PanToVehicle vehicleName={focusVehicleName} trigger={focusVehicleTrigger} positions={mappedVehiclePositions} />

        {/* Reset zoom on trigger */}
        <ResetZoom trigger={resetZoomTrigger} incidents={mappableIncidents} />
        <FitAllButton incidents={mappableIncidents} />

        {/* Track zoom so vehicle clusters can shrink at low zoom */}
        <ZoomWatcher onZoomChange={setMapZoom} />
      </MapContainer>

      {/* Warning for incidents without location */}
      <MissingLocationsWarning
        incidents={incidentsWithoutLocation}
        onIncidentClick={onMarkerClick}
      />

      {/* Map Legend */}
      {/* An empty position list means no GPS is set up (or nothing is reporting) — the vehicle
          and assignment-line sections then describe marks that cannot appear, so they go. */}
      <MapLegend
        colorBy={routeAccents ? "auftrag" : colorBy}
        colorGroups={routeAccents ? routeColorGroups : colorGroups}
        showVehicles={mappedVehiclePositions.length > 0}
        showAssignments={showAssignmentLines && mappedVehiclePositions.length > 0}
      />

      {/* Simulated-drive indicator — map only, so exercises stay realistic elsewhere */}
      <GpsSimBanner />
    </div>
  )
}
