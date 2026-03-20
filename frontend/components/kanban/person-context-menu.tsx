"use client"

import { useState, useCallback } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { apiClient, type ApiEventSpecialFunctionResponse, type FunctionType } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { toast } from "sonner"
import { Car, Binoculars, Package2, Check } from 'lucide-react'

interface PersonContextMenuProps {
  children: React.ReactNode
  personnelId: string
  personnelName: string
}

export function PersonContextMenu({
  children,
  personnelId,
  personnelName,
}: PersonContextMenuProps) {
  const { selectedEvent } = useEvent()
  const { operations, removeCrew, refreshOperations } = useOperations()
  const [vehicles, setVehicles] = useState<Array<{ id: string; name: string }>>([])
  const [vehicleDrivers, setVehicleDrivers] = useState<Map<string, string>>(new Map())
  const [currentFunctions, setCurrentFunctions] = useState<ApiEventSpecialFunctionResponse[]>([])
  const [loading, setLoading] = useState(false)

  // State for conflict confirmation dialog
  const [conflictDialog, setConflictDialog] = useState<{
    open: boolean
    functionType: FunctionType
    vehicleId?: string
    conflictingOperations: Array<{ id: string; location: string; crewName: string }>
  }>({ open: false, functionType: 'driver', conflictingOperations: [] })

  // Load data lazily when context menu opens
  const handleOpenChange = useCallback(async (open: boolean) => {
    if (!open || !selectedEvent) return

    try {
      const [allVehicles, allFunctions, personnelFunctions] = await Promise.all([
        apiClient.getVehicles(),
        apiClient.getEventSpecialFunctions(selectedEvent.id),
        apiClient.getPersonnelSpecialFunctions(selectedEvent.id, personnelId),
      ])

      // Set vehicles
      const sorted = allVehicles
        .sort((a, b) => a.display_order - b.display_order)
        .map(v => ({ id: v.id, name: v.name }))
      setVehicles(sorted)

      // Build driver map from all functions
      const driverMap = new Map<string, string>()
      allFunctions
        .filter(f => f.function_type === 'driver' && f.vehicle_id)
        .forEach(f => {
          if (f.vehicle_id) {
            driverMap.set(f.vehicle_id, f.personnel_name)
          }
        })
      setVehicleDrivers(driverMap)

      // Set this person's functions
      setCurrentFunctions(personnelFunctions)
    } catch (error) {
      console.error('Failed to load context menu data:', error)
    }
  }, [selectedEvent, personnelId])

  // Find operations where this person is assigned as crew
  const getConflictingOperations = () => {
    return operations
      .filter(op => op.crew.includes(personnelName))
      .map(op => ({ id: op.id, location: op.location, crewName: personnelName }))
  }

  const assignFunction = async (functionType: FunctionType, vehicleId?: string) => {
    if (!selectedEvent || loading) return

    // Check for incident assignment conflicts (driver and magazin make person unavailable)
    if (functionType === 'driver' || functionType === 'magazin') {
      const conflicts = getConflictingOperations()
      if (conflicts.length > 0) {
        setConflictDialog({
          open: true,
          functionType,
          vehicleId,
          conflictingOperations: conflicts,
        })
        return
      }
    }

    await doAssignFunction(functionType, vehicleId)
  }

  const doAssignFunction = async (functionType: FunctionType, vehicleId?: string) => {
    if (!selectedEvent || loading) return

    setLoading(true)
    try {
      await apiClient.assignSpecialFunction(selectedEvent.id, {
        personnel_id: personnelId,
        function_type: functionType,
        vehicle_id: vehicleId || null,
      })
      toast.success('Funktion zugewiesen', {
        description: `${personnelName} wurde als ${getFunctionLabel(functionType)} zugewiesen`,
      })
      refreshOperations()
    } catch (error: any) {
      console.error('Failed to assign function:', error)

      // Handle specific error cases
      const errorDetail = error?.message || error?.response?.data?.detail || ''

      if (errorDetail.includes('already has a driver')) {
        toast.error('Fahrzeug bereits zugewiesen', {
          description: 'Dieses Fahrzeug hat bereits einen Fahrer. Bitte entfernen Sie zuerst den aktuellen Fahrer.',
        })
      } else {
        const errorMessage = errorDetail || 'Funktion konnte nicht zugewiesen werden'
        toast.error('Fehler', { description: errorMessage })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleConflictConfirm = async () => {
    const { functionType, vehicleId, conflictingOperations } = conflictDialog

    // Unassign from all conflicting operations first
    for (const conflict of conflictingOperations) {
      removeCrew(conflict.id, conflict.crewName)
    }

    setConflictDialog(prev => ({ ...prev, open: false }))

    // Small delay to let state updates propagate
    await new Promise(resolve => setTimeout(resolve, 100))

    // Now assign the function
    await doAssignFunction(functionType, vehicleId)
  }

  const unassignFunction = async (functionType: FunctionType, vehicleId?: string) => {
    if (!selectedEvent || loading) return

    setLoading(true)
    try {
      await apiClient.unassignSpecialFunction(selectedEvent.id, {
        personnel_id: personnelId,
        function_type: functionType,
        vehicle_id: vehicleId || null,
      })
      toast.success('Funktion entfernt', {
        description: `${personnelName} wurde als ${getFunctionLabel(functionType)} entfernt`,
      })
      refreshOperations()
    } catch (error: any) {
      console.error('Failed to unassign function:', error)
      const errorMessage = error?.response?.data?.detail || 'Funktion konnte nicht entfernt werden'
      toast.error('Fehler', { description: errorMessage })
    } finally {
      setLoading(false)
    }
  }

  const getFunctionLabel = (functionType: FunctionType) => {
    switch (functionType) {
      case 'driver':
        return 'Fahrer'
      case 'reko':
        return 'Reko'
      case 'magazin':
        return 'Magazin'
      default:
        return functionType
    }
  }

  const hasFunction = (functionType: FunctionType, vehicleId?: string) => {
    if (functionType === 'driver') {
      return currentFunctions.some(
        f => f.function_type === functionType && f.vehicle_id === vehicleId
      )
    }
    return currentFunctions.some(f => f.function_type === functionType)
  }

  return (
    <>
      <ContextMenu onOpenChange={handleOpenChange}>
        <ContextMenuTrigger asChild>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {vehicles.map((vehicle) => {
            const currentDriver = vehicleDrivers.get(vehicle.id)
            const isThisPersonDriver = hasFunction('driver', vehicle.id)

            return (
              <ContextMenuItem
                key={vehicle.id}
                onClick={() => {
                  if (isThisPersonDriver) {
                    unassignFunction('driver', vehicle.id)
                  } else {
                    assignFunction('driver', vehicle.id)
                  }
                }}
                className="flex items-center justify-between"
              >
                <div className="flex items-center">
                  {isThisPersonDriver && <Check className="mr-2 h-4 w-4" />}
                  <Car className={`mr-2 h-4 w-4 ${!isThisPersonDriver ? 'ml-6' : ''}`} />
                  {vehicle.name}
                </div>
                {currentDriver && !isThisPersonDriver && (
                  <span className="text-xs text-muted-foreground ml-2">({currentDriver})</span>
                )}
              </ContextMenuItem>
            )
          })}

          {vehicles.length > 0 && <ContextMenuSeparator />}

          <ContextMenuItem
            onClick={() => {
              if (hasFunction('reko')) {
                unassignFunction('reko')
              } else {
                assignFunction('reko')
              }
            }}
          >
            {hasFunction('reko') && <Check className="mr-2 h-4 w-4" />}
            <Binoculars className={`mr-2 h-4 w-4 ${!hasFunction('reko') ? 'ml-6' : ''}`} />
            Reko
          </ContextMenuItem>

          <ContextMenuItem
            onClick={() => {
              if (hasFunction('magazin')) {
                unassignFunction('magazin')
              } else {
                assignFunction('magazin')
              }
            }}
          >
            {hasFunction('magazin') && <Check className="mr-2 h-4 w-4" />}
            <Package2 className={`mr-2 h-4 w-4 ${!hasFunction('magazin') ? 'ml-6' : ''}`} />
            Magazin
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Conflict confirmation dialog */}
      <AlertDialog open={conflictDialog.open} onOpenChange={(open) => setConflictDialog(prev => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Person ist einem Einsatz zugewiesen</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{personnelName}</strong> ist aktuell{' '}
              {conflictDialog.conflictingOperations.length === 1
                ? `dem Einsatz «${conflictDialog.conflictingOperations[0]?.location}» zugewiesen`
                : `${conflictDialog.conflictingOperations.length} Einsätzen zugewiesen`
              }.
              {' '}Als {getFunctionLabel(conflictDialog.functionType)} kann die Person nicht gleichzeitig einem Einsatz zugeteilt sein.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleConflictConfirm}>
              Vom Einsatz entfernen & zuweisen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
