'use client'

/**
 * «Neue Meldung» / «Anruf erfassen» — one sheet, two jobs (plan 26, decision 14).
 *
 * The difference from the phone desk's `/alarm` form is who is filling it in:
 * a **known person standing in front of the thing**. That is why there are no
 * Melder fields (they are the Melder), why the location offers their own GPS,
 * and why there is a switch the phone desk could never have.
 *
 * **Two shapes, on purpose.** Somebody on the Telefondienst is sitting at a
 * desk taking a call, so their form is `/alarm`: Meldung, Priorität, all
 * thirteen Einsatzarten, Melder and Telefon. A crew reporting a tree is
 * one-handed in the rain, so theirs stays four pills and an address — the KP
 * re-types a wrong guess in two seconds, and a seven-field form is the reason
 * nothing gets reported at all. Keeping them the same would mean picking which
 * of the two to make worse.
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
import { Check, ChevronsUpDown, Loader2, LocateFixed } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LocationInput } from '@/components/location/location-input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { FooterSheet } from '@/components/ui/footer-sheet'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { apiClient, type ApiFeldIncidentCreated } from '@/lib/api-client'
import { reverseGeocode } from '@/lib/geocoding'
import { PRIORITY_LABELS } from '@/lib/priority'
import { cn } from '@/lib/utils'
import { INCIDENT_TYPE_LABELS } from '@/lib/types/incidents'
import type { IncidentPriority, IncidentType } from '@/lib/types/incidents'

/** The one label style the whole sheet uses — the same one `/alarm` uses, which
 *  is what stopped the location field (its own component) looking like a
 *  different form bolted into the middle of this one. */
const LABEL = 'text-sm font-semibold text-muted-foreground'

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
  /** False for a Reko trupp with no crew work of their own: they were sent to
   *  LOOK and report back, so «wir übernehmen das gleich» is not theirs to say.
   *  Somebody who is reko AND on a crew still gets the switch — see the page. */
  canTakeOver?: boolean
  /** Refresh the list: a taken-over Meldung appears on it immediately. */
  onReported: (result: ApiFeldIncidentCreated) => void
}

