'use client'

import { formatTime } from '@/lib/format-time'
import { useState, useEffect, useRef } from 'react'
import { useEffectEvent } from '@/lib/hooks/use-effect-event'
import { useSearchParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useIntlLocale } from '@/lib/date-locale'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Binoculars, MapPin, Check } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, type ApiDangersAssessment, type ApiEffortEstimation } from '@/lib/api-client'
import { ApiError } from '@/lib/api/types'
import { LinkInvalidCard } from '@/components/link-page/link-page'
import {
  EMPTY_REKO_FORM,
  RekoReportForm,
  toRekoFormData,
  type RekoFormData,
} from '@/components/reko/reko-report-form'
import { telHref } from '@/lib/phone'
import { getApiUrl } from '@/lib/env'
import { RekoDummyGenerator } from '@/components/reko-dummy-generator'
import { ShellLoader, LoadingStatus } from '@/components/ui/shell-loader'

// The field page is the SHELL: the token, the incident header, the arrival
// ping, the localStorage draft and the 30 s autosave. The fields themselves are
// `RekoReportForm`, which the board's incident detail mounts too — one component
// and two mounts, because a second form drifts and the KP path is then the one
// that quietly loses a field (plan 26 §5.1).
const INITIAL_FORM_DATA: RekoFormData = EMPTY_REKO_FORM

// Photos have their own upload/delete transactions. Only send report fields the crew changed.
const SCALAR_FIELDS = ['is_relevant', 'power_supply', 'summary_text', 'additional_notes'] as const
type DraftChanges = Partial<Pick<RekoFormData, typeof SCALAR_FIELDS[number]>> & {
  dangers_json?: Partial<ApiDangersAssessment>
  effort_json?: Partial<ApiEffortEstimation>
}

function changedKeys<T extends object>(base: T, form: T, keys: (keyof T)[]): Partial<T> {
  return Object.fromEntries(keys.filter(key => JSON.stringify(base[key]) !== JSON.stringify(form[key]))
    .map(key => [key, form[key]])) as Partial<T>
}

function changedFields(base: RekoFormData, form: RekoFormData): DraftChanges {
  const dangers = changedKeys(base.dangers_json, form.dangers_json, Object.keys(EMPTY_REKO_FORM.dangers_json) as (keyof ApiDangersAssessment)[])
  const effort = changedKeys(base.effort_json, form.effort_json, Object.keys(EMPTY_REKO_FORM.effort_json) as (keyof ApiEffortEstimation)[])
  return {
    ...changedKeys(base, form, [...SCALAR_FIELDS]),
    ...(Object.keys(dangers).length && { dangers_json: dangers }),
    ...(Object.keys(effort).length && { effort_json: effort }),
  }
}

function applyDraft(server: RekoFormData, changes: DraftChanges): RekoFormData {
  return { ...server, ...changes,
    dangers_json: { ...server.dangers_json, ...changes.dangers_json },
    effort_json: { ...server.effort_json, ...changes.effort_json },
  }
}

export default function RekoForm() {
  const params = useSearchParams()
  const incidentId = params.get('incident_id')
  const token = params.get('token')
  const personnelId = params.get('personnel_id')
  return <FieldReport key={JSON.stringify([incidentId, token, personnelId])} incidentId={incidentId}
    token={token} personnelId={personnelId} returnTo={params.get('return_to')} />
}

