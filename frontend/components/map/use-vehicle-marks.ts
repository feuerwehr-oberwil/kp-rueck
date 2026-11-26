import { useCallback, useEffect, useMemo } from "react"
import { useTranslations } from "next-intl"
import type { ApiVehicle, ApiVehiclePosition } from "@/lib/api-client"
import type { MapIncident } from "@/lib/map-incident"
import { STATUS_TO_GROUP } from "@/lib/types/incidents"
import { GPS_STALE_SETTING, clusterVehicles, estimatePillWidth, parseStaleMinutes, pillFace } from "@/lib/map-vehicles"
import { normalizeVehicleName } from "@/lib/vehicle-positions"
import { haversineKm } from "@/lib/utils/route-geo"
import { useCurrentTime } from "@/lib/hooks/use-current-time"
import { useVehiclePositions } from "@/lib/hooks/use-vehicle-positions"
import { pillTexts } from "./vehicle-marker"
import { shortAddressOf } from "./incident-marker"
import type { PlacedPill } from "./use-vehicle-placement"

/**
 * The Lagekarte's vehicle pills, as MapView draws and places them: the GPS positions (live, or
 * `positionsOverride` in token mode) under KP Rück's vehicle names, one mark per shared spot with
 * its face, width and Magazin flag, and what a pill's list says about each vehicle. Reports to
 * `onGpsAvailabilityChange` whether GPS is live.
 */
