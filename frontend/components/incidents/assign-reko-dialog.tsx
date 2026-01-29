"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, User, Loader2 } from "lucide-react"
import { apiClient, type ApiAvailableRekoPersonnel } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface AssignRekoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  incidentId: string
  incidentTitle: string
  onAssigned?: () => void
}

export function AssignRekoDialog({
  open,
  onOpenChange,
  incidentId,
  incidentTitle,
  onAssigned,
}: AssignRekoDialogProps) {
  const [personnel, setPersonnel] = useState<ApiAvailableRekoPersonnel[]>([])
  const [currentlyAssignedId, setCurrentlyAssignedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [assigning, setAssigning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load available Reko personnel when dialog opens
  useEffect(() => {
    if (open) {
      loadAvailablePersonnel()
    }
  }, [open, incidentId])

  const loadAvailablePersonnel = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiClient.getAvailableRekoPersonnel(incidentId)
      setPersonnel(response.personnel)
      setCurrentlyAssignedId(response.currently_assigned_id)
    } catch (err) {
      console.error('Failed to load Reko personnel:', err)
      setError('Fehler beim Laden der Reko-Personen')
    } finally {
      setLoading(false)
    }
  }

  const handleAssign = async (person: ApiAvailableRekoPersonnel) => {
    setAssigning(person.personnel_id)
    try {
      await apiClient.assignRekoPersonnel(incidentId, person.personnel_id)
      toast.success(`${person.name} für Reko zugewiesen`)
      onAssigned?.()
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to assign Reko personnel:', err)
      toast.error('Fehler bei der Zuweisung')
    } finally {
      setAssigning(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Reko-Personal zuweisen
          </DialogTitle>
          <DialogDescription className="truncate">
            Einsatz: {incidentTitle}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Fixed height container to prevent layout shifts */}
          <div className="min-h-[300px]">
            {loading ? (
              <div className="flex items-center justify-center h-[300px]">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Lädt...</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-[300px]">
                <p className="text-destructive">{error}</p>
                <Button variant="outline" onClick={loadAvailablePersonnel} className="mt-4">
                  Erneut versuchen
                </Button>
              </div>
            ) : personnel.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[300px]">
                <User className="h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-sm font-medium text-foreground mb-2">
                  Keine Reko-Personen verfügbar
                </p>
                <p className="text-xs text-muted-foreground text-center">
                  Tipp: Rechtsklick auf eine Person in der Seitenleiste → "Als Reko zuweisen" um jemanden als Reko-Personal zu markieren.
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-2">
                  {personnel.map((person) => {
                  const isCurrentlyAssigned = person.personnel_id === currentlyAssignedId
                  return (
                    <button
                      key={person.personnel_id}
                      onClick={() => handleAssign(person)}
                      disabled={assigning !== null || isCurrentlyAssigned}
                      className={cn(
                        "w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left",
                        isCurrentlyAssigned
                          ? "border-green-500 bg-green-500/10 cursor-default"
                          : "border-border/50 hover:border-primary/50 hover:bg-secondary/30",
                        assigning === person.personnel_id && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <User className={cn(
                          "h-5 w-5 flex-shrink-0",
                          isCurrentlyAssigned ? "text-green-500" :
                          person.assignment_count > 0 ? "text-orange-500" : "text-muted-foreground"
                        )} />
                        <div>
                          <p className="font-medium text-sm">{person.name}</p>
                          {person.role && (
                            <p className="text-xs text-muted-foreground">{person.role}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isCurrentlyAssigned ? (
                          <Badge variant="default" className="text-xs bg-green-600">
                            Zugewiesen
                          </Badge>
                        ) : person.assignment_count > 0 ? (
                          <Badge variant="outline" className="text-xs">
                            {person.assignment_count} {person.assignment_count === 1 ? 'Einsatz' : 'Einsätze'}
                          </Badge>
                        ) : null}
                        {assigning === person.personnel_id && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
              </ScrollArea>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
