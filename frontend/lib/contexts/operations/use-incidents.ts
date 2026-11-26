"use client"

import { useContext, useMemo } from "react"
import { toMapIncident } from "@/lib/map-incident"
import { OperationsContext } from "./contexts"

/**
 * The board's operations as the maps draw them (`MapIncident`, the map page, the wall map,
 * `MapView`). Read-only: writes go through `useOperations()`.
 */
export function useIncidents() {
  const context = useContext(OperationsContext)
  if (context === undefined) {
    throw new Error("useIncidents must be used within an OperationsProvider")
  }
  const { operations, formatLocation, refreshOperations } = context
  // Memoised: the map page, the wall map and MapView key their own memos on this array.
  const incidents = useMemo(() => operations.map(toMapIncident), [operations])
  return { incidents, formatLocation, refreshIncidents: refreshOperations }
}
