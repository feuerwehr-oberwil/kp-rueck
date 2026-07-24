"use client"

import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { apiClient, type ApiEventSpecialFunctionResponse, type FunctionType } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { getIncidentRefLabel } from "@/lib/incident-types"
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
  const t = useTranslations('kanban')
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

  // State for unassign confirmation dialog (removing a special function is
  // consequential: the person drops out of Reko views / driver duty and is
  // treated as a normal person afterwards)
  const [unassignDialog, setUnassignDialog] = useState<{
    open: boolean
    functionType: FunctionType
    vehicleId?: string
    vehicleName?: string
  }>({ open: false, functionType: 'driver' })

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
      .map(op => ({ id: op.id, location: getIncidentRefLabel(op, 40), crewName: personnelName }))
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
      refreshOperations()
    } catch (error: any) {
      console.error('Failed to assign function:', error)

      // Handle specific error cases
      const errorDetail = error?.message || error?.response?.data?.detail || ''

      if (errorDetail.includes('already has a driver')) {
        toast.error(t('personMenu.vehicleTaken'), {
          description: t('personMenu.vehicleTakenDescription'),
        })
      } else {
        const errorMessage = errorDetail || t('personMenu.assignFailed')
        toast.error(t('common.error'), { description: errorMessage })
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
      refreshOperations()
    } catch (error: any) {
      console.error('Failed to unassign function:', error)
      const errorMessage = error?.response?.data?.detail || t('personMenu.unassignFailed')
      toast.error(t('common.error'), { description: errorMessage })
    } finally {
      setLoading(false)
    }
  }

  const getFunctionLabel = (functionType: FunctionType) => {
    switch (functionType) {
      case 'driver':
        return t('personMenu.driver')
      case 'reko':
        return t('common.reko')
      case 'magazin':
        return t('common.magazin')
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
                    setUnassignDialog({
                      open: true,
                      functionType: 'driver',
                      vehicleId: vehicle.id,
                      vehicleName: vehicle.name,
                    })
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
                setUnassignDialog({ open: true, functionType: 'reko' })
              } else {
                assignFunction('reko')
              }
            }}
          >
            {hasFunction('reko') && <Check className="mr-2 h-4 w-4" />}
            <Binoculars className={`mr-2 h-4 w-4 ${!hasFunction('reko') ? 'ml-6' : ''}`} />
            {t('common.reko')}
          </ContextMenuItem>

          <ContextMenuItem
            onClick={() => {
              if (hasFunction('magazin')) {
                setUnassignDialog({ open: true, functionType: 'magazin' })
              } else {
                assignFunction('magazin')
              }
            }}
          >
            {hasFunction('magazin') && <Check className="mr-2 h-4 w-4" />}
            <Package2 className={`mr-2 h-4 w-4 ${!hasFunction('magazin') ? 'ml-6' : ''}`} />
            {t('common.magazin')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Conflict confirmation dialog */}
      <ConfirmDialog
        open={conflictDialog.open}
        onOpenChange={(open) => setConflictDialog(prev => ({ ...prev, open }))}
        title={t('personMenu.conflictTitle')}
        description={t.rich('personMenu.conflictDescription', {
          strong: (chunks) => <strong>{chunks}</strong>,
          name: personnelName,
          assignment:
            conflictDialog.conflictingOperations.length === 1
              ? t('personMenu.conflictAssignedOne', {
                  location: conflictDialog.conflictingOperations[0]?.location ?? '',
                })
              : t('personMenu.conflictAssignedMany', {
                  count: conflictDialog.conflictingOperations.length,
                }),
          function: getFunctionLabel(conflictDialog.functionType),
        })}
        cancelText={t('common.cancel')}
        confirmText={t('personMenu.confirmAction')}
        onConfirm={handleConflictConfirm}
      />

      {/* Unassign confirmation dialog (removing a special function) */}
      <ConfirmDialog
        open={unassignDialog.open}
        onOpenChange={(open) => setUnassignDialog(prev => ({ ...prev, open }))}
        title={t('personMenu.unassignTitle', {
          function: getFunctionLabel(unassignDialog.functionType),
        })}
        description={
          unassignDialog.functionType === 'reko'
            ? t.rich('personMenu.unassignRekoDescription', {
                strong: (chunks) => <strong>{chunks}</strong>,
                name: personnelName,
              })
            : unassignDialog.functionType === 'driver'
              ? t.rich('personMenu.unassignDriverDescription', {
                  strong: (chunks) => <strong>{chunks}</strong>,
                  name: personnelName,
                  vehicle: unassignDialog.vehicleName ?? '',
                })
              : t.rich('personMenu.unassignMagazinDescription', {
                  strong: (chunks) => <strong>{chunks}</strong>,
                  name: personnelName,
                })
        }
        cancelText={t('common.cancel')}
        confirmText={t('personMenu.unassignConfirm')}
        variant="destructive"
        onConfirm={() => unassignFunction(unassignDialog.functionType, unassignDialog.vehicleId)}
      />
    </>
  )
}
