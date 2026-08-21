"use client"

/**
 * OperationHoverCard — rich hover content for map markers (incident markers and
 * Auftrag route stops). Renders inside a Leaflet tooltip, which lives outside
 * the app's styled tree and always has a white bubble — so everything is inline
 * styles with fixed colours: a fixed width for predictable wrapping, fixed
 * grays instead of theme variables.
 */

import type { CSSProperties } from "react"
import { useTranslations } from "next-intl"
import { IncidentTime } from "@/components/ui/incident-time"
import { useIncidentTimeMode } from "@/lib/hooks/use-incident-time-mode"
import type { Operation } from "@/lib/contexts/operations-context"
import type { GroupResources } from "@/lib/types/groups"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { sortCrewByLeader } from "@/lib/crew-order"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { formatPickupSince } from "@/lib/pickup"

const CARD: CSSProperties = {
  width: 220,
  whiteSpace: "normal",
  textAlign: "left",
  lineHeight: 1.35,
}
const TITLE: CSSProperties = { margin: 0, fontSize: 12, fontWeight: 600 }
const META: CSSProperties = { margin: "2px 0 0", fontSize: 11, color: "#6b7280" }
const ROW: CSSProperties = { margin: "2px 0 0", fontSize: 11 }
const MUTED: CSSProperties = { color: "#6b7280" }
const ROUTE_BLOCK: CSSProperties = {
  margin: "5px 0 0",
  paddingTop: 4,
  borderTop: "1px solid #e5e7eb",
}
const ROUTE_TITLE: CSSProperties = { margin: 0, fontSize: 11, fontWeight: 600, color: "#374151" }
const PICKUP: CSSProperties = {
  margin: "3px 0 0",
  fontSize: 11,
  fontWeight: 600,
  color: "#92400e",
  background: "#fef3c7",
  borderRadius: 4,
  padding: "1px 5px",
  display: "inline-block",
}
const NOTES: CSSProperties = {
  margin: "3px 0 0",
  fontSize: 11,
  color: "#6b7280",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
}

export function OperationHoverCard({
  operation,
  seq,
  routeName,
  routeResources,
}: {
  operation: Operation
  /** Route-stop sequence number ("2." prefix on Auftrag stops). */
  seq?: number
  /** Name of the Auftrag this stop belongs to, when it belongs to one. */
  routeName?: string
  /** Resources owned by that Auftrag. A stop carries none of its own — the
   *  route does — so without these the hover card of an Auftrag stop shows an
   *  empty crew and the operator has to go look it up on the board. */
  routeResources?: GroupResources
}) {
  const tKanban = useTranslations("kanban")
  const tIncidents = useTranslations("incidents")
  const tTime = useTranslations("kanban.incidentTime")
  const tFeld = useTranslations("feld")
  const { mode: timeMode } = useIncidentTimeMode()
  // Never a blank between two commas: a name the roster lost reads as
  // «Unbekannt», same as every chip surface. Route resources arrive already
  // normalised by the groups context, so only the incident's own lists need it.
  const label = (name: string) => name.trim() || tKanban("common.unknownResource")
  const address =
    (operation.locationDisplay ?? formatLocationForDisplay(operation.location, getGlobalHomeCity())) || operation.location
  // EL first (decision 23), and sorted BEFORE the slice: this card shows three
  // of the crew and a "+4", so an unsorted list is the one place the
  // Einsatzleiter can be cut off the surface entirely.
  const crewShown = sortCrewByLeader(operation.crew, operation.leaderName).slice(0, 3)
  const routeCrew = sortCrewByLeader(routeResources?.personnel ?? [], (p) => Boolean(p.isLeader))
  const routeVehicles = routeResources?.vehicles ?? []
  const routeCrewShown = routeCrew.slice(0, 4)

  return (
    <div style={CARD}>
      <p style={TITLE}>
        {seq !== undefined ? `${seq}. ` : ""}
        {address}
      </p>
      <p style={META}>
        {getIncidentTypeLabel(operation.incidentType)}
        {" · "}
        {tKanban(`columns.${operation.status}`)}
        {" · "}
        {tIncidents(`priority.${operation.priority}`)}
      </p>
      {/* Abholung (decision 24). The pickup is a driving job and whoever assigns
          it is looking at where things are, so the map carries the chip too.
          Inline amber rather than <PickupBadge>: this tooltip lives outside the
          app's styled tree, where Tailwind classes do not reach. */}
      {operation.pickupNeeded && (
        <p style={PICKUP}>
          {tFeld("pickup.badge")}
          {formatPickupSince(operation.pickupRequestedAt)
            ? ` · ${tFeld("pickup.since", { time: formatPickupSince(operation.pickupRequestedAt) })}`
            : ""}
          {operation.pickupNote ? ` · ${operation.pickupNote}` : ""}
        </p>
      )}
      {/* The same time every other surface shows. Spelled out rather than left to
          the mode icon: a Leaflet tooltip has pointer-events off, so there is no
          hovering the chip to find out what the number means. */}
      <p style={ROW}>
        <span style={MUTED}>{tTime(`modes.${timeMode}`)}: </span>
        <IncidentTime operation={operation} readOnly showIcon={false} className="text-inherit" />
      </p>
      {operation.assignedReko && (
        <p style={ROW}>
          <span style={MUTED}>Reko: </span>
          {label(operation.assignedReko.name)}
        </p>
      )}
      {operation.vehicles.length > 0 && (
        <p style={ROW}>
          <span style={MUTED}>{tKanban("resources.vehicles")}: </span>
          {operation.vehicles.map(label).join(", ")}
        </p>
      )}
      {operation.crew.length > 0 && (
        <p style={ROW}>
          <span style={MUTED}>{tKanban("resources.crew")}: </span>
          {crewShown.map(label).join(", ")}
          {operation.crew.length > crewShown.length && ` +${operation.crew.length - crewShown.length}`}
        </p>
      )}
      {operation.materials.length > 0 && (
        <p style={ROW}>
          <span style={MUTED}>{tKanban("resources.materials")}: </span>
          {operation.materials.length}
        </p>
      )}
      {/* Route-owned crew. Kept in its own block under the Auftrag's name so it
          never reads as if these people were assigned to this one stop. */}
      {(routeVehicles.length > 0 || routeCrew.length > 0) && (
        <div style={ROUTE_BLOCK}>
          <p style={ROUTE_TITLE}>{routeName ?? tKanban("resources.auftrag")}</p>
          {routeVehicles.length > 0 && (
            <p style={ROW}>
              <span style={MUTED}>{tKanban("resources.vehicles")}: </span>
              {routeVehicles.map((v) => v.name).join(", ")}
            </p>
          )}
          {routeCrew.length > 0 && (
            <p style={ROW}>
              <span style={MUTED}>{tKanban("resources.crew")}: </span>
              {routeCrewShown.map((p) => p.name).join(", ")}
              {routeCrew.length > routeCrewShown.length && ` +${routeCrew.length - routeCrewShown.length}`}
            </p>
          )}
        </div>
      )}
      {operation.notes && <p style={NOTES}>{operation.notes}</p>}
    </div>
  )
}
