"use client"

import { useTranslations } from "next-intl"
import { Axe, Building2, Phone, Timer } from 'lucide-react'
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PrioritySelect } from "@/components/kanban/priority-select"
import { DetailField, DetailFlags, DENSE_CONTROL } from "@/components/kanban/detail-field"
import { FieldSaveStatus, fieldSaveEdgeClass, useFieldSave } from "@/components/kanban/field-save-status"
import { FieldReportFlags } from "@/components/kanban/field-report-flags"
import { LocationInput } from "@/components/location/location-input"
import { type Operation, type OperationStatus } from "@/lib/contexts/operations-context"
import { columns } from "@/lib/kanban-utils"
import { telHref } from "@/lib/phone"
import { incidentTypeKeys, getIncidentTypeLabel } from "@/lib/incident-types"
import { cn, CONTACT_PHONE_MAX, sanitizePhoneInput } from "@/lib/utils"
import { detailTabLayout, type DetailLayout } from "@/components/kanban/operation-detail-tab-layout"

/** The panel's free-text fields (Meldung, Notizen) on an 18px line: with the field's 4px
 *  padding and its border, one line is exactly the panel's 28px field and every line after
 *  costs 18px – a dictated Meldung of five lines gives the laptop 10px back (hill climb r22).
 *  The label's `pt-1.5` still centres on the first line. */
const DENSE_TEXT_LINES = "leading-[18px]"

/** Whether the provenance toggles apply to this card at all.
 *
 *  Only "operator", "intake" and "feld" are an editor's to claim ("Telefonisch
 *  gemeldet" / "Vom Feld gemeldet"). A card carrying "divera" or a webhook slug
 *  came from a delivering system; offering a switch that would relabel it as a
 *  phone call — and be refused with a 422 — is worse than not offering one. A
 *  locally-created card has no `source` yet and is the operator case. */
function isEditorClaimedSource(source: string | undefined): boolean {
  return !source || source === 'operator' || source === 'intake' || source === 'feld'
}

/**
 * The save state of every free-text field on Übersicht.
 *
 * Called by `OperationDetailContent`, not by `OverviewFields`: the detail stays
 * mounted on every tab, so the fields stay watched (`watchFieldSave`) and a
 * failed save is said in the detail rather than toasted while another tab is
 * in front.
 */
export function useOverviewFieldSaves(operation: Operation) {
  // The text fields' save state (lib/field-save): what each one shows — the
  // operator's draft while one is held, so neither a reload nor a remote
  // update can replace text the server has not got — and the line under it.
  const notesSave = useFieldSave(operation.id, 'notes', operation.notes)
  const contactSave = useFieldSave(operation.id, 'contact', operation.contact)
  const contactPhoneSave = useFieldSave(operation.id, 'contactPhone', operation.contactPhone)
  const internalNotesSave = useFieldSave(operation.id, 'internalNotes', operation.internalNotes)
  const nachbarhilfeNoteSave = useFieldSave(operation.id, 'nachbarhilfeNote', operation.nachbarhilfeNote)
  const amWartenNoteSave = useFieldSave(operation.id, 'amWartenNote', operation.amWartenNote)
  return { notesSave, contactSave, contactPhoneSave, internalNotesSave, nachbarhilfeNoteSave, amWartenNoteSave }
}

/**
 * Übersicht's left column: where, what, how urgent, who reported it, the KP's
 * notes, the Merkmale and the Status row. Rendered by `OperationDetailContent`
 * as the first column of the Übersicht grid; `saves` comes from
 * `useOverviewFieldSaves`.
 */
