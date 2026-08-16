'use client'

/**
 * «Neue Meldung» — reporting a Schadenplatz from the field (plan 26, decision 14).
 *
 * The difference from the phone desk's `/alarm` form is who is filling it in:
 * a **known person standing in front of the thing**. That is why there are no
 * Melder fields (they are the Melder), why the location offers their own GPS,
 * and why there is a switch the phone desk could never have.
 *
 * **"Wir übernehmen das gleich"** is not a transfer. If the crew is working an
 * Auftrag, this becomes another stop on it and the route's resources already
 * cover it; if they are on a single job, that job and this one become a route.
 * The server decides which, and says so — the confirmation is specific because
 * "gespeichert" tells a crew nothing about whether the KP now expects them
 * there.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, MapPin } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { FooterSheet } from '@/components/ui/footer-sheet'
import { apiClient, type ApiFeldIncidentCreated } from '@/lib/api-client'
import { INCIDENT_TYPE_LABELS } from '@/lib/types/incidents'
import type { IncidentType } from '@/lib/types/incidents'

/**
 * The four a storm night is actually made of, in the order they come up.
 *
 * The full list is thirteen and lives on the board — a phone in the rain gets
 * the ones a crew reports, and "Diverse Einsätze" catches the rest. The KP can
 * re-type it in two seconds if the guess was wrong.
 */
const FIELD_TYPES: IncidentType[] = [
  'elementarereignis',
  'technische_hilfeleistung',
  'oelwehr',
  'diverse_einsaetze',
]

interface FeldMeldenSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  personnelId: string
  token: string
  /** True when this person holds the Telefondienst role — the phone desk is a
   *  role rather than a page since plan 26 (decision 6), so the same sheet
   *  writes down a call when the person taking it is the one on the phone. */
  isPhoneDesk?: boolean
  /** Refresh the list: a taken-over Meldung appears on it immediately. */
  onReported: (result: ApiFeldIncidentCreated) => void
}

export function FeldMeldenSheet({
  open,
  onOpenChange,
  personnelId,
  token,
  isPhoneDesk,
  onReported,
}: FeldMeldenSheetProps) {
  const t = useTranslations('feld.melden')
  const [type, setType] = useState<IncidentType>('elementarereignis')
  const [address, setAddress] = useState('')
  const [description, setDescription] = useState('')
  const [takeOver, setTakeOver] = useState(false)
  const [coords, setCoords] = useState<{ lat: string; lng: string } | null>(null)
  const [contact, setContact] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [locating, setLocating] = useState(false)
  const [sending, setSending] = useState(false)

  const reset = () => {
    setType('elementarereignis')
    setAddress('')
    setDescription('')
    setTakeOver(false)
    setCoords(null)
    setContact('')
    setContactPhone('')
  }

  /** The reporter is standing there, so their own position is the best address
   *  they have — and typing a street name one-handed in the rain is the worst. */
  const locate = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      position => {
        setCoords({
          lat: position.coords.latitude.toFixed(6),
          lng: position.coords.longitude.toFixed(6),
        })
        setLocating(false)
      },
      error => {
        console.error('Geolocation failed:', error)
        setLocating(false)
        toast.error(t('locateFailed'))
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  const submit = async () => {
    // The address is what the KP dispatches against; coordinates alone are a
    // dot nobody can read out over the radio, so one of the two must exist.
    if (!address.trim() && !coords) return
    setSending(true)
    try {
      const result = await apiClient.createFeldIncident(personnelId, token, {
        // The title is what the board shows on the card. The address is the
        // most useful thing a crew can put there and the one they always have.
        title: address.trim() || INCIDENT_TYPE_LABELS[type],
        type,
        priority: 'medium',
        location_address: address.trim() || null,
        location_lat: coords?.lat ?? null,
        location_lng: coords?.lng ?? null,
        description: description.trim() || null,
        take_over: takeOver,
        as_phone_call: Boolean(isPhoneDesk),
        contact: isPhoneDesk ? contact.trim() || null : null,
        contact_phone: isPhoneDesk ? contactPhone.trim() || null : null,
      })
      toast.success(t(`confirm.${result.takeover}`))
      onReported(result)
      reset()
      onOpenChange(false)
    } catch (error) {
      console.error('Field report failed:', error)
      toast.error(t('failed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <FooterSheet open={open} onOpenChange={onOpenChange} className="max-w-md mx-auto px-4 py-4">
      <h2 className="mb-3 text-lg font-semibold">{isPhoneDesk ? t('titlePhone') : t('title')}</h2>

      <div className="space-y-4">
        <div>
          <Label className="text-xs font-semibold text-muted-foreground">{t('what')}</Label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {FIELD_TYPES.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => setType(option)}
                className={`min-h-9 rounded-lg border px-3 text-sm transition-colors ${
                  type === option
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border bg-muted hover:bg-secondary'
                }`}
              >
                {INCIDENT_TYPE_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="feld-melden-address" className="text-xs font-semibold text-muted-foreground">
            {t('where')}
          </Label>
          <Input
            id="feld-melden-address"
            value={address}
            onChange={event => setAddress(event.target.value)}
            placeholder={t('wherePlaceholder')}
            className="mt-1.5"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={locate} disabled={locating}>
              {locating ? <Loader2 className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />}
              {t('useLocation')}
            </Button>
            {coords && <span className="text-xs text-muted-foreground">{t('located')}</span>}
          </div>
        </div>

        <div>
          <Label htmlFor="feld-melden-description" className="text-xs font-semibold text-muted-foreground">
            {t('description')}
          </Label>
          <Textarea
            id="feld-melden-description"
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder={t('descriptionPlaceholder')}
            className="mt-1.5 min-h-20"
          />
        </div>

        {/* The Melder — only for somebody taking a call. A firefighter standing
            in front of the thing IS the Melder, and their name is already on
            the audit row, so asking them who reported it is asking twice. */}
        {isPhoneDesk && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="feld-melden-contact" className="text-xs font-semibold text-muted-foreground">
                {t('caller')}
              </Label>
              <Input
                id="feld-melden-contact"
                value={contact}
                onChange={event => setContact(event.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="feld-melden-phone" className="text-xs font-semibold text-muted-foreground">
                {t('callerPhone')}
              </Label>
              <Input
                id="feld-melden-phone"
                inputMode="tel"
                value={contactPhone}
                onChange={event => setContactPhone(event.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>
        )}

        {/* The switch the phone desk could never have: the person reporting is
            the person who can do it. What it does depends on what they are
            already working — the server decides and the confirmation says so. */}
        {!isPhoneDesk && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/10 p-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t('takeOver')}</div>
            <div className="text-xs text-muted-foreground">{t('takeOverHint')}</div>
          </div>
          <Switch checked={takeOver} onCheckedChange={setTakeOver} />
        </div>
        )}

        <Button
          size="lg"
          className="w-full"
          onClick={submit}
          disabled={sending || (!address.trim() && !coords)}
        >
          {sending && <Loader2 className="size-4 animate-spin" />}
          {t('submit')}
        </Button>
      </div>
    </FooterSheet>
  )
}
