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
 *
 * **Two steps: erfassen, dann lesen.** This is the only entry on `/feld` that
 * creates a Schadenplatz on the board — a wrong house number here sends a squad
 * to the wrong street, and the crew cannot take it back from a phone. So the
 * form hands over to a plain list of what was typed before anything is sent.
 * The same argument the four field actions already make with their one-line
 * "Stimmt das?" panel; this one has five answers to show instead of one, so it
 * gets the step rather than a line.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight, Loader2, LocateFixed } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LocationInput } from '@/components/location/location-input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { FooterSheet } from '@/components/ui/footer-sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiClient, type ApiFeldIncidentCreated, type ApiFeldOwnReport } from '@/lib/api-client'
import { reverseGeocode } from '@/lib/geocoding'
import { PRIORITY_LABELS } from '@/lib/priority'
import { asIncidentType, INCIDENT_TYPE_LABELS } from '@/lib/types/incidents'
import type { IncidentPriority, IncidentType } from '@/lib/types/incidents'
import { sanitizePhoneInput } from '@/lib/utils'

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

interface FeldMeldenSheetBase {
  open: boolean
  onOpenChange: (open: boolean) => void
  personnelId: string
  token: string
  /** True when this person holds the Telefondienst role — the phone desk is a
   *  role rather than a page since plan 26 (decision 6), so the same sheet
   *  writes down a call when the person taking it is the one on the phone. */
  isPhoneDesk?: boolean
}

interface FeldMeldenCreateProps extends FeldMeldenSheetBase {
  editing?: never
  /** False for a Reko trupp with no crew work of their own: they were sent to
   *  LOOK and report back, so «wir übernehmen das gleich» is not theirs to say.
   *  Somebody who is reko AND on a crew still gets the switch — see the page. */
  canTakeOver?: boolean
  /** Refresh the list: a taken-over Meldung appears on it immediately. */
  onReported: (result: ApiFeldIncidentCreated) => void
}

interface FeldMeldenEditProps extends FeldMeldenSheetBase {
  /** The Meldung being corrected. Its presence is what puts the sheet in edit
   *  mode — the form is the same one, prefilled, minus the two things that only
   *  make sense once: «wir übernehmen das gleich» (taking a Schadenplatz on
   *  happens at the moment of reporting, and re-running it on an edit would
   *  rebuild an Auftrag around a crew that has moved on). */
  editing: ApiFeldOwnReport
  canTakeOver?: never
  onReported: (result: ApiFeldOwnReport) => void
}

/** Two modes, one form. The union keeps `onReported` honest: a create hands back
 *  what became of the Meldung, a correction hands back the corrected row. */
export type FeldMeldenSheetProps = FeldMeldenCreateProps | FeldMeldenEditProps

/** Low, in every form that creates an incident. Most Meldungen are ordinary —
 *  a board where every new card claims «Mittel» has nothing left to say "this
 *  one" with, and the card tables already read `low` as the quiet default. */
const DEFAULT_PRIORITY: IncidentPriority = 'low'

/** Same narrowing as `asIncidentType`, for the priority union. Local because
 *  this is the only surface that reads a priority back off the wire. */
function asPriority(value: string | undefined): IncidentPriority {
  return value && value in PRIORITY_LABELS ? (value as IncidentPriority) : DEFAULT_PRIORITY
}

