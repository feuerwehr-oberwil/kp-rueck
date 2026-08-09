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
import { FeldVehicleChecklist } from '@/components/feld/feld-vehicle-checklist'
import PhotoUpload, { type PhotoTransport } from '@/components/reko/photo-upload'
import type {
  ApiRapportMaterialRow,
  ApiRapportVehicleRow,
  ApiSchadenplatzRapport,
  ApiRapportUpdate,
} from '@/lib/api/types'
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
  /**
   * Photos, if this mount has a door for them (§6.1). The crew photographs the
   * cellar; the KP attaches the photo that arrived by WhatsApp — same storage,
   * different door, and the form knows about neither.
   *
   * Photos are NOT part of the autosaved draft: they are stored server-side the
   * moment they are taken, so a lost tab loses the typing, never the pictures.
   */
  photos?: PhotoTransport
}

interface FeldRapportFormProps {
  incidentId: string
  transport: RapportTransport
  /** Copy only — never behaviour. */
  mount?: 'feld' | 'kp'
  disabled?: boolean
  onSaved?: (rapport: ApiSchadenplatzRapport) => void
}

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
  // Deliberately its own state, seeded once from the load and never re-seeded
  // from a save response: a photo is stored the moment it is taken, so the
  // upload's own answer is the newer truth and an autosave that started before
  // it must not roll the list back.
  const [photos, setPhotos] = useState<string[]>([])
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
        setPhotos(data.photos ?? [])
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
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    if (isSubmittingRef.current || disabled) return

    // No required field and no blocking gate (decision 10): a gate during a
    // storm is a gate people defeat with empty forms. The Restliste is what
    // surfaces a thin rapport, not a dialog in the rain.
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

  /**
   * "Melder übernehmen" — one tap that PREFILLS the free text (§18.10).
   *
   * It writes the Melder's lines and stops there: an existing note is never
   * overwritten, because the crew's own words about who owns the place beat a
   * name the dispatcher took down. Melder and Eigentümer are frequently
   * different people, which is why this copies and never equates.
   */
  const takeOverMelder = () => {
    const prefill = rapport?.prefill
    if (!prefill) return
    const lines = [prefill.melder_name, prefill.melder_street, prefill.melder_city]
      .map(line => line?.trim())
      .filter((line): line is string => Boolean(line))
    if (lines.length === 0) return
    setFormData(prev => ({
      ...prev,
      owner_note: prev.owner_note.trim() ? prev.owner_note : lines.join('\n'),
    }))
  }

  const boardPersonnel = rapport?.prefill.board_personnel_count ?? 0

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

        {/* No address and no EL block here. Both mounts already state them in
            their own header — the modal's title line, and the /feld detail's
            header section with its LeaderLine — and a read-only copy of what
            is two centimetres above it is a form field that asks to be read
            and then answers nothing. */}
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
        suggestions={rapport.prefill.material_name_suggestions ?? []}
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

        {/* ONE box (§18.10). It replaced three inputs plus a "Fahrzeug
            beteiligt" reveal hiding two more — five fields of which the first
            real use filled exactly one. A crew writes "Fam. Meier, unten links,
            Tel 079 ..." and a plate underneath if there was a car; that is what
            the PDF and the xlsx want too. */}
        <Textarea
          value={formData.owner_note}
          disabled={readOnly}
          rows={4}
          maxLength={2000}
          placeholder={t('ownerPlaceholder')}
          aria-label={t('sections.owner')}
          onChange={e => update('owner_note', e.target.value)}
        />
      </section>

      {/* --------------------------------------- Mannschaft und Fahrzeuge */}
      {/* A plain confirmation of two facts, nothing else. The block used to be
          headed "Kostenpflicht" and asked for two numbers; the crew in the
          field does not decide who gets billed, and a vehicle COUNT tells
          whoever retypes it nothing that three names do not tell better. */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('sections.confirm')}</h3>

        <div className="space-y-1.5">
          <Label htmlFor="rapport-personnel" className="text-xs text-muted-foreground">
            {t('personnelCount')}
          </Label>
          <Input
            id="rapport-personnel"
            type="number"
            min={0}
            inputMode="numeric"
            className="max-w-32"
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

        <FeldVehicleChecklist
          rows={formData.vehicles}
          disabled={readOnly}
          onChange={(rows: ApiRapportVehicleRow[]) => update('vehicles', rows)}
        />
      </section>

      {/* ---------------------------------------------------------- Fotos */}
      {transport.photos && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t('sections.photos')}</h3>
          <PhotoUpload
            photos={photos}
            incidentId={incidentId}
            transport={transport.photos}
            disabled={readOnly}
            onPhotosChange={update => setPhotos(current => update(current))}
          />
        </section>
      )}

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