function FieldReport({ incidentId, token, personnelId, returnTo }: {
  incidentId: string | null
  token: string | null
  personnelId: string | null
  returnTo: string | null
}) {
  const router = useRouter()
  const t = useTranslations('reko.form')
  const tLoading = useTranslations('common')
  const intlLocale = useIntlLocale()

  const [formData, setFormData] = useState<RekoFormData>(INITIAL_FORM_DATA)
  const [syncedData, setSyncedData] = useState<RekoFormData | null>(null)
  const [storageKey, setStorageKey] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<RekoFormData | null>(null)
  const saving = useRef<Promise<RekoFormData> | null>(null)
  const [incidentTitle, setIncidentTitle] = useState<string>('')
  const [incidentDetails, setIncidentDetails] = useState<{
    location?: string
    type?: string
    description?: string
    contact?: string
  }>({})
  const [assignedPersonnelName, setAssignedPersonnelName] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Ref mirror of the submission state: the auto-save interval captures stale
  // closures, so it must check this ref (set synchronously on submit) instead
  // of the isSubmitting state. Once a submit succeeds it stays true forever so
  // no late draft-save can un-submit the report.
  const isSubmittingRef = useRef(false)
  const [isMarkingArrived, setIsMarkingArrived] = useState(false)
  const [arrivedAt, setArrivedAt] = useState<Date | null>(null)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  /**
   * Something is on this phone that the KP has not got.
   *
   * Set by the `saveDraft` catch, which used to swallow the failure entirely —
   * so the footer kept saying «Gespeichert um 20:14» through twenty minutes of
   * failed saves. Nothing is lost when this is true (localStorage holds every
   * keystroke); it simply has not reached the command post, and that is the
   * distinction the person at the Schadenplatz is actually asking about.
   */
  const [unsent, setUnsent] = useState(false)
  /** Whether this phone has a network at all — the difference between "es
   *  kommt nicht durch" (a fault) and "kein Netz" (a cellar, and normal). */
  const [online, setOnline] = useState(true)
  const [validationError, setValidationError] = useState<string | null>(null)
  // A dead link (no token, or the server refused it) gets the /alarm card — one
  // message in the crew's words, not «Token» plus an «API Fehler» toast.
  const [linkInvalid, setLinkInvalid] = useState(false)
  // Constant until the backend returns the event's training_flag on the Reko form
  // response (see the NOTE in the loader below); the dummy generator stays hidden.
  const isTraining = false

  // Dummy data generation for training mode. The whole report is generated as one
  // coherent picture: a NOT-relevant incident reads like a false alarm (no people,
  // ~no time, no dangers), while a relevant one scales personnel/duration with how
  // many dangers were found. See handleGenerateDummyData for the orchestration.
  const ALL_DANGERS: Array<keyof ApiDangersAssessment> = ['fire_danger', 'explosion', 'collapse', 'chemical', 'electrical']

  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

  // Choose a coherent set of dangers given a target severity (number of dangers).
  const generateDangers = (count: number): Partial<ApiDangersAssessment> => {
    const selected: Partial<ApiDangersAssessment> = {}
    const shuffled = [...ALL_DANGERS].sort(() => Math.random() - 0.5)
    shuffled.slice(0, count).forEach(danger => {
      (selected as Record<string, boolean>)[danger] = true
    })
    return selected
  }

  // Personnel + duration scale with danger severity, kept small and tidy: a Reko
  // estimates the handful needed at the scene, and whole hours read cleaner on the
  // board than fractional "false precision" estimates.
  const generateEffort = (dangerCount: number): Partial<ApiEffortEstimation> => {
    // Base crew of 2-3, plus ~1-2 extra per danger found. Capped at a sane max.
    const base = 2 + Math.floor(Math.random() * 2) // 2-3
    const perDanger = dangerCount * (1 + Math.floor(Math.random() * 2)) // 1-2 each
    const personnel = Math.min(base + perDanger, 10)
    // Whole hours only: 1h base + ~0.5h per danger, with jitter, floored at 1.
    const duration = Math.max(1, Math.round(1 + dangerCount * 0.5 + Math.random()))
    return {
      personnel_count: personnel,
      estimated_duration_hours: duration,
      vehicles_needed: [],
      equipment_needed: [],
    }
  }

  // Summaries that match the situation, kept generic but natural (localized).
  const NOT_RELEVANT_SUMMARIES = t.raw('summaries.notRelevant') as string[]
  const LOW_SEVERITY_SUMMARIES = t.raw('summaries.low') as string[]
  const HIGH_SEVERITY_SUMMARIES = t.raw('summaries.high') as string[]

  const handleMarkArrived = async () => {
    if (!incidentId || !token || arrivedAt) return

    setIsMarkingArrived(true)
    try {
      const response = await apiClient.markRekoArrived(incidentId, token)
      if (response.arrived_at) {
        setArrivedAt(new Date(response.arrived_at))
      }
    } catch (error) {
      console.error('Failed to mark arrived:', error)
      toast.error(t('arrivalError'))
    } finally {
      setIsMarkingArrived(false)
    }
  }

  const handleGenerateDummyData = () => {
    const isRelevant = Math.random() > 0.25 // ~75% relevant

    const emptyDangers: ApiDangersAssessment = {
      fire: false, // Not shown in form - if there's fire, reko isn't needed
      fire_danger: false,
      explosion: false,
      collapse: false,
      chemical: false,
      electrical: false,
      other_notes: '',
    }

    let dummyData: RekoFormData

    if (!isRelevant) {
      // Not relevant: no people, no time, no dangers, "nothing to do" summary.
      dummyData = {
        is_relevant: false,
        dangers_json: { ...emptyDangers },
        effort_json: {
          personnel_count: 0,
          vehicles_needed: [],
          equipment_needed: [],
          estimated_duration_hours: 0,
        },
        power_supply: 'unknown',
        photos_json: formData.photos_json,
        summary_text: pick(NOT_RELEVANT_SUMMARIES),
        additional_notes: '',
      }
    } else {
      // Relevant: pick a severity, weighted toward few/no dangers so reports don't
      // all read as multi-hazard scenes. Mostly 0-1, occasionally 2, rarely 3.
      const dangerCount = pick([0, 0, 0, 1, 1, 1, 2, 3])
      const summaryBank = dangerCount >= 2 ? HIGH_SEVERITY_SUMMARIES : LOW_SEVERITY_SUMMARIES
      dummyData = {
        is_relevant: true,
        dangers_json: { ...emptyDangers, ...generateDangers(dangerCount) },
        effort_json: {
          personnel_count: null,
          vehicles_needed: [],
          equipment_needed: [],
          estimated_duration_hours: null,
          ...generateEffort(dangerCount),
        },
        // More dangers more likely to need power; otherwise usually available.
        power_supply: dangerCount >= 2 ? pick(['emergency_needed', 'unavailable', 'available']) : pick(['available', 'available', 'unknown']),
        photos_json: formData.photos_json,
        summary_text: pick(summaryBank),
        additional_notes: '',
      }
    }

    setFormData(dummyData)
  };

  // Validate access and load existing data – once per link (incident, token, person); the
  // helpers and `t` are read through an effect event, so nothing else can reload the form
  // under the crew's typing.
  const loadForm = useEffectEvent(() => {
    let active = true
    async function init() {
      if (!incidentId || !token) {
        setLinkInvalid(true)
        setIsLoading(false)
        return
      }

      try {
        // Load incident details and existing draft/report
        const data = await apiClient.getRekoForm(incidentId, token, personnelId)

        if (!active) return
        setIncidentTitle(data.incident_title || t('unknownIncident'))
        setIncidentDetails({
          location: data.incident_location || undefined,
          type: data.incident_type || undefined,
          description: data.incident_description || undefined,
          contact: data.incident_contact || undefined
        })

        // Set assigned personnel name if available
        setAssignedPersonnelName(data.submitted_by_personnel_name || null)

        // NOTE: When the backend implements it, the getRekoForm response should
        // include the event's training_flag so training features can be enabled
        // (add `event_training_flag: boolean` to ApiRekoFormResponse and turn the
        // `isTraining` constant above back into state).

        // Set arrivedAt if already marked
        if (data.arrived_at) {
          setArrivedAt(new Date(data.arrived_at))
        }

        // A report belongs to one form link. The old incident-wide key cannot identify its author.
        const key = `reko-report-draft-${data.id}`
        const serverData = toRekoFormData(data)
        setStorageKey(key)
        setSyncedData(serverData)
        setFormData(serverData)
        try {
          const raw = localStorage.getItem(key)
          const draft = raw ? JSON.parse(raw) : null
          if (draft?.changes && draft.previous) {
            const recovered = applyDraft(serverData, draft.changes)
            if (Object.keys(changedFields(serverData, recovered)).length) {
              // A lost response can leave an already-written draft on the phone. If the server
              // still has our old values, replay; divergent values need an explicit choice.
              const previous = applyDraft(serverData, draft.previous)
              if (Object.keys(changedFields(previous, serverData)).length) {
                setRecovery(recovered)
              } else {
                setFormData(recovered)
                toast.info(t('localRestored'), { description: t('localRestoredDescription') })
              }
            }
          }
        } catch (error) {
          console.error('Failed to load local Reko draft:', error)
        }
      } catch (error) {
        if (!active) return
        console.error('Failed to load form:', error)
        // 4xx = the server refused this link (expired, revoked, wrong incident);
        // anything else is the connection, which a new link would not fix.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          setLinkInvalid(true)
        } else {
          setValidationError(t('loadError'))
        }
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void init()
    return () => { active = false }
  })
  useEffect(() => loadForm(), [incidentId, token, personnelId])

  const changes = syncedData && changedFields(syncedData, formData)
  const dirty = !!changes && Object.keys(changes).length > 0
  useEffect(() => {
    if (!storageKey || !syncedData || recovery) return
    try {
      const fields = changedFields(syncedData, formData)
      if (Object.keys(fields).length > 0) {
        localStorage.setItem(storageKey, JSON.stringify({ changes: fields, previous: changedFields(formData, syncedData) }))
      } else {
        localStorage.removeItem(storageKey)
      }
    } catch (error) {
      console.error('Failed to store local Reko draft:', error)
    }
  }, [storageKey, syncedData, formData, recovery])

  async function saveDraft() {
    if (!dirty || !changes || saving.current || isSubmittingRef.current || !incidentId || !token) return
    const request = apiClient.saveRekoDraft(incidentId, token, changes).then(() => formData)
    saving.current = request
    setIsSaving(true)
    try {
      await request
      setSyncedData(formData)
      setLastSaved(new Date())
      setUnsent(false)
    } catch (error) {
      console.error('Auto-save failed:', error)
      setUnsent(true)
    } finally {
      saving.current = null
      setIsSaving(false)
    }
  }

  const autosave = useEffectEvent(() => void saveDraft())
  useEffect(() => {
    if (!dirty || isSubmitting) return
    const interval = setInterval(autosave, 30000)
    return () => clearInterval(interval)
  }, [dirty, formData, isSubmitting])

  // The network coming back is the usual end of an `unsent` stretch: the next
  // autosave carries everything. Watched so the footer can say "kein Netz"
  // while it lasts and stop saying it the moment it does not.
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  // The "Einsatz relevant?" requirement lives in the shared field set, which
  // refuses to call this until it is answered — the same rule on both mounts.
  async function handleSubmit() {
    if (!incidentId || !token || !syncedData || isSubmittingRef.current) return

    // Set the ref synchronously so any in-flight auto-save closure bails out.
    isSubmittingRef.current = true
    setIsSubmitting(true)

    try {
      // Serialize final submission after an earlier autosave, even when its response is delayed.
      const baseline = (await saving.current?.catch(() => syncedData)) ?? syncedData
      await apiClient.submitRekoReport(incidentId, token, changedFields(baseline, formData))
      setSyncedData(formData)
      setUnsent(false)

      // Redirect to success page with return URL for back button functionality.
      // Intentionally keep isSubmitting/isSubmittingRef true on success so the
      // button stays disabled and no auto-save can fire until the redirect.
      setTimeout(() => {
        // The address, so the success page can say WHICH Einsatz went to the KP.
        const params = new URLSearchParams()
        const where = incidentDetails.location || incidentTitle
        if (where) params.set('ort', where)
        if (returnTo) {
          params.set('return_to', returnTo)
        }
        router.push(`/reko/success?${params.toString()}`)
      }, 1000)
    } catch (error) {
      console.error('Submit failed:', error)
      toast.error(t('submitError'))
      // Only re-enable submission (and auto-save) after a failed submit
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingStatus size="surface" className="text-sm">{tLoading('loading')}</LoadingStatus>
      </div>
    )
  }

  if (linkInvalid) {
    return <LinkInvalidCard title={t('invalidTitle')} description={t('invalidLink')} />
  }

  if (validationError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{validationError}</AlertDescription>
      </Alert>
    )
  }

  if (recovery) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <p>{t('draftConflict')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => { setFormData(recovery); setRecovery(null) }}>{t('restoreDevice')}</Button>
            <Button variant="outline" onClick={() => setRecovery(null)}>{t('keepServer')}</Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-5">
      {/* Training Mode Dummy Data Generator */}
      <RekoDummyGenerator
        isTraining={isTraining}
        onGenerate={handleGenerateDummyData}
      />

      {/* Incident Info */}
      <div className="rounded-lg bg-secondary/50 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium">{incidentDetails.location || incidentTitle}</span>
          {assignedPersonnelName && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Binoculars className="h-4 w-4" />
              <span>{assignedPersonnelName}</span>
            </div>
          )}
        </div>
        {incidentDetails.description && (
          <p className="text-sm text-muted-foreground mt-2">
            {incidentDetails.description}
          </p>
        )}
        {incidentDetails.contact && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <span className="text-sm text-muted-foreground">{t('contactLabel')}</span>
            <a
              href={telHref(incidentDetails.contact) ?? undefined}
              className="text-sm font-medium text-foreground underline underline-offset-2 hover:decoration-2"
            >
              {incidentDetails.contact}
            </a>
          </div>
        )}
      </div>

      {/* Arrival Ping Button */}
      <Button
        type="button"
        onClick={handleMarkArrived}
        disabled={isMarkingArrived || !!arrivedAt}
        variant={arrivedAt ? "secondary" : "default"}
        size="lg"
        className={`w-full ${arrivedAt ? 'bg-muted text-muted-foreground' : ''}`}
      >
        {isMarkingArrived ? (
          <>
            <ShellLoader className="h-5 w-5" />
            {t('markingArrival')}
          </>
        ) : arrivedAt ? (
          <>
            <Check className="h-5 w-5" />
            {t('arrivalReported', { time: formatTime(arrivedAt, intlLocale) })}
          </>
        ) : (
          <>
            <MapPin className="h-5 w-5" />
            {t('imOnSite')}
          </>
        )}
      </Button>

      {/* The field set itself — the SAME component the board's incident detail
          mounts, with a different transport and identity (plan 26 §5.1). The
          shell above (header, arrival ping, dummy generator) is what differs;
          the fields must not. */}
      <RekoReportForm
        incidentId={incidentId!}
        value={formData}
        onChange={setFormData}
        mount="feld"
        isSubmitting={isSubmitting}
        busy={isSaving}
        onSubmit={handleSubmit}
        photos={{
          url: (filename) => `${getApiUrl()}/api/photos/${incidentId}/${encodeURIComponent(filename)}?${new URLSearchParams({ reko_token: token! })}`,
          upload: async (file, onProgress) =>
            (await apiClient.uploadRekoPhoto(incidentId!, token!, file, onProgress)).filename,
          remove: (filename) => apiClient.deleteRekoPhoto(incidentId!, token!, filename),
        }}
        footer={
          /* Three honest states instead of one friendly lie. The question at a
             Schadenplatz is never «wurde gespeichert?» — localStorage answers
             that on every keystroke — it is whether the KP has it or whether it
             is still on this phone. «Jetzt zum KP senden» is the same button
             the Rapport form calls `sendChanges`; one pattern, two forms. */
          !unsent || !dirty ? (
            <div className="space-y-1 text-center">
              {lastSaved && !dirty && (
                <p className="text-sm">
                  {t('syncedAt', {
                    time: formatTime(lastSaved, intlLocale),
                  })}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{lastSaved && !dirty ? t('syncedHint') : t('autoSave')}</p>
            </div>
          ) : online ? (
            <div className="space-y-2">
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
                <p className="font-medium">{t('unsentTitle')}</p>
                <p className="mt-0.5">
                  {lastSaved
                    ? t('unsentBody', {
                        time: formatTime(lastSaved, intlLocale),
                      })
                    : t('unsentBodyNever')}
                </p>
                <p className="mt-1 text-xs opacity-90">{t('unsentReassurance')}</p>
              </div>
              <Button type="button" className="w-full" disabled={isSaving} onClick={() => saveDraft()}>
                {isSaving ? <ShellLoader className="h-4 w-4" /> : null}
                {t('sendNow')}
              </Button>
            </div>
          ) : (
            /* No network is not a fault and gets no red: it is a cellar, and it
               ends by itself. The one instruction that matters is to leave the
               form open, because closing it is what would actually cost the
               text. */
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-medium">{t('offlineTitle')}</p>
              <p className="mt-0.5">{t('offlineBody')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('offlineHint')}</p>
            </div>
          )
        }
      />
    </div>
  )
}
