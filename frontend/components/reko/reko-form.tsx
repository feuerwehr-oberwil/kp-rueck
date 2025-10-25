'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle2, AlertCircle, Save, Send, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, type ApiDangersAssessment, type ApiEffortEstimation } from '@/lib/api-client'
import PhotoUpload from './photo-upload'

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

  const [formData, setFormData] = useState<RekoFormData>(INITIAL_FORM_DATA)
  const [incidentTitle, setIncidentTitle] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

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
        const data = await apiClient.getRekoForm(incidentId, token)

        setIncidentTitle(data.incident_title || 'Unbekannt')

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
  }, [incidentId, token])

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

  async function handleManualSave() {
    await saveDraft()
    toast.success('Entwurf gespeichert')
  }

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

      // Redirect to success page
      setTimeout(() => {
        router.push(`/reko/success?id=${incidentId}`)
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
      {/* Incident Info */}
      <div className="rounded-lg bg-muted p-4">
        <h3 className="font-semibold">Einsatz</h3>
        <p className="text-sm text-muted-foreground">{incidentTitle}</p>
      </div>

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
          <RadioGroup
            value={formData.is_relevant === null ? '' : formData.is_relevant.toString()}
            onValueChange={(value) => updateFormData('is_relevant', value === 'true')}
            className="flex gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="true" id="relevant-yes" />
              <Label htmlFor="relevant-yes" className="font-normal cursor-pointer">
                Ja
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="false" id="relevant-no" />
              <Label htmlFor="relevant-no" className="font-normal cursor-pointer">
                Nein
              </Label>
            </div>
          </RadioGroup>
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

        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">
            Welche Gefahren bestehen? (Mehrfachauswahl)
          </Label>

          {[
            { key: 'fire', label: 'Feuer/Brand' },
            { key: 'explosion', label: 'Explosionsgefahr' },
            { key: 'collapse', label: 'Einsturzgefahr' },
            { key: 'chemical', label: 'Gefahrstoffe (chemisch)' },
            { key: 'electrical', label: 'Elektrische Gefahr' }
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center space-x-2">
              <input
                type="checkbox"
                id={`danger-${key}`}
                checked={formData.dangers_json[key as keyof ApiDangersAssessment] as boolean}
                onChange={(e) => updateFormData('dangers_json', {
                  ...formData.dangers_json,
                  [key]: e.target.checked
                })}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor={`danger-${key}`} className="font-normal cursor-pointer">
                {label}
              </Label>
            </div>
          ))}

          <div className="mt-2">
            <Label htmlFor="danger-other">Weitere Gefahren</Label>
            <Textarea
              id="danger-other"
              value={formData.dangers_json.other_notes || ''}
              onChange={(e) => updateFormData('dangers_json', {
                ...formData.dangers_json,
                other_notes: e.target.value
              })}
              placeholder="Weitere Gefahren beschreiben..."
              rows={2}
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
            <Label htmlFor="personnel-count">Geschätzter Personalaufwand (Anzahl Personen)</Label>
            <input
              id="personnel-count"
              type="number"
              min="0"
              value={formData.effort_json.personnel_count || ''}
              onChange={(e) => updateFormData('effort_json', {
                ...formData.effort_json,
                personnel_count: e.target.value ? parseInt(e.target.value) : null
              })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="z.B. 10"
            />
          </div>

          <div>
            <Label htmlFor="duration">Geschätzte Dauer (Stunden)</Label>
            <input
              id="duration"
              type="number"
              min="0"
              step="0.5"
              value={formData.effort_json.estimated_duration_hours || ''}
              onChange={(e) => updateFormData('effort_json', {
                ...formData.effort_json,
                estimated_duration_hours: e.target.value ? parseFloat(e.target.value) : null
              })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="z.B. 2.5"
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

        <div>
          <Label htmlFor="power-supply">Stromversorgung vor Ort</Label>
          <Select
            value={formData.power_supply}
            onValueChange={(value) => updateFormData('power_supply', value)}
          >
            <SelectTrigger id="power-supply">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unknown">Unbekannt</SelectItem>
              <SelectItem value="available">Vorhanden</SelectItem>
              <SelectItem value="unavailable">Nicht vorhanden</SelectItem>
              <SelectItem value="emergency_needed">Notstrom benötigt</SelectItem>
            </SelectContent>
          </Select>
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
          <Label htmlFor="summary">Kurzzusammenfassung</Label>
          <Textarea
            id="summary"
            value={formData.summary_text}
            onChange={(e) => updateFormData('summary_text', e.target.value)}
            placeholder="Wichtigste Erkenntnisse zusammenfassen..."
            rows={3}
          />
        </div>

        <div>
          <Label htmlFor="notes">Zusätzliche Notizen</Label>
          <Textarea
            id="notes"
            value={formData.additional_notes}
            onChange={(e) => updateFormData('additional_notes', e.target.value)}
            placeholder="Weitere Bemerkungen..."
            rows={2}
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
      <div className="flex flex-col sm:flex-row gap-3 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={handleManualSave}
          disabled={isSaving || isSubmitting}
          className="flex-1"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Wird gespeichert...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Als Entwurf speichern
            </>
          )}
        </Button>

        <Button
          type="submit"
          disabled={isSubmitting || isSaving}
          className="flex-1"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Wird übermittelt...
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Meldung übermitteln
            </>
          )}
        </Button>
      </div>

      {/* Help Text */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="text-sm">
          Das Formular wird automatisch alle 30 Sekunden als Entwurf gespeichert.
          Sie können es jederzeit verlassen und später weiterbearbeiten.
        </AlertDescription>
      </Alert>
    </form>
  )
}
