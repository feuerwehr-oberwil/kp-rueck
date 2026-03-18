"use client"

import { useState, useEffect, useCallback } from "react"
import { Polyline, Tooltip } from "react-leaflet"
import { apiClient, type ApiVehicleTrail } from "@/lib/api-client"

interface VehicleTrailsProps {
  /** Whether Traccar is configured and trails should be fetched */
  enabled: boolean
  /** How many minutes of trail history to show */
  minutes?: number
  /** Polling interval in ms */
  pollInterval?: number
}

/**
 * Renders fading breadcrumb trails behind each GPS-tracked vehicle.
 * Each trail is a polyline showing the vehicle's recent path.
 * Older segments fade out gradually.
 */
export function VehicleTrails({
  enabled,
  minutes = 30,
  pollInterval = 30000,
}: VehicleTrailsProps) {
  const [trails, setTrails] = useState<ApiVehicleTrail[]>([])

  const fetchTrails = useCallback(async () => {
    try {
      const data = await apiClient.getVehicleTrails(minutes)
      setTrails(data)
    } catch {
      // Silent — trails are optional
    }
  }, [minutes])

  useEffect(() => {
    if (!enabled) return

    fetchTrails()
    const interval = setInterval(fetchTrails, pollInterval)
    return () => clearInterval(interval)
  }, [enabled, fetchTrails, pollInterval])

  if (!enabled || trails.length === 0) return null

  return (
    <>
      {trails.map((trail) => {
        if (trail.points.length < 2) return null

        const positions = trail.points.map(
          (p) => [p.latitude, p.longitude] as [number, number]
        )

        return (
          <Polyline
            key={`trail-${trail.device_id}`}
            positions={positions}
            pathOptions={{
              color: "#3b82f6",
              weight: 2,
              opacity: 0.35,
              dashArray: "4, 8",
              lineCap: "round",
              lineJoin: "round",
            }}
          >
            <Tooltip sticky>
              <span className="text-xs">{trail.device_name} — letzte {minutes} Min.</span>
            </Tooltip>
          </Polyline>
        )
      })}
    </>
  )
}
