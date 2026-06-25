/**
 * WhatsApp Formatter Utility
 *
 * Formats operation/incident data into a WhatsApp-compatible message. The order,
 * emojis and labels live in an editable template (settings); this builder only
 * renders each section's *content* into token values. See message-template.ts.
 */

import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { type ApiRekoReportResponse } from "@/lib/api-client"
import {
  renderMessageTemplate,
  DEFAULT_WHATSAPP_INCIDENT_TEMPLATE,
} from "@/lib/message-template"

interface FormatWhatsAppMessageOptions {
  operation: Operation
  materials: Material[]
  rekoReport?: ApiRekoReportResponse | null
  vehicleDrivers?: Map<string, string> // Map of vehicle name to driver name
  vehicleCallsigns?: Map<string, string> // Map of vehicle name to radio_call_sign
  /** Editable template; falls back to the built-in default when omitted. */
  template?: string
}

/** Render the assigned-vehicles section content (without the leading emoji). */
function buildVehicles(
  operation: Operation,
  vehicleDrivers?: Map<string, string>,
  vehicleCallsigns?: Map<string, string>,
): string {
  if (operation.vehicles.length === 0) return ""
  const vehicleLines = operation.vehicles.map((vehicleName) => {
    const callsign = vehicleCallsigns?.get(vehicleName) || operation.vehicleCallsigns?.get(vehicleName)
    const driverName = vehicleDrivers?.get(vehicleName)
    const driverStay = operation.vehicleDriverStay?.get(vehicleName)
    const displayName = callsign ? `${vehicleName} · ${callsign}` : vehicleName
    const parts = [displayName]
    if (driverName) parts.push(`Fahrer: ${driverName}`)
    if (driverStay !== undefined) {
      parts.push(driverStay ? "📍 bleibt vor Ort" : "↩ kehrt zurück")
    }
    return driverName || driverStay !== undefined
      ? `${parts[0]} (${parts.slice(1).join(", ")})`
      : parts[0]
  })
  return vehicleLines.join(", ")
}

/** Render the assigned-materials section content (without the leading emoji). */
function buildMaterials(operation: Operation, materials: Material[]): string {
  if (operation.materials.length === 0) return ""
  const materialList = operation.materials.map((matId) => {
    const material = materials.find((m) => m.id === matId)
    if (material) {
      const category = material.category ? ` (${material.category})` : ""
      return `${material.name}${category}`
    }
    // Material was deleted after assignment — show a readable placeholder
    // rather than leaking a raw UUID into the WhatsApp message.
    return "Unbekanntes Material"
  })
  return materialList.join(", ")
}

/** Render the whole Reko block (incl. its "🔍 *REKO*" header), or "" when none. */
function buildReko(rekoReport?: ApiRekoReportResponse | null): string {
  if (!rekoReport || rekoReport.is_draft) return ""
  const lines: string[] = [`🔍 *REKO*`]

  if (rekoReport.dangers_json) {
    const dangers: string[] = []
    if (rekoReport.dangers_json.fire) dangers.push("🔥 Feuer")
    if (rekoReport.dangers_json.fire_danger) dangers.push("🔥 Brandgefahr")
    if (rekoReport.dangers_json.explosion) dangers.push("💥 Explosion")
    if (rekoReport.dangers_json.collapse) dangers.push("⚠️ Einsturz")
    if (rekoReport.dangers_json.chemical) dangers.push("☢️ Gefahrstoffe")
    if (rekoReport.dangers_json.electrical) dangers.push("⚡ Elektrisch")
    if (dangers.length > 0) lines.push(`⚠️ ${dangers.join(", ")}`)
    if (rekoReport.dangers_json.other_notes && rekoReport.dangers_json.other_notes.trim()) {
      lines.push(`_${rekoReport.dangers_json.other_notes}_`)
    }
  }

  if (rekoReport.summary_text && rekoReport.summary_text.trim()) {
    lines.push(rekoReport.summary_text)
  }
  if (rekoReport.additional_notes && rekoReport.additional_notes.trim()) {
    lines.push(`📌 ${rekoReport.additional_notes}`)
  }

  if (rekoReport.effort_json) {
    const effort = rekoReport.effort_json
    const effortParts: string[] = []
    if (effort.vehicles_needed && effort.vehicles_needed.length > 0) {
      effortParts.push(`🚗 ${effort.vehicles_needed.join(", ")}`)
    }
    if (effort.equipment_needed && effort.equipment_needed.length > 0) {
      effortParts.push(`🔧 ${effort.equipment_needed.join(", ")}`)
    }
    if (effortParts.length > 0) lines.push(effortParts.join(" • "))
  }

  return lines.join("\n")
}

/**
 * Format an operation for WhatsApp sharing.
 * Uses WhatsApp markdown syntax and emojis for better readability.
 */
export function formatWhatsAppMessage({
  operation,
  materials,
  rekoReport,
  vehicleDrivers,
  vehicleCallsigns,
  template,
}: FormatWhatsAppMessageOptions): string {
  const timestamp = new Date().toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  const values: Record<string, string> = {
    type: getIncidentTypeLabel(operation.incidentType).toUpperCase(),
    location: operation.location?.trim() || "",
    notes: operation.notes?.trim() || "",
    contact: operation.contact?.trim() || "",
    internal_notes: operation.internalNotes?.trim() || "",
    vehicles: buildVehicles(operation, vehicleDrivers, vehicleCallsigns),
    crew: operation.crew.length > 0 ? operation.crew.join(", ") : "",
    materials: buildMaterials(operation, materials),
    reko: buildReko(rekoReport),
    timestamp,
  }

  return renderMessageTemplate(template || DEFAULT_WHATSAPP_INCIDENT_TEMPLATE, values)
}
