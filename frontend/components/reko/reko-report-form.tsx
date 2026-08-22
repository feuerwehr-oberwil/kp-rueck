'use client'

/**
 * The Reko report's field set (plan 26 §5.1) — **one component, two mounts**.
 *
 * `/reko` renders it for a crew holding a per-incident form token; the board's
 * incident detail renders the *same* component with a different transport and a
 * different identity. Not a second form: divergence here is exactly how the KP
 * path silently loses a field six months later, and the whole point of this
 * phase is that a Reko report can arrive over the radio at all.
 *
 * What stays outside, in each mount's own shell: the field page's incident
 * header, its "Ich bin vor Ort" button, its localStorage draft and its 30 s
 * autosave; the board's collapse, its create-vs-amend choice and its transport.
 * What lives in here is everything an operator dictating a Reko report has to be
 * able to enter — including the "Einsatz relevant?" requirement, which is a
 * property of the report and not of the phone it was typed on.
 *
 * `photos` is optional and the block is simply absent without it. Both mounts
 * now pass one: the Reko photo endpoints take a session as well as a form token
 * (§6.1), because the picture often reaches the KP over WhatsApp rather than
 * over the form — no signal in the cellar, or a crew that will not open an app.
 */

import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Loader2, Send } from 'lucide-react'

import { DetailField, DENSE_CONTROL } from '@/components/kanban/detail-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import PhotoUpload, { type PhotoTransport } from '@/components/reko/photo-upload'
import type { ApiDangersAssessment, ApiEffortEstimation, ApiRekoReportResponse } from '@/lib/api/types'

/** The five hazards, in the order both mounts ask them. */
const DANGER_KEYS = ['fire_danger', 'explosion', 'collapse', 'chemical', 'electrical'] as const

/** The four answers to «Stromversorgung», in the order both mounts offer them. */
const POWER_OPTIONS = ['unknown', 'available', 'unavailable', 'emergency_needed'] as const

export interface RekoFormData {
  is_relevant: boolean | null
  dangers_json: ApiDangersAssessment
  effort_json: ApiEffortEstimation
  power_supply: string
  photos_json: string[]
  summary_text: string
  additional_notes: string
}

export const EMPTY_REKO_FORM: RekoFormData = {
  is_relevant: null,
  dangers_json: {
    fire: false,
    fire_danger: false,
    explosion: false,
    collapse: false,
    chemical: false,
    electrical: false,
    other_notes: '',
  },
  effort_json: {
    personnel_count: null,
    vehicles_needed: [],
    equipment_needed: [],
    estimated_duration_hours: null,
  },
  power_supply: 'unknown',
  photos_json: [],
  summary_text: '',
  additional_notes: '',
}

/** A report as the API returns it, in the shape the form edits. */
export function toRekoFormData(report: Partial<ApiRekoReportResponse> | null | undefined): RekoFormData {
  if (!report) return { ...EMPTY_REKO_FORM }
  return {
    is_relevant: report.is_relevant ?? null,
    dangers_json: report.dangers_json ?? { ...EMPTY_REKO_FORM.dangers_json },
    effort_json: report.effort_json ?? { ...EMPTY_REKO_FORM.effort_json },
    power_supply: report.power_supply || 'unknown',
    photos_json: report.photos_json ?? [],
    summary_text: report.summary_text ?? '',
    additional_notes: report.additional_notes ?? '',
  }
}

interface RekoReportFormProps {
  incidentId: string
  value: RekoFormData
  /** A React setter, so a photo upload can merge against the current list. */
  onChange: Dispatch<SetStateAction<RekoFormData>>
  /** The mount's photo door, if it has one. */
  photos?: PhotoTransport
  onSubmit: () => void | Promise<void>
  /** Copy only — never behaviour (the same rule the Rapport form follows). */
  mount?: 'feld' | 'kp'
  isSubmitting?: boolean
  /** Something else is on the wire (an autosave): the fields stay usable, the
   *  submit button does not. Kept apart from `isSubmitting` so the button never
   *  says "wird übermittelt" about a background draft save. */
  busy?: boolean
  disabled?: boolean
  /** The mount's own note under the button (autosave state, last save, …). */
  footer?: React.ReactNode
}

