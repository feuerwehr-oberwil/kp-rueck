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
  Pencil,
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
import { getApiUrl } from '@/lib/env'
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

/** One row of the form, as the review step and the receipt both show it. */
interface AlarmRow {
  label: string
  value: string
  hint?: string
}

/** Everything the form collected, in the shape the form's own state holds it.
 *  Kept after sending so a correction starts from what was actually typed
 *  rather than from an empty form. */
interface AlarmDraft {
  message: string
  type: IncidentType
  priority: IncidentPriority
  address: string | null
  lat: number | null
  lng: number | null
  hints: string
  contact: string
  contactPhone: string
}

const EMPTY_DRAFT: AlarmDraft = {
  message: '',
  // Low, like every other incident-creating form: most alarms are ordinary, and
  // a board where every card claims «Mittel» has no way left to say "this one".
  type: 'elementarereignis',
  priority: 'low',
  address: null,
  lat: null,
  lng: null,
  hints: '',
  contact: '',
  contactPhone: '',
}

/** What the KP has done with it so far — the two questions a paper receipt
 *  cannot answer. Deliberately carries no content: what was reported is on
 *  this screen already, and echoing the columns back would echo whatever an
 *  operator has since typed into them. */
interface ReceiptState {
  status: string
  editable: boolean
  vehicles: string[]
}

/**
 * The body of a correction — `IntakeAlarmUpdate` on the server.
 *
 * For the text fields, `''` clears and an omitted key leaves it untouched. The
 * coordinates follow their own contract: **explicitly `null` clears the pin,
 * an omitted key leaves it unchanged.** This form always sends its current
 * pin state, which is exactly right — after a freetext address edit the
 * `LocationInput` has already nulled the stale pin (see `commitFreetext`), so
 * the PUT clears it on the server too instead of re-sending coordinates that
 * belong to the previous address.
 *
 * `internal_notes` is optional for a reason of its own: the server *appends*
 * it to «Notizen» rather than assigning it, because an operator writes into
 * that column too and the receipt is not allowed to read it back. So it is
 * sent only when the reporter changed their own Hinweis.
 */
interface IntakeCorrection {
  title: string
  type: IncidentType
  priority: IncidentPriority
  location_address: string
  location_lat: string | null
  location_lng: string | null
  description: string
  contact: string
  contact_phone: string
  internal_notes?: string
}

/**
 * What was sent, kept so it can be read back afterwards.
 *
 * The screen used to end at a green tick and «Weiteren Alarm erfassen», which
 * threw away the only copy of what had just been typed: whether it was
 * Hauptstrasse 12 or 21 could then only be answered by the KP, over the phone.
 * The rows are the same `reviewRows` the «Stimmt das so?» step showed two
 * seconds earlier — no second format, just the same list without a send button.
 *
 * `receiptToken` is what makes the live status and the correction window
 * possible at all: the intake link names an event and no incident, so it can
 * never stand for "this is the alarm I just reported". The token names exactly
 * one incident, is short-lived, and lives in memory only — closing the tab ends
 * the correction window, which is the right side to err on for a slip of paper
 * that anybody at the phone desk can pick up.
 */
interface AlarmReceipt {
  rows: AlarmRow[]
  at: Date
  incidentId: string
  receiptToken: string | null
  draft: AlarmDraft
}

/** How often the receipt asks whether the KP has picked the alarm up. Slow on
 *  purpose: the intake door is rate limited per IP and a station NATs every
 *  phone behind one address. */
const RECEIPT_POLL_MS = 20_000

/** The German `detail` a FastAPI error carries, when it carries one. */
async function readDetail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail: unknown }).detail
      if (typeof detail === 'string') return detail
    }
  } catch {
    // A body that is not JSON says nothing useful — fall through to the caller's
    // own wording.
  }
  return null
}

/** A receipt call the server answered with an error — carries the HTTP status
 *  so the poll can tell a terminal 401/403 (token expired, alarm archived)
 *  from an ordinary hiccup. A request that never reached the server throws a
 *  plain `TypeError` from `fetch` and has no status at all. */
class ReceiptRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ReceiptRequestError'
  }
}

/**
 * The two receipt calls.
 *
 * Plain `fetch` rather than the api-client: `/alarm` is a public page with no
 * session, no auth refresh, and no toast surface — the client's own intake
 * calls already opt out of its toasts for exactly that reason. Both tokens go
 * in the query string, and both are required server-side.
 */
async function intakeReceiptRequest(
  path: string,
  init?: RequestInit,
): Promise<ReceiptState> {
  const response = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    throw new ReceiptRequestError(
      (await readDetail(response)) ?? `HTTP ${response.status}`,
      response.status,
    )
  }
  return (await response.json()) as ReceiptState
}

