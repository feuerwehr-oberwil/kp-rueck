"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Marker, Polyline, Tooltip } from "react-leaflet"
import L from "leaflet"
import type { Incident } from "@/lib/types/incidents"
import type { ApiVehiclePosition } from "@/lib/api-client"
import { STATUS_TO_GROUP, type IncidentStatus } from "@/lib/types/incidents"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"

interface AssignmentLine {
  vehicleName: string
  vehiclePosition: [number, number]
  incidentPosition: [number, number]
  incidentTitle: string
  distanceMeters: number
}

interface AssignmentLinesProps {
  incidents: Incident[]
  vehiclePositions: ApiVehiclePosition[]
  visible?: boolean
  /** Show the vehicle→incident distance as a label on each assignment. */
  showDistances?: boolean
}

// Haversine distance in meters (same formula as the backend geofence checks).
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(meters: number): string {
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`
  return `${(meters / 1000).toFixed(1)} km`
}

// Small pill label rendered at the midpoint of an assignment line.
function distanceLabelIcon(text: string): L.DivIcon {
  const html = `
    <div style="
      transform: translate(-50%, -50%);
      display: inline-block;
      background: rgba(255, 255, 255, 0.95);
      color: #dc2626;
      border: 1.5px solid #dc2626;
      border-radius: 9999px;
      padding: 1px 7px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    ">${text}</div>
  `
  return L.divIcon({ html, className: "distance-label", iconSize: [0, 0] })
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
export function AssignmentLines({
  incidents,
  vehiclePositions,
  visible = true,
  showDistances = false,
}: AssignmentLinesProps) {
  const t = useTranslations('map')
  const lines = useMemo(() => {
    if (!visible && !showDistances) return []

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
        if (!vp) {
          if (vehiclePositions.length > 0) {
            console.debug(
              `[AssignmentLines] No GPS match for vehicle "${vehicle.name}". Traccar devices: [${vehiclePositions.map(p => p.device_name).join(', ')}]`
            )
          }
          continue
        }

        result.push({
          vehicleName: vehicle.name,
          vehiclePosition: [vp.latitude, vp.longitude],
          incidentPosition: [incident.location_lat, incident.location_lng],
          // title is usually the raw address, so strip the home town from either
          incidentTitle: (incident.location_display ?? formatLocationForDisplay(incident.title || incident.location_address || '', getGlobalHomeCity())) || t('assignmentLines.incidentFallback'),
          distanceMeters: distanceMeters(
            vp.latitude,
            vp.longitude,
            incident.location_lat,
            incident.location_lng,
          ),
        })
      }
    }

    return result
  }, [incidents, vehiclePositions, visible, showDistances, t])

  if ((!visible && !showDistances) || lines.length === 0) return null

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

      {visible &&
        lines.map((line, idx) => (
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
                {line.vehicleName} → {line.incidentTitle} ({formatDistance(line.distanceMeters)})
              </span>
            </Tooltip>
          </Polyline>
        ))}

      {/* Distance labels at the line midpoints (independent of line visibility) */}
      {showDistances &&
        lines.map((line, idx) => (
          <Marker
            key={`distance-${line.vehicleName}-${idx}`}
            position={[
              (line.vehiclePosition[0] + line.incidentPosition[0]) / 2,
              (line.vehiclePosition[1] + line.incidentPosition[1]) / 2,
            ]}
            icon={distanceLabelIcon(formatDistance(line.distanceMeters))}
            interactive={false}
            zIndexOffset={200}
          />
        ))}
    </>
  )
}
