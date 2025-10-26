"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Separator } from "@/components/ui/separator"
import { Plus, Save, MapPin, Check, ChevronsUpDown } from 'lucide-react'
import type { Incident, IncidentCreate, IncidentUpdate, IncidentType, IncidentPriority } from "@/lib/types/incidents"
import { INCIDENT_TYPE_LABELS, PRIORITY_LABELS } from "@/lib/types/incidents"
import { useIncidents } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { cn } from "@/lib/utils"
import RekoReportSection from "@/components/reko/reko-report-section"

interface IncidentFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  incident?: Incident | null
  mode?: 'create' | 'edit'
}

export function IncidentForm({ open, onOpenChange, incident, mode = 'create' }: IncidentFormProps) {
  const { createIncident, updateIncident, trainingMode } = useIncidents()
  const { selectedEvent } = useEvent()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [incidentTypeOpen, setIncidentTypeOpen] = useState(false)

  const [formData, setFormData] = useState<IncidentCreate>({
    event_id: incident?.event_id || selectedEvent?.id || '',
    title: incident?.title || '',
    type: incident?.type || 'technische_hilfeleistung',
    priority: incident?.priority || 'medium',
    location_address: incident?.location_address || null,
    location_lat: incident?.location_lat || null,
    location_lng: incident?.location_lng || null,
    description: incident?.description || null,
    status: incident?.status || 'eingegangen',
  })

  // Keyboard shortcuts for priority (Shift+1-3)
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if Shift is pressed and not in an input field
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const target = e.target as HTMLElement
        // Don't trigger if user is typing in an input/textarea
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

        switch (e.key) {
          case '1':
            e.preventDefault()
            setFormData(prev => ({ ...prev, priority: 'low' }))
            break
          case '2':
            e.preventDefault()
            setFormData(prev => ({ ...prev, priority: 'medium' }))
            break
          case '3':
            e.preventDefault()
            setFormData(prev => ({ ...prev, priority: 'high' }))
            break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  // Check if coordinates are valid
  const hasValidCoordinates =
    typeof formData.location_lat === 'number' &&
    typeof formData.location_lng === 'number' &&
    !isNaN(formData.location_lat) &&
    !isNaN(formData.location_lng) &&
    formData.location_lat >= -90 &&
    formData.location_lat <= 90 &&
    formData.location_lng >= -180 &&
    formData.location_lng <= 180

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      if (mode === 'create') {
        await createIncident(formData)
      } else if (incident) {
        const updateData: IncidentUpdate = {
          title: formData.title,
          type: formData.type,
          priority: formData.priority,
          location_address: formData.location_address,
          location_lat: formData.location_lat,
          location_lng: formData.location_lng,
          description: formData.description,
        }
        await updateIncident(incident.id, updateData)
      }

      // Reset form and close
      setFormData({
        event_id: selectedEvent?.id || '',
        title: '',
        type: 'technische_hilfeleistung',
        priority: 'medium',
        location_address: null,
        location_lat: null,
        location_lng: null,
        description: null,
        status: 'eingegangen',
      })
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to save incident:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Reset form when incident changes or modal opens
  useState(() => {
    if (open && incident && mode === 'edit') {
      setFormData({
        event_id: incident.event_id,
        title: incident.title,
        type: incident.type,
        priority: incident.priority,
        location_address: incident.location_address,
        location_lat: incident.location_lat,
        location_lng: incident.location_lng,
        description: incident.description,
        status: incident.status,
      })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-3">
            {mode === 'create' ? (
              <>
                <Plus className="h-6 w-6 text-primary" />
                Neuer Einsatz
              </>
            ) : (
              <>
                <Save className="h-6 w-6 text-primary" />
                Einsatz bearbeiten
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-base">
            {trainingMode && (
              <span className="inline-flex items-center gap-2 px-2 py-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                Übungsmodus aktiv
              </span>
            )}
            {mode === 'edit' && incident && (
              <span className="ml-2">ID: {incident.id}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          {/* Title */}
          <div>
            <Label htmlFor="title" className="text-sm font-semibold text-muted-foreground">
              Titel / Einsatzbezeichnung *
            </Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="z.B. Wohnungsbrand Hauptstrasse 45"
              className="mt-2"
              required
              autoFocus={mode === 'create'}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Type - Searchable Combobox */}
            <div>
              <Label htmlFor="type" className="text-sm font-semibold text-muted-foreground">
                Einsatzart *
              </Label>
              <Popover open={incidentTypeOpen} onOpenChange={setIncidentTypeOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={incidentTypeOpen}
                    className="mt-2 w-full justify-between"
                  >
                    {formData.type ? INCIDENT_TYPE_LABELS[formData.type] : "Einsatzart wählen..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Einsatzart suchen..." />
                    <CommandList>
                      <CommandEmpty>Keine Einsatzart gefunden.</CommandEmpty>
                      <CommandGroup>
                        {Object.entries(INCIDENT_TYPE_LABELS).map(([key, label]) => (
                          <CommandItem
                            key={key}
                            value={label}
                            onSelect={() => {
                              setFormData({ ...formData, type: key as IncidentType })
                              setIncidentTypeOpen(false)
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                formData.type === key ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Priority */}
            <div>
              <Label htmlFor="priority" className="text-sm font-semibold text-muted-foreground">
                Priorität * <span className="text-xs text-muted-foreground/60">(Shift+1-3)</span>
              </Label>
              <Select
                value={formData.priority}
                onValueChange={(value) => setFormData({ ...formData, priority: value as IncidentPriority })}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Location - Full Width */}
          <div className="col-span-full">
            <Label htmlFor="location_address" className="text-sm font-semibold text-muted-foreground">
              Einsatzort
            </Label>
            <Input
              id="location_address"
              value={formData.location_address || ''}
              onChange={(e) => setFormData({ ...formData, location_address: e.target.value || null })}
              placeholder="Strasse, Hausnummer, PLZ, Ort"
              className="mt-2"
            />
          </div>

          {/* Coordinates */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-muted-foreground">
                Koordinaten
              </Label>
              {hasValidCoordinates && (
                <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                  <MapPin className="h-3.5 w-3.5" />
                  <Check className="h-3.5 w-3.5" />
                  <span className="font-medium">Gültige Koordinaten</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Latitude */}
              <div>
                <Label htmlFor="location_lat" className="text-xs text-muted-foreground">
                  Breitengrad (Lat)
                </Label>
                <Input
                  id="location_lat"
                  type="number"
                  step="any"
                  value={formData.location_lat ?? ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      location_lat: e.target.value ? parseFloat(e.target.value) : null,
                    })
                  }
                  placeholder="47.51637699"
                  className="mt-1"
                />
              </div>

              {/* Longitude */}
              <div>
                <Label htmlFor="location_lng" className="text-xs text-muted-foreground">
                  Längengrad (Lng)
                </Label>
                <Input
                  id="location_lng"
                  type="number"
                  step="any"
                  value={formData.location_lng ?? ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      location_lng: e.target.value ? parseFloat(e.target.value) : null,
                    })
                  }
                  placeholder="7.56180045"
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="description" className="text-sm font-semibold text-muted-foreground">
              Beschreibung / Notizen
            </Label>
            <Textarea
              id="description"
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value || null })}
              placeholder="Zusätzliche Informationen, Besonderheiten, Gefahren..."
              className="mt-2 min-h-[100px]"
            />
          </div>

          {/* Reko Reports (only in edit mode) */}
          {mode === 'edit' && incident && (
            <div>
              <Separator className="my-6" />
              <Label className="text-sm font-semibold text-muted-foreground">
                Rekognoszierungs-Meldungen
              </Label>
              <div className="mt-3">
                <RekoReportSection incidentId={incident.id} />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <Button type="submit" disabled={isSubmitting || !formData.title} className="gap-2">
              {mode === 'create' ? (
                <>
                  <Plus className="h-4 w-4" />
                  Einsatz erstellen
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Änderungen speichern
                </>
              )}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Abbrechen
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
