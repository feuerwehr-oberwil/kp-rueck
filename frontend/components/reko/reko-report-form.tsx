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
import { Loader2, Send } from 'lucide-react'

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
  // tab and a mouse. Same fields, same order, same component — only the scale
  // differs, so the board's mount stops spending a screen and a half on eight
  // answers. See components/kanban/detail-field.tsx for the same reasoning.
  // Dense rows carry NO rules between them (image #15): the fixed label column
  // is what aligns the form, and a border under every row was four heavy lines
  // saying nothing the whitespace does not.
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

  return (
    <form onSubmit={handleSubmit} className={cn(dense ? "space-y-3" : "space-y-5")}>
      {/* Section 1: Basic Confirmation */}
      <div className={cn(dense ? "flex items-center gap-2" : "space-y-3")}>
        <div className={cn("flex items-center gap-1", dense && "w-[104px] shrink-0")}>
          <Label className={cn(
            "text-muted-foreground",
            dense ? "text-xs font-normal" : "text-sm font-medium tracking-wide",
          )}>
            {t('relevantQuestion')}
          </Label>
          <span className="text-destructive" aria-hidden="true">*</span>
        </div>
        <div className={cn(dense ? "flex gap-1.5" : "grid grid-cols-2 gap-3")}>
          <Button
            type="button"
            variant={value.is_relevant === true ? 'default' : 'outline'}
            onClick={() => update('is_relevant', true)}
            disabled={disabled}
            size={dense ? "sm" : "lg"}
            className={cn(!dense && "text-base")}
          >
            {t('yes')}
          </Button>
          <Button
            type="button"
            variant={value.is_relevant === false ? 'default' : 'outline'}
            onClick={() => update('is_relevant', false)}
            disabled={disabled}
            size={dense ? "sm" : "lg"}
            className={cn(!dense && "text-base")}
          >
            {t('no')}
          </Button>
        </div>
        {relevantMissing && <p className="text-xs text-destructive">{t('relevantRequired')}</p>}
      </div>

      {!dense && <Separator />}

      {/* Section 2: Dangers Assessment */}
      <div className={cn(dense ? "flex items-start gap-2" : "space-y-3")}>
        <Label className={cn(
          "text-muted-foreground",
          dense ? "w-[104px] shrink-0 pt-1 text-xs font-normal" : "text-sm font-medium tracking-wide",
        )}>
          {t('dangers')}
        </Label>
        <div className={cn(dense && "min-w-0 flex-1 space-y-1")}>

        <div className={cn(dense ? "grid grid-cols-2 gap-x-2 gap-y-0.5" : "space-y-2")}>
          {(['fire_danger', 'explosion', 'collapse', 'chemical', 'electrical'] as const).map(key => (
            <label
              key={key}
              htmlFor={`danger-${key}`}
              className={cn(
                "flex cursor-pointer items-center transition-colors",
                dense
                  ? "gap-2 rounded-md px-1.5 py-1 hover:bg-secondary/60"
                  : "gap-3 rounded-lg bg-secondary/50 p-3 hover:bg-secondary",
              )}
            >
              <Checkbox
                id={`danger-${key}`}
                checked={value.dangers_json[key as keyof ApiDangersAssessment] as boolean}
                disabled={disabled}
                onCheckedChange={checked =>
                  update('dangers_json', { ...value.dangers_json, [key]: checked === true })
                }
                className={cn(dense ? "h-4 w-4" : "h-5 w-5")}
              />
              <span className="text-sm">{t(`dangerLabels.${key}`)}</span>
            </label>
          ))}
        </div>

        <div className={cn(!dense && "pt-2")}>
          {!dense && (
            <Label htmlFor="danger-other" className="text-sm font-semibold text-muted-foreground mb-1.5 block">
              {t('otherDangers')}
            </Label>
          )}
          <Textarea
            id="danger-other"
            value={value.dangers_json.other_notes || ''}
            disabled={disabled}
            onChange={e => update('dangers_json', { ...value.dangers_json, other_notes: e.target.value })}
            placeholder={dense ? t('otherDangers') : t('otherDangersPlaceholder')}
            rows={2}
            className={cn(dense && "min-h-[2.5rem] py-1 text-sm")}
          />
        </div>
        </div>
      </div>

      {!dense && <Separator />}

      {/* Section 3: Effort Assessment */}
      <div className={cn(dense ? "flex items-center gap-2" : "space-y-3")}>
        <Label className={cn(
          "text-muted-foreground",
          dense ? "w-[104px] shrink-0 text-xs font-normal" : "text-sm font-medium tracking-wide",
        )}>
          {t('effort')}
        </Label>

        {/* Wraps rather than overflows. Both labels are `whitespace-nowrap` and
            both inputs are a fixed width, so the row is ~380px of unshrinkable
            content — more than the board's 420px side panel has left after its
            padding and the «Aufwand» gutter. Without the wrap the second field
            simply ran off the panel's edge. In the modal, which is wider, it
            still sits on one line. */}
        <div className={cn(dense ? "flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5" : "grid grid-cols-2 gap-3")}>
          <div className={cn(dense && "flex items-center gap-1.5")}>
            <Label htmlFor="personnel-count" className={cn(
              "text-muted-foreground",
              dense ? "text-xs font-normal whitespace-nowrap" : "text-sm font-semibold mb-1.5 block",
            )}>
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
              className={cn(dense ? "h-7 w-20" : "h-11")}
            />
          </div>

          <div className={cn(dense && "flex items-center gap-1.5")}>
            <Label htmlFor="duration" className={cn(
              "text-muted-foreground",
              dense ? "text-xs font-normal whitespace-nowrap" : "text-sm font-semibold mb-1.5 block",
            )}>
              {t('duration')}
            </Label>
            <Input
              id="duration"
              type="text"
              inputMode="decimal"
              disabled={disabled}
              value={durationText}
              onChange={e => {
                // Accept decimals like "0.5"; keep the raw text so a leading "0"
                // (or a lone "0.") survives instead of being coerced away.
                let raw = e.target.value.replace(',', '.').replace(/[^\d.]/g, '')
                const dot = raw.indexOf('.')
                if (dot !== -1) raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, '')
                setDurationText(raw)
                const parsed = raw === '' || raw === '.' ? null : parseFloat(raw)
                update('effort_json', {
                  ...value.effort_json,
                  estimated_duration_hours: parsed !== null && !Number.isNaN(parsed) ? parsed : null,
                })
              }}
              placeholder={t('durationPlaceholder')}
              className={cn(dense ? "h-7 w-20" : "h-11")}
            />
          </div>
        </div>
      </div>

      {!dense && <Separator />}

      {/* Section 4: Power Supply */}
      <div className={cn(dense ? "flex items-center gap-2" : "space-y-3")}>
        <Label className={cn(
          "text-muted-foreground",
          dense ? "w-[104px] shrink-0 text-xs font-normal" : "text-sm font-medium tracking-wide",
        )}>
          {t('powerSupply')}
        </Label>
        {/* Four thumb-sized buttons on the phone, one narrow select on the
            board: a mouse does not need a 44px target for a four-way choice,
            and the modal is not the place to spend two rows on it. */}
        {dense ? (
          <Select
            value={value.power_supply}
            disabled={disabled}
            onValueChange={option => update('power_supply', option)}
          >
            <SelectTrigger className="h-7 w-auto min-w-[10rem] border-0 bg-transparent px-1 text-sm shadow-none hover:bg-input/50 focus-visible:bg-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['unknown', 'available', 'unavailable', 'emergency_needed'] as const).map(option => (
                <SelectItem key={option} value={option}>{t(`powerLabels.${option}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
        <div className="grid grid-cols-2 gap-2">
          {(['unknown', 'available', 'unavailable', 'emergency_needed'] as const).map(option => (
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
        )}
      </div>

      {!dense && <Separator />}

      {/* Summary */}
      <div className={cn(dense ? "space-y-1 pt-1" : "space-y-3")}>
        {!dense && (
          <Label className="text-sm font-medium text-muted-foreground tracking-wide">{t('summary')}</Label>
        )}

        <div>
          <Label htmlFor="summary" className={cn(
            "text-muted-foreground block",
            dense ? "text-xs font-normal mb-0.5" : "text-sm font-semibold mb-1.5",
          )}>
            {dense ? t('summary') : t('summaryShort')}
          </Label>
          <Textarea
            id="summary"
            value={value.summary_text}
            disabled={disabled}
            onChange={e => update('summary_text', e.target.value)}
            placeholder={t('summaryPlaceholder')}
            rows={dense ? 2 : 3}
            className={cn(dense && "text-sm")}
          />
        </div>

        <div>
          <Label htmlFor="notes" className={cn(
            "text-muted-foreground block",
            dense ? "text-xs font-normal mb-0.5" : "text-sm font-semibold mb-1.5",
          )}>
            {t('notes')}
          </Label>
          <Textarea
            id="notes"
            value={value.additional_notes}
            disabled={disabled}
            onChange={e => update('additional_notes', e.target.value)}
            placeholder={t('notesPlaceholder')}
            rows={2}
            className={cn(dense && "text-sm")}
          />
        </div>
      </div>

      {photos && (
        <>
          {!dense && <Separator />}

          <div className={cn(dense ? "space-y-1 pt-1" : "space-y-3")}>
            <Label className={cn(
              "text-muted-foreground",
              dense ? "text-xs font-normal" : "text-sm font-medium tracking-wide",
            )}>
              {t('photos')}
            </Label>
            {/* Says what this box is FOR on the board: not the operator taking
                pictures, but the ones that arrived over WhatsApp. */}
            {isKp && <p className="text-xs text-muted-foreground">{t('photosKpHint')}</p>}
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
      <div className={cn("space-y-3", dense ? "pt-2" : "pt-4")}>
        <Button type="submit" disabled={disabled || isSubmitting || busy} className={isKp ? 'w-full' : 'w-full h-14'} size="lg">
          {isSubmitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {isKp ? t('submittingKp') : t('submitting')}
            </>
          ) : (
            <>
              <Send className="h-5 w-5" />
              {isKp ? t('submitKp') : t('submit')}
            </>
          )}
        </Button>

        {footer}
      </div>
    </form>
  )
}
