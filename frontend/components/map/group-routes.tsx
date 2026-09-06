"use client"

/**
 * GroupRoutes — shared MapLibre overlay for Auftrag (incident group) routes.
 *
 * Presentational only: given a set of groups + an operation lookup, it draws, per
 * group with ≥2 located stops, a solid line through the stops in `groupPosition`
 * order (coloured by the route's own `colorAccent`, deliberately distinct from the
 * animated red GPS ant-trail in `assignment-lines.tsx`) plus numbered sequence
 * markers on every located stop.
 *
 * All routes share ONE GeoJSON source/line layer — the colour and the dimming ride
 * on each feature's properties, so a board with a dozen Aufträge is still one layer
 * on the GPU. The numbered pins stay DOM `<Marker>`s: they are small, interactive
 * and carry a rich hover card, which is what DOM markers are for.
 *
 * Reused by the Routen-Editor modal and the `/map` page. Must be rendered as a child
 * of the shared `<BaseMap>` (react-map-gl's `<Map>`), never on its own.
 */

import { useMemo, useState } from "react"
import type { CSSProperties } from "react"
import { Layer, Marker, Source, type LineLayer } from "react-map-gl/maplibre"
import { Z, type FeatureCollectionData } from "@/lib/map-view"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import type { Operation } from "@/lib/contexts/operations-context"
import { isLocated, type LocatedOperation } from "@/lib/utils/route-geo"
import { OperationHoverCard } from "./operation-hover-card"
import { MapTooltip } from "./map-tooltip"
import { colorAccent, toStopMirrorStatus, type StopMirrorStatus } from "@/lib/kanban-utils"
import { STATUS_GROUP_BORDER_STYLE, type StatusGroup } from "@/lib/types/incidents"

const NEUTRAL_BORDER_COLOR = "#374151" // gray-700 — same neutral marker outline the incident markers use

/** The one source/layer pair every route line lives in. Exported so a surface can order around it. */
export const GROUP_ROUTES_SOURCE_ID = "group-routes"
export const GROUP_ROUTES_LINE_LAYER_ID = "group-routes-line"

// Anchor → tooltip edge: Leaflet's 6px arrow margin plus the old `offset={[0, -14]}`.
const STOP_TOOLTIP_GAP = 20

const ROUTE_WIDTH_PX = 4

/**
 * The route line.
 *
 * `line-width` interpolates by zoom – ~60 % of the old fixed 4 px at z11, ~130 % at z16. A fixed
 * pixel width was a Leaflet constraint, and a storm board with a dozen Aufträge zoomed out to the
 * whole Gemeinde was a thicket of equally fat lines, while a route zoomed in to one street drew
 * thinner than the numbered pins it connects. Linear between the two stops leaves the board's
 * default zoom 13 at ~90 %, so the familiar look barely moves. Colour and opacity stay
 * data-driven, which is what keeps every Auftrag in this one layer.
 */
const ROUTE_PAINT: LineLayer["paint"] = {
  "line-color": ["get", "color"],
  "line-opacity": ["get", "opacity"],
  "line-width": ["interpolate", ["linear"], ["zoom"], 11, ROUTE_WIDTH_PX * 0.6, 16, ROUTE_WIDTH_PX * 1.3],
}

// Route stops mirror the four board columns; collapse each onto the incident
// status group so the marker's neutral outline can carry the exact same
// border-STYLE convention the incident markers use (no status colours).
const MIRROR_STATUS_GROUP: Record<StopMirrorStatus, StatusGroup> = {
  incoming: "open", // Offen → dashed
  enroute: "active", // Disponiert → solid
  active: "active", // Einsatz → solid
  returning: "completed", // Beendet → dotted
  complete: "completed", // Abgeschlossen → dotted
}

// Translate the incident markers' SVG `stroke-dasharray` convention (the single
// source of truth in STATUS_GROUP_BORDER_STYLE) into the equivalent CSS
// border-style keyword for the div-based route pins.
function borderStyleForDasharray(dasharray: string): "solid" | "dashed" | "dotted" {
  if (dasharray === "none") return "solid"
  return Number.parseInt(dasharray, 10) <= 2 ? "dotted" : "dashed"
}

// Numbered sequence pin: the circle FILL is the Auftrag's colour (`routeColor`) so
// the pin reads as belonging to its route, while a single neutral outer outline
// encodes the stop's column status (Offen / Disponiert / Einsatz / Beendet) purely
// through its STYLE — solid / dashed / dotted — matching the incident markers'
// `Rahmen` convention (STATUS_GROUP_BORDER_STYLE), NOT via any status colour.
// `dimmed` softens non-focused groups when the caller focuses one.
function sequencePinStyle(
  routeColor: string,
  mirrorStatus: StopMirrorStatus,
  highlighted: boolean,
  dimmed: boolean,
): CSSProperties {
  const size = highlighted ? 30 : 26
  const { dasharray, opacity: statusOpacity } = STATUS_GROUP_BORDER_STYLE[MIRROR_STATUS_GROUP[mirrorStatus]]
  return {
    width: size,
    height: size,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: routeColor,
    color: "white",
    border: "2px solid white",
    outline: `2px ${borderStyleForDasharray(dasharray)} ${NEUTRAL_BORDER_COLOR}`,
    outlineOffset: 1,
    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.35)",
    borderRadius: "50%",
    fontSize: highlighted ? 14 : 12,
    fontWeight: 700,
    lineHeight: 1,
    opacity: (dimmed ? 0.4 : 1) * statusOpacity,
    transition: "all 0.2s ease",
    cursor: "pointer",
  }
}

