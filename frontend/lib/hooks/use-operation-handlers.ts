import { toast } from 'sonner'
import { translateOutsideReact } from '@/lib/i18n-messages'
import type { Operation } from '@/lib/contexts/operations-context'

interface UseOperationHandlersProps {
  selectedOperation: Operation | null
  updateOperation: (id: string, updates: Partial<Operation>) => void
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
  assignVehicleToOperation,
  deleteOperation,
}: UseOperationHandlersProps) {

  const handleOperationUpdate = (updates: Partial<Operation>) => {
    if (!selectedOperation) return
    // Update operation in context - derived selectedOperation will auto-update
    updateOperation(selectedOperation.id, updates)
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
      toast.error(translateOutsideReact('notifications.operations.deleteFailedTitle'), {
        description: translateOutsideReact('notifications.operations.deleteFailedDescription'),
      })
    }
  }

  return {
    handleOperationUpdate,
    handleVehicleAssign,
    handleOperationDelete,
  }
}
