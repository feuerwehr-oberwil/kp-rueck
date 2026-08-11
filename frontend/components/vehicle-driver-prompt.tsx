"use client"

import { useEffect, useRef, useState } from "react"
import { apiClient, type ApiEventSpecialFunctionResponse } from "@/lib/api-client"
import { useOperations } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { DriverAssignmentDialog } from "./driver-assignment-dialog"

/**
 * Listens for vehicles that need a driver (see operations-context
 * `vehicleNeedingDriver`) and opens the driver assignment dialog so the user can
 * pick someone. Dismissing the dialog ("Schliessen") leaves the vehicle without a
 * driver — same UX as opening it from the Fahrzeugstatus sheet.
 *
 * The queue behind it holds either one vehicle (just assigned to an incident with
 * nobody driving it) or every driverless vehicle, when the setup checklist starts a
 * run. Assigning a driver moves to the next vehicle; closing ends the run, because
 * a dismiss means "not now" and re-asking would be nagging.
 *
 * Mounted once in the root layout so it covers every assignment entry point
 * (kanban drag-drop, map, command palette, context menu, setup checklist).
 */
export function VehicleDriverPrompt() {
  const {
    vehicleNeedingDriver,
    advanceVehicleNeedingDriver,
    clearVehicleNeedingDriver,
    personnel,
    operations,
    removeCrew,
  } = useOperations()
  const { selectedEvent } = useEvent()
  const eventId = selectedEvent?.id ?? null

  const [specialFunctions, setSpecialFunctions] = useState<ApiEventSpecialFunctionResponse[]>([])

  // The dialog closes itself right after a successful assignment, so "closed" alone
  // cannot tell an assignment from a dismissal — and the two mean opposite things for
  // a run. onDriverAssigned always fires first, which is what this records.
  const assignedRef = useRef(false)

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
      // Keyed by vehicle so the dialog remounts on each step of a run instead of
      // carrying the previous vehicle's search text and selection over.
      key={vehicleNeedingDriver.vehicleId}
      open={true}
      onOpenChange={(open) => {
        if (open) return
        if (assignedRef.current) {
          assignedRef.current = false
          advanceVehicleNeedingDriver()
        } else {
          clearVehicleNeedingDriver()
        }
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
        assignedRef.current = true
      }}
      removeCrew={removeCrew}
    />
  )
}
