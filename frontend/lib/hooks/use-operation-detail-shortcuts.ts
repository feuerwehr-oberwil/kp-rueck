"use client"

import { useEffect } from "react"

import type { Operation } from "@/lib/contexts/operations-context"

interface AvailableVehicle {
  id: string
  name: string
  type: string
}

interface UseOperationDetailShortcutsParams {
  /** Modal open state — listener only attaches while true. */
  enabled: boolean
  /** The incident the modal is bound to. */
  operation: Operation | null
  /** Vehicles in the modal's quick-assign list (max 5 used). */
  availableVehicles: AvailableVehicle[]
  onUpdate: (updates: Partial<Operation>) => void
  onAssignVehicle: (vehicleId: string, vehicleName: string, operationId: string) => void
  onRemoveVehicle: (operationId: string, vehicleName: string) => void
}

const SHIFT_PRIORITY_KEYS: Record<string, Operation["priority"]> = {
  "1": "low",
  "!": "low",
  "2": "medium",
  "@": "medium",
  "3": "high",
  "#": "high",
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLElement && target.getAttribute("role") === "combobox") return true
  return false
}

/**
 * Wires the operation-detail modal's keyboard shortcuts:
 *   Shift+1 / Shift+2 / Shift+3 — set priority low / medium / high
 *   0                            — toggle "zu Fuss"
 *   1..5                         — assign or remove the Nth quick-assign vehicle
 *
 * Listener is detached whenever `enabled` flips false or the modal unmounts,
 * so shortcuts can't fire while the modal is closed.
 */
export function useOperationDetailShortcuts({
  enabled,
  operation,
  availableVehicles,
  onUpdate,
  onAssignVehicle,
  onRemoveVehicle,
}: UseOperationDetailShortcutsParams): void {
  useEffect(() => {
    if (!enabled || !operation) return

    const handleKeyPress = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return

      if (event.shiftKey) {
        const priority = SHIFT_PRIORITY_KEYS[event.key]
        if (priority) {
          event.preventDefault()
          onUpdate({ priority })
          return
        }
      }

      if (event.key === "0" && !event.shiftKey) {
        event.preventDefault()
        onUpdate({ zuFuss: !operation.zuFuss })
        return
      }

      const vehicleIndex = Number.parseInt(event.key, 10) - 1
      if (
        !Number.isNaN(vehicleIndex) &&
        vehicleIndex >= 0 &&
        vehicleIndex < 5 &&
        vehicleIndex < availableVehicles.length
      ) {
        const vehicle = availableVehicles[vehicleIndex]
        if (!vehicle) return
        event.preventDefault()
        const isAssigned = operation.vehicles.includes(vehicle.name)
        if (isAssigned) {
          onRemoveVehicle(operation.id, vehicle.name)
        } else {
          onAssignVehicle(vehicle.id, vehicle.name, operation.id)
        }
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    return () => window.removeEventListener("keydown", handleKeyPress)
  }, [enabled, operation, availableVehicles, onUpdate, onAssignVehicle, onRemoveVehicle])
}
