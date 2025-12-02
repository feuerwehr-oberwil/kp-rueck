"use client"

/**
 * NewEmergencyModal Component
 *
 * SYNC NOTE: This component uses the shared LocationInput component
 * (components/location/location-input.tsx) for location entry.
 * Any changes to location input behavior should be made in that component.
 */

import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus } from 'lucide-react'
import { type Operation, type OperationStatus } from "@/lib/contexts/operations-context"
import { incidentTypeKeys, getIncidentTypeLabel } from "@/lib/incident-types"
import { apiClient } from "@/lib/api-client"
import { LocationInput } from "@/components/location/location-input"
import { toast } from "sonner"

interface NewEmergencyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateOperation: (operation: Omit<Operation, "id" | "dispatchTime">) => void
  nextOperationId: string
}

export function NewEmergencyModal({
  open,
  onOpenChange,
  onCreateOperation,
  nextOperationId,
}: NewEmergencyModalProps) {
  const [formData, setFormData] = useState({
    location: "",
    incidentType: "elementarereignis",
    priority: "low" as "high" | "medium" | "low",
    vehicle: null as string | null,
    coordinates: [47.51637699933488, 7.561800450458299] as [number, number],
    status: "incoming" as OperationStatus,
    crew: [] as string[],
    materials: [] as string[],
    notes: "",
    contact: "",
    internalNotes: "",
    statusChangedAt: null as Date | null,
    hasCompletedReko: false,
    rekoSummary: null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicles: [] as string[],
    vehicleAssignments: new Map(),
  })


  const handleSubmit = () => {
    if (!formData.location) {
      return
    }

    onCreateOperation(formData)
    toast.success(`Einsatz erstellt: ${formData.location}`)

    // Reset form
    setFormData({
      location: "",
      incidentType: "elementarereignis",
      priority: "low",
      vehicle: null,
      coordinates: [47.51637699933488, 7.561800450458299],
      status: "incoming",
      crew: [],
      materials: [],
      notes: "",
      contact: "",
      internalNotes: "",
      statusChangedAt: null,
      hasCompletedReko: false,
      rekoSummary: null,
      crewAssignments: new Map(),
      materialAssignments: new Map(),
      vehicles: [],
      vehicleAssignments: new Map(),
    })

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Plus className="h-6 w-6 text-primary" />
            <DialogTitle className="text-2xl">Neuer Einsatz</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            Einsatz-ID: {nextOperationId} (wird automatisch vergeben)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Location - Always shown */}
          <LocationInput
            address={formData.location}
            latitude={formData.coordinates[0]}
            longitude={formData.coordinates[1]}
            onAddressChange={(address) => setFormData(prev => ({ ...prev, location: address || "" }))}
            onCoordinatesChange={(lat, lon) =>
              setFormData(prev => ({
                ...prev,
                coordinates: [lat ?? 47.51637699933488, lon ?? 7.561800450458299]
              }))
            }
          />

          {/* All fields */}
              {/* Meldung */}
              <div>
                <Label htmlFor="notes" className="text-sm font-semibold text-muted-foreground">
                  Meldung
                </Label>
                <Textarea
                  id="notes"
                  placeholder="Notizen, Besonderheiten, Gefahren..."
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="mt-2 min-h-[100px]"
                />
              </div>

              {/* Grid - 2 columns */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="incidentType" className="text-sm font-semibold text-muted-foreground">
                    Einsatzart
                  </Label>
                  <Select
                    value={formData.incidentType}
                    onValueChange={(value) => setFormData({ ...formData, incidentType: value })}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Einsatzart auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {incidentTypeKeys.map((typeKey) => (
                        <SelectItem key={typeKey} value={typeKey}>
                          {getIncidentTypeLabel(typeKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="priority" className="text-sm font-semibold text-muted-foreground">
                    Priorität
                  </Label>
                  <Select
                    value={formData.priority}
                    onValueChange={(value) => setFormData({ ...formData, priority: value as "high" | "medium" | "low" })}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Niedrig</SelectItem>
                      <SelectItem value="medium">Mittel</SelectItem>
                      <SelectItem value="high">Hoch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Contact */}
              <div>
                <Label htmlFor="contact" className="text-sm font-semibold text-muted-foreground">
                  Kontakt / Melder
                </Label>
                <Input
                  id="contact"
                  placeholder="Name, Telefonnummer..."
                  value={formData.contact}
                  onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
                  className="mt-2"
                />
              </div>

          {/* Info */}
          <div className="bg-secondary/30 p-3 rounded-lg">
            <p className="text-sm text-muted-foreground">
              Fahrzeuge, Mannschaft und Material können nach dem Erstellen des Einsatzes per Drag & Drop zugewiesen werden.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <Button
              onClick={handleSubmit}
              disabled={!formData.location}
              className="gap-2 hover-delight"
            >
              <Plus className="h-4 w-4" />
              Einsatz erstellen
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
