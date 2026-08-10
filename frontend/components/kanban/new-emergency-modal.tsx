"use client"

/**
 * NewEmergencyModal Component
 *
 * SYNC NOTE: This component uses the shared LocationInput component
 * (components/location/location-input.tsx) for location entry.
 * Any changes to location input behavior should be made in that component.
 */

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { sanitizePhoneInput } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Phone, Plus } from 'lucide-react'
import { type Operation, type OperationStatus } from "@/lib/contexts/operations-context"
import { incidentTypeKeys, getIncidentTypeLabel } from "@/lib/incident-types"
import { LocationInput } from "@/components/location/location-input"
import { toast } from "sonner"

interface NewEmergencyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateOperation: (operation: Omit<Operation, "id" | "dispatchTime">) => void
  /** When set, the created incident is attached to this Auftrag (streamlined "+ Stop"). */
  defaultGroupId?: string | null
}

export function NewEmergencyModal({
  open,
  onOpenChange,
  onCreateOperation,
  defaultGroupId = null,
}: NewEmergencyModalProps) {
  const t = useTranslations('kanban')
  const [formData, setFormData] = useState({
    location: "",
    incidentType: "elementarereignis",
    priority: "low" as "high" | "medium" | "low",
    vehicle: null as string | null,
    coordinates: null as Operation["coordinates"],
    status: "incoming" as OperationStatus,
    crew: [] as string[],
    materials: [] as string[],
    notes: "",
    // "Telefonisch gemeldet" — off by default, because typing a card on the
    // board IS the operator case (plan 26 §6).
    source: "operator" as "operator" | "intake",
    contact: "",
    contactPhone: "",
    internalNotes: "",
    nachbarhilfe: false,
    nachbarhilfeNote: "",
    amWarten: false,
    amWartenNote: "",
    zuFuss: false,
    statusChangedAt: null as Date | null,
    hasCompletedReko: false,
    rekoArrivedAt: null as Date | null,
    rekoSummary: null,
    assignedReko: null as { id: string; name: string } | null,
    leaderName: null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicles: [] as string[],
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map() as Map<string, string>,
    vehicleDriverStay: new Map() as Map<string, boolean>,
    groupId: null as string | null,
    groupPosition: 0,
  })

  // Form validation state
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [showValidationErrors, setShowValidationErrors] = useState(false)

  // When opened as an Auftrag "+ Stop", stamp the preset group so the created
  // incident is attached at creation. Cleared again by the reset on submit/close.
  useEffect(() => {
    if (open) {
      setFormData((prev) => ({ ...prev, groupId: defaultGroupId }))
    }
  }, [open, defaultGroupId])

  // Validation rules
  const isLocationValid = formData.location.trim().length > 0
  const showLocationError = (touched.location || showValidationErrors) && !isLocationValid


  const handleSubmit = () => {
    // Trigger validation display
    setShowValidationErrors(true)

    if (!isLocationValid) {
      toast.error(t('newEmergency.validationTitle'), {
        description: t('newEmergency.validationDescription')
      })
      return
    }

    onCreateOperation(formData)

    // Reset form and validation state
    setFormData({
      location: "",
      incidentType: "elementarereignis",
      priority: "low",
      vehicle: null,
      coordinates: null,
      status: "incoming",
      crew: [],
      materials: [],
      notes: "",
      source: "operator",
      contact: "",
      contactPhone: "",
      internalNotes: "",
      nachbarhilfe: false,
      nachbarhilfeNote: "",
      amWarten: false,
      amWartenNote: "",
      zuFuss: false,
      statusChangedAt: null,
      hasCompletedReko: false,
      rekoArrivedAt: null,
      rekoSummary: null,
      assignedReko: null,
      leaderName: null,
      crewAssignments: new Map(),
      materialAssignments: new Map(),
      vehicles: [],
      vehicleAssignments: new Map(),
      vehicleCallsigns: new Map(),
      vehicleDriverStay: new Map(),
      groupId: null,
      groupPosition: 0,
    })
    setTouched({})
    setShowValidationErrors(false)

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl modal-h-tall overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Plus className="h-6 w-6 text-primary" />
            <DialogTitle>{t('common.newIncident')}</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            {t('newEmergency.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Location - Required field with validation */}
          <div className="space-y-1.5">
            <LocationInput
              address={formData.location}
              latitude={formData.coordinates?.[0] ?? null}
              longitude={formData.coordinates?.[1] ?? null}
              onAddressChange={(address) => {
                setFormData(prev => ({ ...prev, location: address || "" }))
                setTouched(prev => ({ ...prev, location: true }))
              }}
              onCoordinatesChange={(lat, lon) =>
                setFormData(prev => ({
                  ...prev,
                  coordinates: lat !== null && lon !== null ? [lat, lon] : null
                }))
              }
              autoFocus={open}
              error={showLocationError}
            />
            {showLocationError && (
              <p className="text-sm text-destructive">
                {t('newEmergency.locationError')}
              </p>
            )}
          </div>

          {/* Meldung */}
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-sm font-semibold text-muted-foreground">
              {t('common.meldung')}
            </Label>
            <Textarea
              id="notes"
              placeholder={t('common.meldungPlaceholder')}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="min-h-[100px]"
            />
          </div>

          {/* Grid - 2 columns */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="incidentType" className="text-sm font-semibold text-muted-foreground">
                {t('common.einsatzart')}
              </Label>
              <Select
                value={formData.incidentType}
                onValueChange={(value) => setFormData({ ...formData, incidentType: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('common.einsatzartPlaceholder')} />
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
              <Label htmlFor="priority" className="text-sm font-semibold text-muted-foreground">
                {t('common.priority')}
              </Label>
              <Select
                value={formData.priority}
                onValueChange={(value) => setFormData({ ...formData, priority: value as "high" | "medium" | "low" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('common.priorityLow')}</SelectItem>
                  <SelectItem value="medium">{t('common.priorityMedium')}</SelectItem>
                  <SelectItem value="high">{t('common.priorityHigh')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Provenance, then who, then the number — one sentence: somebody
              phoned, this is who, this is the number. It sits here rather than
              at the top of the form because the operator is already in these
              fields when they take a call; a selector above would add a step to
              the board's most-used modal just to confirm the normal case. */}
          <div
            className="rounded-lg border border-border p-3 cursor-pointer select-none"
            onClick={() =>
              setFormData((prev) => ({ ...prev, source: prev.source === 'intake' ? 'operator' : 'intake' }))
            }
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Phone className="h-5 w-5 text-muted-foreground" />
                <div>
                  <Label className="text-sm font-semibold pointer-events-none">
                    {t('common.phoneReported')}
                  </Label>
                  <p className="text-xs text-muted-foreground">{t('common.phoneReportedDescription')}</p>
                </div>
              </div>
              <Switch
                aria-label={t('common.phoneReported')}
                checked={formData.source === 'intake'}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, source: checked ? 'intake' : 'operator' }))
                }
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Contact */}
          <div className="space-y-1.5">
            <Label htmlFor="contact" className="text-sm font-semibold text-muted-foreground">
              {t('common.contact')}
            </Label>
            <Input
              id="contact"
              placeholder={t('common.contactPlaceholder')}
              value={formData.contact}
              onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
            />
          </div>

          {/* Contact phone */}
          <div className="space-y-1.5">
            <Label htmlFor="contact-phone" className="text-sm font-semibold text-muted-foreground">
              {t('common.contactPhone')}
            </Label>
            <Input
              id="contact-phone"
              type="tel"
              inputMode="tel"
              placeholder={t('common.contactPhonePlaceholder')}
              value={formData.contactPhone}
              onChange={(e) => setFormData({ ...formData, contactPhone: sanitizePhoneInput(e.target.value) })}
            />
          </div>

          {/* Info */}
          <div className="bg-muted/50 p-3 rounded-lg">
            <p className="text-sm text-muted-foreground">
              {t('newEmergency.infoDragDrop')}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t">
            <Button
              onClick={handleSubmit}
              disabled={!formData.location}
              className="hover-delight"
            >
              <Plus className="h-4 w-4" />
              {t('newEmergency.create')}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
