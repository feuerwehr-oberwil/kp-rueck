"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { apiClient } from "@/lib/api-client"
import { wsClient } from "@/lib/websocket-client"
import { useOperations } from "@/lib/contexts/operations-context"

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
  return useVehicleDriverState(eventId, enabled).drivers
}

/**
 * The same map plus whether it has loaded at least once for this event. A
 * surface that says «Kein Fahrer» needs the flag: before the first answer an
 * empty map means «not known yet», not «nobody is driving».
 */
export function useVehicleDriverState(eventId: string | null | undefined, enabled = true) {
  // The fleet off the board sync (no fetch of its own); a driver is stored by
  // vehicle id and named at render, so a renamed truck renames its row too.
  const { vehicles, isLoaded: fleetLoaded } = useOperations()
  const [driversByVehicleId, setDriversByVehicleId] = useState<Map<string, string>>(new Map())
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!enabled || !eventId) return
    try {
      const specialFunctions = await apiClient.getEventSpecialFunctions(eventId)
      const next = new Map<string, string>()
      for (const f of specialFunctions) {
        if (f.function_type === "driver" && f.vehicle_id) next.set(f.vehicle_id, f.personnel_name)
      }
      setDriversByVehicleId(next)
      setLoadedFor(eventId)
    } catch (error) {
      console.error("Failed to load vehicle drivers:", error)
    }
  }, [enabled, eventId])

  const vehicleDrivers = useMemo(() => {
    const byName = new Map<string, string>()
    for (const vehicle of vehicles) {
      const driver = driversByVehicleId.get(vehicle.id)
      if (driver) byName.set(vehicle.name, driver)
    }
    return byName
  }, [vehicles, driversByVehicleId])

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

  return { drivers: vehicleDrivers, loaded: !!eventId && loadedFor === eventId && fleetLoaded }
}
