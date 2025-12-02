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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2, AlertCircle, Send, Loader2, MapPin, Info, Binoculars } from 'lucide-react'
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

  const [formData, setFormData] = useState<RekoFormData>(INITIAL_FORM_DATA)
  const [incidentTitle, setIncidentTitle] = useState<string>('')
  const [incidentDetails, setIncidentDetails] = useState<{
    location?: string
    type?: string
    description?: string
  }>({})
  const [assignedPersonnelName, setAssignedPersonnelName] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isTraining, setIsTraining] = useState(false)

  // Dummy data generation functions for training mode
  const generateRandomDangers = (): Partial<ApiDangersAssessment> => {
    const allDangers: Array<keyof ApiDangersAssessment> = ['fire', 'explosion', 'collapse', 'chemical', 'electrical'];
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

  const handleGenerateDummyData = () => {
    const dummyData: RekoFormData = {
      is_relevant: Math.random() > 0.2, // 80% relevant
      dangers_json: {
        fire: false,
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
    toast.success('Dummy-Daten generiert');
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
          description: data.incident_description || undefined
        })

        // Set assigned personnel name if available
        setAssignedPersonnelName(data.submitted_by_personnel_name || null)

        // NOTE: When backend is implemented, the getRekoForm response should include
        // the event's training_flag so we can enable training features
        // For now, this will be false (production mode)
        // Backend should add: event_training_flag: boolean to ApiRekoFormResponse
        // setIsTraining(data.event_training_flag || false)

        // Load existing report/draft
        setFormData({
          is_relevant: data.is_relevant,
          dangers_json: data.dangers_json || INITIAL_FORM_DATA.dangers_json,
          effort_json: data.effort_json || INITIAL_FORM_DATA.effort_json,
          power_supply: data.power_supply || 'unknown',
          photos_json: data.photos_json || [],
          summary_text: data.summary_text || '',
          additional_notes: data.additional_notes || ''
        })
      } catch (error) {
        console.error('Failed to load form:', error)
        setValidationError('Fehler beim Laden des Formulars. Token möglicherweise ungültig.')
      } finally {
        setIsLoading(false)
      }
    }

    init()
  }, [incidentId, token, personnelId])

  // Auto-save draft every 30 seconds
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

      toast.success('Meldung erfolgreich übermittelt')

      // Redirect to success page with token for back button functionality
      setTimeout(() => {
        router.push(`/reko/success?id=${incidentId}&token=${token}`)
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
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Training Mode Dummy Data Generator */}
      <RekoDummyGenerator
        isTraining={isTraining}
        onGenerate={handleGenerateDummyData}
      />

      {/* Incident Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <MapPin className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              {incidentDetails.location || incidentTitle}
            </CardTitle>
            {assignedPersonnelName && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground bg-muted px-2 py-1 rounded-md">
                <Binoculars className="h-4 w-4" />
                <span>{assignedPersonnelName}</span>
              </div>
            )}
          </div>
          {incidentDetails.type && (
            <CardDescription className="capitalize">
              {incidentDetails.type.replace(/_/g, ' ')}
            </CardDescription>
          )}
        </CardHeader>
        {incidentDetails.description && (
          <CardContent className="pt-0">
            <div className="flex items-start gap-2 text-sm">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="text-muted-foreground">{incidentDetails.description}</span>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Section 1: Basic Confirmation */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">
            1
          </span>
          Grundlagen
        </h3>

        <div className="space-y-2">
          <Label className="text-base">Ist der Einsatz relevant? *</Label>
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant={formData.is_relevant === true ? 'default' : 'outline'}
              onClick={() => updateFormData('is_relevant', true)}
              className="h-14 text-lg font-medium"
            >
              Ja
            </Button>
            <Button
              type="button"
              variant={formData.is_relevant === false ? 'default' : 'outline'}
              onClick={() => updateFormData('is_relevant', false)}
              className="h-14 text-lg font-medium"
            >
              Nein
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      {/* Section 2: Dangers Assessment */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">
            2
          </span>
          Gefahren
        </h3>

        <div className="space-y-3">
          <Label className="text-base">
            Welche Gefahren bestehen? (Mehrfachauswahl)
          </Label>

          {[
            { key: 'fire', label: 'Feuer/Brand' },
            { key: 'explosion', label: 'Explosionsgefahr' },
            { key: 'collapse', label: 'Einsturzgefahr' },
            { key: 'chemical', label: 'Gefahrstoffe (chemisch)' },
            { key: 'electrical', label: 'Elektrische Gefahr' }
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center space-x-3 py-1">
              <Checkbox
                id={`danger-${key}`}
                checked={formData.dangers_json[key as keyof ApiDangersAssessment] as boolean}
                onCheckedChange={(checked) => updateFormData('dangers_json', {
                  ...formData.dangers_json,
                  [key]: checked === true
                })}
                className="h-6 w-6"
              />
              <Label htmlFor={`danger-${key}`} className="font-normal cursor-pointer text-base">
                {label}
              </Label>
            </div>
          ))}

          <div className="mt-3">
            <Label htmlFor="danger-other" className="text-base">Weitere Gefahren</Label>
            <Textarea
              id="danger-other"
              value={formData.dangers_json.other_notes || ''}
              onChange={(e) => updateFormData('dangers_json', {
                ...formData.dangers_json,
                other_notes: e.target.value
              })}
              placeholder="Weitere Gefahren beschreiben..."
              rows={3}
              className="text-base"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Section 3: Effort Assessment */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">
            3
          </span>
          Aufwand
        </h3>

        <div className="space-y-3">
          <div>
            <Label htmlFor="personnel-count" className="text-base">Geschätzter Personalaufwand (Anzahl Personen)</Label>
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
              className="h-12 text-lg"
            />
          </div>

          <div>
            <Label htmlFor="duration" className="text-base">Geschätzte Dauer (Stunden)</Label>
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
              placeholder="z.B. 2.5"
              className="h-12 text-lg"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Section 4: Power Supply */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">
            4
          </span>
          Stromversorgung
        </h3>

        <div className="space-y-2">
          <Label className="text-base">Stromversorgung vor Ort</Label>
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant={formData.power_supply === 'unknown' ? 'default' : 'outline'}
              onClick={() => updateFormData('power_supply', 'unknown')}
              className="h-14 text-base font-medium"
            >
              Unbekannt
            </Button>
            <Button
              type="button"
              variant={formData.power_supply === 'available' ? 'default' : 'outline'}
              onClick={() => updateFormData('power_supply', 'available')}
              className="h-14 text-base font-medium"
            >
              Vorhanden
            </Button>
            <Button
              type="button"
              variant={formData.power_supply === 'unavailable' ? 'default' : 'outline'}
              onClick={() => updateFormData('power_supply', 'unavailable')}
              className="h-14 text-base font-medium"
            >
              Nicht vorhanden
            </Button>
            <Button
              type="button"
              variant={formData.power_supply === 'emergency_needed' ? 'default' : 'outline'}
              onClick={() => updateFormData('power_supply', 'emergency_needed')}
              className="h-14 text-base font-medium"
            >
              Notstrom benötigt
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      {/* Photo Upload */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Fotos (optional)</h3>
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
        <h3 className="text-lg font-semibold">Zusammenfassung</h3>

        <div>
          <Label htmlFor="summary" className="text-base">Kurzzusammenfassung</Label>
          <Textarea
            id="summary"
            value={formData.summary_text}
            onChange={(e) => updateFormData('summary_text', e.target.value)}
            placeholder="Wichtigste Erkenntnisse zusammenfassen..."
            rows={4}
            className="text-base"
          />
        </div>

        <div>
          <Label htmlFor="notes" className="text-base">Zusätzliche Notizen</Label>
          <Textarea
            id="notes"
            value={formData.additional_notes}
            onChange={(e) => updateFormData('additional_notes', e.target.value)}
            placeholder="Weitere Bemerkungen..."
            rows={3}
            className="text-base"
          />
        </div>
      </div>

      {/* Auto-save indicator */}
      {lastSaved && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          Zuletzt gespeichert: {lastSaved.toLocaleTimeString('de-CH')}
        </div>
      )}

      {/* Action Buttons */}
      <div className="pt-4">
        <Button
          type="submit"
          disabled={isSubmitting || isSaving}
          className="w-full h-16 text-lg font-semibold"
          size="lg"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Wird übermittelt...
            </>
          ) : (
            <>
              <Send className="mr-2 h-5 w-5" />
              Meldung übermitteln
            </>
          )}
        </Button>
      </div>

      {/* Help Text */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="text-sm">
          Das Formular wird automatisch alle 30 Sekunden gespeichert.
          Sie können es jederzeit verlassen und später weiterbearbeiten.
        </AlertDescription>
      </Alert>
    </form>
  )
}
