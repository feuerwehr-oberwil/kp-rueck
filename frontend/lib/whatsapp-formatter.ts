/**
 * WhatsApp Formatter Utility
 *
 * Formats operation/incident data into a WhatsApp-compatible message format
 * with emojis and proper formatting for field communication.
 */

import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { type ApiRekoReportResponse } from "@/lib/api-client"

interface FormatWhatsAppMessageOptions {
  operation: Operation
  materials: Material[]
  rekoReport?: ApiRekoReportResponse | null
  vehicleDrivers?: Map<string, string> // Map of vehicle name to driver name
}

/**
 * Format an operation for WhatsApp sharing
 * Uses WhatsApp markdown syntax and emojis for better readability
 */
export function formatWhatsAppMessage({ operation, materials, rekoReport, vehicleDrivers }: FormatWhatsAppMessageOptions): string {
  const lines: string[] = []

  // === HEADER SECTION ===
  // Incident type, location, description all together
  lines.push(`🚨 *${getIncidentTypeLabel(operation.incidentType).toUpperCase()}*`)
  lines.push(`📍 ${operation.location}`)

  // Meldung (Notes/Description) - directly after location
  if (operation.notes && operation.notes.trim()) {
    lines.push(`📝 ${operation.notes}`)
  }

  // Contact/Reporter - part of header
  if (operation.contact && operation.contact.trim()) {
    lines.push(`☎️ ${operation.contact}`)
  }

  // Internal Notes
  if (operation.internalNotes && operation.internalNotes.trim()) {
    lines.push(`📋 ${operation.internalNotes}`)
  }

  lines.push('') // Separator after header

  // === ASSIGNMENTS SECTION ===
  const assignments: string[] = []

  // Assigned Vehicles
  if (operation.vehicles.length > 0) {
    const vehicleList = operation.vehicles.map(vehicleName => {
      const driverName = vehicleDrivers?.get(vehicleName)
      return driverName ? `${vehicleName} (${driverName})` : vehicleName
    })
    assignments.push(`🚒 ${vehicleList.join(', ')}`)
  }

  // Assigned Crew
  if (operation.crew.length > 0) {
    assignments.push(`👤 ${operation.crew.join(', ')}`)
  }

  // Assigned Materials
  if (operation.materials.length > 0) {
    const materialList = operation.materials.map(matId => {
      const material = materials.find(m => m.id === matId)
      if (material) {
        // Include category in parentheses if available
        const category = material.category ? ` (${material.category})` : ''
        return `${material.name}${category}`
      }
      return matId
    })
    assignments.push(`🧰 ${materialList.join(', ')}`)
  }

  // Add all assignments on separate lines
  if (assignments.length > 0) {
    lines.push(assignments.join('\n'))
    lines.push('')
  }

  // === REKO SECTION ===
  if (rekoReport && !rekoReport.is_draft) {
    lines.push(`🔍 *REKO*`)

    // Dangers - inline with main label
    if (rekoReport.dangers_json) {
      const dangers: string[] = []
      if (rekoReport.dangers_json.fire) dangers.push('🔥 Feuer')
      if (rekoReport.dangers_json.fire_danger) dangers.push('🔥 Brandgefahr')
      if (rekoReport.dangers_json.explosion) dangers.push('💥 Explosion')
      if (rekoReport.dangers_json.collapse) dangers.push('⚠️ Einsturz')
      if (rekoReport.dangers_json.chemical) dangers.push('☢️ Gefahrstoffe')
      if (rekoReport.dangers_json.electrical) dangers.push('⚡ Elektrisch')

      if (dangers.length > 0) {
        lines.push(`⚠️ ${dangers.join(', ')}`)
      }

      if (rekoReport.dangers_json.other_notes && rekoReport.dangers_json.other_notes.trim()) {
        lines.push(`_${rekoReport.dangers_json.other_notes}_`)
      }
    }

    // Summary - direct text
    if (rekoReport.summary_text && rekoReport.summary_text.trim()) {
      lines.push(rekoReport.summary_text)
    }

    // Additional Notes
    if (rekoReport.additional_notes && rekoReport.additional_notes.trim()) {
      lines.push(`📌 ${rekoReport.additional_notes}`)
    }

    // Effort Estimation - only vehicles and equipment (people/hours not relevant for WhatsApp)
    if (rekoReport.effort_json) {
      const effort = rekoReport.effort_json
      const effortParts: string[] = []

      if (effort.vehicles_needed && effort.vehicles_needed.length > 0) {
        effortParts.push(`🚗 ${effort.vehicles_needed.join(', ')}`)
      }

      if (effort.equipment_needed && effort.equipment_needed.length > 0) {
        effortParts.push(`🔧 ${effort.equipment_needed.join(', ')}`)
      }

      if (effortParts.length > 0) {
        lines.push(effortParts.join(' • '))
      }
    }

    lines.push('') // Single separator after entire Reko section
  }

  // Footer with timestamp
  const timestamp = new Date().toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
  lines.push(`_Erstellt: ${timestamp}_`)

  return lines.join('\n')
}
