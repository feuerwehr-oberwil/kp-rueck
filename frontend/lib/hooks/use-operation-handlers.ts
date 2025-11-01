import { toast } from 'sonner'
import type { Operation } from '@/lib/contexts/operations-context'
import type { Dispatch, SetStateAction } from 'react'

interface UseOperationHandlersProps {
  selectedOperation: Operation | null
  setSelectedOperation: Dispatch<SetStateAction<Operation | null>>
  updateOperation: (id: string, updates: Partial<Operation>) => void
  removeVehicle: (operationId: string, vehicleName: string) => void
  assignVehicleToOperation: (vehicleId: string, vehicleName: string, operationId: string) => void
  deleteOperation: (operationId: string) => Promise<void>
}

/**
 * Shared hook for common operation handler functions
 * Used across Kanban, Map, and Combined views
 */
export function useOperationHandlers({
  selectedOperation,
  setSelectedOperation,
  updateOperation,
  removeVehicle,
  assignVehicleToOperation,
  deleteOperation,
}: UseOperationHandlersProps) {

  const handleOperationUpdate = (updates: Partial<Operation>) => {
    if (!selectedOperation) return
    updateOperation(selectedOperation.id, updates)
    setSelectedOperation(prev => prev ? { ...prev, ...updates } : null)
  }

  const handleVehicleRemove = (operationId: string, vehicleName: string) => {
    if (!selectedOperation) return
    removeVehicle(operationId, vehicleName)
    // Update selectedOperation to remove the vehicle from the UI immediately
    setSelectedOperation(prev => prev ? {
      ...prev,
      vehicles: prev.vehicles.filter(v => v !== vehicleName)
    } : null)
  }

  const handleVehicleAssign = (vehicleId: string, vehicleName: string, operationId: string) => {
    if (!selectedOperation) return
    assignVehicleToOperation(vehicleId, vehicleName, operationId)
    // Update selectedOperation to add the vehicle to the UI immediately
    setSelectedOperation(prev => prev ? {
      ...prev,
      vehicles: [...prev.vehicles, vehicleName]
    } : null)
  }

  const handleOperationDelete = async (operationId: string) => {
    try {
      await deleteOperation(operationId)
      toast.success("Einsatz gelöscht", {
        description: "Der Einsatz wurde erfolgreich aus der Datenbank entfernt.",
      })
    } catch (error) {
      console.error('Failed to delete operation:', error)
      toast.error("Fehler beim Löschen", {
        description: "Der Einsatz konnte nicht gelöscht werden. Bitte versuchen Sie es erneut.",
      })
    }
  }

  return {
    handleOperationUpdate,
    handleVehicleRemove,
    handleVehicleAssign,
    handleOperationDelete,
  }
}
