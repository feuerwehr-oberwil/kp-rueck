"use client"

import { useMemo } from "react"
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
 * The selected Ereignis's drivers as vehicle id → driver (name + personnel id), read off the
 * board snapshot's special functions – the board reloads them on every
 * `special_function_update`. Keyed by id, never by name: two vehicles may share a name.
 */
export function useVehicleDrivers(): VehicleDrivers {
  return useVehicleDriverState().drivers
}

/**
 * The same map plus whether the board snapshot that carries it has arrived. A surface that
 * says «Kein Fahrer» needs the flag: before the first load an empty map means «not known
 * yet», not «nobody is driving».
 */
export function useVehicleDriverState(): { drivers: VehicleDrivers; loaded: boolean } {
  const { specialFunctions, isLoaded, boardNeverLoaded } = useOperations()
  const drivers = useMemo(() => driversFromSpecialFunctions(specialFunctions), [specialFunctions])
  return { drivers, loaded: isLoaded && !boardNeverLoaded }
}
