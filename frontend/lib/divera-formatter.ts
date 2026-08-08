/**
 * Divera alarm message formatter.
 *
 * Like the WhatsApp message but tuned for Divera: plain text (Divera does not
 * render markdown, so no '*'/'_'), no location line (the address is sent as a
 * structured field), and materials rendered as a list. Emojis are kept.
 *
 * Order, emojis and labels live in editable templates (settings); this builder
 * only renders each section's content into token values. See message-template.ts.
 */

import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { sortCrewByLeader } from "@/lib/crew-order"
import {
  renderMessageTemplate,
  DEFAULT_ALARM_TITLE_TEMPLATE,
  DEFAULT_ALARM_TEXT_TEMPLATE,
} from "@/lib/message-template"

interface FormatAlarmMessageOptions {
  operation: Operation
  materials: Material[]
  /** Editable template; falls back to the built-in default when omitted. */
  template?: string
}

/** Alarm title (Stichwort), e.g. "KP: Elementarereignis". */
export function formatAlarmTitle(operation: Operation, template?: string): string {
  const values: Record<string, string> = {
    type: getIncidentTypeLabel(operation.incidentType),
    location: operation.location?.trim() || "",
    priority: operation.priority || "",
  }
  return renderMessageTemplate(template || DEFAULT_ALARM_TITLE_TEMPLATE, values)
}

/** Render the assigned-vehicles section content (callsign + stay/return, no driver). */
function buildVehicles(operation: Operation): string {
  // A "zu Fuss" incident has no vehicle on purpose — surface that explicitly
  // instead of leaving the section blank, so the crew knows they go on foot.
  if (operation.vehicles.length === 0) return operation.zuFuss ? "Zu Fuss" : ""
  const vehicleLines = operation.vehicles.map((vehicleName) => {
    const callsign = operation.vehicleCallsigns?.get(vehicleName)
    const driverStay = operation.vehicleDriverStay?.get(vehicleName)
    const displayName = callsign ? `${vehicleName} · ${callsign}` : vehicleName
    if (driverStay === undefined) return displayName
    return `${displayName} (${driverStay ? "bleibt vor Ort" : "kehrt zurück"})`
  })
  return vehicleLines.join(", ")
}

/** Render the materials section content as a "Material:\n- item" list, or "". */
function buildMaterials(operation: Operation, materials: Material[]): string {
  if (operation.materials.length === 0) return ""
  const lines = ["Material:"]
  for (const matId of operation.materials) {
    const material = materials.find((m) => m.id === matId)
    const name = material
      ? `${material.name}${material.category ? ` (${material.category})` : ""}`
      : "Unbekanntes Material"
    lines.push(`- ${name}`)
  }
  return lines.join("\n")
}

/** Plain-text alarm body for Divera. */
export function formatAlarmMessage({ operation, materials, template }: FormatAlarmMessageOptions): string {
  const type = getIncidentTypeLabel(operation.incidentType)
  const location = operation.location?.trim() || ""
  const values: Record<string, string> = {
    type,
    location,
    notes: operation.notes?.trim() || "",
    contact: operation.contact?.trim() || "",
    internal_notes: operation.internalNotes?.trim() || "",
    vehicles: buildVehicles(operation),
    // EL first (decision 23): the alarm text is read on a phone on the way out.
    crew: operation.crew.length > 0 ? sortCrewByLeader(operation.crew, operation.leaderName).join(", ") : "",
    materials: buildMaterials(operation, materials),
  }
  const rendered = renderMessageTemplate(template || DEFAULT_ALARM_TEXT_TEMPLATE, values)
  if (rendered.trim().length > 0) return rendered
  // The default body is all optional sections (notes/crew/vehicles/materials); a
  // minimal incident leaves every line empty and the renderer drops them all,
  // producing a blank alarm. Never send an empty body — fall back to type + place.
  return location ? `${type}\n${location}` : type
}