export function OverviewFields({
  operation,
  layout,
  canEdit,
  saves,
  onUpdate,
  onChangeStatus,
}: {
  operation: Operation
  layout: DetailLayout
  canEdit: boolean
  saves: ReturnType<typeof useOverviewFieldSaves>
  onUpdate: (updates: Partial<Operation>) => void
  onChangeStatus?: (operationId: string, targetStatus: OperationStatus) => void
}) {
  const t = useTranslations('kanban')
  const { dense, sectionStep } = detailTabLayout(layout)
  const { notesSave, contactSave, contactPhoneSave, internalNotesSave, nachbarhilfeNoteSave, amWartenNoteSave } = saves

  return (
    <div className={sectionStep.fields}>
    {/* Where, what, how urgent. The fields carry their own labels, so a
        «Lage» heading over them said nothing – gone, whitespace groups. */}
    <div>
    <div>
    {/* Location - Smart Input with Geocoding. It carries its own label
        and its own map/coordinate buttons, so it lays itself out as a row
        rather than being wrapped in one. */}
    <LocationInput
      address={operation.location}
      latitude={operation.coordinates?.[0] ?? null}
      longitude={operation.coordinates?.[1] ?? null}
      disabled={!canEdit}
      geocodeInitialAddress={false}
      dense

      onAddressChange={(address) => {
        if (canEdit) onUpdate({ location: address ?? '' })
      }}
      onCoordinatesChange={(lat, lon) => {
        if (!canEdit) return
        if (lat !== null && lon !== null) {
          onUpdate({ coordinates: [lat, lon] })
        } else {
          onUpdate({ coordinates: null })
        }
      }}
    />

    {/* What came in, right under where — the same order as «Neuer
        Einsatz» (Ort, Meldung, Einsatzart, Priorität …), so the dialog and
        the detail read as one form seen twice (UX-DESKTOP-14). */}
    <DetailField
      label={t('common.meldung')}
      htmlFor="notes"
      alignStart
      footer={<FieldSaveStatus view={notesSave} onRetry={(notes) => onUpdate({ notes })} />}
    >
      <Textarea
        id="notes"
        placeholder={t('detail.meldungPlaceholder')}
        value={notesSave.value}
        disabled={!canEdit}
        aria-invalid={notesSave.failed || undefined}
        onChange={(e) => onUpdate({ notes: e.target.value })}
        // Grows with what is in it. `h-auto` is what makes that work:
        // DENSE_CONTROL's height is an explicit one, and an explicit
        // height beats the base Textarea's `field-sizing-content` — which
        // is how a dictated Meldung ended up scrolling inside five rems
        // and clipped mid-word. The floor is ONE line — an empty Meldung
        // must not reserve a void — and the max-height is where it goes
        // back to scrolling rather than pushing the form off the panel.
        className={cn(
          DENSE_CONTROL,
          // `resize-none`: the field already grows with its content
          // (`field-sizing-content`), so the corner grabber offered a second,
          // worse way to do the same thing - and on a borderless control it was
          // the only thing drawing a visible edge.
          "h-auto resize-none py-1",
          // Three lines of floor: the field must READ as a textarea, not a textbox.
          dense ? "max-h-[14rem] min-h-[3.75rem]" : "max-h-[20rem] min-h-[3.75rem]",
          dense && DENSE_TEXT_LINES,
          fieldSaveEdgeClass(notesSave),
        )}
      />
    </DetailField>

    {/* One per line, both mounts: two half-width controls sharing a row is
        how «Mittel» gets read as the Einsatzart. */}
    <>
      <DetailField label={t('common.einsatzart')} htmlFor="edit-incidentType">
        <Select
          value={operation.incidentType}
          disabled={!canEdit}
          onValueChange={(value) => onUpdate({ incidentType: value })}
        >
          <SelectTrigger className={DENSE_CONTROL} tabIndex={0}>
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

      <DetailField label={t('common.priority')} htmlFor="edit-priority">
        <PrioritySelect
          className={DENSE_CONTROL}
          tabIndex={0}
          value={operation.priority}
          disabled={!canEdit}
          onValueChange={(priority) => onUpdate({ priority })}
        />
      </DetailField>
    </>
    </div>
    </div>

    {/* Who reported it, the KP's own notes, and the flags that qualify
        the incident. Unnamed like the block above – the rows carry their
        own labels. */}
    <div>
    <div>
    {/* Contact */}
    <DetailField
      label={t('common.contact')}
      htmlFor="contact"
      footer={<FieldSaveStatus view={contactSave} onRetry={(contact) => onUpdate({ contact })} />}
    >
      <Input
        id="contact"
        placeholder={t('common.contactPlaceholder')}
        value={contactSave.value}
        disabled={!canEdit}
        aria-invalid={contactSave.failed || undefined}
        onChange={(e) => onUpdate({ contact: e.target.value })}
        className={cn(DENSE_CONTROL, fieldSaveEdgeClass(contactSave))}
      />
    </DetailField>

    {/* Contact phone */}
    <DetailField
      label={t('common.contactPhone')}
      htmlFor="contact-phone"
      footer={
        <FieldSaveStatus view={contactPhoneSave} onRetry={(contactPhone) => onUpdate({ contactPhone })} />
      }
      action={operation.contactPhone.trim() ? (
        <a
          href={telHref(operation.contactPhone) ?? undefined}
          className="relative hit-area inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-2 hover:decoration-2"
        >
          <Phone className="h-3 w-3 shrink-0" />
          {t('common.callContact')}
        </a>
      ) : undefined}
    >
      <Input
        id="contact-phone"
        type="tel"
        inputMode="tel"
        placeholder={t('common.contactPhonePlaceholder')}
        value={contactPhoneSave.value}
        maxLength={CONTACT_PHONE_MAX}
        disabled={!canEdit}
        aria-invalid={contactPhoneSave.failed || undefined}
        onChange={(e) => onUpdate({ contactPhone: sanitizePhoneInput(e.target.value) })}
        className={cn(DENSE_CONTROL, fieldSaveEdgeClass(contactPhoneSave))}
      />
    </DetailField>

    {/* Notes and the flags that qualify the incident stay in this column:
        together with the fields above they are one reading — what this
        incident IS. The other column answers who is on it. */}
    {/* Internal Notes */}
    <DetailField
      label={t('common.notes')}
      htmlFor="internalNotes"
      alignStart
      footer={
        <FieldSaveStatus view={internalNotesSave} onRetry={(internalNotes) => onUpdate({ internalNotes })} />
      }
    >
      <Textarea
        id="internalNotes"
        placeholder={t('common.internalNotesPlaceholder')}
        value={internalNotesSave.value}
        disabled={!canEdit}
        aria-invalid={internalNotesSave.failed || undefined}
        onChange={(e) => onUpdate({ internalNotes: e.target.value })}
        // Same auto-grow as «Meldung» above — see there for why `h-auto`.
        className={cn(
          DENSE_CONTROL,
          // `resize-none`: the field already grows with its content
          // (`field-sizing-content`), so the corner grabber offered a second,
          // worse way to do the same thing - and on a borderless control it was
          // the only thing drawing a visible edge.
          "h-auto resize-none py-1",
          // Three lines of floor: the field must READ as a textarea, not a textbox.
          dense ? "max-h-[14rem] min-h-[3.75rem]" : "max-h-[20rem] min-h-[3.75rem]",
          // …once it is in use. EMPTY and unfocused (its placeholder showing) it is
          // one row of the form's height (r21): most incidents have no Notizen, and
          // the three-line floor pushed «Kräfte» under the panel's footer on a
          // laptop. Focus or a first letter gives it the floor back. Height only –
          // the value, its draft and the save line under it are untouched.
          dense
            ? "placeholder-shown:not-focus:min-h-(--field-h-dense)"
            : "placeholder-shown:not-focus:min-h-(--field-h)",
          dense && DENSE_TEXT_LINES,
          fieldSaveEdgeClass(internalNotesSave),
        )}
      />
    </DetailField>

    {/* The flags stand together, last and out of the way, as ONE row of
        chips (owner pick UX-DESKTOP-14 B — the same `DetailFlags` row
        «Neuer Einsatz» ends with): they are the same kind of statement
        about the incident (how it came in, who it is for, why it waits)
        and are set only when they apply. A flag with a «warum» note gets
        it as its own row under the chips while it is on.
        "Telefonisch" / "Vom Feld" are correctable after the fact (plan 26
        decision 8): two chips over ONE source value, so turning one on
        turns the other off. A card that arrived from a delivering system
        keeps its own provenance and is not an operator's to relabel. */}
    <DetailFlags
      label={t('common.merkmale')}
      disabled={!canEdit}
      flags={[
        ...(isEditorClaimedSource(operation.source)
          ? [
              {
                key: 'intake',
                label: t('common.phoneReported'),
                description: t('common.phoneReportedDescription'),
                icon: <Phone className="h-3.5 w-3.5 shrink-0" />,
                checked: operation.source === 'intake',
                onToggle: (checked: boolean) => canEdit && onUpdate({ source: checked ? 'intake' : 'operator' }),
              },
              {
                key: 'feld',
                label: t('common.feldReported'),
                description: t('common.feldReportedDescription'),
                icon: <Axe className="h-3.5 w-3.5 shrink-0" />,
                checked: operation.source === 'feld',
                onToggle: (checked: boolean) => canEdit && onUpdate({ source: checked ? 'feld' : 'operator' }),
              },
            ]
          : []),
        {
          key: 'nachbarhilfe',
          label: t('common.nachbarhilfe'),
          description: t('detail.nachbarhilfeDescription'),
          icon: <Building2 className="h-3.5 w-3.5 shrink-0" />,
          checked: operation.nachbarhilfe || false,
          onToggle: (checked: boolean) => canEdit && onUpdate({ nachbarhilfe: checked }),
          // Save state INSIDE the field (trail / ✓ at its trailing edge) so
          // the row keeps its height while saving and after; only a failure
          // opens the line below — an error may take space (owner 02.10.).
          note: (
            <div className="relative">
              <Input
                placeholder={t('common.nachbarhilfePlaceholder')}
                aria-label={t('common.nachbarhilfe')}
                value={nachbarhilfeNoteSave.value}
                disabled={!canEdit}
                aria-invalid={nachbarhilfeNoteSave.failed || undefined}
                onChange={(e) => onUpdate({ nachbarhilfeNote: e.target.value })}
                className={cn(DENSE_CONTROL, "pr-7", fieldSaveEdgeClass(nachbarhilfeNoteSave))}
              />
              <FieldSaveStatus
                part="mark"
                view={nachbarhilfeNoteSave}
                onRetry={(nachbarhilfeNote) => onUpdate({ nachbarhilfeNote })}
                className="absolute top-1/2 right-2 -translate-y-1/2"
              />
            </div>
          ),
          footer: (
            <FieldSaveStatus
              part="failure"
              view={nachbarhilfeNoteSave}
              onRetry={(nachbarhilfeNote) => onUpdate({ nachbarhilfeNote })}
            />
          ),
        },
        {
          key: 'amWarten',
          label: t('common.amWarten'),
          description: t('common.amWartenDescription'),
          icon: <Timer className="h-3.5 w-3.5 shrink-0" />,
          checked: operation.amWarten || false,
          onToggle: (checked: boolean) => canEdit && onUpdate({ amWarten: checked }),
          note: (
            <div className="relative">
              <Input
                placeholder={t('common.amWartenPlaceholder')}
                aria-label={t('common.amWarten')}
                value={amWartenNoteSave.value}
                disabled={!canEdit}
                aria-invalid={amWartenNoteSave.failed || undefined}
                onChange={(e) => onUpdate({ amWartenNote: e.target.value })}
                className={cn(DENSE_CONTROL, "pr-7", fieldSaveEdgeClass(amWartenNoteSave))}
              />
              <FieldSaveStatus
                part="mark"
                view={amWartenNoteSave}
                onRetry={(amWartenNote) => onUpdate({ amWartenNote })}
                className="absolute top-1/2 right-2 -translate-y-1/2"
              />
            </div>
          ),
          footer: (
            <FieldSaveStatus part="failure" view={amWartenNoteSave} onRetry={(amWartenNote) => onUpdate({ amWartenNote })} />
          ),
        },
      ]}
    />

    {/* The card menu's «Reko vor Ort» / «Abholung nötig» (owner, 24.11.2026). */}
    <FieldReportFlags operation={operation} disabled={!canEdit} />

    {/* Status — a row under Merkmale like Einsatzart / Priorität (owner pick
        U11, 08.11.2026): the chip block that used to open the resources
        column pushed «Kräfte» under the laptop's footer, and the board moves
        a card by drag or `>` / `<` anyway. Options in board order with the
        column words; the pick goes through `onChangeStatus` — the board's
        `requestStatusChange`, so the dispatch gate, the Reko gate and the
        «Gerade geändert» refusal answer exactly as they did for the chips.
        Re-picking the current status is no change (Radix only reports a new
        value). Without the handler (or the right to edit) it reads, disabled. */}
    <DetailField label={t('common.status')} htmlFor="edit-status">
      <Select
        value={operation.status}
        disabled={!canEdit || !onChangeStatus}
        onValueChange={(next) => {
          const target = columns.find((col) => col.id === next)
          if (target) onChangeStatus?.(operation.id, target.id)
        }}
      >
        <SelectTrigger id="edit-status" className={DENSE_CONTROL} tabIndex={0}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {columns.map((col) => (
            <SelectItem key={col.id} value={col.id}>
              {t(`columns.${col.id}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </DetailField>

    </div>
    </div>
    </div>
  )
}
