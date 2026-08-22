"use client"

/**
 * NewEmergencyModal Component
 *
 * SYNC NOTE: This component uses the shared LocationInput component
 * (components/location/location-input.tsx) for location entry.
 * Any changes to location input behavior should be made in that component.
 *
 * LAYOUT: the same `DetailField` rows the incident detail is built from —
 * `Beschriftung │ Wert` on one line. Two columns, because the modal is four times
 * as wide as the side panel and the stacked version spent ~880px saying the same
 * thing: a label above every control, a full sentence under every switch, and a
 * scrollbar for the trouble. The fields an operator types while taking the call
 * are on the left, who called on the right.
 *
 * Unlike the side panel, the controls here are BOXED. The panel's borderless
 * skin (`DENSE_CONTROL`) works because an existing incident fills every row with
 * a value; in a creation dialog every field is empty at open, and a borderless
 * empty input has no affordance at all — the Einsatzort row read as three bare
 * icons. Same grammar, different skin.
 */

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { sanitizePhoneInput } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DetailField, DetailToggle } from "@/components/kanban/detail-field"
import { Axe, Phone, Plus } from 'lucide-react'
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
    // "Telefonisch gemeldet" / "Vom Feld gemeldet" — off by default, because
    // typing a card on the board IS the operator case (plan 26 §6). One value,
    // two switches: a Meldung came over the phone OR from a Trupp, never both.
    source: "operator" as "operator" | "intake" | "feld",
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
      {/* `sm:`-scoped on purpose: the primitive's own `sm:max-w-lg` is variant-scoped,
          so a bare `max-w-*` loses to it at desktop widths and the form gets
          crushed into ~440px — clipped selects, icon-only Einsatzort. */}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Plus className="h-6 w-6 text-primary" />
            <DialogTitle>{t('common.newIncident')}</DialogTitle>
          </div>
          <DialogDescription>
            {t('newEmergency.description')}
          </DialogDescription>
        </DialogHeader>

        {/* ONE column: the eight rows fit a laptop's height with room to spare,
            and a single reading direction beats filling width for its own sake —
            a second column made the eye jump mid-form. Was ist passiert first
            (same order as the Übersicht tab, so the modal and the detail read as
            one form seen twice), wer hat gemeldet after. */}
        <div className="space-y-1 py-2">
            {/* Location carries its own label and its own map/coordinate buttons,
                so it lays itself out as a row rather than being wrapped in one. */}
            <LocationInput
              address={formData.location}
              latitude={formData.coordinates?.[0] ?? null}
              longitude={formData.coordinates?.[1] ?? null}
              dense
              boxed
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
              <p className="pl-[112px] text-xs text-destructive">
                {t('newEmergency.locationError')}
              </p>
            )}

            <DetailField label={t('common.meldung')} htmlFor="notes" alignStart>
              <Textarea
                id="notes"
                placeholder={t('common.meldungPlaceholder')}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                // Grows with what is in it, like the detail's Meldung.
                className="min-h-[5rem] max-h-[16rem]"
              />
            </DetailField>

            {/* One per line, Einsatzart and Priorität included: two half-width
                controls sharing a row is how «Mittel» gets read as the Einsatzart. */}
            <DetailField label={t('common.einsatzart')} htmlFor="incidentType">
              <Select
                value={formData.incidentType}
                onValueChange={(value) => setFormData({ ...formData, incidentType: value })}
              >
                <SelectTrigger id="incidentType" className="w-full">
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
            </DetailField>

            <DetailField label={t('common.priority')} htmlFor="priority">
              <Select
                value={formData.priority}
                onValueChange={(value) => setFormData({ ...formData, priority: value as "high" | "medium" | "low" })}
              >
                <SelectTrigger id="priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('common.priorityLow')}</SelectItem>
                  <SelectItem value="medium">{t('common.priorityMedium')}</SelectItem>
                  <SelectItem value="high">{t('common.priorityHigh')}</SelectItem>
                </SelectContent>
              </Select>
            </DetailField>

            {/* Wer hat gemeldet. Provenance, then who, then the number: one
              sentence, and the order is the point (see the spec next door). It
              comes AFTER the incident fields rather than above them because the
              operator is already typing the Einsatzort when they take a call; a
              selector on top would add a step to the board's most-used modal just
              to confirm the normal case. Two switches over ONE source value, so
              turning one on turns the other off — the same pair, and the same
              `DetailToggle`, as the Übersicht tab. The explanatory sentence under
              each switch is gone; it lives on as the label's `title`. */}
            <DetailToggle
              label={t('common.phoneReported')}
              description={t('common.phoneReportedDescription')}
              icon={<Phone className="h-3.5 w-3.5 shrink-0" />}
              checked={formData.source === 'intake'}
              onToggle={(checked) =>
                setFormData((prev) => ({ ...prev, source: checked ? 'intake' : 'operator' }))
              }
            />
            <DetailToggle
              label={t('common.feldReported')}
              description={t('common.feldReportedDescription')}
              icon={<Axe className="h-3.5 w-3.5 shrink-0" />}
              checked={formData.source === 'feld'}
              onToggle={(checked) =>
                setFormData((prev) => ({ ...prev, source: checked ? 'feld' : 'operator' }))
              }
            />

            <DetailField label={t('common.contact')} htmlFor="contact">
              <Input
                id="contact"
                placeholder={t('common.contactPlaceholder')}
                value={formData.contact}
                onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
              />
            </DetailField>

            <DetailField label={t('common.contactPhone')} htmlFor="contact-phone">
              <Input
                id="contact-phone"
                type="tel"
                inputMode="tel"
                placeholder={t('common.contactPhonePlaceholder')}
                value={formData.contactPhone}
                onChange={(e) => setFormData({ ...formData, contactPhone: sanitizePhoneInput(e.target.value) })}
              />
            </DetailField>

            <p className="pt-3 text-xs leading-relaxed text-muted-foreground">
              {t('newEmergency.infoDragDrop')}
            </p>
        </div>

        {/* Actions — Abbrechen left, primary right, like every other dialog. */}
        <DialogFooter className="border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!formData.location}
            className="hover-delight"
          >
            <Plus className="h-4 w-4" />
            {t('newEmergency.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
