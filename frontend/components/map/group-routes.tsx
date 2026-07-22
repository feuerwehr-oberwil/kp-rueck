"use client"

/**
 * GroupRoutes — shared react-leaflet overlay for Auftrag (incident group) routes.
 *
 * Presentational only: given a set of groups + an operation lookup, it draws, per
 * group with ≥2 located stops, a solid `<Polyline>` through the stops in
 * `groupPosition` order (coloured by `group.color`, deliberately distinct from the
 * animated red GPS ant-trail in `assignment-lines.tsx`) plus numbered sequence
 * markers on every located stop.
 *
 * Reused by the Routen-Editor modal (Phase 2) and the `/map` page (Phase 3). Must
 * only ever be rendered as a child of a react-leaflet `<MapContainer>` on the
 * client — it statically imports leaflet, so keep it out of any SSR path (the modal
 * loads it behind an `isClient` guard, map-view is dynamically imported ssr:false).
 */

import { Fragment, useMemo } from "react"
import { Marker, Polyline, Tooltip } from "react-leaflet"
import L from "leaflet"
import type { IncidentGroup } from "@/lib/types/groups"
import type { Operation } from "@/lib/contexts/operations-context"
import { isLocated } from "@/lib/utils/route-geo"
import { stopStatusMarkerColor, toStopMirrorStatus } from "@/lib/kanban-utils"

const DEFAULT_ROUTE_COLOR = "#6366f1" // indigo-500 fallback when a group has no colour

// Numbered sequence pin: the circle FILL encodes the stop's column status
// (Offen / Disponiert / Einsatz / Beendet) so route progress reads at a glance,
// while a coloured ring (`routeColor`) keeps the pin tied to its Auftrag. `dimmed`
// softens non-focused groups when the caller focuses one.
function sequenceMarkerIcon(
  seq: number,
  fill: string,
  routeColor: string,
  highlighted: boolean,
  dimmed: boolean,
): L.DivIcon {
  const size = highlighted ? 30 : 26
  const html = `
    <div style="
      width: ${size}px;
      height: ${size}px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${fill};
      color: white;
      border: 2px solid white;
      box-shadow: 0 0 0 2px ${routeColor}, 0 2px 6px rgba(0, 0, 0, 0.35);
      border-radius: 50%;
      font-size: ${highlighted ? 14 : 12}px;
      font-weight: 700;
      line-height: 1;
      opacity: ${dimmed ? 0.4 : 1};
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
  points: { id: string; op: Operation; seq: number }[]
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
}

export function GroupRoutes({
  groups,
  operationsById,
  focusGroupId = null,
  onMarkerClick,
  highlightIncidentId = null,
}: GroupRoutesProps) {
  const items = useMemo<RouteRenderItem[]>(() => {
    return groups.map((group) => {
      const color = group.color ?? DEFAULT_ROUTE_COLOR
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
                icon={sequenceMarkerIcon(seq, stopStatusMarkerColor(toStopMirrorStatus(op)), color, highlightIncidentId === id, dimmed)}
                zIndexOffset={highlightIncidentId === id ? 300 : 100}
                eventHandlers={onMarkerClick ? { click: () => onMarkerClick(id) } : undefined}
              >
                <Tooltip direction="top" offset={[0, -14]}>
                  <span className="text-xs font-medium">
                    {seq}. {op.location}
                  </span>
                </Tooltip>
              </Marker>
            ))}
          </Fragment>
        )
      })}
    </>
  )
}
