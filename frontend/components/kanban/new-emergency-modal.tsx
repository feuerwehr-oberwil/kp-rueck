"use client"

/**
 * NewEmergencyModal Component
 *
 * SYNC NOTE: This component uses the shared LocationInput component
 * (components/location/location-input.tsx) for location entry.
 * Any changes to location input behavior should be made in that component.
 *
 * LAYOUT: the same `DetailField` rows the incident detail is built from —
 * `Beschriftung │ Wert` on one line, a single column top to bottom. The stacked
 * original spent ~880px saying the same thing (a label above every control, a
 * sentence under every switch, a scrollbar for the trouble); a two-column pass
 * in between made the eye jump mid-form.
 *
 * Unlike the side panel, the controls here are BOXED. The panel's borderless
 * skin (`DENSE_CONTROL`) works because an existing incident fills every row
 * with a value; in a creation dialog every field is empty at open, and a
 * borderless empty input has no affordance at all — the Einsatzort row read as
 * three bare icons. Rows carry no hairlines anywhere since the «Nur Abstand»
 * pick — the boxes and the whitespace do the separating. Same grammar,
 * different skin.
 *
 * MESSAGES (#21): what is wrong is said UNDER the field, never in a toast and
 * never by greying the button out. Red blocks (no Einsatzort), amber advises (a
 * phone number with a digit count no Swiss number has) and lets the operator
 * create anyway. «Einsatz erstellen» stays pressable: a press with the Ort
 * missing shows the reason and puts the cursor into the field — the old
 * disabled button said nothing, and its error only appeared after the field had
 * been filled and emptied again.
 *
 * ON A PHONE the rows stack (DetailField does that by itself below 768px, see
 * `useStackedFields`): label above, control full width, switches label-left /
 * switch-right — the grammar of every other phone form. The row's 120px
 * label column left a 390px phone ~200px of control and read as a table. A field's
 * message then sits full width under its control as well.
 *
 * DUPLICATES (R2): while the Einsatzort is typed the server is asked for open
 * cards of this Ereignis within 50 m or at the same street + number. A match is
 * said UNDER the Einsatzort, amber like every other advice: «Möglicherweise
 * dasselbe wie …» with «Zusammenführen» (the report becomes a Nachtrag on that
 * card, no new card, undo on the toast and in the card's Verlauf) and «Trotzdem
 * neu» (puts the hint away). It never blocks «Einsatz erstellen».
 */

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { sanitizePhoneInput } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/components/ui/use-mobile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DETAIL_MESSAGE_INDENT, DetailField, DetailToggle } from "@/components/kanban/detail-field"
import { Axe, Phone, Plus } from 'lucide-react'
import { type Operation, type OperationStatus } from "@/lib/contexts/operations-context"
import { incidentTypeKeys, getIncidentTypeLabel } from "@/lib/incident-types"
import { LocationInput } from "@/components/location/location-input"
import {
  FIELD_ADVICE_CLASS,
  FormMessage,
  fieldMessageProps,
  focusFirstBlockingField,
  formMessageId,
} from "@/components/ui/form-message"
import { phoneAdvice } from "@/lib/phone-plausibility"
import { cn } from "@/lib/utils"
import { apiClient, type ApiDuplicateCandidate } from "@/lib/api-client"
import { useDuplicateCandidates } from "@/lib/hooks/use-duplicate-candidates"
import { DuplicateHint } from "@/components/duplicates/duplicate-hint"

/** LocationInput's own input id — the field a blocked submit focuses. */
const LOCATION_FIELD_ID = "location_address"
const PHONE_FIELD_ID = "contact-phone"

