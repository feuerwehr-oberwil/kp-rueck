"use client"

import { useCallback, useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"
import { wsClient } from "@/lib/websocket-client"
import { useOperations } from "@/lib/contexts/operations-context"
import type { ApiEventSpecialFunctionResponse } from "@/lib/api/types/events"

/** A vehicle's driver. The id is there so `PersonName` / `usePersonNaming` can
 *  add the namesake Kennung – a driver is named on the radio like anybody else. */
export interface VehicleDriver {
  name: string
  personnelId: string
}

/** vehicle id → its driver, as every surface that names drivers receives it. */
export type VehicleDrivers = ReadonlyMap<string, VehicleDriver>

/** The event's special-function rows read as vehicle id → driver. */
export function driversFromSpecialFunctions(rows: readonly ApiEventSpecialFunctionResponse[]): Map<string, VehicleDriver> {
  const drivers = new Map<string, VehicleDriver>()
  for (const f of rows) {
    if (f.function_type === "driver" && f.vehicle_id) {
      drivers.set(f.vehicle_id, { name: f.personnel_name, personnelId: f.personnel_id })
    }
  }
  return drivers
}

/**
 * Returns a live map of vehicle id → driver (name + personnel id) for the given event. Keyed by
 * id, never by name: two vehicles may share a name.
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
  // Whether the fleet has arrived with the board sync — «Kein Fahrer» on a
  // vehicle the board does not know yet would be a guess.
  const { isLoaded: fleetLoaded } = useOperations()
  const [driversByVehicleId, setDriversByVehicleId] = useState<VehicleDrivers>(new Map())
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!enabled || !eventId) return
    try {
      setDriversByVehicleId(driversFromSpecialFunctions(await apiClient.getEventSpecialFunctions(eventId)))
      setLoadedFor(eventId)
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

  return { drivers: driversByVehicleId, loaded: !!eventId && loadedFor === eventId && fleetLoaded }
}
