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
    nachbarhilfe: false,
    nachbarhilfeNote: "",
    statusChangedAt: null as Date | null,
    hasCompletedReko: false,
    rekoArrivedAt: null as Date | null,
    rekoSummary: null,
    assignedReko: null as { id: string; name: string } | null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicles: [] as string[],
    vehicleAssignments: new Map(),
  })

  // Form validation state
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [showValidationErrors, setShowValidationErrors] = useState(false)

  // Validation rules
  const isLocationValid = formData.location.trim().length > 0
  const showLocationError = (touched.location || showValidationErrors) && !isLocationValid


  const handleSubmit = () => {
    // Trigger validation display
    setShowValidationErrors(true)

    if (!isLocationValid) {
      toast.error("Bitte füllen Sie alle Pflichtfelder aus", {
        description: "Der Einsatzort ist erforderlich."
      })
      return
    }

    onCreateOperation(formData)
    toast.success(`Einsatz erstellt: ${formData.location}`)

    // Reset form and validation state
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
      nachbarhilfe: false,
      nachbarhilfeNote: "",
      statusChangedAt: null,
      hasCompletedReko: false,
      rekoArrivedAt: null,
      rekoSummary: null,
      assignedReko: null,
      crewAssignments: new Map(),
      materialAssignments: new Map(),
      vehicles: [],
      vehicleAssignments: new Map(),
    })
    setTouched({})
    setShowValidationErrors(false)

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
            Erfassen Sie die Details zum neuen Einsatz
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Location - Required field with validation */}
          <div className="space-y-1.5">
            <LocationInput
              address={formData.location}
              latitude={formData.coordinates[0]}
              longitude={formData.coordinates[1]}
              onAddressChange={(address) => {
                setFormData(prev => ({ ...prev, location: address || "" }))
                setTouched(prev => ({ ...prev, location: true }))
              }}
              onCoordinatesChange={(lat, lon) =>
                setFormData(prev => ({
                  ...prev,
                  coordinates: [lat ?? 47.51637699933488, lon ?? 7.561800450458299]
                }))
              }
              autoFocus={open}
              error={showLocationError}
            />
            {showLocationError && (
              <p className="text-sm text-destructive">
                Bitte geben Sie einen Einsatzort ein
              </p>
            )}
          </div>

          {/* Meldung */}
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-sm font-medium">
              Meldung
            </Label>
            <Textarea
              id="notes"
              placeholder="Notizen, Besonderheiten, Gefahren..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="min-h-[100px]"
            />
          </div>

          {/* Grid - 2 columns */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="incidentType" className="text-sm font-medium">
                Einsatzart
              </Label>
              <Select
                value={formData.incidentType}
                onValueChange={(value) => setFormData({ ...formData, incidentType: value })}
              >
                <SelectTrigger>
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

            <div className="space-y-1.5">
              <Label htmlFor="priority" className="text-sm font-medium">
                Priorität
              </Label>
              <Select
                value={formData.priority}
                onValueChange={(value) => setFormData({ ...formData, priority: value as "high" | "medium" | "low" })}
              >
                <SelectTrigger>
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
          <div className="space-y-1.5">
            <Label htmlFor="contact" className="text-sm font-medium">
              Kontakt / Melder
            </Label>
            <Input
              id="contact"
              placeholder="Name, Telefonnummer..."
              value={formData.contact}
              onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
            />
          </div>

          {/* Info */}
          <div className="bg-muted/50 p-3 rounded-lg">
            <p className="text-sm text-muted-foreground">
              Fahrzeuge, Mannschaft und Material können nach dem Erstellen des Einsatzes per Drag & Drop zugewiesen werden.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t">
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
