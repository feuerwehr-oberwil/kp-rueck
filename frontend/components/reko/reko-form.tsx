'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
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
  const [isMarkingArrived, setIsMarkingArrived] = useState(false)
  const [arrivedAt, setArrivedAt] = useState<Date | null>(null)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isTraining, setIsTraining] = useState(false)

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

  // Load form data from localStorage
  const loadFromLocalStorage = useCallback((): RekoFormData | null => {
    if (!localStorageKey) return null
    try {
      const stored = localStorage.getItem(localStorageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        return parsed.data as RekoFormData
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

  // Dummy data generation functions for training mode
  const generateRandomDangers = (): Partial<ApiDangersAssessment> => {
    const allDangers: Array<keyof ApiDangersAssessment> = ['fire_danger', 'explosion', 'collapse', 'chemical', 'electrical'];
    const selectedCount = Math.floor(Math.random() * 3) + 1; // 1-3 dangers
    const selected: Partial<ApiDangersAssessment> = {};

    // Randomly select dangers
    const shuffled = [...allDangers].sort(() => Math.random() - 0.5);
    shuffled.slice(0, selectedCount).forEach(danger => {
      if (danger !== 'other_notes') {
        (selected as any)[danger] = true;
      }
    });

    return selected;
  };

  const generateRandomEffort = (): Partial<ApiEffortEstimation> => {
    return {
      personnel_count: Math.floor(Math.random() * 20) + 5, // 5-25 people
      estimated_duration_hours: (Math.random() * 4) + 0.5, // 0.5-4.5 hours
      vehicles_needed: [],
      equipment_needed: []
    };
  };

  const generateRandomPowerSupply = (): string => {
    const options = ['available', 'unavailable', 'emergency_needed', 'unknown'];
    return options[Math.floor(Math.random() * options.length)];
  };

  const generateRandomSummary = (): string => {
    const summaries = [
      'Situation unter Kontrolle. Einsatz kann wie geplant durchgeführt werden.',
      'Zugang erschwert. Zusätzliches Material benötigt.',
      'Lage stabil. Keine besonderen Vorkommnisse.',
      'Mehrere Gebäudeteile betroffen. Einsatz wird länger dauern.',
      'Bewohner kooperativ. Gute Zusammenarbeit vor Ort.',
      'Zufahrt blockiert. Alternative Route notwendig.',
      'Stromversorgung ausgefallen. Notstrom erforderlich.',
      'Einsatzstelle gut zugänglich. Optimale Arbeitsbedingungen.'
    ];
    return summaries[Math.floor(Math.random() * summaries.length)];
  };

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
      toast.error('Fehler beim Melden der Ankunft')
    } finally {
      setIsMarkingArrived(false)
    }
  }

  const handleGenerateDummyData = () => {
    const dummyData: RekoFormData = {
      is_relevant: Math.random() > 0.2, // 80% relevant
      dangers_json: {
        fire: false, // Not shown in form - if there's fire, reko isn't needed
        fire_danger: false,
        explosion: false,
        collapse: false,
        chemical: false,
        electrical: false,
        other_notes: '',
        ...generateRandomDangers()
      },
      effort_json: {
        personnel_count: null,
        vehicles_needed: [],
        equipment_needed: [],
        estimated_duration_hours: null,
        ...generateRandomEffort()
      },
      power_supply: generateRandomPowerSupply(),
      photos_json: formData.photos_json, // Keep existing photos
      summary_text: generateRandomSummary(),
      additional_notes: Math.random() > 0.5 ? 'Automatisch generierte Übungsdaten' : ''
    };

    setFormData(dummyData);
  };

  // Validate access and load existing data
  useEffect(() => {
    async function init() {
      if (!incidentId || !token) {
        setValidationError('Ungültiger Link. Bitte QR-Code erneut scannen.')
        setIsLoading(false)
        return
      }

      try {
        // Load incident details and existing draft/report
        const data = await apiClient.getRekoForm(incidentId, token, personnelId)

        setIncidentTitle(data.incident_title || 'Unbekannt')
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

        // Use localStorage data if it exists and has meaningful content
        // (user was likely editing offline)
        if (localData && (localData.summary_text || localData.is_relevant !== null)) {
          setFormData(localData)
          toast.info('Lokale Änderungen wiederhergestellt', {
            description: 'Ihre zuvor eingegebenen Daten wurden geladen.'
          })
        } else {
          setFormData(serverData)
        }
        setLocalStorageLoaded(true)
      } catch (error) {
        console.error('Failed to load form:', error)
        setValidationError('Fehler beim Laden des Formulars. Token möglicherweise ungültig.')
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

  // Auto-save draft to server every 30 seconds (backup to server)
  useEffect(() => {
    if (!incidentId || !token || isLoading) return

    const interval = setInterval(() => {
      saveDraft()
    }, 30000)

    return () => clearInterval(interval)
  }, [formData, incidentId, token, isLoading])

  const saveDraft = useCallback(async () => {
    if (isSaving || isSubmitting || !incidentId || !token) return

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
  }, [formData, incidentId, token, isSaving, isSubmitting])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (formData.is_relevant === null) {
      toast.error('Bitte "Einsatz relevant?" beantworten')
      return
    }

    if (!incidentId || !token) return

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

      // Redirect to success page with return URL for back button functionality
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
      toast.error('Fehler beim Übermitteln. Bitte erneut versuchen.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function updateFormData<K extends keyof RekoFormData>(
    key: K,
    value: RekoFormData[K]
  ) {
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
            <span className="text-sm text-muted-foreground">Kontakt / Melder: </span>
            <a
              href={`tel:${incidentDetails.contact.replace(/\s/g, '')}`}
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
        className={`w-full h-12 ${arrivedAt ? 'bg-muted text-muted-foreground' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
      >
        {isMarkingArrived ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Melde Ankunft...
          </>
        ) : arrivedAt ? (
          <>
            <Check className="mr-2 h-5 w-5" />
            Ankunft gemeldet ({arrivedAt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })})
          </>
        ) : (
          <>
            <MapPin className="mr-2 h-5 w-5" />
            Ich bin vor Ort
          </>
        )}
      </Button>

      {/* Section 1: Basic Confirmation */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Einsatz relevant? *
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant={formData.is_relevant === true ? 'default' : 'outline'}
            onClick={() => updateFormData('is_relevant', true)}
            className="h-12 text-base"
          >
            Ja
          </Button>
          <Button
            type="button"
            variant={formData.is_relevant === false ? 'default' : 'outline'}
            onClick={() => updateFormData('is_relevant', false)}
            className="h-12 text-base"
          >
            Nein
          </Button>
        </div>
      </div>

      <Separator />

      {/* Section 2: Dangers Assessment */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Gefahren
        </Label>

        <div className="space-y-2">
          {[
            { key: 'fire_danger', label: 'Brandgefahr' },
            { key: 'explosion', label: 'Explosionsgefahr' },
            { key: 'collapse', label: 'Einsturzgefahr' },
            { key: 'chemical', label: 'Gefahrstoffe' },
            { key: 'electrical', label: 'Elektrische Gefahr' }
          ].map(({ key, label }) => (
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
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>

        <div className="pt-2">
          <Label htmlFor="danger-other" className="text-sm mb-1.5 block">Weitere Gefahren</Label>
          <Textarea
            id="danger-other"
            value={formData.dangers_json.other_notes || ''}
            onChange={(e) => updateFormData('dangers_json', {
              ...formData.dangers_json,
              other_notes: e.target.value
            })}
            placeholder="Beschreibung..."
            rows={2}
          />
        </div>
      </div>

      <Separator />

      {/* Section 3: Effort Assessment */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Aufwand
        </Label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="personnel-count" className="text-sm mb-1.5 block">Personal (Anz.)</Label>
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
              placeholder="z.B. 10"
              className="h-11"
            />
          </div>

          <div>
            <Label htmlFor="duration" className="text-sm mb-1.5 block">Dauer (Std.)</Label>
            <Input
              id="duration"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={formData.effort_json.estimated_duration_hours || ''}
              onChange={(e) => updateFormData('effort_json', {
                ...formData.effort_json,
                estimated_duration_hours: e.target.value ? parseFloat(e.target.value) : null
              })}
              placeholder="z.B. 2"
              className="h-11"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Section 4: Power Supply */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Stromversorgung
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'unknown', label: 'Unbekannt' },
            { value: 'available', label: 'Vorhanden' },
            { value: 'unavailable', label: 'Nicht vorhanden' },
            { value: 'emergency_needed', label: 'Notstrom nötig' }
          ].map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              variant={formData.power_supply === value ? 'default' : 'outline'}
              onClick={() => updateFormData('power_supply', value)}
              className="h-11 text-sm"
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Photo Upload */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Fotos
        </Label>
        <PhotoUpload
          photos={formData.photos_json}
          incidentId={incidentId!}
          token={token!}
          onPhotosChange={(photos) => updateFormData('photos_json', photos)}
        />
      </div>

      <Separator />

      {/* Summary */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Zusammenfassung
        </Label>

        <div>
          <Label htmlFor="summary" className="text-sm mb-1.5 block">Kurzzusammenfassung</Label>
          <Textarea
            id="summary"
            value={formData.summary_text}
            onChange={(e) => updateFormData('summary_text', e.target.value)}
            placeholder="Wichtigste Erkenntnisse..."
            rows={3}
          />
        </div>

        <div>
          <Label htmlFor="notes" className="text-sm mb-1.5 block">Zusätzliche Notizen</Label>
          <Textarea
            id="notes"
            value={formData.additional_notes}
            onChange={(e) => updateFormData('additional_notes', e.target.value)}
            placeholder="Weitere Bemerkungen..."
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
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Übermitteln...
            </>
          ) : (
            <>
              <Send className="mr-2 h-5 w-5" />
              Meldung übermitteln
            </>
          )}
        </Button>

        {/* Auto-save indicator */}
        <p className="text-xs text-center text-muted-foreground">
          {lastSaved ? (
            <>Gespeichert um {lastSaved.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}</>
          ) : (
            <>Wird automatisch gespeichert</>
          )}
        </p>
      </div>
    </form>
  )
}
