"use client"

import { useMemo } from "react"
import { useOperations } from "../operations-context"

/** One fleet vehicle as the keyboard and the quick-assign row know it. */
export interface VehicleShortcut {
  /** The number key that means this vehicle – its `display_order`. */
  key: string
  name: string
  id: string
  type: string
  /** LEGACY mirror of `out_of_service`; the sidebar draws «nicht einsatzbereit» off it. */
  status: string
}

/**
 * The fleet in board order, each vehicle keyed by its `display_order`. The one
 * rule for «vehicle 3»: the board, the Lagekarte and the command palette all
 * read it from here, so the same number is the same truck on every screen (the
 * map used to number by list position, while the board used display_order).
 *
 * Off the board sync's own fleet (`useOperations().vehicles`), which every
 * board load and every `vehicle_update` refreshes – no fetch of its own.
 */
export function useVehicleShortcuts(): VehicleShortcut[] {
  const { vehicles } = useOperations()
  return useMemo(
    () =>
      [...vehicles]
        .sort((a, b) => a.display_order - b.display_order)
        .map((vehicle) => ({
          key: String(vehicle.display_order),
          name: vehicle.name,
          id: vehicle.id,
          type: vehicle.type,
          status: vehicle.status,
        })),
    [vehicles],
  )
}
