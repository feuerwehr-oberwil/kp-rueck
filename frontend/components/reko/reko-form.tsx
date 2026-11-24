'use client'

import { formatTime } from '@/lib/format-time'
import { useState, useEffect, useRef } from 'react'
import { useEffectEvent } from '@/lib/hooks/use-effect-event'
import { useSearchParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useIntlLocale } from '@/lib/date-locale'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Binoculars, MapPin, Check, CircleCheck, CloudCheck, CloudOff } from 'lucide-react'
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
import {
  applyDraft, changedFields, conflictsWithServer, draftFields, ReportDrafts,
  type DraftChanges, type RecoverableDraft, type StoredRevision,
} from './field-draft'
import { telHref } from '@/lib/phone'
import { ownPath } from '@/lib/own-path'
import { unmutedToast } from '@/lib/toast-lifetime'
import { getApiUrl } from '@/lib/env'
import { RekoDummyGenerator } from '@/components/reko-dummy-generator'
import { ShellLoader, LoadingStatus } from '@/components/ui/shell-loader'

// The field page is the SHELL: the token, the incident header, the arrival
// ping, the localStorage draft and the 30 s autosave. The fields themselves are
// `RekoReportForm`, which the board's incident detail mounts too — one component
// and two mounts, because a second form drifts and the KP path is then the one
// that quietly loses a field (plan 26 §5.1).
const INITIAL_FORM_DATA: RekoFormData = EMPTY_REKO_FORM

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
  const tSuccess = useTranslations('reko.success')
  const tLoading = useTranslations('common')
  const intlLocale = useIntlLocale()

  const [formData, setFormData] = useState<RekoFormData>(INITIAL_FORM_DATA)
  const [syncedData, setSyncedData] = useState<RekoFormData | null>(null)
  const [drafts, setDrafts] = useState<ReportDrafts | null>(null)
  const [recovery, setRecovery] = useState<RecoverableDraft[]>([])
  const restored = useRef<RecoverableDraft | null>(null)
  const [attempts, setAttempts] = useState<DraftChanges[]>([])
  const latestAttempts = useRef<DraftChanges[]>([])
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
  // The link opened on a report the KP already has: until this phone saves once, the footer
  // must not say «nothing has arrived» – the KP holds the loaded state.
  const [serverHasReport, setServerHasReport] = useState(false)
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
        const store = new ReportDrafts(data.id)
        const serverData = toRekoFormData(data)
        setDrafts(store)
        setSyncedData(serverData)
        setFormData(serverData)
        setServerHasReport(Object.keys(changedFields(INITIAL_FORM_DATA, serverData)).length > 0)
        try {
          const candidates = store.read().filter(version => {
            const desired = applyDraft(serverData, version.draft.changes)
            return Object.keys(changedFields(serverData, desired, version.draft.attempts?.at(-1))).length > 0
          })
          if (candidates.length === 1 && !conflictsWithServer(serverData, candidates[0].draft)) {
            restore(candidates[0], serverData)
            toast.info(t('localRestored'), { description: t('localRestoredDescription') })
          } else {
            setRecovery(candidates)
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

  function restore(version: RecoverableDraft, server: RekoFormData) {
    restored.current = version
    rememberAttempts(version.draft.attempts ?? [])
    setFormData(applyDraft(server, version.draft.changes))
    setRecovery([])
  }

  function rememberAttempts(history: DraftChanges[]) {
    latestAttempts.current = history
    setAttempts(history)
  }

  const changes = syncedData && changedFields(syncedData, formData, attempts.at(-1))
  const dirty = !!changes && Object.keys(changes).length > 0

  function persist(store: ReportDrafts, base: RekoFormData, form: RekoFormData, unconfirmed: DraftChanges[]) {
    try {
      const fields = changedFields(base, form, unconfirmed.at(-1))
      return store.write(Object.keys(fields).length ? {
        changes: fields,
        previous: changedFields(base, base, fields),
        ...(unconfirmed.length > 0 && { attempts: unconfirmed }),
      } : null)
    } catch (error) {
      console.error('Failed to store local Reko draft:', error)
    }
  }

  useEffect(() => {
    if (drafts && syncedData && !recovery.length) persist(drafts, syncedData, formData, attempts)
  }, [drafts, syncedData, recovery, formData, attempts])

  function acknowledged(form: RekoFormData, sent: StoredRevision | null | undefined) {
    // The request may finish after the component unmounts, when no effect can do this.
    // Retire the exact revision sent; a later keystroke already has its own storage key.
    if (sent) {
      try { drafts?.acknowledge(sent) } catch (error) { console.error('Failed to retire sent Reko draft:', error) }
    }
    const version = restored.current
    if (version && !Object.keys(changedFields(form, applyDraft(form, version.draft.changes))).length) {
      // The chosen source revision reached the KP. A concurrent writer has its own
      // immutable revision. A source we further edited stays available as another version.
      try { drafts?.retire(version) } catch (error) { console.error('Failed to retire Reko draft:', error) }
      restored.current = null
    }
    rememberAttempts([])
    setSyncedData(form)
    setUnsent(false)
  }

  function sending(base: RekoFormData, fields: DraftChanges) {
    // Each attempt includes all previously unconfirmed fields. Keep distinct snapshots:
    // a commit followed by a lost response could have left any of them on the server.
    const history = latestAttempts.current.filter(previous => JSON.stringify(previous) !== JSON.stringify(fields))
    if (Object.keys(fields).length) history.push(fields)
    rememberAttempts(history)
    // Persist BEFORE dispatch: closing a tab while waiting for a response is just as
    // ambiguous as losing the response. The stored intent always uses the latest values.
    if (drafts) return persist(drafts, base, formData, history)
  }

  async function saveDraft() {
    if (!dirty || !changes || !syncedData || saving.current || isSubmittingRef.current || !incidentId || !token) return
    const sent = sending(syncedData, changes)
    const request = apiClient.saveRekoDraft(incidentId, token, changes).then(() => formData)
    saving.current = request
    setIsSaving(true)
    try {
      await request
      acknowledged(formData, sent)
      setLastSaved(new Date())
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
      const fields = changedFields(baseline, formData, latestAttempts.current.at(-1))
      const sent = sending(baseline, fields)
      await apiClient.submitRekoReport(incidentId, token, fields)
      acknowledged(formData, sent)

      // Intentionally keep isSubmitting/isSubmittingRef true on success so the
      // button stays disabled and no auto-save can fire until the redirect.
      // The address, so the receipt says WHICH Einsatz went to the KP.
      const where = incidentDetails.location || incidentTitle
      const back = ownPath(returnTo)
      if (back) {
        // Opened from /feld: straight back to the list, the receipt as a toast (owner,
        // 19.11.2026). Unmuted: the phone and /feld are quiet surfaces, where
        // `toast.success` says nothing. `replace`: «back» must not reopen a sent form.
        unmutedToast(tSuccess('title'), {
          description: where || undefined,
          icon: <CircleCheck className="text-success" aria-hidden />,
        })
        router.replace(back)
        return
      }
      // A link from an alarm or a QR code has nowhere to go back to: the success page.
      setTimeout(() => {
        const params = new URLSearchParams()
        if (where) params.set('ort', where)
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

  if (recovery.length && syncedData) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <p>{t(recovery.length > 1 ? 'draftVersions' : 'draftConflict')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {recovery.map(version => recovery.length === 1 ? (
              <Button key={version.revisions[0].key} onClick={() => restore(version, syncedData)}>
                {t('restoreDevice')}
              </Button>
            ) : (
              <button key={version.revisions[0].key} type="button"
                className="w-full rounded-md border bg-background p-3 text-left focus-visible:ring-2"
                onClick={() => restore(version, syncedData)}>
                <span className="block font-semibold">{version.savedAt
                  ? t('draftAt', { time: formatTime(new Date(version.savedAt), intlLocale) }) : t('restoreDevice')}</span>
                <DraftSummary changes={version.draft.changes} />
              </button>
            ))}
            <Button variant="outline" onClick={() => {
              if (recovery.length === 1) {
                try { drafts?.retire(recovery[0]) } catch (error) { console.error('Failed to retire Reko draft:', error) }
              }
              setRecovery([])
            }}>{t('keepServer')}</Button>
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
        // Outline, not ink: the send in the footer is the page's one main button (9C).
        variant={arrivedAt ? "secondary" : "outline"}
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
          /* Three honest states instead of one friendly lie, one line each in the fixed
             footer (9C). The question at a Schadenplatz is never «wurde gespeichert?» –
             localStorage answers that on every keystroke – it is whether the KP has it or
             whether it is still on this phone. «Jetzt senden» is the same action the Rapport
             form calls `sendChanges`; one pattern, two forms. */
          !online && dirty ? (
            /* No network is not a fault and gets no red: it is a cellar, and it ends by
               itself. Said as soon as there is something to send – not 30 s later, when
               the next save fails. The one instruction that matters is to leave the form
               open, because closing it is what would actually cost the text. */
            <div role="status" className="flex items-start gap-2">
              <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" aria-hidden />
              <p className="min-w-0">
                <span className="block font-medium">{t('offlineTitle')}</span>
                <span className="block text-xs text-muted-foreground">{t('offlineHint')}</span>
              </p>
            </div>
          ) : !unsent || !dirty ? (
            <p className="flex items-center gap-2">
              {lastSaved ? (
                <>
                  <CloudCheck className={`h-4 w-4 shrink-0 ${dirty ? 'text-muted-foreground' : 'text-success'}`} aria-hidden />
                  <span className="min-w-0 truncate" title={t('kpStand', { time: formatTime(lastSaved, intlLocale) })}>
                    {t('kpStand', { time: formatTime(lastSaved, intlLocale) })}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{t('draftLive')}</span>
                </>
              ) : (
                <span className="text-muted-foreground">{t('autoSave')}</span>
              )}
            </p>
          ) : (
            <div role="status" className="flex items-center gap-2 text-warning-foreground">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="block font-medium">{t('unsentTitle')}</span>
                <span className="block text-xs">
                  {lastSaved
                    ? t('kpStand', { time: formatTime(lastSaved, intlLocale) })
                    : serverHasReport ? t('kpEarlier') : t('kpNothing')}
                </span>
              </p>
              <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={isSaving} onClick={() => saveDraft()}>
                {isSaving ? <ShellLoader className="h-4 w-4" /> : null}
                {t('sendNowShort')}
              </Button>
            </div>
          )
        }
      />
    </div>
  )
}

function DraftSummary({ changes }: { changes: DraftChanges }) {
  const t = useTranslations('reko.form')
  const report = useTranslations('reko.reportSection')
  const labels: Record<string, string> = {
    summary_text: t('summaryShort'), additional_notes: t('notes'), is_relevant: t('relevantQuestion'),
    power_supply: t('powerSupply'), other_notes: t('otherDangers'), personnel_count: t('personnelCount'),
    estimated_duration_hours: t('duration'), vehicles_needed: report('vehiclesLabel'), equipment_needed: report('equipmentLabel'),
  }
  return draftFields(changes).map(([key, value]) => {
    const label = labels[key] ?? report(`dangerBadges.${key}`)
    let content = value == null || value === '' ? '–' : String(value)
    if (typeof value === 'boolean') content = t(value ? 'yes' : 'no')
    if (Array.isArray(value)) content = value.join(', ') || '–'
    if (key === 'power_supply' && t.has(`powerLabels.${value}`)) content = t(`powerLabels.${value}`)
    return <span key={key} className="block break-words text-sm">{label}: {content}</span>
  })
}