interface RouteRenderItem {
  group: IncidentGroup
  color: string
  dimmed: boolean
  /** Located stops in group order, with their 1-based sequence badge. */
  points: { id: string; op: LocatedOperation; seq: number }[]
}

/** One numbered stop. Its own component so hovering one pin re-renders only that pin. */
function RouteStopMarker({
  op,
  seq,
  color,
  highlighted,
  dimmed,
  routeName,
  routeResources,
  onClick,
}: {
  op: LocatedOperation
  seq: number
  color: string
  highlighted: boolean
  dimmed: boolean
  routeName: string
  routeResources?: GroupResources
  onClick?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [lat, lng] = op.coordinates

  return (
    <Marker
      longitude={lng}
      latitude={lat}
      style={{ zIndex: hovered ? Z.routeStopHovered : highlighted ? Z.routeStopHighlighted : Z.routeStop }}
      // A click on a DOM marker bubbles to the map's own canvas container, where it would
      // fire a map click as well (Leaflet swallowed it) — so every pin stops it, whether
      // or not the caller wants the click.
      onClick={(event) => {
        event.originalEvent.stopPropagation()
        onClick?.()
      }}
    >
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={sequencePinStyle(color, toStopMirrorStatus(op), highlighted, dimmed)}>{seq}</div>
        {hovered && (
          <MapTooltip side="top" gap={STOP_TOOLTIP_GAP}>
            <OperationHoverCard operation={op} seq={seq} routeName={routeName} routeResources={routeResources} />
          </MapTooltip>
        )}
      </div>
    </Marker>
  )
}

interface GroupRoutesProps {
  /** One or many Aufträge to draw. Pass a single-element array to focus one. */
  groups: IncidentGroup[]
  /** id → Operation lookup (stops are real incidents). */
  operationsById: Map<string, Operation>
  /** Optional: emphasize this group and dim the rest. */
  focusGroupId?: string | null
  /** Fired when a numbered stop marker is clicked. */
  onMarkerClick?: (incidentId: string) => void
  /** Highlight this stop's marker (e.g. the Routen-Editor's focused stop). */
  highlightIncidentId?: string | null
  /** Resolves a route's own crew/vehicles for the stop hover cards. Optional:
   *  callers outside the groups provider (Routen-Editor preview) simply omit it
   *  and the cards fall back to the stop's own — empty — resources. */
  groupResourcesFor?: (groupId: string) => GroupResources
}

export function GroupRoutes({
  groups,
  operationsById,
  focusGroupId = null,
  onMarkerClick,
  highlightIncidentId = null,
  groupResourcesFor,
}: GroupRoutesProps) {
  const items = useMemo<RouteRenderItem[]>(() => {
    return groups.map((group) => {
      // One resolver for the whole app: `colorAccent` returns the route's own
      // colour and, for a route that never got one, the same hashed hue the
      // board chips, the marker colouring and the legend already show. The
      // private indigo fallback that used to live here painted every colourless
      // Auftrag the same, so two routes on one map were one colour on the line
      // and two different ones everywhere else.
      const color = colorAccent(group.id, "auftrag", groups)
      const dimmed = focusGroupId !== null && group.id !== focusGroupId
      // Sequence numbers follow the full stop order (including unlocated stops)
      // so the badges match the ordered list; only located stops get a marker.
      const points: RouteRenderItem["points"] = []
      group.stopIds.forEach((id, index) => {
        const op = operationsById.get(id)
        if (isLocated(op)) points.push({ id, op, seq: index + 1 })
      })
      return { group, color, dimmed, points }
    })
  }, [groups, operationsById, focusGroupId])

  // One LineString per route with ≥2 located stops. Colour and opacity travel as
  // feature properties and are read back by the layer's `['get', …]` paint, so all
  // routes share a single layer instead of one per Auftrag.
  const lines = useMemo<FeatureCollectionData>(
    () => ({
      type: "FeatureCollection",
      features: items
        .filter(({ points }) => points.length >= 2)
        .map(({ group, color, dimmed, points }) => ({
          type: "Feature",
          id: group.id,
          properties: { color, opacity: dimmed ? 0.3 : 0.85 },
          geometry: {
            type: "LineString",
            // GeoJSON is [lng, lat]; an Operation's coordinates are [lat, lng].
            coordinates: points.map(({ op }) => [op.coordinates[1], op.coordinates[0]]),
          },
        })),
    }),
    [items],
  )

  return (
    <>
      <Source id={GROUP_ROUTES_SOURCE_ID} type="geojson" data={lines}>
        <Layer
          id={GROUP_ROUTES_LINE_LAYER_ID}
          type="line"
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={ROUTE_PAINT}
        />
      </Source>

      {items.map(({ group, color, dimmed, points }) =>
        points.map(({ id, op, seq }) => (
          <RouteStopMarker
            key={id}
            op={op}
            seq={seq}
            color={color}
            highlighted={highlightIncidentId === id}
            dimmed={dimmed}
            routeName={group.name}
            routeResources={groupResourcesFor?.(group.id)}
            onClick={onMarkerClick ? () => onMarkerClick(id) : undefined}
          />
        )),
      )}
    </>
  )
}
