"use client"

import { useContext, useMemo } from "react"
import type { ApiIncident } from "@/lib/api-client"
import { sortCrewByLeader } from "@/lib/crew-order"
import { useEvent } from "../event-context"
import { OperationsContext } from "./contexts"

/**
 * The board's operations in the `Incident` shape the map screens (map page, wall
 * map, `MapView`) still draw from. Read-only: writes go through `useOperations()`.
 *
 * An adapter, not a second source: crew/vehicle/material rows carry only what the
 * board knows (ids, names, assignment ids); the `assigned_at`/`completed_at` stamps are
 * placeholders nobody reads. Longer term the map takes `Operation[]` directly.
 */
export function useIncidents() {
  const context = useContext(OperationsContext)
  const { selectedEvent } = useEvent()

  if (context === undefined) {
    throw new Error("useIncidents must be used within an OperationsProvider")
  }

  const { operations, materials, formatLocation, refreshOperations } = context
  const eventId = selectedEvent?.id || ""
  // Memoised: the map page, the wall map and MapView key their own memos on
  // this array, and a fresh one per render (with fresh `new Date()`s inside)
  // meant none of those ever hit.
  const incidents = useMemo(() => {
    const materialById = new Map(materials.map((m) => [m.id, m]))
    return operations.map((op) => ({
      id: op.id,
      number: op.number ?? null,
      event_id: eventId,
      title: op.location,
      type: op.incidentType as ApiIncident['type'],
      priority: op.priority as "low" | "medium" | "high",
      location_address: op.location,
      location_display: op.locationDisplay ?? null,
      location_lat: op.coordinates?.[0] ?? null,
      location_lng: op.coordinates?.[1] ?? null,
      status: op.status,
      description: op.notes,
      nachbarhilfe: op.nachbarhilfe || false,
      am_warten: op.amWarten || false,
      zu_fuss: op.zuFuss || false,
      created_at: op.dispatchTime,
      updated_at: op.dispatchTime,
      created_by: null,
      completed_at: op.status === "complete" ? new Date() : null,
      status_changed_at: op.statusChangedAt,
      has_completed_reko: op.hasCompletedReko || false,
      reko_arrived_at: op.rekoArrivedAt ?? null,
      assigned_vehicles: op.vehicles.map((vehicle) => ({
        assignment_id: vehicle.assignmentId ?? "",
        vehicle_id: vehicle.vehicleId,
        name: vehicle.name,
        type: "",
        assigned_at: new Date(),
        driver_stay: vehicle.driverStay ?? false,
      })),
      // EL first (decision 23), sorted here rather than at the render site: this
      // adapter shape carries no leader flag, so the map's crew badges
      // (`app/map/page.tsx`) have no way to work it out for themselves.
      assigned_personnel: sortCrewByLeader(op.crew, op.leaderId).map((member) => ({
        assignment_id: member.assignmentId ?? "",
        personnel_id: member.personnelId,
        name: member.name,
        role: "",
        assigned_at: new Date(),
      })),
      assigned_materials: op.materials.map((id) => {
        const material = materialById.get(id)
        return {
          assignment_id: "",
          material_id: id,
          name: material?.name || id,
          assigned_at: new Date(),
        }
      }),
    }))
  }, [operations, materials, eventId])

  return { incidents, formatLocation, refreshIncidents: refreshOperations }
}
