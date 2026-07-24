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
import type { Operation } from "@/lib/contexts/operations-context"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"

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
}: {
  operation: Operation
  /** Route-stop sequence number ("2." prefix on Auftrag stops). */
  seq?: number
}) {
  const tKanban = useTranslations("kanban")
  const tIncidents = useTranslations("incidents")
  const address =
    formatLocationForDisplay(operation.location, getGlobalHomeCity()) || operation.location
  const crewShown = operation.crew.slice(0, 3)

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
      {operation.assignedReko && (
        <p style={ROW}>
          <span style={MUTED}>Reko: </span>
          {operation.assignedReko.name}
        </p>
      )}
      {operation.vehicles.length > 0 && (
        <p style={ROW}>
          <span style={MUTED}>{tKanban("resources.vehicles")}: </span>
          {operation.vehicles.join(", ")}
        </p>
      )}
      {operation.crew.length > 0 && (
        <p style={ROW}>
          <span style={MUTED}>{tKanban("resources.crew")}: </span>
          {crewShown.join(", ")}
          {operation.crew.length > crewShown.length && ` +${operation.crew.length - crewShown.length}`}
        </p>
      )}
      {operation.materials.length > 0 && (
        <p style={ROW}>
          <span style={MUTED}>{tKanban("resources.materials")}: </span>
          {operation.materials.length}
        </p>
      )}
      {operation.notes && <p style={NOTES}>{operation.notes}</p>}
    </div>
  )
}
