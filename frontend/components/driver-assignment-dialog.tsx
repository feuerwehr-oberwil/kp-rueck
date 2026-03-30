"use client"

import { useState, useMemo, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, User, CheckCircle, Circle, Loader2, X, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { apiClient, type ApiEventSpecialFunctionResponse } from "@/lib/api-client"
import { type Person, type Operation } from "@/lib/contexts/operations-context"

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
  removeCrew: (operationId: string, crewName: string) => void
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
  const [searchQuery, setSearchQuery] = useState("")
  const [isAssigning, setIsAssigning] = useState(false)
  const [justAssigned, setJustAssigned] = useState<string | null>(null)

  // Track driver locally so we can update UI immediately
  const [localDriverId, setLocalDriverId] = useState<string | null>(initialDriverId)
  const [localDriverName, setLocalDriverName] = useState<string | null>(initialDriverName)

  // Conflict dialog state
  const [conflictDialog, setConflictDialog] = useState<{
    open: boolean
    person: Person | null
    conflictingOperations: Array<{ id: string; location: string; crewName: string }>
  }>({ open: false, person: null, conflictingOperations: [] })

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

  // Get personnel already assigned as drivers to other vehicles
  const driversOnOtherVehicles = useMemo(() => {
    return new Set(
      specialFunctions
        .filter(f => f.function_type === 'driver' && f.vehicle_id !== vehicleId)
        .map(f => f.personnel_id)
    )
  }, [specialFunctions, vehicleId])

  // Get available personnel (checked in and not driving another vehicle)
  // Include incident-assigned personnel so they can be selected with confirmation
  const availablePersonnel = useMemo(() => {
    return personnel.filter(p => {
      // Must not be driving another vehicle
      if (driversOnOtherVehicles.has(p.id)) return false
      // Must be available or assigned to an incident (not a driver/magazin)
      if (p.status === 'available') return true
      // Include incident-assigned personnel (but not drivers/magazin)
      if (p.status === 'assigned' && !p.isDriver && !p.isMagazin) return true
      return false
    })
  }, [personnel, driversOnOtherVehicles])

  // Get operations where a person is assigned
  const getPersonConflicts = (person: Person) => {
    return operations
      .filter(op => op.crew.includes(person.name))
      .map(op => ({ id: op.id, location: op.location, crewName: person.name }))
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
    try {
      // If there's a current driver, unassign them first
      if (localDriverId) {
        await apiClient.unassignSpecialFunction(eventId, {
          personnel_id: localDriverId,
          function_type: 'driver',
          vehicle_id: vehicleId,
        })
      }

      // Assign the new driver
      await apiClient.assignSpecialFunction(eventId, {
        personnel_id: person.id,
        function_type: 'driver',
        vehicle_id: vehicleId,
      })

      // Update local state
      setLocalDriverId(person.id)
      setLocalDriverName(person.name)

      setJustAssigned(person.id)
      setTimeout(() => setJustAssigned(null), 600)

      onDriverAssigned()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to assign driver:', error)
      toast.error('Fehler beim Zuweisen des Fahrers')
    } finally {
      setIsAssigning(false)
    }
  }

  const handleConflictConfirm = async () => {
    const { person, conflictingOperations } = conflictDialog
    if (!person) return

    // Unassign from all conflicting operations
    for (const conflict of conflictingOperations) {
      removeCrew(conflict.id, conflict.crewName)
    }

    setConflictDialog(prev => ({ ...prev, open: false }))

    // Small delay to let state updates propagate
    await new Promise(resolve => setTimeout(resolve, 100))

    // Now assign as driver
    await doAssignDriver(person)
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
      toast.error('Fehler beim Entfernen des Fahrers')
    } finally {
      setIsAssigning(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Fahrer für {vehicleName}
            </DialogTitle>
            <DialogDescription>
              {localDriverName
                ? `Aktueller Fahrer: ${localDriverName}`
                : 'Kein Fahrer zugewiesen'
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
                    <p className="text-xs text-muted-foreground">Aktueller Fahrer</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveDriver}
                  disabled={isAssigning}
                  className="text-muted-foreground hover:text-foreground"
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
                placeholder="Person suchen..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Personnel List */}
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-2">
                {/* Fahrer (F-tagged) section */}
                {driversGroup.length > 0 && (
                  <>
                    {othersGroup.length > 0 && (
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1 pt-1">Fahrer</p>
                    )}
                    {driversGroup.map((person) => {
                      const isCurrentDriver = person.id === localDriverId
                      const wasJustAssigned = justAssigned === person.id
                      const hasIncidentConflict = isAssignedToIncident(person)

                      return (
                        <button
                          key={person.id}
                          onClick={() => !isCurrentDriver && handleAssignDriver(person)}
                          disabled={isAssigning || isCurrentDriver}
                          className={cn(
                            "w-full flex items-center justify-between p-3 rounded-lg border border-border/50 transition-all text-left",
                            !isCurrentDriver && "hover:border-primary/50 hover:bg-secondary/30",
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
                            {hasIncidentConflict && (
                              <Badge variant="outline" className="text-xs gap-1 text-amber-500 border-amber-500/30">
                                <AlertTriangle className="h-3 w-3" />
                                Im Einsatz
                              </Badge>
                            )}
                            {isCurrentDriver && (
                              <Badge variant="secondary" className="text-xs">Aktuell</Badge>
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
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1 pt-3">Andere</p>
                    )}
                    {othersGroup.map((person) => {
                      const isCurrentDriver = person.id === localDriverId
                      const wasJustAssigned = justAssigned === person.id
                      const hasIncidentConflict = isAssignedToIncident(person)

                      return (
                        <button
                          key={person.id}
                          onClick={() => !isCurrentDriver && handleAssignDriver(person)}
                          disabled={isAssigning || isCurrentDriver}
                          className={cn(
                            "w-full flex items-center justify-between p-3 rounded-lg border border-border/50 transition-all text-left",
                            !isCurrentDriver && "hover:border-primary/50 hover:bg-secondary/30",
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
                            {hasIncidentConflict && (
                              <Badge variant="outline" className="text-xs gap-1 text-amber-500 border-amber-500/30">
                                <AlertTriangle className="h-3 w-3" />
                                Im Einsatz
                              </Badge>
                            )}
                            {isCurrentDriver && (
                              <Badge variant="secondary" className="text-xs">Aktuell</Badge>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </>
                )}

                {/* Empty state */}
                {filteredPersonnel.length === 0 && (
                  <div className="text-center py-12">
                    <User className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-sm font-medium text-foreground mb-1">
                      {searchQuery ? 'Keine Personen gefunden' : 'Keine verfügbaren Personen'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {searchQuery
                        ? 'Versuchen Sie einen anderen Suchbegriff'
                        : 'Alle Personen sind bereits als Fahrer eingeteilt oder nicht eingecheckt'
                      }
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Schliessen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Conflict confirmation dialog */}
      <AlertDialog open={conflictDialog.open} onOpenChange={(open) => setConflictDialog(prev => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Person ist einem Einsatz zugewiesen</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{conflictDialog.person?.name}</strong> ist aktuell{' '}
              {conflictDialog.conflictingOperations.length === 1
                ? `dem Einsatz «${conflictDialog.conflictingOperations[0]?.location}» zugewiesen`
                : `${conflictDialog.conflictingOperations.length} Einsätzen zugewiesen`
              }.
              {' '}Als Fahrer kann die Person nicht gleichzeitig einem Einsatz zugeteilt sein.
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
