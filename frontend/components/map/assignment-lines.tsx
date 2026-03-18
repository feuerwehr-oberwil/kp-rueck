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
    if (!visible) return []

    const result: AssignmentLine[] = []

    // Build a map of vehicle name (lowercase) → position for quick lookup
    const vehicleByName = new Map<string, ApiVehiclePosition>()
    for (const vp of vehiclePositions) {
      vehicleByName.set(vp.device_name.toLowerCase(), vp)
    }

    // For each incident with assigned vehicles, try to find a matching GPS position
    for (const incident of incidents) {
      // Skip incidents without coordinates
      if (incident.location_lat == null || incident.location_lng == null) continue

      // Skip completed incidents
      const group = STATUS_TO_GROUP[incident.status as IncidentStatus]
      if (group === "completed") continue

      for (const vehicle of incident.assigned_vehicles) {
        const vp = vehicleByName.get(vehicle.name.toLowerCase())
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
