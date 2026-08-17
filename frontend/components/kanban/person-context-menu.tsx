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
import { TransferRekoDialog } from "@/components/kanban/transfer-reko-dialog"
import { toast } from "sonner"
import { Car, Binoculars, Package2, Phone, MonitorCog, Check } from 'lucide-react'

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
  const { operations, personnel, removeCrew, refreshOperations } = useOperations()
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

  // Reko hand-over: how much would be orphaned by dropping the role, and who
  // could take it over.
  const [transferOpen, setTransferOpen] = useState(false)
  const rekoIncidentCount = operations.filter((op) => op.assignedReko?.id === personnelId).length
  const thisPerson = personnel.find((p) => p.id === personnelId) ?? null
  const rekoPersonnel = personnel.filter((p) => p.isReko && p.id !== personnelId)

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

    // Every role but Reko takes the person off the board's available list
    // (`operations-context.tsx` counts them as assigned), so putting somebody on
    // the phone desk while they are dispatched to a Schadenplatz is the same
    // conflict as making them a driver — and the KP should be asked, not
    // surprised. Reko stays out: a Reko trupp IS out on a Schadenplatz.
    if (functionType !== 'reko') {
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
    } catch (error) {
      console.error('Failed to assign function:', error)

      // Handle specific error cases. apiClient rejects with ApiError, whose
      // message carries the backend's `detail`.
      const errorDetail = error instanceof Error ? error.message : ''

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
    } catch (error) {
      console.error('Failed to unassign function:', error)
      // Deliberately generic: the axios-shaped lookup this replaced never
      // matched (apiClient throws ApiError), so this was always the message.
      toast.error(t('common.error'), { description: t('personMenu.unassignFailed') })
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
      case 'telefondienst':
        return t('common.telefondienst')
      case 'kommandoposten':
        return t('common.kommandoposten')
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

          {/* Telefondienst is a role like the three above it, not a page: the
              person holding it gets the call form on their own `/feld`. It
              belongs here for the same reason Magazin does — the KP hands it
              out by right-clicking a name, and it lasts for the Ereignis. */}
          <ContextMenuItem
            onClick={() => {
              if (hasFunction('telefondienst')) {
                setUnassignDialog({ open: true, functionType: 'telefondienst' })
              } else {
                assignFunction('telefondienst')
              }
            }}
          >
            {hasFunction('telefondienst') && <Check className="mr-2 h-4 w-4" />}
            <Phone className={`mr-2 h-4 w-4 ${!hasFunction('telefondienst') ? 'ml-6' : ''}`} />
            {t('common.telefondienst')}
          </ContextMenuItem>

          {/* The one role that unlocks nothing: it says this person is running
              the board. Without it the KP kept being offered its own operators
              as crew, because «verfügbar» counted anybody not on an incident —
              and working on this app is work. */}
          <ContextMenuItem
            onClick={() => {
              if (hasFunction('kommandoposten')) {
                setUnassignDialog({ open: true, functionType: 'kommandoposten' })
              } else {
                assignFunction('kommandoposten')
              }
            }}
          >
            {hasFunction('kommandoposten') && <Check className="mr-2 h-4 w-4" />}
            <MonitorCog className={`mr-2 h-4 w-4 ${!hasFunction('kommandoposten') ? 'ml-6' : ''}`} />
            {t('common.kommandoposten')}
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
        // Removing the Reko role from someone who still holds incidents used to
        // just orphan them — the incidents kept a Reko that no longer existed,
        // and nothing said so. Offer the hand-over first; releasing outright
        // stays available as the secondary action.
        extraAction={
          unassignDialog.functionType === 'reko' && rekoIncidentCount > 0
            ? {
                label: t('personMenu.unassignRekoTransfer', { count: rekoIncidentCount }),
                onSelect: () => {
                  setUnassignDialog((prev) => ({ ...prev, open: false }))
                  setTransferOpen(true)
                },
              }
            : undefined
        }
      />

      {/* Hand the incidents to another Reko, then drop the role. */}
      <TransferRekoDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        fromPerson={thisPerson}
        rekoPersonnel={rekoPersonnel}
        onTransferred={() => {
          // The incidents have a new Reko; this person's role can now go
          // without leaving anything behind.
          void unassignFunction('reko')
        }}
      />
    </>
  )
}
