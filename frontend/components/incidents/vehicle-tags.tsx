"use client"

import { useState, useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { X, Plus, Truck, Check } from 'lucide-react'
import { apiClient, type ApiVehicle } from "@/lib/api-client"
import type { AssignedVehicle } from "@/lib/types/incidents"

interface VehicleTagsProps {
  incidentId: string
  assignedVehicles: AssignedVehicle[]
  onUpdate?: () => void
  readOnly?: boolean
}

/**
 * Trello-like vehicle assignment component
 * Displays assigned vehicles as tags/badges and allows adding/removing vehicles
 */
export function VehicleTags({ incidentId, assignedVehicles, onUpdate, readOnly = false }: VehicleTagsProps) {
  const [allVehicles, setAllVehicles] = useState<ApiVehicle[]>([])
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingVehicleId, setLoadingVehicleId] = useState<string | null>(null)
  // Track vehicles that are being assigned/unassigned to prevent duplicate operations
  const [pendingOperations, setPendingOperations] = useState<Set<string>>(new Set())
  // Track recently unassigned vehicles to prevent immediate re-assignment
  const [recentlyUnassigned, setRecentlyUnassigned] = useState<Set<string>>(new Set())

  // Load all vehicles on mount (for callsign display) and when popover opens
  useEffect(() => {
    if (assignedVehicles.length > 0 && allVehicles.length === 0) {
      loadVehicles()
    }
  }, [assignedVehicles])

  useEffect(() => {
    if (isPopoverOpen) {
      loadVehicles()
    }
  }, [isPopoverOpen])

  const loadVehicles = async () => {
    try {
      const vehicles = await apiClient.getVehicles()
      setAllVehicles(vehicles)
    } catch (error) {
      console.error("Failed to load vehicles:", error)
    }
  }

  const handleAssignVehicle = async (vehicleId: string) => {
    if (readOnly) return

    // Check if already assigned or operation in progress
    const isAlreadyAssigned = assignedVehicles.some(av => av.vehicle_id === vehicleId)
    const isOperationPending = pendingOperations.has(vehicleId)

    if (isAlreadyAssigned || isOperationPending) {
      console.log(`Vehicle ${vehicleId} is already assigned or operation pending`)
      return
    }

    setLoadingVehicleId(vehicleId)
    setPendingOperations(prev => new Set(prev).add(vehicleId))

    try {
      await apiClient.assignResource(incidentId, {
        resource_type: "vehicle",
        resource_id: vehicleId,
      })
      onUpdate?.()
    } catch (error) {
      // Only log non-409 errors (409 means already assigned, which is expected in race conditions)
      if (error instanceof Error && !error.message.includes('409') && !error.message.includes('already assigned')) {
        console.error("Failed to assign vehicle:", error)
      }
    } finally {
      setLoadingVehicleId(null)
      setPendingOperations(prev => {
        const next = new Set(prev)
        next.delete(vehicleId)
        return next
      })
    }
  }

  const handleUnassignVehicle = async (assignmentId: string, vehicleId: string, e?: React.MouseEvent) => {
    if (readOnly) return

    e?.stopPropagation()
    setLoadingVehicleId(assignmentId)

    // Add to recently unassigned to prevent immediate re-assignment
    setRecentlyUnassigned(prev => new Set(prev).add(vehicleId))

    try {
      await apiClient.unassignResource(incidentId, assignmentId)
      onUpdate?.()

      // Keep vehicle in recently unassigned for 2 seconds
      setTimeout(() => {
        setRecentlyUnassigned(prev => {
          const next = new Set(prev)
          next.delete(vehicleId)
          return next
        })
      }, 2000)
    } catch (error) {
      console.error("Failed to unassign vehicle:", error)
      // Remove from recently unassigned if error
      setRecentlyUnassigned(prev => {
        const next = new Set(prev)
        next.delete(vehicleId)
        return next
      })
    } finally {
      setLoadingVehicleId(null)
    }
  }

  // Get assigned vehicle IDs for quick lookup
  const assignedVehicleIds = new Set(assignedVehicles.map(av => av.vehicle_id))

  // Get available vehicles (not assigned, not pending, and not recently unassigned)
  const availableVehicles = allVehicles.filter(v =>
    !assignedVehicleIds.has(v.id) &&
    !pendingOperations.has(v.id) &&
    !recentlyUnassigned.has(v.id)
  )

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* Assigned vehicles as badges */}
      {assignedVehicles.map((vehicle) => {
        const fullVehicle = allVehicles.find(v => v.id === vehicle.vehicle_id)
        const callsign = fullVehicle?.radio_call_sign
        return (
        <Badge
          key={vehicle.assignment_id}
          variant="outline"
          className="gap-1 pr-1 group hover:bg-destructive/20 transition-colors text-xs"
          title={callsign ? `Funkrufname: ${callsign}` : undefined}
        >
          <Truck className="h-3 w-3" />
          <span>{vehicle.name}{callsign ? ` · ${callsign}` : ''}</span>
          {!readOnly && (
            <button
              onClick={(e) => handleUnassignVehicle(vehicle.assignment_id, vehicle.vehicle_id, e)}
              disabled={loadingVehicleId === vehicle.assignment_id}
              className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
              title="Fahrzeug entfernen"
            >
              {loadingVehicleId === vehicle.assignment_id ? (
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <X className="h-3 w-3" />
              )}
            </button>
          )}
        </Badge>
        )
      })}

      {/* Add vehicle button */}
      {!readOnly && (
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 gap-1 text-xs"
              title="Fahrzeug zuweisen"
            >
              <Plus className="h-3 w-3" />
              <Truck className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className="space-y-1">
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                Fahrzeug zuweisen
              </div>
              {availableVehicles.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                  {allVehicles.length === 0 ? "Lade Fahrzeuge..." : "Alle Fahrzeuge zugewiesen"}
                </div>
              ) : (
                availableVehicles.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    onClick={() => {
                      handleAssignVehicle(vehicle.id)
                      setIsPopoverOpen(false)
                    }}
                    disabled={loadingVehicleId === vehicle.id || pendingOperations.has(vehicle.id)}
                    className="w-full flex items-center justify-between px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-muted-foreground" />
                      <div className="text-left">
                        <div className="font-medium">{vehicle.name}</div>
                        <div className="text-xs text-muted-foreground">{vehicle.type}</div>
                      </div>
                    </div>
                    {loadingVehicleId === vehicle.id && (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    )}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
