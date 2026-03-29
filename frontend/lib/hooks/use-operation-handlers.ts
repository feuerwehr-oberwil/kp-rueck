import { toast } from 'sonner'
import type { Operation } from '@/lib/contexts/operations-context'

interface UseOperationHandlersProps {
  selectedOperation: Operation | null
  updateOperation: (id: string, updates: Partial<Operation>) => void
  removeVehicle: (operationId: string, vehicleName: string) => void
  assignVehicleToOperation: (vehicleId: string, vehicleName: string, operationId: string) => void
  deleteOperation: (operationId: string) => Promise<void>
}

/**
 * Shared hook for common operation handler functions
 * Used across Kanban, Map, and Combined views
 *
 * Note: selectedOperation should be derived from the operations array via useMemo
 * so that updates to operations are automatically reflected.
 */
export function useOperationHandlers({
  selectedOperation,
  updateOperation,
  removeVehicle,
  assignVehicleToOperation,
  deleteOperation,
}: UseOperationHandlersProps) {

  const handleOperationUpdate = (updates: Partial<Operation>) => {
    if (!selectedOperation) return
    // Update operation in context - derived selectedOperation will auto-update
    updateOperation(selectedOperation.id, updates)
  }

  const handleVehicleRemove = (operationId: string, vehicleName: string) => {
    if (!selectedOperation) return
    // Remove vehicle - derived selectedOperation will auto-update
    removeVehicle(operationId, vehicleName)
  }

  const handleVehicleAssign = (vehicleId: string, vehicleName: string, operationId: string) => {
    if (!selectedOperation) return
    // Assign vehicle - derived selectedOperation will auto-update
    assignVehicleToOperation(vehicleId, vehicleName, operationId)
  }

  const handleOperationDelete = async (operationId: string) => {
    try {
      await deleteOperation(operationId)
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
