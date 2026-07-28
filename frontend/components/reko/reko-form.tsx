'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Send, Loader2, Binoculars, MapPin, Check } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, type ApiDangersAssessment, type ApiEffortEstimation } from '@/lib/api-client'
import PhotoUpload from './photo-upload'
import { telHref } from '@/lib/phone'
import { RekoDummyGenerator } from '@/components/reko-dummy-generator'

interface RekoFormData {
  is_relevant: boolean | null
  dangers_json: ApiDangersAssessment
  effort_json: ApiEffortEstimation
  power_supply: string
  photos_json: string[]
  summary_text: string
  additional_notes: string
}

const INITIAL_FORM_DATA: RekoFormData = {
  is_relevant: null,
  dangers_json: {
    fire: false,
    fire_danger: false,
    explosion: false,
    collapse: false,
    chemical: false,
    electrical: false,
    other_notes: ''
  },
  effort_json: {
    personnel_count: null,
    vehicles_needed: [],
    equipment_needed: [],
    estimated_duration_hours: null
  },
  power_supply: 'unknown',
  photos_json: [],
  summary_text: '',
  additional_notes: ''
}

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
  const [validationError, setValidationError] = useState<string | null>(null)
  const [relevantMissing, setRelevantMissing] = useState(false)
  const [isTraining, setIsTraining] = useState(false)
  // Local text mirror for the duration field: a controlled number input coerces
  // "0"/"0." to falsy and clears the field mid-typing, so we keep the raw string
  // and sync it back only when the stored number changes elsewhere (quick-fill).
  const [durationText, setDurationText] = useState('')
  useEffect(() => {
    const num = formData.effort_json.estimated_duration_hours
    const parsed = durationText.trim() === '' ? null : parseFloat(durationText)
    if (num !== parsed && !(num === null && Number.isNaN(parsed))) {
      setDurationText(num === null || num === undefined ? '' : String(num))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.effort_json.estimated_duration_hours])

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

        // NOTE: When backend is implemented, the getRekoForm response should include
        // the event's training_flag so we can enable training features
        // For now, this will be false (production mode)
        // Backend should add: event_training_flag: boolean to ApiRekoFormResponse
        // setIsTraining(data.event_training_flag || false)

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
    } catch (error) {
      console.error('Auto-save failed:', error)
      // Don't show error toast for background saves
    } finally {
      setIsSaving(false)
    }
  }, [formData, incidentId, token, isSaving])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (formData.is_relevant === null) {
      setRelevantMissing(true)
      return
    }

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

  function updateFormData<K extends keyof RekoFormData>(
    key: K,
    value: RekoFormData[K]
  ) {
    if (key === 'is_relevant') setRelevantMissing(false)
    setFormData(prev => ({ ...prev, [key]: value }))
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
    <form onSubmit={handleSubmit} className="space-y-5">
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

      {/* Section 1: Basic Confirmation */}
      <div className="space-y-3">
        <div className="flex items-center gap-1">
          <Label className="text-sm font-medium text-muted-foreground tracking-wide">
            {t('relevantQuestion')}
          </Label>
          <span className="text-destructive" aria-hidden="true">*</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant={formData.is_relevant === true ? 'default' : 'outline'}
            onClick={() => updateFormData('is_relevant', true)}
            size="lg"
            className="text-base"
          >
            {t('yes')}
          </Button>
          <Button
            type="button"
            variant={formData.is_relevant === false ? 'default' : 'outline'}
            onClick={() => updateFormData('is_relevant', false)}
            size="lg"
            className="text-base"
          >
            {t('no')}
          </Button>
        </div>
        {relevantMissing && (
          <p className="text-xs text-destructive">{t('relevantRequired')}</p>
        )}
      </div>

      <Separator />

      {/* Section 2: Dangers Assessment */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-muted-foreground tracking-wide">
          {t('dangers')}
        </Label>

        <div className="space-y-2">
          {(['fire_danger', 'explosion', 'collapse', 'chemical', 'electrical'] as const).map((key) => (
            <label
              key={key}
              htmlFor={`danger-${key}`}
              className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 cursor-pointer hover:bg-secondary transition-colors"
            >
              <Checkbox
                id={`danger-${key}`}
                checked={formData.dangers_json[key as keyof ApiDangersAssessment] as boolean}
                onCheckedChange={(checked) => updateFormData('dangers_json', {
                  ...formData.dangers_json,
                  [key]: checked === true
                })}
                className="h-5 w-5"
              />
              <span className="text-sm">{t(`dangerLabels.${key}`)}</span>
            </label>
          ))}
        </div>

        <div className="pt-2">
          <Label htmlFor="danger-other" className="text-sm font-semibold text-muted-foreground mb-1.5 block">{t('otherDangers')}</Label>
          <Textarea
            id="danger-other"
            value={formData.dangers_json.other_notes || ''}
            onChange={(e) => updateFormData('dangers_json', {
              ...formData.dangers_json,
              other_notes: e.target.value
            })}
            placeholder={t('otherDangersPlaceholder')}
            rows={2}
          />
        </div>
      </div>

      <Separator />

      {/* Section 3: Effort Assessment */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-muted-foreground tracking-wide">
          {t('effort')}
        </Label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="personnel-count" className="text-sm font-semibold text-muted-foreground mb-1.5 block">{t('personnelCount')}</Label>
            <Input
              id="personnel-count"
              type="number"
              inputMode="numeric"
              min="0"
              value={formData.effort_json.personnel_count || ''}
              onChange={(e) => updateFormData('effort_json', {
                ...formData.effort_json,
                personnel_count: e.target.value ? parseInt(e.target.value) : null
              })}
              placeholder={t('personnelPlaceholder')}
              className="h-11"
            />
          </div>

          <div>
            <Label htmlFor="duration" className="text-sm font-semibold text-muted-foreground mb-1.5 block">{t('duration')}</Label>
            <Input
              id="duration"
              type="text"
              inputMode="decimal"
              value={durationText}
              onChange={(e) => {
                // Accept decimals like "0.5"; keep the raw text so a leading "0"
                // (or a lone "0.") survives instead of being coerced away.
                let raw = e.target.value.replace(',', '.').replace(/[^\d.]/g, '')
                const dot = raw.indexOf('.')
                if (dot !== -1) raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, '')
                setDurationText(raw)
                const parsed = raw === '' || raw === '.' ? null : parseFloat(raw)
                updateFormData('effort_json', {
                  ...formData.effort_json,
                  estimated_duration_hours: parsed !== null && !Number.isNaN(parsed) ? parsed : null,
                })
              }}
              placeholder={t('durationPlaceholder')}
              className="h-11"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Section 4: Power Supply */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-muted-foreground tracking-wide">
          {t('powerSupply')}
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {(['unknown', 'available', 'unavailable', 'emergency_needed'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant={formData.power_supply === value ? 'default' : 'outline'}
              onClick={() => updateFormData('power_supply', value)}
              className="text-sm"
            >
              {t(`powerLabels.${value}`)}
            </Button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Photo Upload */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-muted-foreground tracking-wide">
          {t('photos')}
        </Label>
        <PhotoUpload
          photos={formData.photos_json}
          incidentId={incidentId!}
          token={token!}
          onPhotosChange={(update) =>
            setFormData(prev => ({ ...prev, photos_json: update(prev.photos_json) }))
          }
        />
      </div>

      <Separator />

      {/* Summary */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-muted-foreground tracking-wide">
          {t('summary')}
        </Label>

        <div>
          <Label htmlFor="summary" className="text-sm font-semibold text-muted-foreground mb-1.5 block">{t('summaryShort')}</Label>
          <Textarea
            id="summary"
            value={formData.summary_text}
            onChange={(e) => updateFormData('summary_text', e.target.value)}
            placeholder={t('summaryPlaceholder')}
            rows={3}
          />
        </div>

        <div>
          <Label htmlFor="notes" className="text-sm font-semibold text-muted-foreground mb-1.5 block">{t('notes')}</Label>
          <Textarea
            id="notes"
            value={formData.additional_notes}
            onChange={(e) => updateFormData('additional_notes', e.target.value)}
            placeholder={t('notesPlaceholder')}
            rows={2}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="pt-4 space-y-3">
        <Button
          type="submit"
          disabled={isSubmitting || isSaving}
          className="w-full h-14"
          size="lg"
        >
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

        {/* Auto-save indicator */}
        <p className="text-xs text-center text-muted-foreground">
          {lastSaved ? (
            <>{t('savedAt', { time: lastSaved.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) })}</>
          ) : (
            <>{t('autoSave')}</>
          )}
        </p>
      </div>
    </form>
  )
}
