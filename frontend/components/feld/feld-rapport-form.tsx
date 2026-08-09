'use client'

/**
 * The Schadenplatz-Rapport form (plan 25, §5.3) — **one component, two mounts**.
 *
 * `/feld` renders it for a crew with a token and a personnel id; the board's
 * incident detail renders the *same* component with a different transport and a
 * different identity (decision 28, §6.1). Not a second form: divergence here is
 * exactly how the KP path silently loses a field six months later, and KP parity
 * is the acceptance criterion for this phase, not a convenience.
 *
 * Draft handling is copied from `components/reko/reko-form.tsx`, including the
 * `isSubmittingRef` guard and its reasoning — that ref exists because the
 * autosave interval captures a stale closure and a late draft-save un-submits
 * the report. Do not re-derive that bug.
 *
 * There is no offline queue (decision 11): localStorage plus a 30 s autosave
 * survives a closed tab and a dead network *while typing*, but not a dead server
 * *at submit*. For that day the blank `fahrzeugrapport.pdf` stays in the folder
 * as the Ausfall-Variante.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Check, Copy, Loader2, Send, UserRound } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FeldMaterialChecklist } from '@/components/feld/feld-material-checklist'
import type { ApiDamageType, ApiRapportMaterialRow, ApiSchadenplatzRapport, ApiRapportUpdate } from '@/lib/api/types'
import { applyTimeEdit, toTimeInput } from '@/lib/field-time'
import { getActiveLocale } from '@/lib/i18n-messages'
import {
  EMPTY_RAPPORT_FORM,
  isCorrected,
  mergeDraft,
  toFormData,
  toUpdate,
  type RapportFormData,
} from '@/lib/rapport-draft'
import { cn } from '@/lib/utils'

/**
 * The only thing that differs between the two mounts.
 *
 * Passed in rather than branched on inside, so the form itself has no idea
 * whether it is on a phone in the rain or in the KP — and cannot grow a
 * "if (isKp)" that only one side ever tests.
 */
export interface RapportTransport {
  load: () => Promise<ApiSchadenplatzRapport>
  save: (update: ApiRapportUpdate) => Promise<ApiSchadenplatzRapport>
}

interface FeldRapportFormProps {
  incidentId: string
  transport: RapportTransport
  /** Copy only — never behaviour. */
  mount?: 'feld' | 'kp'
  disabled?: boolean
  onSaved?: (rapport: ApiSchadenplatzRapport) => void
}

const DAMAGE_TYPES: ApiDamageType[] = ['wasserschaden', 'sturmschaden', 'schneebruch', 'anderes']
const AUTOSAVE_MS = 30000

function localStorageKey(incidentId: string): string {
  return `feld-rapport-${incidentId}`
}

function formatDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(getActiveLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function FeldRapportForm({ incidentId, transport, mount = 'feld', disabled, onSaved }: FeldRapportFormProps) {
  const t = useTranslations('feld.rapport')

  const [rapport, setRapport] = useState<ApiSchadenplatzRapport | null>(null)
  const [formData, setFormData] = useState<RapportFormData>(EMPTY_RAPPORT_FORM)
  const [localStorageLoaded, setLocalStorageLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Ref mirror of the submission state: the auto-save interval captures stale
  // closures, so it must check this ref (set synchronously on submit) instead
  // of the isSubmitting state. Once a submit succeeds it stays true forever so
  // no late draft-save can un-submit the report.
  const isSubmittingRef = useRef(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [showVehicleBlock, setShowVehicleBlock] = useState(false)
  const [damageTypeMissing, setDamageTypeMissing] = useState(false)
  // A filed rapport is amendable (decision 3: one report per Schadenplatz,
  // amendable) — but it does not sit there looking like a draft, or nobody can
  // tell a finished slip from an unfinished one.
  const [amending, setAmending] = useState(false)

  const key = localStorageKey(incidentId)

  const saveToLocalStorage = useCallback(
    (data: RapportFormData) => {
      try {
        localStorage.setItem(key, JSON.stringify({ data, timestamp: new Date().toISOString() }))
      } catch (error) {
        console.error('Failed to save rapport draft locally:', error)
      }
    },
    [key],
  )

  const loadFromLocalStorage = useCallback((): { data: RapportFormData; timestamp: string | null } | null => {
    try {
      const stored = localStorage.getItem(key)
      if (!stored) return null
      const parsed = JSON.parse(stored)
      return { data: parsed.data as RapportFormData, timestamp: (parsed.timestamp as string | undefined) ?? null }
    } catch (error) {
      console.error('Failed to read rapport draft:', error)
      return null
    }
  }, [key])

  const clearLocalStorage = useCallback(() => {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.error('Failed to clear rapport draft:', error)
    }
  }, [key])

  // ------------------------------------------------------------------ load
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      setIsLoading(true)
      setLoadError(false)
      try {
        const data = await transport.load()
        if (cancelled) return
        const { form, usedLocal } = mergeDraft(data, loadFromLocalStorage())
        setRapport(data)
        setFormData(form)
        setShowVehicleBlock(Boolean(data.vehicle_plate || data.vehicle_model))
        if (usedLocal) toast.info(t('localRestored'))
        setLocalStorageLoaded(true)
      } catch (error) {
        console.error('Failed to load rapport:', error)
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    init()
    return () => {
      cancelled = true
    }
    // The transport identity changes on every render of the parent; the
    // incident is what actually decides which rapport this is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId])

  // Persist on every change, so a closed tab or a dead network loses nothing.
  useEffect(() => {
    if (!localStorageLoaded || isLoading) return
    saveToLocalStorage(formData)
  }, [formData, localStorageLoaded, isLoading, saveToLocalStorage])

  const saveDraft = useCallback(async () => {
    // Check the ref (not isSubmitting state): stale interval closures would
    // otherwise fire a draft-save mid-/post-submit and un-submit the report.
    if (isSaving || isSubmittingRef.current || isLoading || disabled) return
    setIsSaving(true)
    try {
      const saved = await transport.save(toUpdate(formData, true))
      setRapport(saved)
      setLastSaved(new Date())
      onSaved?.(saved)
    } catch (error) {
      // Background save: no toast. The crew is typing, not watching.
      console.error('Rapport auto-save failed:', error)
    } finally {
      setIsSaving(false)
    }
  }, [formData, isSaving, isLoading, disabled, transport, onSaved])

  useEffect(() => {
    if (isLoading || isSubmitting || disabled) return
    const interval = setInterval(() => {
      saveDraft()
    }, AUTOSAVE_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, isLoading, isSubmitting, disabled])

  const update = <K extends keyof RapportFormData>(field: K, value: RapportFormData[K]) => {
    if (field === 'damage_type') setDamageTypeMissing(false)
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    if (isSubmittingRef.current || disabled) return

    // Schadensart is "required-ish": submit warns ONCE if it is empty and then
    // lets it through (§4). A blocking gate during a storm is a gate people
    // defeat with empty forms.
    if (!formData.damage_type && !damageTypeMissing) {
      setDamageTypeMissing(true)
      toast.warning(t('damageTypeMissing'))
      return
    }

    isSubmittingRef.current = true
    setIsSubmitting(true)
    try {
      const saved = await transport.save(toUpdate(formData, false))
      setRapport(saved)
      setFormData(toFormData(saved))
      clearLocalStorage()
      setAmending(false)
      toast.success(t('submitted'))
      onSaved?.(saved)
      // Intentionally keep isSubmittingRef true on success so no late auto-save
      // can un-submit what was just filed.
      setIsSubmitting(false)
    } catch (error) {
      console.error('Rapport submit failed:', error)
      toast.error(t('submitError'))
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const handleReopen = () => {
    // Amending a filed rapport is normal (decision 3: one report, amendable).
    // The ref has to come back down or every later autosave would bail out.
    isSubmittingRef.current = false
    setAmending(true)
  }

  const takeOverMelder = () => {
    const prefill = rapport?.prefill
    if (!prefill) return
    setFormData(prev => ({
      ...prev,
      owner_name: prefill.melder_name ?? prev.owner_name,
      owner_street: prefill.melder_street ?? prev.owner_street,
      owner_city: prefill.melder_city ?? prev.owner_city,
    }))
  }

  const boardPersonnel = rapport?.prefill.board_personnel_count ?? 0
  const boardVehicles = rapport?.prefill.board_vehicle_count ?? 0

  const provenanceLines = useMemo(() => {
    if (!rapport) return []
    const lines: string[] = []
    if (rapport.created_by_name) {
      lines.push(
        t(rapport.created_in_kp ? 'createdInKp' : 'createdInField', {
          name: rapport.created_by_name,
          at: formatDateTime(rapport.submitted_at ?? rapport.updated_at),
        }),
      )
    }
    if (rapport.updated_by_name && rapport.updated_by_name !== rapport.created_by_name) {
      lines.push(
        t(rapport.updated_in_kp ? 'updatedInKp' : 'updatedInField', {
          name: rapport.updated_by_name,
          at: formatDateTime(rapport.updated_at),
        }),
      )
    }
    return lines
  }, [rapport, t])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (loadError || !rapport) {
    return <p className="text-sm text-destructive">{t('loadError')}</p>
  }

  const submitted = !rapport.is_draft && !amending
  const readOnly = Boolean(disabled)

  return (
    <div className="space-y-6">
      {/* Visibility, not a lock (§3): two crews on one Schadenplatz overwriting
          each other's Kurzbericht is an accepted cost, and a real lock in the
          field is worse than the problem it solves. */}
      {rapport.concurrent_editor && (
        <div className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t('concurrentEditor', {
              name: rapport.concurrent_editor.name,
              at: formatDateTime(rapport.concurrent_editor.at),
            })}
          </span>
        </div>
      )}

      {/* ------------------------------------------------ Einsatzdaten */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('sections.einsatzdaten')}</h3>

        <div className="rounded-lg bg-secondary/40 px-3 py-2 text-sm">
          <p className="text-xs text-muted-foreground">{t('address')}</p>
          {/* Read-only, orientation only: a wrong address is a board
              correction, not a rapport field. */}
          <p>{rapport.prefill.location_address || t('noAddress')}</p>
          {rapport.prefill.leader_name && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('leader', { name: rapport.prefill.leader_name })}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('damageType')}</Label>
          <div className="flex flex-wrap gap-2">
            {DAMAGE_TYPES.map(type => (
              <button
                key={type}
                type="button"
                disabled={readOnly}
                aria-pressed={formData.damage_type === type}
                onClick={() => update('damage_type', formData.damage_type === type ? null : type)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50',
                  formData.damage_type === type
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted/60',
                  damageTypeMissing && !formData.damage_type && 'border-warning',
                )}
              >
                {t(`damageTypes.${type}`)}
              </button>
            ))}
          </div>
          {formData.damage_type === 'anderes' && (
            <Input
              value={formData.damage_type_other}
              disabled={readOnly}
              placeholder={t('damageTypeOtherPlaceholder')}
              onChange={e => update('damage_type_other', e.target.value)}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rapport-start" className="text-xs text-muted-foreground">
              {t('workStarted')}
            </Label>
            <Input
              id="rapport-start"
              type="time"
              disabled={readOnly}
              value={toTimeInput(formData.work_started_at ? new Date(formData.work_started_at) : null)}
              onChange={e => {
                const next = applyTimeEdit(
                  formData.work_started_at ? new Date(formData.work_started_at) : null,
                  e.target.value,
                )
                if (next) update('work_started_at', next.toISOString())
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rapport-end" className="text-xs text-muted-foreground">
              {t('workEnded')}
            </Label>
            <Input
              id="rapport-end"
              type="time"
              disabled={readOnly}
              value={toTimeInput(formData.work_ended_at ? new Date(formData.work_ended_at) : null)}
              onChange={e => {
                const next = applyTimeEdit(
                  formData.work_ended_at ? new Date(formData.work_ended_at) : null,
                  e.target.value,
                )
                if (next) update('work_ended_at', next.toISOString())
              }}
            />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- Material */}
      <FeldMaterialChecklist
        rows={formData.materials}
        extraNote={formData.extra_material_note}
        disabled={readOnly}
        onChange={(rows: ApiRapportMaterialRow[]) => update('materials', rows)}
        onExtraNoteChange={value => update('extra_material_note', value)}
      />

      {/* ------------------------------------------------- Kurzbericht */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('sections.kurzbericht')}</h3>
        <div className="space-y-1.5">
          <Textarea
            value={formData.kurzbericht}
            disabled={readOnly}
            rows={5}
            placeholder={t('kurzberichtPlaceholder')}
            onChange={e => update('kurzbericht', e.target.value)}
          />
          {/* Dictation needs no code: every phone keyboard has a microphone
              key, and one line of hint copy is the whole feature. */}
          <p className="text-xs text-muted-foreground">{t('kurzberichtHint')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rapport-handover" className="text-xs text-muted-foreground">
            {t('handedOverTo')}
          </Label>
          <Input
            id="rapport-handover"
            value={formData.handed_over_to}
            disabled={readOnly}
            placeholder={t('handedOverToPlaceholder')}
            onChange={e => update('handed_over_to', e.target.value)}
          />
        </div>
      </section>

      {/* --------------------------------- Eigentümer-/Halterdaten */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('sections.owner')}</h3>
        {/* The first citizen PII in kp-rueck (§9): names, home addresses and
            plates of people who are not members. It lives with the incident and
            is deleted with the event; there is no second retention rule. */}
        <p className="text-xs text-muted-foreground">{t('ownerHint')}</p>

        {rapport.prefill.melder_name && (
          <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={takeOverMelder}>
            <Copy className="size-3.5" />
            {t('takeOverMelder', { name: rapport.prefill.melder_name })}
          </Button>
        )}

        <div className="space-y-2">
          <Input
            value={formData.owner_name}
            disabled={readOnly}
            placeholder={t('ownerName')}
            aria-label={t('ownerName')}
            onChange={e => update('owner_name', e.target.value)}
          />
          <Input
            value={formData.owner_street}
            disabled={readOnly}
            placeholder={t('ownerStreet')}
            aria-label={t('ownerStreet')}
            onChange={e => update('owner_street', e.target.value)}
          />
          <Input
            value={formData.owner_city}
            disabled={readOnly}
            placeholder={t('ownerCity')}
            aria-label={t('ownerCity')}
            onChange={e => update('owner_city', e.target.value)}
          />
        </div>

        {/* Hidden by default: a KFZ block is irrelevant on all but a few
            Einsätze, and an always-visible one is two more empty boxes on a
            phone in the rain. */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={showVehicleBlock}
            disabled={readOnly}
            onChange={e => setShowVehicleBlock(e.target.checked)}
          />
          {t('vehicleInvolved')}
        </label>
        {showVehicleBlock && (
          <div className="space-y-2">
            <Input
              value={formData.vehicle_plate}
              disabled={readOnly}
              placeholder={t('vehiclePlate')}
              aria-label={t('vehiclePlate')}
              onChange={e => update('vehicle_plate', e.target.value)}
            />
            <Input
              value={formData.vehicle_model}
              disabled={readOnly}
              placeholder={t('vehicleModel')}
              aria-label={t('vehicleModel')}
              onChange={e => update('vehicle_model', e.target.value)}
            />
          </div>
        )}
      </section>

      {/* ------------------------------------------------ Kostenpflicht */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('sections.kostenpflicht')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rapport-personnel" className="text-xs text-muted-foreground">
              {t('personnelCount')}
            </Label>
            <Input
              id="rapport-personnel"
              type="number"
              min={0}
              inputMode="numeric"
              disabled={readOnly}
              value={formData.personnel_count ?? ''}
              onChange={e => update('personnel_count', e.target.value === '' ? null : Number(e.target.value))}
            />
            {/* The divergence is itself information: it says the board was
                behind reality, and the export prints it as such. */}
            {isCorrected(formData.personnel_count, boardPersonnel) && (
              <p className="text-xs text-muted-foreground">{t('fromBoard', { count: boardPersonnel })}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rapport-vehicles" className="text-xs text-muted-foreground">
              {t('vehicleCount')}
            </Label>
            <Input
              id="rapport-vehicles"
              type="number"
              min={0}
              inputMode="numeric"
              disabled={readOnly}
              value={formData.vehicle_count ?? ''}
              onChange={e => update('vehicle_count', e.target.value === '' ? null : Number(e.target.value))}
            />
            {isCorrected(formData.vehicle_count, boardVehicles) && (
              <p className="text-xs text-muted-foreground">{t('fromBoard', { count: boardVehicles })}</p>
            )}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- Abschluss */}
      <div className="space-y-2">
        {provenanceLines.map(line => (
          <p key={line} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <UserRound className="h-3 w-3 shrink-0" />
            {line}
          </p>
        ))}
        {lastSaved && !submitted && (
          <p className="text-xs text-muted-foreground">
            {t('lastSaved', { at: lastSaved.toLocaleTimeString(getActiveLocale(), { hour: '2-digit', minute: '2-digit' }) })}
          </p>
        )}

        {submitted ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
              <Check className="h-3.5 w-3.5" />
              {t('submittedBadge', { at: formatDateTime(rapport.submitted_at) })}
            </span>
            {!readOnly && (
              <Button type="button" variant="outline" size="sm" onClick={handleReopen}>
                {t('amend')}
              </Button>
            )}
          </div>
        ) : (
          <Button type="button" className="w-full" disabled={readOnly || isSubmitting} onClick={handleSubmit}>
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {mount === 'kp' ? t('submitKp') : t('submit')}
          </Button>
        )}
      </div>
    </div>
  )
}
