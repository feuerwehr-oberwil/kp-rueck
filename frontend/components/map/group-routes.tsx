"use client"

/**
 * GroupRoutes — shared react-leaflet overlay for Auftrag (incident group) routes.
 *
 * Presentational only: given a set of groups + an operation lookup, it draws, per
 * group with ≥2 located stops, a solid `<Polyline>` through the stops in
 * `groupPosition` order (coloured by the route's own `colorAccent`, deliberately
 * distinct from the animated red GPS ant-trail in `assignment-lines.tsx`) plus
 * numbered sequence markers on every located stop.
 *
 * Reused by the Routen-Editor modal (Phase 2) and the `/map` page (Phase 3). Must
 * only ever be rendered as a child of a react-leaflet `<MapContainer>` on the
 * client — it statically imports leaflet, so keep it out of any SSR path (the modal
 * loads it behind an `isClient` guard, map-view is dynamically imported ssr:false).
 */

import { Fragment, useMemo } from "react"
import { Marker, Polyline, Tooltip } from "react-leaflet"
import L from "leaflet"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import type { Operation } from "@/lib/contexts/operations-context"
import { isLocated, type LocatedOperation } from "@/lib/utils/route-geo"
import { OperationHoverCard } from "./operation-hover-card"
import { colorAccent, toStopMirrorStatus, type StopMirrorStatus } from "@/lib/kanban-utils"
import { STATUS_GROUP_BORDER_STYLE, type StatusGroup } from "@/lib/types/incidents"

const NEUTRAL_BORDER_COLOR = "#374151" // gray-700 — same neutral marker outline the incident markers use

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
function sequenceMarkerIcon(
  seq: number,
  routeColor: string,
  mirrorStatus: StopMirrorStatus,
  highlighted: boolean,
  dimmed: boolean,
): L.DivIcon {
  const size = highlighted ? 30 : 26
  const { dasharray, opacity: statusOpacity } = STATUS_GROUP_BORDER_STYLE[MIRROR_STATUS_GROUP[mirrorStatus]]
  const borderStyle = borderStyleForDasharray(dasharray)
  const opacity = (dimmed ? 0.4 : 1) * statusOpacity
  const html = `
    <div style="
      width: ${size}px;
      height: ${size}px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${routeColor};
      color: white;
      border: 2px solid white;
      outline: 2px ${borderStyle} ${NEUTRAL_BORDER_COLOR};
      outline-offset: 1px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
      border-radius: 50%;
      font-size: ${highlighted ? 14 : 12}px;
      font-weight: 700;
      line-height: 1;
      opacity: ${opacity};
      transition: all 0.2s ease;
    ">${seq}</div>
  `
  return L.divIcon({
    html,
    className: "route-sequence-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

interface RouteRenderItem {
  group: IncidentGroup
  color: string
  dimmed: boolean
  /** Located stops in group order, with their 1-based sequence badge. */
  points: { id: string; op: LocatedOperation; seq: number }[]
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

  return (
    <>
      {items.map(({ group, color, dimmed, points }) => {
        const line = points.map(({ op }) => op.coordinates)
        return (
          <Fragment key={group.id}>
            {line.length >= 2 && (
              <Polyline
                positions={line}
                pathOptions={{
                  color,
                  weight: 4,
                  opacity: dimmed ? 0.3 : 0.85,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            )}
            {points.map(({ id, op, seq }) => (
              <Marker
                key={id}
                position={op.coordinates}
                icon={sequenceMarkerIcon(seq, color, toStopMirrorStatus(op), highlightIncidentId === id, dimmed)}
                zIndexOffset={highlightIncidentId === id ? 300 : 100}
                eventHandlers={onMarkerClick ? { click: () => onMarkerClick(id) } : undefined}
              >
                <Tooltip direction="top" offset={[0, -14]}>
                  <OperationHoverCard
                    operation={op}
                    seq={seq}
                    routeName={group.name}
                    routeResources={groupResourcesFor?.(group.id)}
                  />
                </Tooltip>
              </Marker>
            ))}
          </Fragment>
        )
      })}
    </>
  )
}