function receiptPath(token: string, incidentId: string, receiptToken: string): string {
  return (
    `/api/intake/alarm/${encodeURIComponent(incidentId)}` +
    `?token=${encodeURIComponent(token)}&receipt=${encodeURIComponent(receiptToken)}`
  )
}

function AlarmIntake() {
  const t = useTranslations('intake.alarm')
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [status, setStatus] = useState<Status>('loading')
  const [eventName, setEventName] = useState('')
  const [trainingFlag, setTrainingFlag] = useState(false)
  const [receipt, setReceipt] = useState<AlarmReceipt | null>(null)
  /** The receipt's «Meldung korrigieren» is open. Separate from `status` so
   *  cancelling drops straight back onto the receipt it came from. */
  const [correcting, setCorrecting] = useState(false)

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

  // The correction: the same form, prefilled, sending a PUT instead of a POST.
  // Keyed by incident so a second alarm never inherits the first one's text.
  if (status === 'success' && receipt && correcting && receipt.receiptToken) {
    return (
      <AlarmForm
        key={`correct-${receipt.incidentId}`}
        token={token}
        eventName={eventName}
        trainingFlag={trainingFlag}
        initial={receipt.draft}
        editing={{ incidentId: receipt.incidentId, receiptToken: receipt.receiptToken }}
        onCancel={() => setCorrecting(false)}
        onSuccess={corrected => {
          // The time stays the time it was reported — a correction does not make
          // the alarm newer, and the KP is working from the original.
          setReceipt(prev => (prev ? { ...prev, rows: corrected.rows, draft: corrected.draft } : prev))
          setCorrecting(false)
        }}
      />
    )
  }

  if (status === 'success' && receipt) {
    return (
      <ReceiptScreen
        token={token}
        eventName={eventName}
        receipt={receipt}
        onCorrect={() => setCorrecting(true)}
        onAnother={() => {
          setReceipt(null)
          setStatus('ready')
        }}
      />
    )
  }

  return (
    <AlarmForm
      token={token}
      eventName={eventName}
      trainingFlag={trainingFlag}
      onSuccess={sent => {
        setReceipt({
          rows: sent.rows,
          at: new Date(),
          incidentId: sent.incidentId,
          receiptToken: sent.receiptToken,
          draft: sent.draft,
        })
        setCorrecting(false)
        setStatus('success')
      }}
    />
  )
}

/** The quittung: what is now at the KP, in the words it was typed in. */
function ReceiptScreen({
  token,
  eventName,
  receipt,
  onCorrect,
  onAnother,
}: {
  token: string
  eventName: string
  receipt: AlarmReceipt
  onCorrect: () => void
  onAnother: () => void
}) {
  const t = useTranslations('intake.alarm')
  // The three "the KP has it" sentences are `/feld`'s own, word for word — the
  // reporter is being told the same thing whichever door they came through, so
  // the strings are shared rather than copied.
  const tReports = useTranslations('feld.reports')
  /** `null` until the first poll answers. The page used to hard-code
   *  `{status: 'incoming', editable: true}` here, which read as «noch
   *  korrigierbar» even when the very first poll could not confirm it — an
   *  honest «wird geprüft» beats an optimistic claim. */
  const [state, setState] = useState<ReceiptState | null>(null)
  /** Terminal: the server answered 401/403 — the receipt token has expired or
   *  the alarm is archived. Nothing here will ever change again, so the poll
   *  stops and the correction offer goes away for good. */
  const [expired, setExpired] = useState(false)

  const { incidentId, receiptToken } = receipt
  useEffect(() => {
    if (!receiptToken) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    const load = async () => {
      try {
        const next = await intakeReceiptRequest(receiptPath(token, incidentId, receiptToken))
        if (!cancelled) setState(next)
      } catch (error) {
        // 401/403 is not a hiccup: the token is dead and will stay dead.
        // Keeping the last known «noch korrigierbar» would send the reporter
        // typing a correction into a link that can no longer take one.
        if (
          !cancelled &&
          error instanceof ReceiptRequestError &&
          (error.status === 401 || error.status === 403)
        ) {
          setExpired(true)
          if (timer) clearInterval(timer)
          timer = undefined
          return
        }
        // Anything else: keep the last known answer. A receipt that blanks its
        // own status because a phone lost the signal for ten seconds is worse
        // than one that is briefly a poll behind.
      }
    }
    void load()
    timer = setInterval(() => void load(), RECEIPT_POLL_MS)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [token, incidentId, receiptToken])

  // `editable` is the server's own answer rather than the page re-deriving it
  // from a status vocabulary it should not have to know.
  const stateLabel = expired
    ? t('statusExpired')
    : state === null
      ? t('statusChecking')
      : state.editable
        ? t('statusOpen')
        : state.status === 'complete'
          ? tReports('stateDone')
          : state.vehicles.length > 0
            ? tReports('stateDispatchedWith', { vehicles: state.vehicles.join(', ') })
            : tReports('stateDispatched')

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15">
          <Check className="h-6 w-6 text-emerald-500" />
        </div>
        <h1 className="text-lg font-semibold">{t('receiptTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('receiptMeta', {
            eventName,
            time: receipt.at.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }),
          })}
        </p>
      </div>

      {/* What became of it, and the one thing that can still be done about it.
          Without an older backend's receipt token there is no correction to
          offer and no status to poll, so the row stays out of the way. */}
      {receiptToken && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <span className="text-sm">{stateLabel}</span>
          {/* Only while the server has SAID it is still the reporter's to
              change — once the KP has sent somebody, the vehicle name stands
              here instead and the correction goes over the radio; while the
              status is unknown or the link expired, no promise is made. */}
          {!expired && state?.editable && (
            <button
              type="button"
              onClick={onCorrect}
              className="text-xs underline underline-offset-2 hover:text-foreground"
            >
              {t('correct')}
            </button>
          )}
        </div>
      )}

      {/* The same rows the review step showed, minus the send button. */}
      <div className="overflow-hidden rounded-xl border border-border">
        {receipt.rows.map(row => (
          <div key={row.label} className="flex gap-3 border-b border-border/50 px-3 py-2.5 text-sm last:border-b-0">
            <span className="w-24 shrink-0 pt-px text-xs text-muted-foreground">{row.label}</span>
            <span className="min-w-0 flex-1 leading-snug">
              {row.value}
              {row.hint && <span className="block text-xs text-muted-foreground">{row.hint}</span>}
            </span>
          </div>
        ))}
      </div>

      {/* Below the receipt, not instead of it: a second alarm is the rarer of
          the two things somebody does here. */}
      <Button className="w-full" size="lg" onClick={onAnother}>
        <Plus className="h-5 w-5" />
        {t('another')}
      </Button>
    </div>
  )
}

