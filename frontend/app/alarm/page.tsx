'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Loader2,
  Plus,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { LocationInput } from '@/components/location/location-input'
import { INCIDENT_TYPE_LABELS } from '@/lib/types/incidents'
import type { IncidentType, IncidentPriority } from '@/lib/types/incidents'
import { PRIORITY_LABELS } from '@/lib/priority'
import { apiClient } from '@/lib/api-client'
import { cn, sanitizePhoneInput } from '@/lib/utils'

export default function AlarmPage() {
  return (
    <div className="min-h-screen bg-background px-4 pt-6 pb-24">
      <div className="mx-auto max-w-md">
        <Suspense fallback={<CenteredSpinner />}>
          <AlarmIntake />
        </Suspense>
      </div>
    </div>
  )
}

function CenteredSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}

type Status = 'loading' | 'invalid' | 'ready' | 'success'

function AlarmIntake() {
  const t = useTranslations('intake.alarm')
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [status, setStatus] = useState<Status>('loading')
  const [eventName, setEventName] = useState('')
  const [trainingFlag, setTrainingFlag] = useState(false)

  // Validate the token / load event context on mount.
  useEffect(() => {
    let cancelled = false
    if (!token) {
      setStatus('invalid')
      return
    }
    apiClient
      .getIntakeContext(token)
      .then((ctx) => {
        if (cancelled) return
        setEventName(ctx.event.name)
        setTrainingFlag(ctx.event.training_flag)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('invalid')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  if (status === 'loading') return <CenteredSpinner />

  if (status === 'invalid') {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
        <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-destructive" />
        <h1 className="text-lg font-semibold">{t('invalidTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('invalidDescription')}
        </p>
      </div>
    )
  }

  if (status === 'success') {
    return <SuccessScreen eventName={eventName} onAnother={() => setStatus('ready')} />
  }

  return (
    <AlarmForm
      token={token}
      eventName={eventName}
      trainingFlag={trainingFlag}
      onSuccess={() => setStatus('success')}
    />
  )
}

function SuccessScreen({ eventName, onAnother }: { eventName: string; onAnother: () => void }) {
  const t = useTranslations('intake.alarm')
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
        <Check className="h-7 w-7 text-emerald-500" />
      </div>
      <h1 className="text-lg font-semibold">{t('successTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('successDescription', { eventName })}
      </p>
      <Button className="mt-6 w-full" size="lg" onClick={onAnother}>
        <Plus className="h-5 w-5" />
        {t('another')}
      </Button>
    </div>
  )
}

interface AlarmFormProps {
  token: string
  eventName: string
  trainingFlag: boolean
  onSuccess: () => void
}

function AlarmForm({ token, eventName, trainingFlag, onSuccess }: AlarmFormProps) {
  const t = useTranslations('intake.alarm')
  /** What the caller said the thing IS. Lands in the incident's `description`,
   *  which is the column the board labels «Meldung» — see the submit below. */
  const [message, setMessage] = useState('')
  const [type, setType] = useState<IncidentType>('elementarereignis')
  // Low, like every other incident-creating form: most alarms are ordinary, and
  // a board where every card claims «Mittel» has no way left to say "this one".
  const [priority, setPriority] = useState<IncidentPriority>('low')
  const [address, setAddress] = useState<string | null>(null)
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  /** The extras that came with the call. Lands in `internal_notes` — the board's
   *  «Notizen» — so it sits beside the Meldung instead of overwriting it. */
  const [hints, setHints] = useState('')
  const [contact, setContact] = useState('')
  const [contactPhone, setContactPhone] = useState('')

  const [typeOpen, setTypeOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Erfassen, then read it back. Same two steps as `/feld`'s «Neue Meldung»,
   *  for the same reason: this form puts a Schadenplatz on the board, and a
   *  wrong house number sends a squad to the wrong street. */
  const [step, setStep] = useState<'form' | 'review'>('form')

  const incomplete = !message.trim()

  /** What the review step lists, in the order the form asked for it. Empty rows
   *  are dropped rather than shown blank — a dash next to «Melder» is a field
   *  somebody starts wondering whether they missed. */
  const reviewRows: { label: string; value: string; hint?: string }[] = [
    {
      label: t('review.where'),
      value: address?.trim() || (lat !== null && lng !== null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : ''),
      // Worth naming when there is also a street: the pin is what the map opens
      // on, and it is the half of the answer the operator did not type.
      hint: address?.trim() && lat !== null && lng !== null ? t('review.hasPin') : undefined,
    },
    { label: t('messageLabel'), value: message.trim() },
    { label: t('priorityLabel'), value: PRIORITY_LABELS[priority] },
    { label: t('typeLabel'), value: INCIDENT_TYPE_LABELS[type] },
    { label: t('hintsLabel'), value: hints.trim() },
    { label: t('contactLabel'), value: contact.trim() },
    { label: t('contactPhoneLabel'), value: contactPhone.trim() },
  ].filter(row => row.value)

  const handleSubmit = async () => {
    if (incomplete || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await apiClient.createIntakeAlarm(token, {
        // `title` is the board's address column in all but name: a card reads
        // `location_address || title`, and the board's own «Neuer Einsatz» puts
        // the address here too. The Meldung goes where the board reads it.
        title: address?.trim() || message.trim(),
        type,
        priority,
        location_address: address,
        location_lat: lat !== null ? String(lat) : null,
        location_lng: lng !== null ? String(lng) : null,
        description: message.trim(),
        contact: contact.trim() || null,
        contact_phone: contactPhone.trim() || null,
        internal_notes: hints.trim() || null,
      })
      onSuccess()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t('submitError')
      )
    } finally {
      setSubmitting(false)
    }
  }

  // ------------------------------------------------------------- review
  // What was typed, as a plain list. Nothing here is a control: the way to
  // change something is the one button that says so, because a review screen
  // with editable fields in it is the form again with a bolder heading.
  if (step === 'review') {
    return (
      <div className="space-y-6">
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t('review.stepForm')}</span>
            <ChevronRight className="size-3" />
            <span className="font-medium text-foreground">{t('review.stepCheck')}</span>
          </p>
          <h1 className="text-2xl font-bold">{t('review.title')}</h1>
          {/* Which board this is about to land on. The form says it in its own
              header, and the step that actually sends must not say less. */}
          <p className="mt-1 text-sm text-muted-foreground">{eventName}</p>
          {trainingFlag && (
            <span className="mt-2 inline-flex items-center gap-2 rounded border border-warning/20 bg-warning/10 px-2 py-1 text-xs text-warning-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('trainingMode')}
            </span>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-border">
          {reviewRows.map(row => (
            <div key={row.label} className="flex gap-3 border-b border-border/50 px-3 py-2.5 text-sm last:border-b-0">
              <span className="w-24 shrink-0 pt-px text-xs text-muted-foreground">{row.label}</span>
              <span className="min-w-0 flex-1 leading-snug">
                {row.value}
                {row.hint && <span className="block text-xs text-muted-foreground">{row.hint}</span>}
              </span>
            </div>
          ))}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Button size="lg" className="w-full text-base" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {t('submitting')}
              </>
            ) : (
              <>
                <Plus className="h-5 w-5" />
                {t('submit')}
              </>
            )}
          </Button>
          {/* Back, not "Abbrechen": somebody who spotted a wrong house number
              wants the field it is in, not their alarm thrown away. */}
          <Button variant="ghost" size="lg" className="w-full" disabled={submitting} onClick={() => setStep('form')}>
            <ChevronLeft className="size-4" />
            {t('review.back')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (!incomplete) setStep('review')
      }}
      className="space-y-6"
    >
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Plus className="h-6 w-6 text-primary" />
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{eventName}</p>
        {trainingFlag && (
          <span className="mt-2 inline-flex items-center gap-2 rounded border border-warning/20 bg-warning/10 px-2 py-1 text-xs text-warning-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('trainingMode')}
          </span>
        )}
      </header>

      {/* Location — first, so the address isn't repeated in the message */}
      <LocationInput
        address={address}
        latitude={lat}
        longitude={lng}
        onAddressChange={setAddress}
        onCoordinatesChange={(la, lo) => {
          setLat(la)
          setLng(lo)
        }}
        disabled={submitting}
        // The first thing a caller says is where. Autofocus used to sit on the
        // Meldung below, so the operator typed the address into the wrong field
        // or reached for the mouse before the sentence was finished.
        autoFocus
      />

      {/* Meldung — what was reported (not the address, that's the location above) */}
      <div>
        <Label htmlFor="title" className="text-sm font-semibold text-muted-foreground">
          {t('messageLabel')} <span className="text-destructive" aria-hidden="true">*</span>
        </Label>
        <Input
          id="title"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('messagePlaceholder')}
          className="mt-2 h-12 text-base"
          required
        />
      </div>

      {/* Priority — three quick buttons (mobile-friendly, like the Reko form) */}
      <div>
        <Label className="text-sm font-semibold text-muted-foreground">{t('priorityLabel')} <span className="text-destructive" aria-hidden="true">*</span></Label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(Object.entries(PRIORITY_LABELS) as [IncidentPriority, string][]).map(([key, label]) => (
            <Button
              key={key}
              type="button"
              variant={priority === key ? 'default' : 'outline'}
              onClick={() => setPriority(key)}
              size="lg"
              className="text-base"
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Type */}
      <div>
        <Label className="text-sm font-semibold text-muted-foreground">{t('typeLabel')} <span className="text-destructive" aria-hidden="true">*</span></Label>
        <Popover open={typeOpen} onOpenChange={setTypeOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={typeOpen}
              size="lg"
              className="mt-2 w-full justify-between text-base font-normal"
            >
              {INCIDENT_TYPE_LABELS[type]}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder={t('typeSearchPlaceholder')} />
              <CommandList>
                <CommandEmpty>{t('typeNotFound')}</CommandEmpty>
                <CommandGroup>
                  {Object.entries(INCIDENT_TYPE_LABELS).map(([key, label]) => (
                    <CommandItem
                      key={key}
                      value={label}
                      onSelect={() => {
                        setType(key as IncidentType)
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

      {/* Weitere Hinweise — the board's «Notizen», beside the Meldung above */}
      <div>
        <Label htmlFor="hints" className="text-sm font-semibold text-muted-foreground">
          {t('hintsLabel')}
        </Label>
        <Textarea
          id="hints"
          value={hints}
          onChange={(e) => setHints(e.target.value)}
          placeholder={t('hintsPlaceholder')}
          className="mt-2 min-h-[100px] text-base"
        />
      </div>

      {/* Contact (Melder / Anrufer) */}
      <div>
        <Label htmlFor="contact" className="text-sm font-semibold text-muted-foreground">
          {t('contactLabel')}
        </Label>
        <Input
          id="contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder={t('contactPlaceholder')}
          className="mt-2 h-12 text-base"
        />
      </div>

      {/* Contact phone */}
      <div>
        <Label htmlFor="contact-phone" className="text-sm font-semibold text-muted-foreground">
          {t('contactPhoneLabel')}
        </Label>
        <Input
          id="contact-phone"
          type="tel"
          inputMode="tel"
          value={contactPhone}
          onChange={(e) => setContactPhone(sanitizePhoneInput(e.target.value))}
          placeholder={t('contactPhonePlaceholder')}
          className="mt-2 h-12 text-base"
        />
      </div>

      {/* Not "absenden": this button sends nothing, and a button that claims it
          does is the fat-finger the review step exists to catch. */}
      <Button type="submit" size="lg" className="w-full text-base" disabled={incomplete}>
        {t('review.next')}
        <ChevronRight className="size-4" />
      </Button>
    </form>
  )
}
