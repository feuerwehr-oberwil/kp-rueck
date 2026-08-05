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
import { type GroupResources } from "@/lib/types/groups"
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
  /** Resources owned by the incident's Auftrag (route). A grouped incident
   *  carries none itself — the route does — so merge these in or the crew /
   *  vehicle / material lines come out blank. */
  groupResources?: GroupResources | null
  /** Auftrag context to prepend (route name + stop position), when grouped. */
  auftrag?: { name: string; stopPos: number; stopTotal: number } | null
  /** Editable template; falls back to the built-in default when omitted. */
  template?: string
}

/** Render the assigned-vehicles section content (without the leading emoji). */
function buildVehicles(
  operation: Operation,
  vehicleDrivers?: Map<string, string>,
  vehicleCallsigns?: Map<string, string>,
): string {
  // A "zu Fuss" incident has no vehicle on purpose — surface that explicitly
  // instead of leaving the section blank, so the crew knows they go on foot.
  if (operation.vehicles.length === 0) return operation.zuFuss ? "🚶 Zu Fuss" : ""
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
/** Crew as one line, with the Einsatzleiter marked. */
function formatCrew(crew: string[], leaderName: string | null): string {
  if (crew.length === 0) return ""
  return crew.map((name) => (leaderName && name === leaderName ? `EL ${name}` : name)).join(", ")
}

export function formatWhatsAppMessage({
  operation,
  materials,
  rekoReport,
  vehicleDrivers,
  vehicleCallsigns,
  groupResources,
  auftrag,
  template,
}: FormatWhatsAppMessageOptions): string {
  const timestamp = new Date().toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  // A grouped incident's crew/vehicles/materials live on the Auftrag, so its own
  // arrays are empty — merge the route's resources in before composing, or the
  // message dispatches with no crew/vehicle/material.
  const eff = groupResources
    ? {
        ...operation,
        crew: [...operation.crew, ...groupResources.personnel.map((p) => p.name)],
        vehicles: [...operation.vehicles, ...groupResources.vehicles.map((v) => v.name)],
        materials: [...operation.materials, ...groupResources.materials.map((m) => m.resourceId)],
        vehicleDriverStay: (() => {
          const m = new Map(operation.vehicleDriverStay ?? [])
          for (const v of groupResources.vehicles) {
            if (v.driverStay !== undefined) m.set(v.name, v.driverStay)
          }
          return m
        })(),
      }
    : operation

  // A stop owns no people — the route does — so a grouped incident takes its
  // Einsatzleiter from the Auftrag. «EL» goes out as the same two letters the
  // board shows and the radio says.
  const leaderName = groupResources?.personnel.find((p) => p.isLeader)?.name ?? operation.leaderName ?? null

  const values: Record<string, string> = {
    type: getIncidentTypeLabel(operation.incidentType).toUpperCase(),
    location: operation.location?.trim() || "",
    notes: operation.notes?.trim() || "",
    contact: operation.contact?.trim() || "",
    internal_notes: operation.internalNotes?.trim() || "",
    vehicles: buildVehicles(eff, vehicleDrivers, vehicleCallsigns),
    crew: formatCrew(eff.crew, leaderName),
    materials: buildMaterials(eff, materials),
    reko: buildReko(rekoReport),
    timestamp,
  }

  const body = renderMessageTemplate(template || DEFAULT_WHATSAPP_INCIDENT_TEMPLATE, values)
  // Prepend the route context so the recipient sees this is one stop of a route.
  return auftrag
    ? `📋 Auftrag «${auftrag.name}» · Stop ${auftrag.stopPos}/${auftrag.stopTotal}\n\n${body}`
    : body
}