/** What a finished form hands back: the receipt's rows, the values behind them,
 *  and the identity of the alarm they belong to. */
interface AlarmSubmitted {
  rows: AlarmRow[]
  draft: AlarmDraft
  incidentId: string
  receiptToken: string | null
}

interface AlarmFormProps {
  token: string
  eventName: string
  trainingFlag: boolean
  /** Prefill, for a correction. Defaults to an empty form. */
  initial?: AlarmDraft
  /** Present while an alarm that is already at the KP is being corrected. */
  editing?: { incidentId: string; receiptToken: string } | null
  onCancel?: () => void
  onSuccess: (sent: AlarmSubmitted) => void
}

function AlarmForm({ token, eventName, trainingFlag, initial, editing, onCancel, onSuccess }: AlarmFormProps) {
  const t = useTranslations('intake.alarm')
  const start = initial ?? EMPTY_DRAFT
  /** What the caller said the thing IS. Lands in the incident's `description`,
   *  which is the column the board labels «Meldung» — see the submit below. */
  const [message, setMessage] = useState(start.message)
  const [type, setType] = useState<IncidentType>(start.type)
  const [priority, setPriority] = useState<IncidentPriority>(start.priority)
  const [address, setAddress] = useState<string | null>(start.address)
  const [lat, setLat] = useState<number | null>(start.lat)
  const [lng, setLng] = useState<number | null>(start.lng)
  /** The extras that came with the call. Lands in `internal_notes` — the board's
   *  «Notizen» — so it sits beside the Meldung instead of overwriting it. On a
   *  correction that column belongs to the operator too, so what is typed here
   *  is *added* to it rather than replacing it — see the submit below. */
  const [hints, setHints] = useState(start.hints)
  const [contact, setContact] = useState(start.contact)
  const [contactPhone, setContactPhone] = useState(start.contactPhone)

  const [typeOpen, setTypeOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Erfassen, then read it back. Same two steps as `/feld`'s «Neue Meldung»,
   *  for the same reason: this form puts a Schadenplatz on the board, and a
   *  wrong house number sends a squad to the wrong street. A correction is read
   *  back too — it is the step that catches the second typo. */
  const [step, setStep] = useState<'form' | 'review'>('form')
  /** Priorität, Einsatzart and Hinweise live behind one fold: they are the
   *  KP's decisions (both carry sensible defaults) and the Telefondienst's
   *  extra time — not questions the form leads with. A correction opens the
   *  fold, and so does a draft that already carries a Hinweis: what is set
   *  must never be hidden. */
  const [detailsOpen, setDetailsOpen] = useState(Boolean(editing) || Boolean(start.hints))

  /** A Schadenplatz without a location is the one thing this form must not
   *  produce — the address input says «required», so the gate enforces it.
   *  A map pin counts: not every meadow has a street. */
  const hasLocation = Boolean(address?.trim()) || (lat !== null && lng !== null)
  const incomplete = !message.trim() || !hasLocation

  /** What the review step lists, in the order the form asked for it. Empty rows
   *  are dropped rather than shown blank — a dash next to «Melder» is a field
   *  somebody starts wondering whether they missed. The receipt after sending
   *  shows this same list, which is why it is worth building it once. */
  const reviewRows: AlarmRow[] = [
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

  const draft: AlarmDraft = { message, type, priority, address, lat, lng, hints, contact, contactPhone }

  const handleSubmit = async () => {
    if (incomplete || submitting) return
    setSubmitting(true)
    setError(null)
    // `title` is the board's address column in all but name: a card reads
    // `location_address || title`, and the board's own «Neuer Einsatz» puts the
    // address here too. The Meldung goes where the board reads it.
    const title = address?.trim() || message.trim()
    try {
      if (editing) {
        // A correction sends `''`, not `null`, for the TEXT fields it left
        // empty: the server reads `null` as «unverändert» there, so a Melder
        // typed in by mistake could otherwise never be taken back out again.
        // The coordinates are the other way round — `null` explicitly CLEARS
        // the pin (a freetext address edit nulls the local lat/lng, and the
        // stale pin must not survive on the server either); an omitted key
        // would leave it unchanged.
        //
        // «Notizen» is the exception, in both directions. The server APPENDS
        // what arrives there instead of assigning it, because that column is
        // shared with the operator and the receipt is not allowed to read it
        // back. So the hint only goes along when it actually changed — resending
        // the unchanged one would be asking for a Nachtrag of itself.
        const correction: IntakeCorrection = {
          title,
          type,
          priority,
          location_address: address?.trim() ?? '',
          location_lat: lat !== null ? String(lat) : null,
          location_lng: lng !== null ? String(lng) : null,
          description: message.trim(),
          contact: contact.trim(),
          contact_phone: contactPhone.trim(),
        }
        if (hints.trim() !== start.hints.trim()) correction.internal_notes = hints.trim()
        await intakeReceiptRequest(receiptPath(token, editing.incidentId, editing.receiptToken), {
          method: 'PUT',
          body: JSON.stringify(correction),
        })
        onSuccess({ rows: reviewRows, draft, incidentId: editing.incidentId, receiptToken: editing.receiptToken })
        return
      }
      // The create path answers `{ id, receipt_token }`. `receipt_token` is
      // optional here so an older backend simply yields a receipt without the
      // live status and without the correction button.
      const created: { id: string; receipt_token?: string } = await apiClient.createIntakeAlarm(token, {
        title,
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
      // The rows as they stood when the alarm left — the form is about to be
      // reset for the next one, and the receipt has to outlive it.
      onSuccess({
        rows: reviewRows,
        draft,
        incidentId: created.id,
        receiptToken: created.receipt_token ?? null,
      })
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : editing ? t('correctError') : t('submitError')
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
            ) : editing ? (
              <>
                <Pencil className="h-5 w-5" />
                {t('correctSubmit')}
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
          {editing ? <Pencil className="h-6 w-6 text-primary" /> : <Plus className="h-6 w-6 text-primary" />}
          {editing ? t('correct') : t('title')}
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
        required
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

      {/* Details — Priorität, Einsatzart and Hinweise behind one fold. Wo and
          Was are the alarm; these three are classification and colour, both of
          which the KP sets on the board within seconds anyway. The fold keeps
          them reachable for the Telefondienst, who has the caller on the line
          and time to ask — and out of the way of everybody who does not. */}
      <button
        type="button"
        onClick={() => setDetailsOpen((open) => !open)}
        aria-expanded={detailsOpen}
        className="flex w-full items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={`size-4 transition-transform ${detailsOpen ? 'rotate-90' : ''}`} />
        {t('detailsToggle')}
      </button>

      {detailsOpen && (
      <>
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
        <Label className="text-sm font-semibold text-muted-foreground">{t('typeLabel')}</Label>
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
        {/* Only on a correction. By then the column is shared with the operator,
            so what is typed here is added to «Notizen» rather than swapped in —
            and a field that quietly behaves differently than it looks is worse
            than one that says so. */}
        {editing && <p className="mt-1.5 text-xs text-muted-foreground">{t('hintsCorrectionHelp')}</p>}
      </div>
      </>
      )}

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
      {/* Name the missing piece instead of leaving a dead button: the message
          field is visibly empty on its own, the location gate is not. */}
      {!hasLocation && (
        <p className="text-center text-sm text-muted-foreground">{t('missingLocation')}</p>
      )}
      {/* Only on a correction: the way out of an edit nobody wanted after all.
          The alarm itself is already at the KP and stays there. */}
      {editing && onCancel && (
        <Button type="button" variant="ghost" size="lg" className="w-full" onClick={onCancel}>
          {t('correctCancel')}
        </Button>
      )}
    </form>
  )
}
