"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MapPin, AlertCircle } from "lucide-react"
import type { Incident } from "@/lib/types/incidents"
import { INCIDENT_TYPE_LABELS } from "@/lib/types/incidents"

interface TransferIncidentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceIncident: Incident
  availableIncidents: Incident[]
  onTransfer: (targetIncidentId: string) => void
  isTransferring?: boolean
}

export function TransferIncidentDialog({
  open,
  onOpenChange,
  sourceIncident,
  availableIncidents,
  onTransfer,
  isTransferring = false,
}: TransferIncidentDialogProps) {
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)

  const handleTransfer = () => {
    if (selectedIncidentId) {
      onTransfer(selectedIncidentId)
    }
  }

  const handleClose = () => {
    setSelectedIncidentId(null)
    onOpenChange(false)
  }

  // Filter out the source incident from available incidents
  const targetIncidents = availableIncidents.filter(inc => inc.id !== sourceIncident.id)

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Ressourcen übertragen</DialogTitle>
          <DialogDescription>
            Alle Zuweisungen von &quot;{sourceIncident.title}&quot; zu einem anderen Einsatz übertragen
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-4">
          {targetIncidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <AlertCircle className="h-12 w-12 mb-3" />
              <p>Keine anderen Einsätze verfügbar</p>
              <p className="text-sm">Es müssen mindestens zwei Einsätze vorhanden sein</p>
            </div>
          ) : (
            targetIncidents.map((incident) => (
              <button
                key={incident.id}
                onClick={() => setSelectedIncidentId(incident.id)}
                className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                  selectedIncidentId === incident.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50 hover:bg-accent"
                }`}
              >
                <div className="space-y-2">
                  {/* Title and location */}
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 flex-shrink-0 text-primary mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <h4 className="font-semibold text-sm">{incident.title}</h4>
                      {incident.location_address && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {incident.location_address}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Incident type and priority */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      {INCIDENT_TYPE_LABELS[incident.type]}
                    </Badge>
                    <Badge
                      variant={
                        incident.priority === "high"
                          ? "destructive"
                          : incident.priority === "medium"
                          ? "default"
                          : "secondary"
                      }
                      className="text-xs"
                    >
                      {incident.priority === "high"
                        ? "Hoch"
                        : incident.priority === "medium"
                        ? "Mittel"
                        : "Niedrig"}
                    </Badge>
                    {incident.assigned_vehicles.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {incident.assigned_vehicles.length} Fahrzeug(e)
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isTransferring}>
            Abbrechen
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={!selectedIncidentId || isTransferring}
          >
            {isTransferring ? "Übertrage..." : "Übertragen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
