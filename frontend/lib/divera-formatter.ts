/**
 * Divera alarm message formatter.
 *
 * Like the WhatsApp message but tuned for Divera: plain text (Divera does not
 * render markdown, so no '*'/'_'), no location line (the address is sent as a
 * structured field), and materials rendered as a list. Emojis are kept.
 */

import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { getIncidentTypeLabel } from "@/lib/incident-types"

interface FormatDiveraMessageOptions {
  operation: Operation
  materials: Material[]
}

/** Alarm title (Stichwort): the emergency type, e.g. "KP: Elementarereignis". */
export function formatDiveraTitle(operation: Operation): string {
  return `KP: ${getIncidentTypeLabel(operation.incidentType)}`
}

/** Plain-text alarm body for Divera. */
export function formatDiveraMessage({ operation, materials }: FormatDiveraMessageOptions): string {
  const lines: string[] = []

  // === HEADER === (no location — it's in the alarm's address field)
  if (operation.notes && operation.notes.trim()) {
    lines.push(`📝 ${operation.notes}`)
  }
  if (operation.contact && operation.contact.trim()) {
    lines.push(`☎️ ${operation.contact}`)
  }
  if (operation.internalNotes && operation.internalNotes.trim()) {
    lines.push(`📋 ${operation.internalNotes}`)
  }

  if (lines.length > 0) lines.push("")

  // === ASSIGNMENTS ===
  // Vehicles (with callsign + stay/return), one line.
  if (operation.vehicles.length > 0) {
    const vehicleLines = operation.vehicles.map((vehicleName) => {
      const callsign = operation.vehicleCallsigns?.get(vehicleName)
      const driverStay = operation.vehicleDriverStay?.get(vehicleName)
      const displayName = callsign ? `${vehicleName} · ${callsign}` : vehicleName
      if (driverStay === undefined) return displayName
      return `${displayName} (${driverStay ? "bleibt vor Ort" : "kehrt zurück"})`
    })
    lines.push(`🚒 ${vehicleLines.join(", ")}`)
  }

  // Crew, one line.
  if (operation.crew.length > 0) {
    lines.push(`👤 ${operation.crew.join(", ")}`)
  }

  // Materials, as a list (one per line).
  if (operation.materials.length > 0) {
    lines.push("🧰 Material:")
    for (const matId of operation.materials) {
      const material = materials.find((m) => m.id === matId)
      const name = material
        ? `${material.name}${material.category ? ` (${material.category})` : ""}`
        : "Unbekanntes Material"
      lines.push(`- ${name}`)
    }
  }

  // Footer timestamp (no markdown).
  const timestamp = new Date().toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
  if (lines.length > 0) lines.push("")
  lines.push(`Erstellt: ${timestamp}`)

  return lines.join("\n")
}
