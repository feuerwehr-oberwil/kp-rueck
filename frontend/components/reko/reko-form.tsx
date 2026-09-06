'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Loader2, Binoculars, MapPin, Check } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, type ApiDangersAssessment, type ApiEffortEstimation } from '@/lib/api-client'
import {
  EMPTY_REKO_FORM,
  RekoReportForm,
  type RekoFormData,
} from '@/components/reko/reko-report-form'
import { telHref } from '@/lib/phone'
import { getApiUrl } from '@/lib/env'
import { RekoDummyGenerator } from '@/components/reko-dummy-generator'

// The field page is the SHELL: the token, the incident header, the arrival
// ping, the localStorage draft and the 30 s autosave. The fields themselves are
// `RekoReportForm`, which the board's incident detail mounts too — one component
// and two mounts, because a second form drifts and the KP path is then the one
// that quietly loses a field (plan 26 §5.1).
const INITIAL_FORM_DATA: RekoFormData = EMPTY_REKO_FORM

export default function RekoForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const t = useTranslations('reko.form')

  const incidentId = searchParams.get('incident_id')
  const token = searchParams.get('token')
  const personnelId = searchParams.get('personnel_id')
  const returnTo = searchParams.get('return_to')

  const [formData, setFormData] = useState<RekoFormData>(INITIAL_FORM_DATA)
  const [localStorageLoaded, setLocalStorageLoaded] = useState(false)
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
  // Constant until the backend returns the event's training_flag on the Reko form
  // response (see the NOTE in the loader below); the dummy generator stays hidden.
  const isTraining = false

  // LocalStorage key for this specific reko form
  const localStorageKey = incidentId ? `reko-form-${incidentId}` : null

  // Save form data to localStorage on every change
  const saveToLocalStorage = useCallback((data: RekoFormData) => {
    if (!localStorageKey) return
    try {
      localStorage.setItem(localStorageKey, JSON.stringify({
        data,
        timestamp: new Date().toISOString()
      }))
    } catch (error) {
      console.error('Failed to save to localStorage:', error)
    }
  }, [localStorageKey])

  // Load form data (and its save timestamp) from localStorage
  const loadFromLocalStorage = useCallback((): { data: RekoFormData; timestamp: string | null } | null => {
    if (!localStorageKey) return null
    try {
      const stored = localStorage.getItem(localStorageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        return {
          data: parsed.data as RekoFormData,
          timestamp: (parsed.timestamp as string | undefined) ?? null
        }
      }
    } catch (error) {
      console.error('Failed to load from localStorage:', error)
    }
    return null
  }, [localStorageKey])

  // Clear localStorage after successful submission
  const clearLocalStorage = useCallback(() => {
    if (!localStorageKey) return
    try {
      localStorage.removeItem(localStorageKey)
    } catch (error) {
      console.error('Failed to clear localStorage:', error)
    }
  }, [localStorageKey])

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

  // Validate access and load existing data
  useEffect(() => {
    async function init() {
      if (!incidentId || !token) {
        setValidationError(t('invalidLink'))
        setIsLoading(false)
        return
      }

      try {
        // Load incident details and existing draft/report
        const data = await apiClient.getRekoForm(incidentId, token, personnelId)

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

        // Load existing report/draft - prefer localStorage for offline resilience
        const localData = loadFromLocalStorage()
        const serverData = {
          is_relevant: data.is_relevant,
          dangers_json: data.dangers_json || INITIAL_FORM_DATA.dangers_json,
          effort_json: data.effort_json || INITIAL_FORM_DATA.effort_json,
          power_supply: data.power_supply || 'unknown',
          photos_json: data.photos_json || [],
          summary_text: data.summary_text || '',
          additional_notes: data.additional_notes || ''
        }

        // Use localStorage data only if it has meaningful content AND is not
        // older than the server report — a stale local draft must not overwrite
        // a report that was edited or submitted more recently elsewhere.
        // If the server has no meaningful report yet, local data wins as before
        // (user was likely editing offline).
        const localHasContent =
          localData !== null && (localData.data.summary_text || localData.data.is_relevant !== null)
        const serverHasContent = data.is_relevant !== null || !!data.summary_text
        const localTimestamp = localData?.timestamp ? new Date(localData.timestamp).getTime() : 0
        const serverTimestamp = data.updated_at ? new Date(data.updated_at).getTime() : 0
        if (localHasContent && (!serverHasContent || localTimestamp > serverTimestamp)) {
          setFormData(localData!.data)
          toast.info(t('localRestored'), {
            description: t('localRestoredDescription')
          })
        } else {
          setFormData(serverData)
        }
        setLocalStorageLoaded(true)
      } catch (error) {
        console.error('Failed to load form:', error)
        setValidationError(t('loadError'))
      } finally {
        setIsLoading(false)
      }
    }

    init()
  }, [incidentId, token, personnelId])

  // Save to localStorage on every form change for offline resilience
  useEffect(() => {
    // Don't save until we've loaded the initial data
    if (!localStorageLoaded || isLoading) return
    saveToLocalStorage(formData)
  }, [formData, localStorageLoaded, isLoading, saveToLocalStorage])

  // Auto-save draft to server every 30 seconds (backup to server).
  // Stops as soon as submission starts so no late draft-save races the submit.
  useEffect(() => {
    if (!incidentId || !token || isLoading || isSubmitting) return

    const interval = setInterval(() => {
      saveDraft()
    }, 30000)

    return () => clearInterval(interval)
  }, [formData, incidentId, token, isLoading, isSubmitting])

  const saveDraft = useCallback(async () => {
    // Check the ref (not isSubmitting state): stale interval closures would
    // otherwise fire a draft-save mid-/post-submit and un-submit the report.
    if (isSaving || isSubmittingRef.current || !incidentId || !token) return

    setIsSaving(true)
    try {
      await apiClient.saveRekoDraft(incidentId, token, {
        ...formData,
        incident_id: incidentId,
        token,
        is_draft: true
      })
      setLastSaved(new Date())
      setUnsent(false)
    } catch (error) {
      console.error('Auto-save failed:', error)
      // Still no toast — the crew is typing, not watching — but the footer is
      // told, because a footer that keeps claiming «Gespeichert um 20:14» while
      // six saves in a row fail is the one thing on this screen that lies.
      setUnsent(true)
    } finally {
      setIsSaving(false)
    }
  }, [formData, incidentId, token, isSaving])

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
    if (!incidentId || !token) return

    // Set the ref synchronously so any in-flight auto-save closure bails out.
    isSubmittingRef.current = true
    setIsSubmitting(true)

    try {
      await apiClient.submitRekoReport(incidentId, token, {
        ...formData,
        incident_id: incidentId,
        token,
        is_draft: false
      })

      // Clear localStorage after successful submission
      clearLocalStorage()

      // Redirect to success page with return URL for back button functionality.
      // Intentionally keep isSubmitting/isSubmittingRef true on success so the
      // button stays disabled and no auto-save can fire until the redirect.
      setTimeout(() => {
        const params = new URLSearchParams()
        params.set('id', incidentId!)
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
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (validationError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{validationError}</AlertDescription>
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
              className="text-sm font-medium text-primary hover:underline"
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
        className={`w-full ${arrivedAt ? 'bg-muted text-muted-foreground' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
      >
        {isMarkingArrived ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('markingArrival')}
          </>
        ) : arrivedAt ? (
          <>
            <Check className="h-5 w-5" />
            {t('arrivalReported', { time: arrivedAt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) })}
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
          !unsent ? (
            <div className="space-y-1 text-center">
              {lastSaved && (
                <p className="text-sm">
                  {t('syncedAt', {
                    time: lastSaved.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }),
                  })}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{lastSaved ? t('syncedHint') : t('autoSave')}</p>
            </div>
          ) : online ? (
            <div className="space-y-2">
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
                <p className="font-medium">{t('unsentTitle')}</p>
                <p className="mt-0.5">
                  {lastSaved
                    ? t('unsentBody', {
                        time: lastSaved.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }),
                      })
                    : t('unsentBodyNever')}
                </p>
                <p className="mt-1 text-xs opacity-90">{t('unsentReassurance')}</p>
              </div>
              <Button type="button" className="w-full" disabled={isSaving} onClick={() => saveDraft()}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t('sendNow')}
              </Button>
            </div>
          ) : (
            /* No network is not a fault and gets no red: it is a cellar, and it
               ends by itself. The one instruction that matters is to leave the
               form open, because closing it is what would actually cost the
               text. */
            <div className="rounded-lg border border-info/40 bg-info/10 p-3 text-sm">
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