interface NewEmergencyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateOperation: (operation: Omit<Operation, "id" | "dispatchTime">) => void
  /** When set, the created incident is attached to this Auftrag (streamlined "+ Stop"). */
  defaultGroupId?: string | null
  /** The Ereignis the card goes into — what the duplicate lookup is scoped to. */
  eventId?: string | null
  /** «Zusammenführen»: the typed report goes into that card instead of a new one.
   *  Absent (a viewer, or a test) = no duplicate lookup at all. */
  onMergeInto?: (operation: Omit<Operation, "id" | "dispatchTime">, targetId: string) => Promise<boolean>
}

export function NewEmergencyModal({
  open,
  onOpenChange,
  onCreateOperation,
  defaultGroupId = null,
  eventId = null,
  onMergeInto,
}: NewEmergencyModalProps) {
  const t = useTranslations('kanban')
  const isMobile = useIsMobile()
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
    // "Telefonisch" / "Vom Feld" — off by default, because
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
  // Advice only once the operator has left the field (or tried to create) —
  // «079 1» is not a wrong number, it is a number being typed.
  const phone = phoneAdvice(formData.contactPhone)
  const showPhoneAdvice = !!phone && (touched.contactPhone || showValidationErrors)

  const handleSubmit = () => {
    // Show every message there is, then refuse only on the blocking ones —
    // the phone advice is said, never waited on.
    setShowValidationErrors(true)

    if (!isLocationValid) {
      focusFirstBlockingField([LOCATION_FIELD_ID])
      return
    }

    onCreateOperation(formData)
    resetAndClose()
  }

  const resetAndClose = () => {
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
    setDismissedKey(null)

    onOpenChange(false)
  }

  // «Möglicherweise dasselbe wie …» — see the header. Asked only for an editor
  // with an Ereignis, and only once there is something to compare.
  const lookup = open && eventId && onMergeInto
    ? {
        eventId,
        lat: formData.coordinates?.[0] ?? null,
        lng: formData.coordinates?.[1] ?? null,
        address: formData.location,
      }
    : null
  const { candidates, key: duplicateKey } = useDuplicateCandidates(lookup, (q) =>
    apiClient.getDuplicateCandidates({ eventId: q.eventId!, lat: q.lat, lng: q.lng, address: q.address }),
  )
  // «Trotzdem neu» answers for THIS address; typing another one asks again.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const [mergingId, setMergingId] = useState<string | null>(null)
  const shownCandidates = duplicateKey !== null && duplicateKey !== dismissedKey ? candidates : []

  const handleMerge = async (candidate: ApiDuplicateCandidate) => {
    if (!onMergeInto) return
    setMergingId(candidate.id)
    try {
      if (await onMergeInto(formData, candidate.id)) resetAndClose()
    } finally {
      setMergingId(null)
    }
  }


  // The form itself — the same rows in both shapes below.
  const fields = (
    <>
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
              // phone: LocationInput's own stacked layout (label above), the /feld one
              dense={!isMobile}
              boxed
              required
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
              // Desktop: straight into the Einsatzort. Phone: no keyboard until a field is
              // tapped — the sheet itself does not focus a field either (ui/sheet.tsx).
              autoFocus={open && !isMobile}
              error={showLocationError}
              describedBy={showLocationError ? formMessageId(LOCATION_FIELD_ID) : undefined}
            />
            {showLocationError && (
              <FormMessage
                id={formMessageId(LOCATION_FIELD_ID)}
                tone="error"
                className={isMobile ? "mt-1" : cn("mb-1", DETAIL_MESSAGE_INDENT)}
              >
                {t('newEmergency.locationError')}
              </FormMessage>
            )}
            <DuplicateHint
              candidates={shownCandidates}
              origin={formData.coordinates ? { lat: formData.coordinates[0], lng: formData.coordinates[1] } : null}
              onMerge={handleMerge}
              onDismiss={() => setDismissedKey(duplicateKey)}
              mergingId={mergingId}
              showSketch={!isMobile}
              density={isMobile ? "touch" : "dense"}
              // The value column, not the label column: margin, so the amber box
              // starts where the fields start (DETAIL_MESSAGE_INDENT is padding).
              className={isMobile ? "my-2" : "my-2 sm:ml-[128px]"}
            />

            <DetailField label={t('common.meldung')} htmlFor="notes" alignStart>
              <Textarea
                id="notes"
                placeholder={t('common.meldungPlaceholder')}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                // Free text about the incident: no contact card, no address book.
                autoComplete="off"
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
                // The Melder is somebody else: never offer the operator's own contact card.
                autoComplete="off"
                enterKeyHint="next"
              />
            </DetailField>

            <DetailField
              label={t('common.contactPhone')}
              htmlFor={PHONE_FIELD_ID}
             
              advice={
                showPhoneAdvice && phone
                  ? t(phone.kind === 'short' ? 'newEmergency.phoneShort' : 'newEmergency.phoneLong', { digits: phone.digits })
                  : undefined
              }
            >
              <Input
                id={PHONE_FIELD_ID}
                type="tel"
                inputMode="tel"
                // the Melder's number, not the operator's own
                autoComplete="off"
                enterKeyHint="done"
                placeholder={t('common.contactPhonePlaceholder')}
                value={formData.contactPhone}
                onChange={(e) => setFormData({ ...formData, contactPhone: sanitizePhoneInput(e.target.value) })}
                onBlur={() => setTouched((prev) => ({ ...prev, contactPhone: true }))}
                className={cn(showPhoneAdvice && FIELD_ADVICE_CLASS)}
                {...fieldMessageProps(PHONE_FIELD_ID, showPhoneAdvice ? 'advice' : null)}
              />
            </DetailField>

            <p className="pt-3 text-xs leading-relaxed text-muted-foreground">
              {t('newEmergency.infoDragDrop')}
            </p>
        </div>

    </>
  )

  const cancelButton = (
    <Button variant="outline" onClick={() => onOpenChange(false)}>
      {t('common.cancel')}
    </Button>
  )
  // Never disabled for a missing Ort: the press is how the operator finds out
  // what is missing (see the header).
  const createButton = (
    <Button
      onClick={handleSubmit}
      className="hover-delight"
    >
      <Plus className="h-4 w-4" />
      {t('newEmergency.create')}
    </Button>
  )

  // PHONE: a bottom sheet standing on the keyboard's edge (ui/sheet.tsx → `--kb-inset`), the
  // rows in their own scroll area and «Abbrechen» / «Einsatz erstellen» in a footer that stays
  // above the keys. The centred 90vh dialog this replaces kept its buttons — and with the
  // autofocused Einsatzort, the keyboard — at the bottom of the whole screen: whoever wanted to
  // create the Einsatz had to put the keyboard away first. Swiping it down closes it like the
  // ✕ does; what was typed stays in this component's state for the next open, as before.
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="modal-h-tall gap-0 rounded-t-2xl">
          {/* While typing, the head is as short as it can be: the band above the keys is
              ~350px on an iPhone, and the sentence under the title is the one thing in it
              nobody needs at that moment. */}
          <SheetHeader className="px-4 pt-5 pb-2 pr-12 [:root[data-kb]_&]:pb-1">
            <div className="flex items-center gap-3">
              <Plus className="h-6 w-6 text-primary" />
              <SheetTitle className="text-lg leading-none">{t('common.newIncident')}</SheetTitle>
            </div>
            <SheetDescription className="[:root[data-kb]_&]:sr-only">{t('newEmergency.description')}</SheetDescription>
          </SheetHeader>
          <SheetBody className="px-4">{fields}</SheetBody>
          <SheetFooter className="mt-0 flex-row gap-2 border-t px-4 pt-3 pb-sheet-safe [&>*]:min-h-11 [&>*]:flex-1">
            {cancelButton}
            {createButton}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
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

        {fields}

        {/* Actions — Abbrechen left, primary right, like every other dialog. */}
        <DialogFooter className="pt-1">
          {cancelButton}
          {createButton}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
