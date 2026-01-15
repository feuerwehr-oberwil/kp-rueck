"use client"

import { useState, useMemo, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, User, CheckCircle, Circle, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { apiClient, type ApiEventSpecialFunctionResponse } from "@/lib/api-client"
import { type Person } from "@/lib/contexts/operations-context"

interface DriverAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vehicleId: string
  vehicleName: string
  eventId: string
  currentDriverId: string | null
  currentDriverName: string | null
  personnel: Person[]
  specialFunctions: ApiEventSpecialFunctionResponse[]
  onDriverAssigned: () => void
}

export function DriverAssignmentDialog({
  open,
  onOpenChange,
  vehicleId,
  vehicleName,
  eventId,
  currentDriverId,
  currentDriverName,
  personnel,
  specialFunctions,
  onDriverAssigned,
}: DriverAssignmentDialogProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [isAssigning, setIsAssigning] = useState(false)
  const [justAssigned, setJustAssigned] = useState<string | null>(null)

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
  const availablePersonnel = useMemo(() => {
    return personnel.filter(p =>
      p.status === 'available' && !driversOnOtherVehicles.has(p.id)
    )
  }, [personnel, driversOnOtherVehicles])

  // Filter by search query
  const filteredPersonnel = useMemo(() => {
    if (!searchQuery.trim()) return availablePersonnel
    const query = searchQuery.toLowerCase()
    return availablePersonnel.filter(p =>
      p.name.toLowerCase().includes(query) ||
      (p.role && p.role.toLowerCase().includes(query))
    )
  }, [availablePersonnel, searchQuery])

  const handleAssignDriver = async (person: Person) => {
    setIsAssigning(true)
    try {
      // If there's a current driver, unassign them first
      if (currentDriverId) {
        await apiClient.unassignSpecialFunction(eventId, {
          personnel_id: currentDriverId,
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

      setJustAssigned(person.id)
      setTimeout(() => setJustAssigned(null), 600)

      toast.success(`${person.name} als Fahrer für ${vehicleName} zugewiesen`)
      onDriverAssigned()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to assign driver:', error)
      toast.error('Fehler beim Zuweisen des Fahrers')
    } finally {
      setIsAssigning(false)
    }
  }

  const handleRemoveDriver = async () => {
    if (!currentDriverId) return

    setIsAssigning(true)
    try {
      await apiClient.unassignSpecialFunction(eventId, {
        personnel_id: currentDriverId,
        function_type: 'driver',
        vehicle_id: vehicleId,
      })

      toast.success(`Fahrer von ${vehicleName} entfernt`)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Fahrer für {vehicleName}
          </DialogTitle>
          <DialogDescription>
            {currentDriverName
              ? `Aktueller Fahrer: ${currentDriverName}`
              : 'Kein Fahrer zugewiesen'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current driver with remove option */}
          {currentDriverId && currentDriverName && (
            <div className="flex items-center justify-between p-3 rounded-lg border border-primary/50 bg-primary/5">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">{currentDriverName}</p>
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
              {filteredPersonnel.map((person, index) => {
                const isCurrentDriver = person.id === currentDriverId
                const wasJustAssigned = justAssigned === person.id

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
                    {isCurrentDriver && (
                      <Badge variant="secondary" className="text-xs">Aktuell</Badge>
                    )}
                  </button>
                )
              })}

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
  )
}
