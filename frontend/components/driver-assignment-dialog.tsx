"use client"

import { useState, useMemo, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, User, CheckCircle, Circle, Loader2, X, AlertTriangle, UserPlus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { apiClient, type ApiEventSpecialFunctionResponse } from "@/lib/api-client"
import { type Person, type Operation, useOperations } from "@/lib/contexts/operations-context"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { useTranslations } from "next-intl"

interface DriverAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vehicleId: string
  vehicleName: string
  eventId: string
  currentDriverId: string | null
  currentDriverName: string | null
  personnel: Person[]
  operations: Operation[]
  specialFunctions: ApiEventSpecialFunctionResponse[]
  onDriverAssigned: () => void
  /** Resolves false when the removal failed (already rolled back + toasted). */
  removeCrew: (operationId: string, crewName: string) => Promise<boolean>
}

export function DriverAssignmentDialog({
  open,
  onOpenChange,
  vehicleId,
  vehicleName,
  eventId,
  currentDriverId: initialDriverId,
  currentDriverName: initialDriverName,
  personnel,
  operations,
  specialFunctions,
  onDriverAssigned,
  removeCrew,
}: DriverAssignmentDialogProps) {
  const t = useTranslations('incidents.driver')
  const tCommon = useTranslations('incidents.common')
  const { refreshOperations } = useOperations()
  const [searchQuery, setSearchQuery] = useState("")
  const [isAssigning, setIsAssigning] = useState(false)
  const [justAssigned, setJustAssigned] = useState<string | null>(null)

  // Inline "add a walk-in as driver" (e.g. a former driver who shows up to help
  // and isn't in the checked-in roster yet).
  const [showAddForm, setShowAddForm] = useState(false)
  const [newPersonName, setNewPersonName] = useState("")
  const [isAddingPerson, setIsAddingPerson] = useState(false)

  // Track driver locally so we can update UI immediately
  const [localDriverId, setLocalDriverId] = useState<string | null>(initialDriverId)
  const [localDriverName, setLocalDriverName] = useState<string | null>(initialDriverName)

  // Conflict dialog state
  const [conflictDialog, setConflictDialog] = useState<{
    open: boolean
    person: Person | null
    conflictingOperations: Array<{ id: string; location: string; crewName: string }>
  }>({ open: false, person: null, conflictingOperations: [] })

  // Reassign dialog state (person is already driving another vehicle)
  const [reassignDialog, setReassignDialog] = useState<{
    open: boolean
    person: Person | null
    fromVehicleId: string | null
    fromVehicleName: string
  }>({ open: false, person: null, fromVehicleId: null, fromVehicleName: "" })

  // Remove-driver confirmation (losing the driver function is consequential:
  // the person is treated as a normal person afterwards)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)

  // Sync local state when props change (e.g., dialog reopened)
  useEffect(() => {
    if (open) {
      setLocalDriverId(initialDriverId)
      setLocalDriverName(initialDriverName)
    }
  }, [open, initialDriverId, initialDriverName])

  // Reset search on close
  useEffect(() => {
    if (!open) {
      setSearchQuery("")
    }
  }, [open])

  // Map personnel already driving ANOTHER vehicle → that vehicle {id, name}.
  // They stay selectable (shown with a "Fährt {vehicle}" badge); picking one
  // moves them here after a confirmation instead of being hidden.
  const otherVehicleByDriver = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
    for (const f of specialFunctions) {
      if (f.function_type === 'driver' && f.vehicle_id && f.vehicle_id !== vehicleId) {
        m.set(f.personnel_id, { id: f.vehicle_id, name: f.vehicle_name ?? '' })
      }
    }
    return m
  }, [specialFunctions, vehicleId])

  // Get available personnel (checked in). Includes people driving another
  // vehicle and incident-assigned personnel — both are selectable with a
  // confirmation step.
  const availablePersonnel = useMemo(() => {
    return personnel.filter(p => {
      // Already driving another vehicle → keep (confirm-to-move on click)
      if (otherVehicleByDriver.has(p.id)) return true
      // Must be available or assigned to an incident (not a driver/magazin)
      if (p.status === 'available') return true
      // Include incident-assigned personnel (but not drivers/magazin)
      if (p.status === 'assigned' && !p.isDriver && !p.isMagazin) return true
      return false
    })
  }, [personnel, otherVehicleByDriver])

  // Get operations where a person is assigned
  const getPersonConflicts = (person: Person) => {
    return operations
      .filter(op => op.crew.includes(person.name))
      .map(op => ({ id: op.id, location: getIncidentRefLabel(op, 40), crewName: person.name }))
  }

  // Check if person is assigned to any incident
  const isAssignedToIncident = (person: Person) => {
    return operations.some(op => op.crew.includes(person.name))
  }

  // Filter by search query (matches name, role, and tags)
  const filteredPersonnel = useMemo(() => {
    if (!searchQuery.trim()) return availablePersonnel
    const query = searchQuery.toLowerCase()
    return availablePersonnel.filter(p =>
      p.name.toLowerCase().includes(query) ||
      (p.role && p.role.toLowerCase().includes(query)) ||
      (p.tags && p.tags.some(t => t.toLowerCase().includes(query)))
    )
  }, [availablePersonnel, searchQuery])

  // Split into F-tagged (Fahrer) and others
  const { driversGroup, othersGroup } = useMemo(() => {
    const drivers: Person[] = []
    const others: Person[] = []
    for (const p of filteredPersonnel) {
      if (p.tags && p.tags.includes("F")) {
        drivers.push(p)
      } else {
        others.push(p)
      }
    }
    return { driversGroup: drivers, othersGroup: others }
  }, [filteredPersonnel])

  const handleAssignDriver = async (person: Person) => {
    // Already driving another vehicle → confirm the move first
    const drivingOther = otherVehicleByDriver.get(person.id)
    if (drivingOther) {
      setReassignDialog({
        open: true,
        person,
        fromVehicleId: drivingOther.id,
        fromVehicleName: drivingOther.name,
      })
      return
    }

    // Check if person is assigned to any incident
    const conflicts = getPersonConflicts(person)
    if (conflicts.length > 0) {
      setConflictDialog({
        open: true,
        person,
        conflictingOperations: conflicts,
      })
      return
    }

    await doAssignDriver(person)
  }

  const doAssignDriver = async (person: Person) => {
    setIsAssigning(true)
    const previousDriverId = localDriverId
    const previousDriverName = localDriverName
    try {
      // If there's a current driver, unassign them first
      if (previousDriverId) {
        await apiClient.unassignSpecialFunction(eventId, {
          personnel_id: previousDriverId,
          function_type: 'driver',
          vehicle_id: vehicleId,
        })
      }

      // Assign the new driver. If this fails, the old driver is ALREADY gone
      // server-side — compensate instead of leaving the UI claiming the old
      // driver while the vehicle is actually driverless.
      try {
        await apiClient.assignSpecialFunction(eventId, {
          personnel_id: person.id,
          function_type: 'driver',
          vehicle_id: vehicleId,
        })
      } catch (error) {
        console.error('Failed to assign driver:', error)
        if (previousDriverId) {
          try {
            await apiClient.assignSpecialFunction(eventId, {
              personnel_id: previousDriverId,
              function_type: 'driver',
              vehicle_id: vehicleId,
            })
            toast.error(t('assignErrorTitle'), {
              description: t('previousDriverKept', { driver: previousDriverName ?? '', vehicle: vehicleName }),
            })
          } catch {
            // Compensation failed too — show the real state.
            setLocalDriverId(null)
            setLocalDriverName(null)
            onDriverAssigned()
            toast.error(t('assignErrorTitle'), {
              description: t('noDriverNow', { vehicle: vehicleName }),
            })
          }
        } else {
          toast.error(t('assignErrorTitle'))
        }
        return
      }

      // Update local state
      setLocalDriverId(person.id)
      setLocalDriverName(person.name)

      setJustAssigned(person.id)
      setTimeout(() => setJustAssigned(null), 600)

      onDriverAssigned()
      onOpenChange(false)
    } catch (error) {
      // Unassigning the old driver failed — nothing changed server-side.
      console.error('Failed to assign driver:', error)
      toast.error(t('assignErrorTitle'), {
        description: previousDriverName ? t('previousDriverKept', { driver: previousDriverName, vehicle: vehicleName }) : undefined,
      })
    } finally {
      setIsAssigning(false)
    }
  }

  // Create a not-yet-registered person, check them in (reusing the event's
  // check-in token — there is no authenticated check-in endpoint), tag them as
  // Fahrer, and assign them as this vehicle's driver in one go.
  const addWalkInDriver = async () => {
    const name = newPersonName.trim()
    if (!name || isAddingPerson) return
    if (personnel.some(p => p.name.trim().toLowerCase() === name.toLowerCase())) {
      toast.error(t('duplicateName'))
      return
    }
    setIsAddingPerson(true)
    try {
      const created = await apiClient.createPersonnel({ name, availability: 'available', tags: ['F'] })
      try {
        const { token } = await apiClient.generateCheckInLink(eventId)
        await apiClient.checkInPersonnel(created.id, token)
      } catch (checkInError) {
        // Non-fatal: they still exist and can be assigned; they just may not
        // show in the checked-in roster until refreshed.
        console.error('Failed to check in walk-in driver:', checkInError)
      }
      await refreshOperations()
      setNewPersonName("")
      setShowAddForm(false)
      // Assign straight away — that's the whole point of adding them here.
      await doAssignDriver({ id: created.id, name: created.name } as Person)
    } catch (error) {
      console.error('Failed to add walk-in driver:', error)
      toast.error(t('addError'))
    } finally {
      setIsAddingPerson(false)
    }
  }

  // One-tap: tag an already-present "Andere" person as Fahrer (F) so they're
  // recognised as a driver going forward.
  const markAsDriver = async (person: Person) => {
    const tags = Array.from(new Set([...(person.tags ?? []), 'F']))
    try {
      await apiClient.updatePersonnel(person.id, { tags })
      await refreshOperations()
      toast.success(t('markedAsDriver', { name: person.name }))
    } catch (error) {
      console.error('Failed to mark as driver:', error)
      toast.error(t('markError'))
    }
  }

  const handleConflictConfirm = async () => {
    const { person, conflictingOperations } = conflictDialog
    if (!person) return

    setConflictDialog(prev => ({ ...prev, open: false }))
    setIsAssigning(true)
    try {
      // Unassign from all conflicting operations and WAIT for the results —
      // firing-and-forgetting raced the driver assignment, so a failed
      // removal put the person back on the incident AFTER they became
      // driver: exactly the state this dialog exists to prevent.
      const results = await Promise.all(
        conflictingOperations.map((conflict) => removeCrew(conflict.id, conflict.crewName))
      )
      if (results.some((ok) => !ok)) {
        // removeCrew already rolled back and toasted; don't make the person
        // a driver while they're still assigned to an incident.
        return
      }

      await doAssignDriver(person)
    } finally {
      setIsAssigning(false)
    }
  }

  const handleReassignConfirm = async () => {
    const { person, fromVehicleId } = reassignDialog
    if (!person || !fromVehicleId) return

    setReassignDialog(prev => ({ ...prev, open: false }))
    setIsAssigning(true)
    try {
      // Take the person off the other vehicle first, then assign here.
      await apiClient.unassignSpecialFunction(eventId, {
        personnel_id: person.id,
        function_type: 'driver',
        vehicle_id: fromVehicleId,
      })
      await doAssignDriver(person)
    } catch (error) {
      console.error('Failed to reassign driver:', error)
      toast.error(t('assignErrorTitle'))
    } finally {
      setIsAssigning(false)
    }
  }

  const handleRemoveDriver = async () => {
    if (!localDriverId) return

    setIsAssigning(true)
    try {
      await apiClient.unassignSpecialFunction(eventId, {
        personnel_id: localDriverId,
        function_type: 'driver',
        vehicle_id: vehicleId,
      })

      // Clear local state immediately
      setLocalDriverId(null)
      setLocalDriverName(null)

      onDriverAssigned()
      // Keep modal open to allow selecting a new driver
    } catch (error) {
      console.error('Failed to remove driver:', error)
      toast.error(t('removeError'))
    } finally {
      setIsAssigning(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {t('title', { vehicle: vehicleName })}
            </DialogTitle>
            <DialogDescription>
              {localDriverName
                ? t('currentDriver', { driver: localDriverName })
                : t('noDriverAssigned')
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Current driver with remove option */}
            {localDriverId && localDriverName && (
              <div className="flex items-center justify-between p-3 rounded-lg border border-primary/50 bg-primary/5">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">{localDriverName}</p>
                    <p className="text-xs text-muted-foreground">{t('currentDriverLabel')}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoveDialogOpen(true)}
                  disabled={isAssigning}
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                >
                  {isAssigning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder={t('searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                autoFocus
              />
            </div>

            {/* Add a not-yet-registered walk-in directly as driver */}
            {!showAddForm ? (
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <UserPlus className="h-4 w-4" />
                <span>{t('addPersonButton')}</span>
              </button>
            ) : (
              <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{t('addPersonHint')}</p>
                <Input
                  type="text"
                  autoFocus
                  placeholder={t('addNamePlaceholder')}
                  value={newPersonName}
                  onChange={(e) => setNewPersonName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addWalkInDriver() }
                    if (e.key === 'Escape') { setShowAddForm(false); setNewPersonName("") }
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    onClick={addWalkInDriver}
                    disabled={!newPersonName.trim() || isAddingPerson}
                    className="flex-1"
                    size="sm"
                  >
                    {isAddingPerson ? (
                      <><Loader2 className="mr-1 h-4 w-4 animate-spin" />{t('adding')}</>
                    ) : (
                      <><Plus className="mr-1 h-4 w-4" />{t('addAndAssign')}</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowAddForm(false); setNewPersonName("") }}
                    disabled={isAddingPerson}
                  >
                    {tCommon('cancel')}
                  </Button>
                </div>
              </div>
            )}

            {/* Personnel List */}
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-2">
                {/* Fahrer (F-tagged) section */}
                {driversGroup.length > 0 && (
                  <>
                    {othersGroup.length > 0 && (
                      <p className="text-xs font-medium text-muted-foreground tracking-wide px-1 pt-1">{t('driversSection')}</p>
                    )}
                    {driversGroup.map((person) => {
                      const isCurrentDriver = person.id === localDriverId
                      const wasJustAssigned = justAssigned === person.id
                      const hasIncidentConflict = isAssignedToIncident(person)
                      const drivingOtherVehicle = otherVehicleByDriver.get(person.id)

                      return (
                        <button
                          key={person.id}
                          onClick={() => !isCurrentDriver && handleAssignDriver(person)}
                          disabled={isAssigning || isCurrentDriver}
                          className={cn(
                            "w-full flex items-center justify-between p-3 rounded-lg border border-border/50 transition-all text-left",
                            !isCurrentDriver && "cursor-pointer hover:border-primary/50 hover:bg-secondary/30",
                            isCurrentDriver && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            {isCurrentDriver ? (
                              <CheckCircle className={cn(
                                "h-5 w-5 text-primary flex-shrink-0",
                                wasJustAssigned && "animate-checkmark-spring"
                              )} />
                            ) : (
                              <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                            )}
                            <div>
                              <p className="font-medium text-sm">{person.name}</p>
                              {person.role && (
                                <p className="text-xs text-muted-foreground">{person.role}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {drivingOtherVehicle && !isCurrentDriver && (
                              <Badge variant="outline" className="text-xs gap-1 text-amber-500 border-amber-500/30">
                                <AlertTriangle className="h-3 w-3" />
                                {t('drivesVehicle', { vehicle: drivingOtherVehicle.name })}
                              </Badge>
                            )}
                            {hasIncidentConflict && (
                              <Badge variant="outline" className="text-xs gap-1 text-amber-500 border-amber-500/30">
                                <AlertTriangle className="h-3 w-3" />
                                {t('inOperation')}
                              </Badge>
                            )}
                            {isCurrentDriver && (
                              <Badge variant="secondary" className="text-xs">{t('current')}</Badge>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </>
                )}

                {/* Andere (non-F-tagged) section */}
                {othersGroup.length > 0 && (
                  <>
                    {driversGroup.length > 0 && (
                      <p className="text-xs font-medium text-muted-foreground tracking-wide px-1 pt-3">{t('othersSection')}</p>
                    )}
                    {othersGroup.map((person) => {
                      const isCurrentDriver = person.id === localDriverId
                      const wasJustAssigned = justAssigned === person.id
                      const hasIncidentConflict = isAssignedToIncident(person)
                      const drivingOtherVehicle = otherVehicleByDriver.get(person.id)

                      return (
                        <div key={person.id} className="flex items-center gap-1">
                          <button
                            onClick={() => !isCurrentDriver && handleAssignDriver(person)}
                            disabled={isAssigning || isCurrentDriver}
                            className={cn(
                              "flex-1 min-w-0 flex items-center justify-between p-3 rounded-lg border border-border/50 transition-all text-left",
                              !isCurrentDriver && "cursor-pointer hover:border-primary/50 hover:bg-secondary/30",
                              isCurrentDriver && "opacity-50 cursor-not-allowed"
                            )}
                          >
                            <div className="flex items-center gap-3">
                              {isCurrentDriver ? (
                                <CheckCircle className={cn(
                                  "h-5 w-5 text-primary flex-shrink-0",
                                  wasJustAssigned && "animate-checkmark-spring"
                                )} />
                              ) : (
                                <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                              )}
                              <div>
                                <p className="font-medium text-sm">{person.name}</p>
                                {person.role && (
                                  <p className="text-xs text-muted-foreground">{person.role}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {drivingOtherVehicle && !isCurrentDriver && (
                                <Badge variant="outline" className="text-xs gap-1 text-amber-500 border-amber-500/30">
                                  <AlertTriangle className="h-3 w-3" />
                                  {t('drivesVehicle', { vehicle: drivingOtherVehicle.name })}
                                </Badge>
                              )}
                              {hasIncidentConflict && (
                                <Badge variant="outline" className="text-xs gap-1 text-amber-500 border-amber-500/30">
                                  <AlertTriangle className="h-3 w-3" />
                                  {t('inOperation')}
                                </Badge>
                              )}
                              {isCurrentDriver && (
                                <Badge variant="secondary" className="text-xs">{t('current')}</Badge>
                              )}
                            </div>
                          </button>
                          {/* One-tap: recognise this person as a Fahrer (adds F tag) */}
                          {!isCurrentDriver && !drivingOtherVehicle && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title={t('markAsDriver')}
                              aria-label={t('markAsDriver')}
                              disabled={isAssigning}
                              onClick={() => markAsDriver(person)}
                              className="flex-shrink-0 h-9 px-2 text-muted-foreground hover:text-primary"
                            >
                              <UserPlus className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      )
                    })}
                  </>
                )}

                {/* Empty state */}
                {filteredPersonnel.length === 0 && (
                  <div className="text-center py-12">
                    <User className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-sm font-medium text-foreground mb-1">
                      {searchQuery ? t('noPersonsFound') : t('noAvailablePersons')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {searchQuery
                        ? t('tryDifferentSearch')
                        : t('allAssignedHint')
                      }
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('close')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Conflict confirmation dialog */}
      <ConfirmDialog
        open={conflictDialog.open}
        onOpenChange={(open) => setConflictDialog(prev => ({ ...prev, open }))}
        title={t('conflictTitle')}
        description={t.rich('conflictDescription', {
          name: conflictDialog.person?.name ?? '',
          count: conflictDialog.conflictingOperations.length,
          location: conflictDialog.conflictingOperations[0]?.location ?? '',
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        cancelText={tCommon('cancel')}
        confirmText={t('conflictConfirm')}
        onConfirm={handleConflictConfirm}
      />

      {/* Reassign confirmation dialog (person drives another vehicle) */}
      <ConfirmDialog
        open={reassignDialog.open}
        onOpenChange={(open) => setReassignDialog(prev => ({ ...prev, open }))}
        title={t('reassignTitle')}
        description={t.rich('reassignDescription', {
          name: reassignDialog.person?.name ?? '',
          fromVehicle: reassignDialog.fromVehicleName,
          vehicle: vehicleName,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        cancelText={tCommon('cancel')}
        confirmText={t('reassignConfirm')}
        onConfirm={handleReassignConfirm}
      />

      {/* Remove-driver confirmation dialog */}
      <ConfirmDialog
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
        title={t('removeConfirmTitle')}
        description={t.rich('removeConfirmDescription', {
          name: localDriverName ?? '',
          vehicle: vehicleName,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        cancelText={tCommon('cancel')}
        confirmText={t('removeConfirmAction')}
        variant="destructive"
        onConfirm={handleRemoveDriver}
      />
    </>
  )
}
