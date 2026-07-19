'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2, Plus, Check, ChevronsUpDown, AlertTriangle, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { LocationInput } from '@/components/location/location-input'
import { INCIDENT_TYPE_LABELS, PRIORITY_LABELS } from '@/lib/types/incidents'
import type { IncidentType, IncidentPriority } from '@/lib/types/incidents'
import { apiClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'

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
        <Plus className="mr-2 h-5 w-5" />
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
  const [title, setTitle] = useState('')
  const [type, setType] = useState<IncidentType>('elementarereignis')
  const [priority, setPriority] = useState<IncidentPriority>('medium')
  const [address, setAddress] = useState<string | null>(null)
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [contact, setContact] = useState('')

  const [typeOpen, setTypeOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await apiClient.createIntakeAlarm(token, {
        title: title.trim(),
        type,
        priority,
        location_address: address,
        location_lat: lat !== null ? String(lat) : null,
        location_lng: lng !== null ? String(lng) : null,
        description: description.trim() || null,
        contact: contact.trim() || null,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Plus className="h-6 w-6 text-primary" />
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{eventName}</p>
        {trainingFlag && (
          <span className="mt-2 inline-flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs text-amber-500">
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
      />

      {/* Meldung — what was reported (not the address, that's the location above) */}
      <div>
        <Label htmlFor="title" className="text-sm font-semibold text-muted-foreground">
          {t('messageLabel')}
        </Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('messagePlaceholder')}
          className="mt-2 h-12 text-base"
          required
          autoFocus
        />
      </div>

      {/* Priority — three quick buttons (mobile-friendly, like the Reko form) */}
      <div>
        <Label className="text-sm font-semibold text-muted-foreground">{t('priorityLabel')}</Label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(Object.entries(PRIORITY_LABELS) as [IncidentPriority, string][]).map(([key, label]) => (
            <Button
              key={key}
              type="button"
              variant={priority === key ? 'default' : 'outline'}
              onClick={() => setPriority(key)}
              className="h-12 text-base"
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Type */}
      <div>
        <Label className="text-sm font-semibold text-muted-foreground">{t('typeLabel')}</Label>
        <Popover open={typeOpen} onOpenChange={setTypeOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={typeOpen}
              className="mt-2 h-12 w-full justify-between text-base font-normal"
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

      {/* Description */}
      <div>
        <Label htmlFor="description" className="text-sm font-semibold text-muted-foreground">
          {t('hintsLabel')}
        </Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
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

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={submitting || !title.trim()}>
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {t('submitting')}
          </>
        ) : (
          <>
            <Plus className="mr-2 h-5 w-5" />
            {t('submit')}
          </>
        )}
      </Button>
    </form>
  )
}
