"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Marker, Polyline, Tooltip } from "react-leaflet"
import L from "leaflet"
import type { Incident } from "@/lib/types/incidents"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
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
  /** The Aufträge, so a vehicle assigned to a ROUTE gets a line too — see
   *  `routeTargets`. Without these it drew none at all. */
  groups?: IncidentGroup[]
  /** Resolves a route's own resources (the vehicle names live here, not on the
   *  stops). Same resolver the route overlay and the hover card use. */
  groupResourcesFor?: (groupId: string) => GroupResources
}

/**
 * Which stop of an Auftrag its vehicles are driving to *now*.
 *
 * A route is worked in order, so one line per vehicle — to the stop in hand —
 * says where it is going. Drawing one to every remaining stop would fan five
 * red lines out of one MTW and answer a question nobody asked. A crew already
 * on site (`active`) is the stop in hand even if an earlier one is still open;
 * otherwise it is the first stop that is not finished.
 */
function currentStop(group: IncidentGroup, byId: Map<string, Incident>): Incident | undefined {
  const stops = group.stopIds.map(id => byId.get(id)).filter((stop): stop is Incident => stop !== undefined)
  const located = stops.filter(stop => stop.location_lat != null && stop.location_lng != null)
  return (
    located.find(stop => stop.status === "active")
    ?? located.find(stop => STATUS_TO_GROUP[stop.status as IncidentStatus] !== "completed")
  )
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
  groups,
  groupResourcesFor,
}: AssignmentLinesProps) {
  const t = useTranslations('map')
  const lines = useMemo(() => {
    if (!visible && !showDistances) return []

    const result: AssignmentLine[] = []
    // One line per vehicle per place, however the vehicle got there: a route
    // vehicle that is also assigned to the stop itself must not be drawn twice.
    const drawn = new Set<string>()

    // Stops are ordinary incidents; the route only carries their ids.
    const byId = new Map(incidents.map(incident => [incident.id, incident]))

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

      // Skip the whole completed group, Rückfahrt included — a drive-home
      // line was tried and dropped: the beendet column is noise on this layer.
      if (STATUS_TO_GROUP[incident.status as IncidentStatus] === "completed") continue

      for (const vehicle of incident.assigned_vehicles) {
        addLine(vehicle.name, incident)
      }
    }

    // The Aufträge: their vehicles belong to the ROUTE and hold no assignment on
    // any single stop, so every one of them was missing from this layer — the
    // squad the KP sent out as one job was the squad with no line on the map.
    for (const group of groups ?? []) {
      const stop = currentStop(group, byId)
      if (!stop) continue
      for (const vehicle of groupResourcesFor?.(group.id)?.vehicles ?? []) {
        addLine(vehicle.name, stop)
      }
    }

    return result

    /** Push one vehicle→place line, once, if that vehicle has a GPS fix. */
    function addLine(vehicleName: string, incident: Incident) {
      if (incident.location_lat == null || incident.location_lng == null) return
      const key = `${normalizeName(vehicleName)}|${incident.id}`
      if (drawn.has(key)) return
      const vp = findMatchingPosition(vehicleName, byExact, byNormalized, vehiclePositions)
      // No match is the normal case for a vehicle without a tracker, so it is
      // silent: logging it fired once per vehicle per render.
      if (!vp) return
      drawn.add(key)

      result.push({
        vehicleName,
        vehiclePosition: [vp.latitude, vp.longitude],
        incidentPosition: [incident.location_lat, incident.location_lng],
        // title is usually the raw address, so strip the home town from either
        incidentTitle: (incident.location_display ?? formatLocationForDisplay(incident.title || incident.location_address || '', getGlobalHomeCity())) || t('assignmentLines.incidentFallback'),
        distanceMeters: distanceMeters(vp.latitude, vp.longitude, incident.location_lat, incident.location_lng),
      })
    }
  }, [incidents, vehiclePositions, visible, showDistances, groups, groupResourcesFor, t])

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

      {/* A distance is a property OF a line. Drawn only while «Linien» was on,
          the labels became red pills floating in open country with nothing to
          measure — so switching distances on brings the lines with it. */}
      {(visible || showDistances) &&
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

      {/* Distance labels at the line midpoints */}
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