export function FeldMeldenSheet({
  open,
  onOpenChange,
  personnelId,
  token,
  isPhoneDesk,
  canTakeOver = true,
  onReported,
}: FeldMeldenSheetProps) {
  const t = useTranslations('feld.melden')
  const [type, setType] = useState<IncidentType>('elementarereignis')
  const [typeOpen, setTypeOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<IncidentPriority>('medium')
  const [address, setAddress] = useState<string | null>(null)
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [takeOver, setTakeOver] = useState(false)
  const [contact, setContact] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [locating, setLocating] = useState(false)
  const [sending, setSending] = useState(false)

  // The phone desk never gets the switch either: they are sitting at a phone,
  // not standing in front of the thing.
  const offerTakeOver = canTakeOver && !isPhoneDesk

  const reset = () => {
    setType('elementarereignis')
    setTitle('')
    setPriority('medium')
    setAddress(null)
    setLat(null)
    setLng(null)
    setDescription('')
    setTakeOver(false)
    setContact('')
    setContactPhone('')
  }

  /** The reporter is standing there, so their own position is the best address
   *  they have — and typing a street name one-handed in the rain is the worst. */
  const locate = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async position => {
        const { latitude, longitude } = position.coords
        setLat(latitude)
        setLng(longitude)
        // A coordinate is not an address: the KP dispatches against a street and
        // reads it out over the radio. So the pin is turned into words, and the
        // crew can correct them — «Standort erfasst» with an empty field was a
        // button that looked like it had done something and had not.
        try {
          const label = await reverseGeocode(latitude, longitude)
          if (label) setAddress(current => current?.trim() || label)
        } catch (error) {
          console.error('Reverse geocoding failed:', error)
        }
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
    const street = address?.trim() ?? ''
    // The phone desk types what was reported; a crew in the field does not, and
    // the address is the most useful title they always have.
    const meldung = isPhoneDesk ? title.trim() : ''
    if (!street && lat === null) return
    if (isPhoneDesk && !meldung) return
    setSending(true)
    try {
      const result = await apiClient.createFeldIncident(personnelId, token, {
        // The title is what the board shows on the card. The address is the
        // most useful thing a crew can put there and the one they always have.
        title: meldung || street || INCIDENT_TYPE_LABELS[type],
        type,
        priority,
        location_address: street || null,
        location_lat: lat === null ? null : lat.toFixed(6),
        location_lng: lng === null ? null : lng.toFixed(6),
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
        {/* Four pills in the rain, all thirteen at the desk. The pills are not
            a lesser version of the picker — they are the four a storm night is
            made of, reachable in one tap with a wet glove. */}
        {!isPhoneDesk && (
          <div>
            <Label className={LABEL}>{t('what')}</Label>
            <div className="mt-2 flex flex-wrap gap-2">
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
        )}

        {/* The same control the phone desk gets on /alarm: type-ahead against
            the geocoder, a map to tap, coordinates to paste. A crew reporting a
            tree on a road it cannot name needs the map more than the KP does. */}
        <LocationInput
          address={address}
          latitude={lat}
          longitude={lng}
          onAddressChange={setAddress}
          onCoordinatesChange={(nextLat, nextLng) => {
            setLat(nextLat)
            setLng(nextLng)
          }}
          disabled={sending}
          // Third way of setting the same field, so it sits with the other two
          // rather than on a line of its own underneath. Only for somebody
          // standing in front of the thing: the phone desk's own position is
          // the fire station, so the button would confidently fill in the
          // wrong address.
          extraAction={
            isPhoneDesk ? undefined : (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={locate}
                disabled={locating || sending}
                title={t('useLocation')}
                tabIndex={-1}
              >
                {locating ? <Loader2 className="size-4 animate-spin" /> : <LocateFixed className="size-4" />}
              </Button>
            )
          }
        />

        {/* Meldung, Priorität, Einsatzart — the three `/alarm` has and a crew
            in the field does not need. Somebody taking a call has both hands
            and the caller on the line; they are the ones who can answer them. */}
        {isPhoneDesk && (
          <>
            <div>
              <Label htmlFor="feld-melden-title" className={LABEL}>
                {t('message')} <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input
                id="feld-melden-title"
                value={title}
                onChange={event => setTitle(event.target.value)}
                placeholder={t('messagePlaceholder')}
                className="mt-2"
              />
            </div>

            <div>
              <Label className={LABEL}>
                {t('priority')} <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(Object.entries(PRIORITY_LABELS) as [IncidentPriority, string][]).map(([key, label]) => (
                  <Button
                    key={key}
                    type="button"
                    variant={priority === key ? 'default' : 'outline'}
                    onClick={() => setPriority(key)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label className={LABEL}>
                {t('what')} <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Popover open={typeOpen} onOpenChange={setTypeOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={typeOpen}
                    className="mt-2 w-full justify-between font-normal"
                  >
                    {INCIDENT_TYPE_LABELS[type]}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t('typeSearch')} />
                    <CommandList>
                      <CommandEmpty>{t('typeNotFound')}</CommandEmpty>
                      <CommandGroup>
                        {(Object.entries(INCIDENT_TYPE_LABELS) as [IncidentType, string][]).map(([key, label]) => (
                          <CommandItem
                            key={key}
                            value={label}
                            onSelect={() => {
                              setType(key)
                              setTypeOpen(false)
                            }}
                          >
                            <Check className={cn('mr-2 h-4 w-4', type === key ? 'opacity-100' : 'opacity-0')} />
                            {label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </>
        )}

        <div>
          <Label htmlFor="feld-melden-description" className={LABEL}>
            {t('description')}
          </Label>
          <Textarea
            id="feld-melden-description"
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder={t('descriptionPlaceholder')}
            className="mt-2 min-h-20"
          />
        </div>

        {/* The Melder — only for somebody taking a call. A firefighter standing
            in front of the thing IS the Melder, and their name is already on
            the audit row, so asking them who reported it is asking twice. */}
        {isPhoneDesk && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="feld-melden-contact" className={LABEL}>
                {t('caller')}
              </Label>
              <Input
                id="feld-melden-contact"
                value={contact}
                onChange={event => setContact(event.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="feld-melden-phone" className={LABEL}>
                {t('callerPhone')}
              </Label>
              <Input
                id="feld-melden-phone"
                inputMode="tel"
                value={contactPhone}
                onChange={event => setContactPhone(event.target.value)}
                className="mt-2"
              />
            </div>
          </div>
        )}

        {/* The switch the phone desk could never have: the person reporting is
            the person who can do it. What it does depends on what they are
            already working — the server decides and the confirmation says so. */}
        {offerTakeOver && (
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 p-3">
            {/* No explanatory line under it: what it does depends on what the
                crew is already working, the confirmation says which, and a
                sentence that has to hedge is worse than the four words. */}
            <div className="min-w-0 flex-1 text-sm font-medium">{t('takeOver')}</div>
            <Switch checked={takeOver} onCheckedChange={setTakeOver} className="shrink-0" />
          </label>
        )}

        <Button
          size="lg"
          className="w-full"
          onClick={submit}
          disabled={sending || (!address?.trim() && lat === null) || (isPhoneDesk && !title.trim())}
        >
          {sending && <Loader2 className="size-4 animate-spin" />}
          {t('submit')}
        </Button>
      </div>
    </FooterSheet>
  )
}