export function useVehicleMarks({
  tokenMode,
  unattended,
  positionsOverride,
  vehicles,
  vehicleStaleMinutes,
  stationSettings,
  magazinCoords,
  incidents,
  compactMap,
  onGpsAvailabilityChange,
}: {
  tokenMode: boolean
  /** A wall (`/display/*`): keeps polling while hidden. */
  unattended: boolean
  positionsOverride: ApiVehiclePosition[] | undefined
  vehicles: ApiVehicle[]
  vehicleStaleMinutes: number | undefined
  stationSettings: Record<string, string>
  magazinCoords: [number, number] | null
  incidents: MapIncident[]
  compactMap: boolean
  onGpsAvailabilityChange: ((available: boolean) => void) | undefined
}) {
  const t = useTranslations('map')

  // Vehicle positions from Traccar GPS. A wall (`/display/*`) keeps polling while
  // hidden: nobody is there to bring the tab back to the front.
  const { positions: livePositions, configured: traccarConfigured } = useVehiclePositions({
    enabled: !tokenMode,
    pauseWhenHidden: !unattended,
  })
  const vehiclePositions = positionsOverride ?? livePositions

  // Map Traccar device names to KP Rück vehicle names for assignment line matching
  // Strategies: exact name match, then display_order match (numeric device name → vehicle at that order)
  const deviceNameToVehicleName = useMemo(() => {
    if (vehicles.length === 0) return new Map<string, string>()

    const vehicleNames = new Set(vehicles.map(v => v.name.toLowerCase()))
    const orderToName = new Map(vehicles.map(v => [String(v.display_order), v.name]))
    const mapping = new Map<string, string>()

    for (const vp of vehiclePositions) {
      // If the device name already matches a vehicle name, map to itself
      if (vehicleNames.has(vp.device_name.toLowerCase())) {
        mapping.set(vp.device_name, vp.device_name)
        continue
      }
      // Try matching by display_order (e.g., device "1" → vehicle with display_order 1)
      const mappedName = orderToName.get(vp.device_name.trim())
      if (mappedName) {
        mapping.set(vp.device_name, mappedName)
      }
    }

    return mapping
  }, [vehiclePositions, vehicles])

  // Positions with mapped names for assignment line matching
  const mappedVehiclePositions = useMemo(() => {
    if (deviceNameToVehicleName.size === 0) return vehiclePositions
    return vehiclePositions.map(vp => {
      const mapped = deviceNameToVehicleName.get(vp.device_name)
      return mapped && mapped !== vp.device_name ? { ...vp, device_name: mapped } : vp
    })
  }, [vehiclePositions, deviceNameToVehicleName])

  // Tell the page whether GPS is live at all. Token mode has no status endpoint,
  // so there the positions themselves are the answer.
  const gpsAvailable = tokenMode ? vehiclePositions.length > 0 : traccarConfigured
  useEffect(() => {
    onGpsAvailabilityChange?.(gpsAvailable)
  }, [gpsAvailable, onGpsAvailabilityChange])

  // Vehicles that share (roughly) the same GPS coord collapse into one spot, its list in fleet
  // order (kanban, vehicle sheet, settings), online first (`clusterVehicles`).
  const vehicleSpots = useMemo(() => {
    // device_name (already mapped to vehicle name) → display_order
    const nameToOrder = new Map<string, number>(vehicles.map((v) => [v.name.toLowerCase(), v.display_order]))
    return clusterVehicles(
      mappedVehiclePositions,
      (v) => nameToOrder.get(v.device_name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER,
    )
  }, [mappedVehiclePositions, vehicles])

  const vehicleNameFor = useCallback(
    (vehicle: ApiVehiclePosition) => deviceNameToVehicleName.get(vehicle.device_name) || vehicle.device_name,
    [deviceNameToVehicleName],
  )

  // The pill shows a last-report time only once it is older than the station's threshold
  // (Einstellungen → GPS); the wall gets the threshold with its payload.
  const staleMinutes = parseStaleMinutes(tokenMode ? vehicleStaleMinutes : stationSettings[GPS_STALE_SETTING])
  // Half-minute tick: a pill turns stale while nothing else on the map changes.
  const { currentTime } = useCurrentTime(30_000)
  const vehicleNow = currentTime?.getTime() ?? 0
  // Where a vehicle is assigned, for its line in the list: «12 Ringstrasse 11».
  const assignmentByVehicle = useMemo(() => {
    const byName = new Map<string, string>()
    for (const incident of incidents) {
      if (STATUS_TO_GROUP[incident.status] === "completed") continue
      const label = `${incident.number ?? ""} ${shortAddressOf(incident)}`.trim()
      for (const vehicle of incident.assigned_vehicles) byName.set(normalizeVehicleName(vehicle.name), label)
    }
    return byName
  }, [incidents])
  const vehicleAssignmentFor = useCallback(
    (vehicle: ApiVehiclePosition) => assignmentByVehicle.get(normalizeVehicleName(vehicleNameFor(vehicle))) ?? null,
    [assignmentByVehicle, vehicleNameFor],
  )
  // A spot within the Magazin's radius is «… · Magazin» in its list.
  const magazinRadiusM = Number.parseFloat(stationSettings["gps.station_radius_meters"] ?? "") || 100
  const vehicleMarks = useMemo(
    () =>
      vehicleSpots.map((spot) => {
        const face = pillFace(spot, vehicleNameFor, vehicleNow, staleMinutes)
        const texts = pillTexts(t, face, vehicleNow, compactMap)
        return {
          spot,
          face,
          width: estimatePillWidth(face, { primary: texts.label, secondary: texts.offlinePart ?? undefined, time: texts.time ?? undefined }),
          atMagazin:
            !!magazinCoords &&
            haversineKm([spot.latitude, spot.longitude], [magazinCoords[0], magazinCoords[1]]) * 1000 <= magazinRadiusM,
        }
      }),
    [vehicleSpots, vehicleNameFor, vehicleNow, staleMinutes, t, magazinCoords, magazinRadiusM, compactMap],
  )
  const vehiclePlacementInput = useMemo<PlacedPill[]>(
    () => vehicleMarks.map(({ spot, width }) => ({ key: spot.key, latitude: spot.latitude, longitude: spot.longitude, width, offset: undefined })),
    [vehicleMarks],
  )

  return {
    traccarConfigured,
    mappedVehiclePositions,
    vehicleNameFor,
    vehicleAssignmentFor,
    staleMinutes,
    vehicleNow,
    vehicleMarks,
    vehiclePlacementInput,
  }
}