export function RekoReportForm({
  incidentId,
  value,
  onChange,
  photos,
  onSubmit,
  mount = 'feld',
  isSubmitting = false,
  busy = false,
  disabled = false,
  footer,
}: RekoReportFormProps) {
  const t = useTranslations('reko.form')
  const isKp = mount === 'kp'
  // The phone gets thumb-sized controls in the rain; the KP gets a column in a
  // tab and a mouse. Same fields, same order, same component — only the shape
  // differs, so the board's mount stops spending a screen and a half on eight
  // answers.
  //
  // The dense branch is not "the phone form, smaller": it is literally the
  // Übersicht's own row primitive (`DetailField` + `DENSE_CONTROL`) — 104px
  // label gutter, ~30px rows, a hairline under each one and controls that grow
  // a box only under the cursor. That is the whole point of Variante A: the
  // Reko surfaces stop being a telephone form standing in the middle of the
  // board and start reading like the tab next door.
  const dense = isKp
  const [relevantMissing, setRelevantMissing] = useState(false)

  // Local text mirror for the duration field: a controlled number input coerces
  // "0"/"0." to falsy and clears the field mid-typing, so we keep the raw string
  // and sync it back only when the stored number changes elsewhere (quick-fill).
  const [durationText, setDurationText] = useState('')
  useEffect(() => {
    const num = value.effort_json.estimated_duration_hours
    const parsed = durationText.trim() === '' ? null : parseFloat(durationText)
    if (num !== parsed && !(num === null && Number.isNaN(parsed))) {
      setDurationText(num === null || num === undefined ? '' : String(num))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.effort_json.estimated_duration_hours])

  function update<K extends keyof RekoFormData>(key: K, next: RekoFormData[K]) {
    if (key === 'is_relevant') setRelevantMissing(false)
    onChange(prev => ({ ...prev, [key]: next }))
  }

  /**
   * The duration field's keystroke handler, shared by both mounts.
   *
   * Accepts decimals like "0.5" (and a German "0,5") and keeps the RAW text, so
   * a leading "0" — or a lone "0." mid-typing — survives instead of being
   * coerced away by the controlled number value.
   */
  function setDuration(input: string) {
    let raw = input.replace(',', '.').replace(/[^\d.]/g, '')
    const dot = raw.indexOf('.')
    if (dot !== -1) raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, '')
    setDurationText(raw)
    const parsed = raw === '' || raw === '.' ? null : parseFloat(raw)
    update('effort_json', {
      ...value.effort_json,
      estimated_duration_hours: parsed !== null && !Number.isNaN(parsed) ? parsed : null,
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // The one required answer, on both mounts: a Reko report that does not say
    // whether the incident is relevant has not answered the question it was
    // sent to answer.
    if (value.is_relevant === null) {
      setRelevantMissing(true)
      return
    }
    await onSubmit()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // The board's mount: the same questions as `DetailField` rows.
  //
  // Reading and writing share one grid now — a value and the control that
  // edits it stand at the same x, so amending over the radio does not move the
  // page under the operator. The submit is a normal `xs` action at the bottom
  // right instead of a full-width 44px bar, which was the last piece of
  // telephone vocabulary standing in the middle of the tab.
  // ─────────────────────────────────────────────────────────────────────────
  if (dense) {
    return (
      <form onSubmit={handleSubmit}>
        <DetailField label={t('relevantQuestion')}>
          <div className="flex flex-wrap items-center gap-2">
            {/* One two-way switch, not two actions. The pair used to be two
                separate buttons, which is what a phone form does when it has
                the width for it. */}
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {([true, false] as const).map((answer, index) => {
                const selected = value.is_relevant === answer
                return (
                  <button
                    key={String(answer)}
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => update('is_relevant', answer)}
                    className={cn(
                      "cursor-pointer px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      index > 0 && "border-l border-border",
                      selected
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "text-muted-foreground hover:bg-input/50",
                    )}
                  >
                    {answer ? t('yes') : t('no')}
                  </button>
                )
              })}
            </div>
            <span className="text-xs text-destructive" aria-hidden="true">*</span>
            {/* The required error sits ON the row it is about — a row list has
                no second line under a field to put it on. */}
            {relevantMissing && <span className="text-xs text-destructive">{t('relevantRequired')}</span>}
          </div>
        </DetailField>

        <DetailField label={t('dangers')} htmlFor="danger-other" alignStart>
          <div className="space-y-1">
            {/* Five toggle marks, not five 44px tiles: with a mouse the target
                is the word, and the row keeps the height of one line. */}
            <div className="flex flex-wrap gap-1">
              {DANGER_KEYS.map(key => {
                const on = value.dangers_json[key]
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    onClick={() => update('dangers_json', { ...value.dangers_json, [key]: !on })}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      on
                        ? "border-warning/45 bg-warning/15 text-warning-foreground"
                        : "border-border text-muted-foreground hover:bg-input/50",
                    )}
                  >
                    {on && <Check className="size-3" />}
                    {t(`dangerLabels.${key}`)}
                  </button>
                )
              })}
            </div>
            <Textarea
              id="danger-other"
              value={value.dangers_json.other_notes || ''}
              disabled={disabled}
              onChange={e => update('dangers_json', { ...value.dangers_json, other_notes: e.target.value })}
              placeholder={t('otherDangers')}
              // Same auto-grow rule the Übersicht's Meldung uses: DENSE_CONTROL
              // sets an explicit `h-7`, and only `h-auto` lets the box follow
              // what is typed into it.
              className={cn(DENSE_CONTROL, "h-auto min-h-7 py-1 text-sm")}
              rows={1}
            />
          </div>
        </DetailField>

        {/* «Aufwand» as a heading is gone here: it grouped two questions that
            each fit on their own row, and the row labels already say what they
            ask. The phone keeps the grouping, where the two fields share a
            line. */}
        <DetailField label={t('personnelCount')} htmlFor="personnel-count">
          <Input
            id="personnel-count"
            type="number"
            inputMode="numeric"
            min="0"
            disabled={disabled}
            value={value.effort_json.personnel_count ?? ''}
            onChange={e =>
              update('effort_json', {
                ...value.effort_json,
                personnel_count: e.target.value ? parseInt(e.target.value) : null,
              })
            }
            placeholder={t('personnelPlaceholder')}
            // `w-24`, not `w-20`: at 80px the «z. B. 10» placeholder was cut
            // off mid-character, which reads as a broken field rather than a
            // hint. The number itself never needs the room — the hint does.
            className={cn(DENSE_CONTROL, "w-24")}
          />
        </DetailField>

        <DetailField label={t('duration')} htmlFor="duration">
          <Input
            id="duration"
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={durationText}
            onChange={e => setDuration(e.target.value)}
            placeholder={t('durationPlaceholder')}
            // Same width as its neighbour — the two read as one pair.
            className={cn(DENSE_CONTROL, "w-24")}
          />
        </DetailField>

        <DetailField label={t('powerSupply')} htmlFor="power-supply">
          {/* Four thumb-sized buttons on the phone, one borderless select on
              the board: a mouse does not need a 44px target for a four-way
              choice, and the tab is not the place to spend two rows on it. */}
          <Select
            value={value.power_supply}
            disabled={disabled}
            onValueChange={option => update('power_supply', option)}
          >
            <SelectTrigger id="power-supply" className={cn(DENSE_CONTROL, "w-auto min-w-[10rem] text-sm")} tabIndex={0}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POWER_OPTIONS.map(option => (
                <SelectItem key={option} value={option}>{t(`powerLabels.${option}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DetailField>

        <DetailField label={t('summary')} htmlFor="summary" alignStart>
          <Textarea
            id="summary"
            value={value.summary_text}
            disabled={disabled}
            onChange={e => update('summary_text', e.target.value)}
            placeholder={t('summaryPlaceholder')}
            className={cn(DENSE_CONTROL, "h-auto max-h-[14rem] min-h-[3rem] py-1 text-sm")}
            rows={2}
          />
        </DetailField>

        <DetailField label={t('notesShort')} htmlFor="notes" alignStart>
          <Textarea
            id="notes"
            value={value.additional_notes}
            disabled={disabled}
            onChange={e => update('additional_notes', e.target.value)}
            placeholder={t('notesPlaceholder')}
            className={cn(DENSE_CONTROL, "h-auto max-h-[14rem] min-h-7 py-1 text-sm")}
            rows={1}
          />
        </DetailField>

        {photos && (
          // The «was das Feld FÜR ist»-sentence — pictures that came in over
          // WhatsApp, not the operator taking them — is the label's hover hint
          // now. A row has no second line for a sentence.
          <DetailField label={t('photos')} description={t('photosKpHint')} alignStart>
            <PhotoUpload
              photos={value.photos_json}
              incidentId={incidentId}
              transport={photos}
              disabled={disabled}
              dense
              onPhotosChange={updater => onChange(prev => ({ ...prev, photos_json: updater(prev.photos_json) }))}
            />
          </DetailField>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          {footer}
          <Button type="submit" size="xs" disabled={disabled || isSubmitting || busy}>
            {isSubmitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {t('submittingKp')}
              </>
            ) : (
              <>
                <Send className="size-3.5" />
                {t('submitKp')}
              </>
            )}
          </Button>
        </div>
      </form>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // The field mount: thumb targets, one question per block, in the rain.
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Section 1: Basic Confirmation */}
      <div className="space-y-3">
        <div className="flex items-center gap-1">
          <Label className="text-sm font-medium tracking-wide text-muted-foreground">
            {t('relevantQuestion')}
          </Label>
          <span className="text-destructive" aria-hidden="true">*</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant={value.is_relevant === true ? 'default' : 'outline'}
            onClick={() => update('is_relevant', true)}
            disabled={disabled}
            size="lg"
            className="text-base"
          >
            {t('yes')}
          </Button>
          <Button
            type="button"
            variant={value.is_relevant === false ? 'default' : 'outline'}
            onClick={() => update('is_relevant', false)}
            disabled={disabled}
            size="lg"
            className="text-base"
          >
            {t('no')}
          </Button>
        </div>
        {relevantMissing && <p className="text-xs text-destructive">{t('relevantRequired')}</p>}
      </div>

      <Separator />

      {/* Section 2: Dangers Assessment */}
      <div className="space-y-3">
        <Label className="text-sm font-medium tracking-wide text-muted-foreground">
          {t('dangers')}
        </Label>

        <div className="space-y-2">
          {DANGER_KEYS.map(key => (
            <label
              key={key}
              htmlFor={`danger-${key}`}
              className="flex cursor-pointer items-center gap-3 rounded-lg bg-secondary/50 p-3 transition-colors hover:bg-secondary"
            >
              <Checkbox
                id={`danger-${key}`}
                checked={value.dangers_json[key]}
                disabled={disabled}
                onCheckedChange={checked =>
                  update('dangers_json', { ...value.dangers_json, [key]: checked === true })
                }
                className="h-5 w-5"
              />
              <span className="text-sm">{t(`dangerLabels.${key}`)}</span>
            </label>
          ))}
        </div>

        <div className="pt-2">
          <Label htmlFor="danger-other" className="mb-1.5 block text-sm font-semibold text-muted-foreground">
            {t('otherDangers')}
          </Label>
          <Textarea
            id="danger-other"
            value={value.dangers_json.other_notes || ''}
            disabled={disabled}
            onChange={e => update('dangers_json', { ...value.dangers_json, other_notes: e.target.value })}
            placeholder={t('otherDangersPlaceholder')}
            rows={2}
          />
        </div>
      </div>

      <Separator />

      {/* Section 3: Effort Assessment */}
      <div className="space-y-3">
        <Label className="text-sm font-medium tracking-wide text-muted-foreground">
          {t('effort')}
        </Label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="personnel-count" className="mb-1.5 block text-sm font-semibold text-muted-foreground">
              {t('personnelCount')}
            </Label>
            <Input
              id="personnel-count"
              type="number"
              inputMode="numeric"
              min="0"
              disabled={disabled}
              value={value.effort_json.personnel_count ?? ''}
              onChange={e =>
                update('effort_json', {
                  ...value.effort_json,
                  personnel_count: e.target.value ? parseInt(e.target.value) : null,
                })
              }
              placeholder={t('personnelPlaceholder')}
              className="h-11"
            />
          </div>

          <div>
            <Label htmlFor="duration" className="mb-1.5 block text-sm font-semibold text-muted-foreground">
              {t('duration')}
            </Label>
            <Input
              id="duration"
              type="text"
              inputMode="decimal"
              disabled={disabled}
              value={durationText}
              onChange={e => setDuration(e.target.value)}
              placeholder={t('durationPlaceholder')}
              className="h-11"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Section 4: Power Supply */}
      <div className="space-y-3">
        <Label className="text-sm font-medium tracking-wide text-muted-foreground">
          {t('powerSupply')}
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {POWER_OPTIONS.map(option => (
            <Button
              key={option}
              type="button"
              variant={value.power_supply === option ? 'default' : 'outline'}
              onClick={() => update('power_supply', option)}
              disabled={disabled}
              className="text-sm"
            >
              {t(`powerLabels.${option}`)}
            </Button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Summary */}
      <div className="space-y-3">
        <Label className="text-sm font-medium tracking-wide text-muted-foreground">{t('summary')}</Label>

        <div>
          <Label htmlFor="summary" className="mb-1.5 block text-sm font-semibold text-muted-foreground">
            {t('summaryShort')}
          </Label>
          <Textarea
            id="summary"
            value={value.summary_text}
            disabled={disabled}
            onChange={e => update('summary_text', e.target.value)}
            placeholder={t('summaryPlaceholder')}
            rows={3}
          />
        </div>

        <div>
          <Label htmlFor="notes" className="mb-1.5 block text-sm font-semibold text-muted-foreground">
            {t('notes')}
          </Label>
          <Textarea
            id="notes"
            value={value.additional_notes}
            disabled={disabled}
            onChange={e => update('additional_notes', e.target.value)}
            placeholder={t('notesPlaceholder')}
            rows={2}
          />
        </div>
      </div>

      {photos && (
        <>
          <Separator />

          <div className="space-y-3">
            <Label className="text-sm font-medium tracking-wide text-muted-foreground">
              {t('photos')}
            </Label>
            <PhotoUpload
              photos={value.photos_json}
              incidentId={incidentId}
              transport={photos}
              disabled={disabled}
              onPhotosChange={updater => onChange(prev => ({ ...prev, photos_json: updater(prev.photos_json) }))}
            />
          </div>
        </>
      )}

      {/* Action */}
      <div className="space-y-3 pt-4">
        <Button type="submit" disabled={disabled || isSubmitting || busy} className="h-14 w-full" size="lg">
          {isSubmitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {t('submitting')}
            </>
          ) : (
            <>
              <Send className="h-5 w-5" />
              {t('submit')}
            </>
          )}
        </Button>

        {footer}
      </div>
    </form>
  )
}
