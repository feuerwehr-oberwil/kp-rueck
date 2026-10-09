"use client"

import { useContext } from "react"
import { apiClient, type ApiIncident, type ApiIncidentCreate, type ApiIncidentUpdate } from "@/lib/api-client"
import { sortCrewByLeader } from "@/lib/crew-order"
import { useEvent } from "../event-context"
import { OperationsContext } from "./contexts"
import type { IncidentCreateInput, IncidentUpdateInput } from "./types"

/**
 * useIncidents - Compatibility hook for components that only need incident data
 */
export function useIncidents() {
  const context = useContext(OperationsContext)
  const { selectedEvent } = useEvent()

  if (context === undefined) {
    throw new Error("useIncidents must be used within an OperationsProvider")
  }

  const incidents = context.operations.map((op) => ({
    id: op.id,
    number: op.number ?? null,
    event_id: selectedEvent?.id || "",
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
    assigned_vehicles: op.vehicles.map((name) => ({
      assignment_id: op.vehicleAssignments.get(name) || "",
      vehicle_id: "",
      name,
      type: "",
      assigned_at: new Date(),
      driver_stay: op.vehicleDriverStay.get(name) || false,
    })),
    // EL first (decision 23), sorted here rather than at the render site: this
    // adapter shape carries no leader flag, so the map's crew badges
    // (`app/map/page.tsx`) have no way to work it out for themselves.
    assigned_personnel: sortCrewByLeader(op.crew, op.leaderName).map((name) => ({
      assignment_id: "",
      personnel_id: "",
      name,
      role: "",
      assigned_at: new Date(),
    })),
    assigned_materials: op.materials.map((id) => {
      const material = context.materials.find(m => m.id === id)
      return {
        assignment_id: "",
        material_id: id,
        name: material?.name || id,
        assigned_at: new Date(),
      }
    }),
  }))

  return {
    incidents,
    personnel: context.personnel,
    materials: context.materials,
    isLoading: context.isLoading,
    isLoaded: context.isLoaded,
    error: null,
    trainingMode: false,
    homeCity: context.homeCity,
    setIncidents: () => {},
    setPersonnel: context.setPersonnel,
    setMaterials: context.setMaterials,
    setTrainingMode: (_trainingMode: boolean) => {},
    formatLocation: context.formatLocation,
    createIncident: async (data: IncidentCreateInput) => {
      const apiData: ApiIncidentCreate = {
        ...data,
        location_lat: data.location_lat != null ? String(data.location_lat) : null,
        location_lng: data.location_lng != null ? String(data.location_lng) : null,
      }
      const apiIncident = await apiClient.createIncident(apiData)
      await context.refreshOperations()
      return apiIncident
    },
    updateIncident: async (id: string, data: IncidentUpdateInput) => {
      const apiData: Partial<ApiIncidentUpdate> = {
        ...data,
        location_lat: data.location_lat != null ? String(data.location_lat) : data.location_lat === null ? null : undefined,
        location_lng: data.location_lng != null ? String(data.location_lng) : data.location_lng === null ? null : undefined,
      }
      await apiClient.updateIncident(id, apiData)
      await context.refreshOperations()
    },
    deleteIncident: async (id: string) => {
      await context.deleteOperation(id)
    },
    refreshIncidents: context.refreshOperations,
    updateIncidentStatus: async () => {},
    getStatusHistory: async () => [],
  }
}
