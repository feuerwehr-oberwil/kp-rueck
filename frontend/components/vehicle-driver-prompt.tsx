"use client"

import { useEffect, useState } from "react"
import { apiClient, type ApiEventSpecialFunctionResponse } from "@/lib/api-client"
import { useOperations } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { DriverAssignmentDialog } from "./driver-assignment-dialog"

/**
 * Listens for vehicles that were just assigned to an incident without a driver
 * (see operations-context `vehicleNeedingDriver`) and opens the driver
 * assignment dialog so the user can pick someone. Dismissing the dialog
 * ("Schliessen") leaves the vehicle without a driver — same UX as opening it
 * from the Fahrzeugstatus sheet.
 *
 * Mounted once in the root layout so it covers every assignment entry point
 * (kanban drag-drop, map, command palette, context menu).
 */
export function VehicleDriverPrompt() {
  const { vehicleNeedingDriver, clearVehicleNeedingDriver, personnel, operations, removeCrew } = useOperations()
  const { selectedEvent } = useEvent()
  const eventId = selectedEvent?.id ?? null

  const [specialFunctions, setSpecialFunctions] = useState<ApiEventSpecialFunctionResponse[]>([])

  // Load the event's special functions so the dialog can exclude personnel who
  // are already driving another vehicle.
  useEffect(() => {
    if (!vehicleNeedingDriver || !eventId) return
    let cancelled = false
    apiClient
      .getEventSpecialFunctions(eventId)
      .then((functions) => {
        if (!cancelled) setSpecialFunctions(functions)
      })
      .catch((err) => {
        console.error("Failed to load special functions for driver prompt:", err)
      })
    return () => {
      cancelled = true
    }
  }, [vehicleNeedingDriver, eventId])

  if (!vehicleNeedingDriver || !eventId) return null

  return (
    <DriverAssignmentDialog
      open={true}
      onOpenChange={(open) => {
        if (!open) clearVehicleNeedingDriver()
      }}
      vehicleId={vehicleNeedingDriver.vehicleId}
      vehicleName={vehicleNeedingDriver.vehicleName}
      eventId={eventId}
      currentDriverId={null}
      currentDriverName={null}
      personnel={personnel}
      operations={operations}
      specialFunctions={specialFunctions}
      onDriverAssigned={() => {
        // Notify the sidebar / vehicle status sheet of the change (same-tab).
        window.dispatchEvent(new Event("driver-assignment-changed"))
      }}
      removeCrew={removeCrew}
    />
  )
}
