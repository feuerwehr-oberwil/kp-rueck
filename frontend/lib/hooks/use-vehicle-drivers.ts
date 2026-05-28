"use client"

import { useCallback, useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"
import { wsClient } from "@/lib/websocket-client"

/**
 * Returns a live map of vehicle name → driver name for the given event.
 *
 * Subscribes to `special_function_update` WebSocket events (cross-tab) and the
 * `driver-assignment-changed` window event (same-tab) so any place that shows
 * driver names stays in sync with vehicle-status-sheet changes without manual
 * refresh.
 *
 * Pass `enabled` to gate fetching — e.g. only load while a modal is open.
 */
export function useVehicleDrivers(eventId: string | null | undefined, enabled = true) {
  const [vehicleDrivers, setVehicleDrivers] = useState<Map<string, string>>(new Map())

  const load = useCallback(async () => {
    if (!enabled || !eventId) return
    try {
      const [vehicles, specialFunctions] = await Promise.all([
        apiClient.getVehicles(),
        apiClient.getEventSpecialFunctions(eventId),
      ])

      const vehicleIdToName = new Map<string, string>()
      vehicles.forEach((v) => vehicleIdToName.set(v.id, v.name))

      const next = new Map<string, string>()
      specialFunctions
        .filter((f) => f.function_type === "driver" && f.vehicle_id)
        .forEach((f) => {
          const vehicleName = vehicleIdToName.get(f.vehicle_id!)
          if (vehicleName) {
            next.set(vehicleName, f.personnel_name)
          }
        })

      setVehicleDrivers(next)
    } catch (error) {
      console.error("Failed to load vehicle drivers:", error)
    }
  }, [enabled, eventId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!enabled) return
    const unsubscribeWs = wsClient.on("special_function_update", () => {
      load()
    })
    const handleDriverChanged = () => load()
    window.addEventListener("driver-assignment-changed", handleDriverChanged)
    return () => {
      unsubscribeWs()
      window.removeEventListener("driver-assignment-changed", handleDriverChanged)
    }
  }, [enabled, load])

  return vehicleDrivers
}