export function FeldMeldenSheet(props: FeldMeldenSheetProps) {
  const { open, onOpenChange, personnelId, token, isPhoneDesk } = props
  const editing = props.editing ?? null
  const canTakeOver = props.editing ? false : (props.canTakeOver ?? true)
  const t = useTranslations('feld.melden')
  // Prefilled from the Meldung in edit mode. The page keys this component by
  // incident id, so opening a different one remounts rather than carrying the
  // last one's text across.
  const [type, setType] = useState<IncidentType>(asIncidentType(editing?.type))
  const [title, setTitle] = useState(editing?.title ?? '')
  const [priority, setPriority] = useState<IncidentPriority>(asPriority(editing?.priority))
  const [address, setAddress] = useState<string | null>(editing?.location_address ?? null)
  const [lat, setLat] = useState<number | null>(editing?.location_lat ? Number(editing.location_lat) : null)
  const [lng, setLng] = useState<number | null>(editing?.location_lng ? Number(editing.location_lng) : null)
  const [description, setDescription] = useState(editing?.description ?? '')
  /** «Weitere Hinweise» — the board's Notizen, separate from the Meldung it is
   *  notes about. Offered to a crew as well as the phone desk: somebody
   *  standing in front of the thing often has the caretaker's number in their
   *  hand, and the alternative was radioing it in. */
  const [notes, setNotes] = useState(editing?.internal_notes ?? '')
  const [takeOver, setTakeOver] = useState(false)
  const [contact, setContact] = useState(editing?.contact ?? '')
  const [contactPhone, setContactPhone] = useState(editing?.contact_phone ?? '')
  const [locating, setLocating] = useState(false)
  const [sending, setSending] = useState(false)
  /** Which half of the sheet is on screen. `review` is never reachable with an
   *  incomplete form — the step button carries the same rule the send button
   *  used to. */
  const [step, setStep] = useState<'form' | 'review'>('form')

  // The phone desk never gets the switch either: they are sitting at a phone,
  // not standing in front of the thing.
  const offerTakeOver = canTakeOver && !isPhoneDesk

  const reset = () => {
    setType('elementarereignis')
    setTitle('')
    setPriority(DEFAULT_PRIORITY)
    setAddress(null)
    setLat(null)
    setLng(null)
    setDescription('')
    setNotes('')
    setTakeOver(false)
    setContact('')
    setContactPhone('')
    setStep('form')
  }

  /** Closing the sheet always comes back to the form. The typed text survives —
   *  a crew that swiped it away to read the address off a house wall must not
   *  lose it — but coming back to a review screen for a Meldung they were in the
   *  middle of writing reads as "this was already sent". */
  const handleOpenChange = (next: boolean) => {
    if (!next) setStep('form')
    onOpenChange(next)
  }

  /** What the review step lists, in the order the form asked for it. Rows with
   *  nothing in them are dropped rather than shown empty: a dash next to
   *  "Beschreibung" is a field somebody starts wondering whether they missed. */
  const reviewRows: { label: string; value: string; hint?: string }[] = [
    ...(isPhoneDesk ? [{ label: t('message'), value: title.trim() }] : []),
    { label: t('what'), value: INCIDENT_TYPE_LABELS[type] },
    ...(isPhoneDesk ? [{ label: t('priority'), value: PRIORITY_LABELS[priority] }] : []),
    {
      label: t('review.where'),
      value: address?.trim() || (lat !== null && lng !== null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : ''),
      // The pin is worth naming when there is also a street: it is what the map
      // opens on, and a crew that tapped "Standort übernehmen" should see that
      // it took.
      hint: address?.trim() && lat !== null && lng !== null ? t('review.hasPin') : undefined,
    },
    ...(isPhoneDesk ? [] : [{ label: t('description'), value: description.trim() }]),
    { label: t('notes'), value: notes.trim() },
    { label: t('caller'), value: contact.trim() },
    { label: t('callerPhone'), value: contactPhone.trim() },
    // Only when the switch was actually offered — "Übernahme: nein" for
    // somebody who was never asked is an answer to a question they did not get.
    ...(offerTakeOver
      ? [{ label: t('review.takeOverLabel'), value: takeOver ? t('review.takeOverYes') : t('review.takeOverNo') }]
      : []),
  ].filter(row => row.value)

  /** Not enough to send: the KP dispatches against a street, so one of address
   *  or pin must exist, and the phone desk always writes down what was said. */
  const locationMissing = !address?.trim() && lat === null
  const messageMissing = Boolean(isPhoneDesk) && !title.trim()
  const incomplete = locationMissing || messageMissing
  /**
   * Why «Weiter» is grey, in one line under the button.
   *
   * Under the button and not as a toast: the reason belongs to the button and
   * has to disappear with the reason, not after five seconds. And it names the
   * CONSEQUENCE — the KP cannot send anybody — rather than the rule, because
   * "Pflichtfeld" is the vocabulary of the form, not of the person standing in
   * front of a fallen tree. The button stays disabled: a button that accepts
   * the tap and then complains is a second failed attempt in the rain.
   */
  const blockedReason = locationMissing
    ? t('needLocation')
    : messageMissing
      ? t('needMessage')
      : null

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
      if (props.editing) {
        const corrected = await apiClient.updateFeldReport(props.editing.incident_id, personnelId, token, {
          // No title: the server keeps it following the address, which is what
          // the card's heading is. Sending one here would freeze a heading that
          // no longer matches the street the correction just changed.
          title: null,
          type,
          priority,
          location_address: street || null,
          location_lat: lat === null ? null : lat.toFixed(6),
          location_lng: lng === null ? null : lng.toFixed(6),
          description: isPhoneDesk ? meldung : description.trim(),
          internal_notes: notes.trim(),
          contact: contact.trim(),
          contact_phone: contactPhone.trim(),
        })
        toast.success(t('editSaved'))
        props.onReported(corrected)
        onOpenChange(false)
        return
      }
      const result = await apiClient.createFeldIncident(personnelId, token, {
        // The card's heading is the ADDRESS — the same choice the board's own
        // «Neuer Einsatz» makes (`title: operation.location`), falling back to
        // what was reported when there is no street.
        title: street || meldung || INCIDENT_TYPE_LABELS[type],
        type,
        priority,
        location_address: street || null,
        location_lat: lat === null ? null : lat.toFixed(6),
        location_lng: lng === null ? null : lng.toFixed(6),
        // The phone desk types the Meldung and, separately, further notes: the
        // Meldung is what the board prints on the card and reads out, the notes
        // are «Notizen». A crew has no second field — what they saw IS the
        // Meldung — so theirs stays the description and adds no notes. Before
        // this, the desk's Meldung went into `title` (invisible the moment
        // there was an address) and the notes overwrote the Meldung.
        description: (isPhoneDesk ? meldung : description.trim()) || null,
        internal_notes: notes.trim() || null,
        take_over: takeOver,
        as_phone_call: Boolean(isPhoneDesk),
        contact: contact.trim() || null,
        contact_phone: contactPhone.trim() || null,
      })
      toast.success(t(`confirm.${result.takeover}`))
      props.onReported(result)
      reset()
      onOpenChange(false)
    } catch (error) {
      console.error('Field report failed:', error)
      // A correction refused because the KP got there first is not a failure of
      // the phone — it is the answer, and the crew has to hear which one it was.
      toast.error(
        props.editing && error instanceof Error && error.message.includes('409')
          ? t('editTooLate')
          : t('failed'),
      )
    } finally {
      setSending(false)
    }
  }

  // ------------------------------------------------------------- review
  // The same sheet, one step on: the form is gone and what was typed is a list.
  // Nothing here is a control — the way to change something is the one button
  // that says so, because a review screen with editable fields in it is just
  // the form again with a more confident heading.
  if (step === 'review') {
    return (
      <FooterSheet open={open} onOpenChange={handleOpenChange} className="max-w-md mx-auto px-4 py-4">
        <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t('review.stepForm')}</span>
          <ChevronRight className="size-3" />
          <span className="font-medium text-foreground">{t('review.stepCheck')}</span>
        </p>
        <h2 className="mb-3 text-lg font-semibold">{editing ? t('review.editTitle') : t('review.title')}</h2>

        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-border">
            {reviewRows.map(row => (
              <div
                key={row.label}
                className="flex gap-3 border-b border-border/50 px-3 py-2.5 text-sm last:border-b-0"
              >
                <span className="w-24 shrink-0 pt-px text-xs text-muted-foreground">{row.label}</span>
                <span className="min-w-0 flex-1 leading-snug">
                  {row.value}
                  {row.hint && <span className="block text-xs text-muted-foreground">{row.hint}</span>}
                </span>
              </div>
            ))}
          </div>

          <Button size="lg" className="w-full" onClick={submit} disabled={sending}>
            {sending && <Loader2 className="size-4 animate-spin" />}
            {editing ? t('editSubmit') : t('submit')}
          </Button>
          {/* Back, not "Abbrechen": the way out of the sheet is the sheet's own
              swipe, and a crew that spotted a wrong house number wants the field
              it is in — not their Meldung thrown away. */}
          <Button variant="ghost" size="lg" className="w-full" disabled={sending} onClick={() => setStep('form')}>
            <ChevronLeft className="size-4" />
            {t('review.back')}
          </Button>
        </div>
      </FooterSheet>
    )
  }

  return (
    <FooterSheet open={open} onOpenChange={handleOpenChange} className="max-w-md mx-auto px-4 py-4">
      <h2 className="mb-3 text-lg font-semibold">
        {editing ? t('editTitle') : isPhoneDesk ? t('titlePhone') : t('title')}
      </h2>
      {/* When it was sent, and that it can still be changed. The window closes
          the moment the KP disponiert — saying so here is what stops a crew
          discovering it at the "zu spät" toast. */}
      {editing && <p className="-mt-2 mb-3 text-xs text-muted-foreground">{t('editHint')}</p>}

      <div className="space-y-4">
        {/* Four options in the rain, all thirteen at the desk. A Select rather
            than the old pill row: four pills wrapped onto two ragged lines on a
            phone, and «Elementarereignis» is the right default on a storm night
            anyway — the other three are one tap into the dropdown. The KP
            re-types a wrong guess in two seconds. */}
        {!isPhoneDesk && (
          <div>
            <Label className={LABEL}>{t('what')}</Label>
            <Select value={type} onValueChange={value => setType(value as IncidentType)}>
              <SelectTrigger className="mt-2 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* A correction can carry a type the KP set that is not one of
                    the field four — keep it selectable instead of blanking the
                    trigger. */}
                {(FIELD_TYPES.includes(type) ? FIELD_TYPES : [type, ...FIELD_TYPES]).map(option => (
                  <SelectItem key={option} value={option}>
                    {INCIDENT_TYPE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* The same control the phone desk gets on /alarm: type-ahead against
            the geocoder, a map to tap, coordinates to paste. A crew reporting a
            tree on a road it cannot name needs the map more than the KP does. */}
        <LocationInput
          required
          address={address}
          latitude={lat}
          longitude={lng}
          onAddressChange={setAddress}
          onCoordinatesChange={(nextLat, nextLng) => {
            setLat(nextLat)
            setLng(nextLng)
          }}
          disabled={sending}
          // The field the whole Meldung hangs on, marked as such: the red
          // outline and the star are the same pair the phone-desk fields
          // already wear, and this is the one that actually blocks «Weiter».
          error={locationMissing}
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
        {/* The three ways in, named once. The field offers all of them and
            looked like it only took typing — and the GPS button is an icon
            whose label is a tooltip nobody sees on a phone. Only while the
            field is empty: once there is an address it is an instruction for
            work already done. */}
        {locationMissing && (
          <p className="-mt-3 text-xs text-muted-foreground">
            {isPhoneDesk ? t('locationHintPhone') : t('locationHint')}
          </p>
        )}

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
              {/* A plain Select, like the board's own «Neuer Einsatz» modal.
                  The searchable Popover `/alarm` uses is right on a full page
                  and wrong inside a bottom sheet: it portals to the body and
                  collision-detects against the viewport, so on a phone it landed
                  across the sheet's own header. Thirteen items scroll fine. */}
              <Select value={type} onValueChange={value => setType(value as IncidentType)}>
                <SelectTrigger className="mt-2 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(INCIDENT_TYPE_LABELS) as [IncidentType, string][]).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* What was seen. For the phone desk this is «Meldung» above — they
            are writing down somebody else's words — so they do not get a second
            field for the same thing. */}
        {!isPhoneDesk && (
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
        )}

        {/* Notizen, not Meldung: anything that is useful on site but is not
            what happened — the Zufahrt, who has the key, that the dog bites. */}
        <div>
          <Label htmlFor="feld-melden-notes" className={LABEL}>
            {t('notes')}
          </Label>
          <Textarea
            id="feld-melden-notes"
            value={notes}
            onChange={event => setNotes(event.target.value)}
            placeholder={t('notesPlaceholder')}
            className="mt-2 min-h-16"
          />
        </div>

        {/* The Melder, for everybody. It used to be the phone desk's alone, on
            the argument that a firefighter standing in front of the thing IS
            the Melder — true, and beside the point: the person who flagged them
            down, the caretaker with the key, the owner of the flooded cellar all
            have a number the KP will otherwise ask for over the radio. Empty is
            the normal case and costs two blank fields.

            Two rows, not two columns: half a phone width holds neither a name
            nor a Swiss number without scrolling the text out of sight. */}
        <>
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
              {/* `type="tel"` is what puts the number pad up; `inputMode` alone
                  left it a text field on the phone this form is used on. */}
              <Input
                id="feld-melden-phone"
                type="tel"
                inputMode="tel"
                value={contactPhone}
                onChange={event => setContactPhone(sanitizePhoneInput(event.target.value))}
                className="mt-2"
              />
            </div>
        </>

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

        {/* Not "absetzen": this button does not send anything, and a button that
            claims it does is the fat-finger this step exists to catch. */}
        <div className="space-y-2">
          <Button size="lg" className="w-full" onClick={() => setStep('review')} disabled={sending || incomplete}>
            {t('review.next')}
            <ChevronRight className="size-4" />
          </Button>
          {/* Grey button, stated reason — or, once it is ready, what the tap
              leads to. A dead button that says nothing is the complaint this
              answers. */}
          <p
            className={`text-center text-xs ${blockedReason ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {blockedReason ?? t('nextStepHint')}
          </p>
        </div>
      </div>
    </FooterSheet>
  )
}
