"use client"

import { useMemo } from "react"
import { Polyline, Tooltip } from "react-leaflet"
import type { Incident } from "@/lib/types/incidents"
import type { ApiVehiclePosition } from "@/lib/api-client"
import { STATUS_TO_GROUP, type IncidentStatus } from "@/lib/types/incidents"

interface AssignmentLine {
  vehicleName: string
  vehiclePosition: [number, number]
  incidentPosition: [number, number]
  incidentTitle: string
}

interface AssignmentLinesProps {
  incidents: Incident[]
  vehiclePositions: ApiVehiclePosition[]
  visible?: boolean
}

/**
 * Normalize a name for fuzzy matching: lowercase, strip whitespace and punctuation.
 * e.g. "TLF 1" → "tlf1", "TLF1" → "tlf1"
 */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_.]+/g, '')
}

/**
 * Try to find a vehicle position matching a given vehicle name.
 * Uses multiple strategies:
 * 1. Exact lowercase match
 * 2. Normalized match (strip whitespace/punctuation)
 * 3. Containment check (device name contains vehicle name or vice versa)
 */
function findMatchingPosition(
  vehicleName: string,
  byExact: Map<string, ApiVehiclePosition>,
  byNormalized: Map<string, ApiVehiclePosition>,
  allPositions: ApiVehiclePosition[]
): ApiVehiclePosition | undefined {
  // Strategy 1: Exact lowercase
  const exact = byExact.get(vehicleName.toLowerCase())
  if (exact) return exact

  // Strategy 2: Normalized (strip whitespace)
  const normalized = byNormalized.get(normalizeName(vehicleName))
  if (normalized) return normalized

  // Strategy 3: Containment — one name contains the other
  const vNameNorm = normalizeName(vehicleName)
  for (const vp of allPositions) {
    const devNorm = normalizeName(vp.device_name)
    if (devNorm.includes(vNameNorm) || vNameNorm.includes(devNorm)) {
      return vp
    }
  }

  return undefined
}

/**
 * Draws animated dashed red polylines ("ant trails") from each vehicle's
 * GPS position to its assigned incident location.
 *
 * Only shows lines for:
 * - Vehicles that are online and have GPS coordinates
 * - Active assignments (not completed incidents)
 * - Incidents with valid coordinates
 */
export function AssignmentLines({ incidents, vehiclePositions, visible = true }: AssignmentLinesProps) {
  const lines = useMemo(() => {
    if (!visible || vehiclePositions.length === 0) return []

    const result: AssignmentLine[] = []

    // Build lookup maps for vehicle positions
    const byExact = new Map<string, ApiVehiclePosition>()
    const byNormalized = new Map<string, ApiVehiclePosition>()
    for (const vp of vehiclePositions) {
      byExact.set(vp.device_name.toLowerCase(), vp)
      byNormalized.set(normalizeName(vp.device_name), vp)
    }

    // For each incident with assigned vehicles, try to find a matching GPS position
    for (const incident of incidents) {
      // Skip incidents without coordinates
      if (incident.location_lat == null || incident.location_lng == null) continue

      // Skip completed incidents
      const group = STATUS_TO_GROUP[incident.status as IncidentStatus]
      if (group === "completed") continue

      for (const vehicle of incident.assigned_vehicles) {
        const vp = findMatchingPosition(vehicle.name, byExact, byNormalized, vehiclePositions)
        if (!vp) continue

        result.push({
          vehicleName: vehicle.name,
          vehiclePosition: [vp.latitude, vp.longitude],
          incidentPosition: [incident.location_lat, incident.location_lng],
          incidentTitle: incident.title || incident.location_address || "Einsatz",
        })
      }
    }

    return result
  }, [incidents, vehiclePositions, visible])

  if (!visible || lines.length === 0) return null

  return (
    <>
      {/* Inject ant-trail CSS animation once */}
      <style>{`
        .ant-trail {
          animation: ant-march 1s linear infinite;
        }
        @keyframes ant-march {
          to {
            stroke-dashoffset: -20;
          }
        }
      `}</style>

      {lines.map((line, idx) => (
        <Polyline
          key={`${line.vehicleName}-${idx}`}
          positions={[line.vehiclePosition, line.incidentPosition]}
          pathOptions={{
            color: "#dc2626",
            weight: 2.5,
            opacity: 0.8,
            dashArray: "8, 12",
            className: "ant-trail",
          }}
        >
          <Tooltip sticky>
            <span className="text-xs font-medium">
              {line.vehicleName} → {line.incidentTitle}
            </span>
          </Tooltip>
        </Polyline>
      ))}
    </>
  )
}
