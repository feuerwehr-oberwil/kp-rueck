'use client'

/**
 * The four field actions on `/feld` (plan 25, phase 1, decision 13).
 *
 * Angekommen · Einsatz beendet · Abholung · Meldung an den KP. They sit above
 * the (later) Rapport form because they are what a crew does *while* working —
 * the form is what it does afterwards, and a phone in the rain gets one tap,
 * not a scroll.
 *
 * **The next step sits in a fixed footer** (6C, phone sweep 24.11.2026): the
 * chain in the card shows where the crew is, the footer (`LinkPageFooter`)
 * holds the one button for the step owed now, on screen however far the page
 * scrolls.
 *
 * **Angekommen and Einsatz beendet ask first (§18.18).** A misplaced tap on a
 * wet phone cannot be undone from the field — only the KP can clear either of
 * them — so the footer turns into the question with «Ja» on top rather than a
 * foreign dialog. One question, one tap. Abholung and Meldung keep their own
 * panels in the card.
 *
 * The one piece of real logic here is the **Abholung follow-up** (decision 24):
 * tapping *Einsatz beendet* immediately asks "Kommt ihr selbst zurück?", because
 * that is the moment the answer is known. It is deliberately a second request,
 * not a field on the first one — the *beendet* report reaches the KP even if the
 * crew walks away from the question. "Abholung nötig" is not a status: a
 * Schadenplatz can be finished and still have three people standing in the rain.
 */

import { formatTime } from '@/lib/format-time'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useIntlLocale } from '@/lib/date-locale'
import {
  CarTaxiFront,
  Check,
  AlertCircle,
  FileText,
  Flag,
  MapPin,
  MessageSquare,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Send,
  Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiClient, type ApiFeldAssignment, type ApiFieldReportState, type ApiFieldRequestCreate } from '@/lib/api-client'
import { fieldRequestLabel, fieldSideState } from '@/lib/field-requests'
import { randomUuid } from '@/lib/utils/validation'
import { deliveryReducer, IDLE, isBusy, type FeldActionKind } from '@/lib/feld-delivery'
import { formatPickupSince, formatPickupWaiting } from '@/lib/pickup'
import { rapportApplies } from '@/lib/rapport-visibility'
import { ShellLoader } from '@/components/ui/shell-loader'
import { FormMessage, formMessageId, useRequiredField } from '@/components/ui/form-message'
import { LinkPageFooter } from '@/components/link-page/link-page-footer'

/** A panel that opens from the fixed footer lands far from the thumb: bring it into view.
 *  A callback ref – it runs once, when the panel mounts. */
const revealPanel = (el: HTMLElement | null) => el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
const focusOnMount = (el: HTMLElement | null) => el?.focus()
// The panel's own heading takes the focus without a jump, so `revealPanel`'s smooth scroll
// still carries the eye there and Tab goes on into the panel, not past it to the footer.
const focusInPlace = (el: HTMLElement | null) => el?.focus({ preventScroll: true })

/**
 * Which follow-up panel is open. Exactly one at a time, so the phone never
 * shows two questions competing for the same thumb.
 *
 * `pickup-followup` is the one that opens by itself, right after *beendet*.
 */
export type FeldPanel =
  | 'none'
  | 'confirm-arrived'
  | 'confirm-complete'
  | 'pickup-followup'
  | 'pickup'
  | 'message'
  | 'request-material'
  | 'request-personnel'

/** How long a green "übermittelt" line stays before the panel goes quiet again. */
const CONFIRMATION_MS = 6000

/**
 * Annotated because ``run`` closes over itself to build the retry — without an
 * explicit type TypeScript cannot infer a self-referencing initializer.
 */
type RunFn = (
  which: FeldActionKind,
  label: string,
  action: () => Promise<ApiFieldReportState | void>,
) => Promise<boolean>

export interface FeldActionsProps {
  assignment: ApiFeldAssignment
  personnelId: string
  token: string
  messageChips: string[]
  /** The station's material names for «Material nötig» (R13). */
  requestMaterials?: string[]
  /** A Meldung or request was delivered — reload so «Angefordert» shows it. */
  onSent?: () => void
  /** Report the new server state up so the list row re-renders. */
  onReported: (state: ApiFieldReportState) => void
  /** Scroll to / open the rapport form further down the page. When absent the
   *  rapport step stays a passive pointer (the form is not on this page). */
  onOpenRapport?: () => void
}

function toDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function FeldActions({
  assignment,
  personnelId,
  token,
  messageChips,
  requestMaterials = [],
  onSent,
  onReported,
  onOpenRapport,
}: FeldActionsProps) {
  const t = useTranslations('feld.actions')
  const tPickup = useTranslations('feld.pickup')
  const tAsk = useTranslations('feld.ask')
  const tRequest = useTranslations('feld.requests')
  const intlLocale = useIntlLocale()
  const [panel, setPanel] = useState<FeldPanel>('none')
  const [note, setNote] = useState(assignment.pickup_note ?? '')
  const [message, setMessage] = useState('')
  // The structured request being filled in (R13): what, how many, a note.
  const [askItem, setAskItem] = useState('')
  const [askQuantity, setAskQuantity] = useState(1)
  const [askNote, setAskNote] = useState('')
  // A send with nothing to send says so under the field (INT-07), never a silently greyed
  // button. A material request needs a material OR a note; a Verstärkung can go bare.
  const messageField = useRequiredField('feld-message', message, t('messageRequired'))
  const askItemField = useRequiredField('feld-ask-item', askItem.trim() || askNote.trim(), tAsk('materialRequired'))
  // One state machine for all four reports: pending → sent | failed. A tap that
  // silently does nothing is the thing being fixed here, so every path ends in
  // a visible answer.
  const [delivery, dispatch] = useReducer(deliveryReducer, IDLE)
  // What "Erneut senden" repeats. Held in a ref rather than in state: it is a
  // closure over the request, not something the render reads.
  const retryRef = useRef<(() => void) | null>(null)
  // Set by «Abbrechen» in the footer's question: the step button that comes back takes the focus.
  const returnFocusRef = useRef(false)
  const takeReturnedFocus = (el: HTMLButtonElement | null) => {
    if (!el || !returnFocusRef.current) return
    returnFocusRef.current = false
    el.focus()
  }
  const attemptRef = useRef(0)

  const busy = delivery.status === 'pending'

  const arrived = Boolean(assignment.arrived_at)
  const arrivedByAutomation = arrived && assignment.arrived_by_automation
  const completed = Boolean(assignment.field_complete_reported_at)
  const pickupNeeded = assignment.pickup_needed
  const pickupSince = toDate(assignment.pickup_requested_at)
  // The vehicles parked at (or travelling with) this Schadenplatz — everything
  // whose driver did not «kehrt zurück» (stays === false). If one is standing
  // outside, «Wir fahren selbst» is the answer the follow-up should lead with,
  // and an Abholung is almost certainly a mis-tap.
  const vehiclesOnSite = assignment.vehicles.filter(vehicle => vehicle.stays !== false).map(vehicle => vehicle.name)

  // The confirmation is a receipt, not a permanent banner — but it has to stay
  // long enough to be read by somebody holding a hose. A failure never expires:
  // it is the one state the crew must act on.
  useEffect(() => {
    if (delivery.status !== 'sent') return
    const timer = setTimeout(() => dispatch({ type: 'clear' }), CONFIRMATION_MS)
    return () => clearTimeout(timer)
  }, [delivery])

  const run = useCallback<RunFn>(
    async (which, label, action) => {
      const attempt = attemptRef.current + 1
      attemptRef.current = attempt
      retryRef.current = () => {
        void run(which, label, action)
      }
      dispatch({ type: 'send', action: which, label, attempt })
      try {
        const state = await action()
        if (state) onReported(state)
        dispatch({ type: 'settled', ok: true, attempt })
        return true
      } catch (err) {
        console.error('Field action failed:', err)
        dispatch({ type: 'settled', ok: false, attempt })
        return false
      }
    },
    [onReported],
  )

  const handleArrived = () => {
    setPanel('none')
    return run('arrived', t('arrived'), () =>
      apiClient.feldReportArrived(assignment.incident_id, personnelId, token),
    )
  }

  const handleComplete = async () => {
    setPanel('none')
    const ok = await run('complete', t('complete'), () =>
      apiClient.feldReportComplete(assignment.incident_id, personnelId, token),
    )
    // The question is asked only once the report has actually landed — an
    // "Abholung nötig" attached to a beendet-Meldung that never arrived would
    // be a crew waiting for a car nobody was told to send.
    if (ok) setPanel('pickup-followup')
    // «Erneut senden» repeats the whole step, follow-up question included —
    // `run`'s own retry would send the report and skip the question.
    else retryRef.current = () => void handleComplete()
  }

  const handlePickup = async (needed: boolean) => {
    const label = needed ? tPickup('needPickup') : tPickup('selfReturn')
    // The note is read at call time on purpose: a retry after a failed send must
    // carry whatever is in the field now, not a stale copy.
    const ok = await run('pickup', label, () =>
      apiClient.feldReportPickup(assignment.incident_id, personnelId, token, needed, needed ? note : null),
    )
    if (ok) setPanel('none')
  }

  const handleMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    messageField.reset()
    // One id per send, built ONCE: «Erneut senden» repeats this exact payload,
    // so the server recognises the repeat instead of opening a second request.
    const payload: ApiFieldRequestCreate = { message: trimmed, client_request_id: randomUuid() }
    const ok = await run('message', trimmed, async () => {
      await apiClient.feldSendMessage(assignment.incident_id, personnelId, token, payload)
    })
    // The typed text survives a failure — the input is only cleared once the KP
    // has it. Retyping a Meldung in the rain is not an acceptable retry.
    if (ok) {
      setMessage('')
      setPanel('none')
      onSent?.()
    }
  }

  /** Open the «what, how many» picker — with a sensible count for each kind. */
  const openAsk = (kind: 'material' | 'personnel') => {
    askItemField.reset()
    setAskItem('')
    setAskNote('')
    setAskQuantity(kind === 'personnel' ? 2 : 1)
    setPanel(kind === 'material' ? 'request-material' : 'request-personnel')
  }

  const handleAsk = async (kind: 'material' | 'personnel') => {
    if (kind === 'material' && !askItemField.check()) return
    const payload: ApiFieldRequestCreate = {
      kind,
      item: askItem.trim() || null,
      quantity: askQuantity,
      message: askNote.trim(),
      // See handleMessage: a retry repeats this id and is a no-op on the server.
      client_request_id: randomUuid(),
    }
    const label = fieldRequestLabel(
      { kind, text: payload.message || null, item: payload.item ?? null, quantity: askQuantity, label: '' },
      tRequest,
    )
    // Built once per tap; «Erneut senden» repeats exactly this request.
    const ok = await run('message', label, async () => {
      await apiClient.feldSendMessage(assignment.incident_id, personnelId, token, payload)
    })
    if (ok) {
      setPanel('none')
      onSent?.()
    }
  }

  // Material names that match what is typed — tapped instead of spelled.
  const materialMatches = (() => {
    const query = askItem.trim().toLocaleLowerCase()
    const list = query
      ? requestMaterials.filter(name => name.toLocaleLowerCase().includes(query) && name !== askItem.trim())
      : requestMaterials
    return list.slice(0, 8)
  })()
  const requests = assignment.field_requests ?? []

  // Only the crew working a Schadenplatz can arrive at it, end it or ask for an
  // Abholung — the server refuses those three from a driver or a Magazin person
  // (plan 26, decision 11). Rendering them anyway would be controls that answer
  // 403. A Meldung is open to anybody who can see the row: noticing something
  // is not a crew privilege.
  const isCrew = assignment.source === 'crew'

  // The journey, as a visible chain: Angekommen → Einsatz beendet → Rapport.
  // Done steps carry their time, the CURRENT step is the one ink main
  // button, the rest waits in grey. The old 2×2 grid put four same-red slabs
  // of three different consequence classes under one thumb; the chain has
  // exactly one pressable thing, and it always names the next step. The
  // markers follow the three states – done, current, later – see below.
  const rapportRelevant = rapportApplies({
    hasBeenDispatched: assignment.has_been_dispatched,
    status: assignment.incident_status,
    hasReport: assignment.rapport_state !== 'none',
    rekoNotRelevant: assignment.reko?.is_relevant === false,
  })
  const timeOf = (value: string | null): string | null => {
    const date = toDate(value)
    return date ? formatTime(date, intlLocale) : null
  }
  type JourneyStep = {
    key: 'arrived' | 'complete' | 'rapport'
    /** The step's name — printed on EVERY state, so the chain reads as a list
     *  of the three stations rather than a floating button. */
    name: string
    done: boolean
    doneLabel: string
    actionLabel?: string
    time?: string | null
  }
  const journey: JourneyStep[] = [
    {
      key: 'arrived',
      name: t('arrived'),
      done: arrived,
      // "Angekommen erkannt" is the GPS automation's stamp (§18.24): the board
      // already knows, but the step must not claim the crew reported it.
      doneLabel: arrivedByAutomation ? t('arrivedAuto') : t('arrivedDone'),
      actionLabel: t('arrivedAction'),
      time: timeOf(assignment.arrived_at),
    },
    {
      key: 'complete',
      name: t('complete'),
      done: completed,
      doneLabel: t('completeDone'),
      actionLabel: t('completeAction'),
      time: timeOf(assignment.field_complete_reported_at),
    },
    ...(rapportRelevant
      ? [{
          key: 'rapport' as const,
          name: t('rapportAction'),
          done: assignment.rapport_state === 'submitted',
          doneLabel: t('rapportDone'),
        }]
      : []),
  ]
  const currentIndex = journey.findIndex(step => !step.done)
  const confirmPanelFor: Record<string, FeldPanel> = { arrived: 'confirm-arrived', complete: 'confirm-complete' }
  const current: JourneyStep | undefined = journey[currentIndex]
  const confirming = panel === 'confirm-arrived' ? 'arrived' : panel === 'confirm-complete' ? 'complete' : null

  /* --- The fixed footer (6C, phone sweep 24.11.2026) ---------------------
     The next step is always on screen: Angekommen → Einsatz beendet → Rapport,
     KP Front's pinned phone-form action. The ask-first confirm (§18.18) grows
     IN the footer, Ja on top, where the thumb already is. Not while the
     Abholung question is open (one question at a time) or once nothing is owed. */
  // The receipt of a status report the footer sent is said in the footer, where the thumb is.
  const statusReport = delivery.status !== 'idle' && (delivery.action === 'arrived' || delivery.action === 'complete')
  const reportFailed = statusReport && delivery.status === 'failed'
  const footerStatus = confirming ? (
    // The question takes the focus from the button that opened it (a keyboard or screen
    // reader would otherwise be left on a removed element); «Abbrechen» hands it back.
    <p ref={focusOnMount} tabIndex={-1} className="font-medium outline-none">
      {confirming === 'arrived' ? t('confirmArrivedQuestion') : t('confirmCompleteQuestion')}
    </p>
  ) : reportFailed ? (
    <p className="flex items-start gap-1.5 text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">
        {t('failedTitle', { label: delivery.label })}
        <span className="block text-xs opacity-90">{t('failed')}</span>
      </span>
    </p>
  ) : statusReport && delivery.status === 'pending' ? (
    <p className="flex items-center gap-1.5 text-muted-foreground">
      <ShellLoader className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{t('sending', { label: delivery.label })}</span>
    </p>
  ) : statusReport && delivery.status === 'sent' ? (
    <p className="flex items-start gap-1.5">
      <Check className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{t('sent', { label: delivery.label })}</span>
    </p>
  ) : current ? (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className="flex size-3 shrink-0 items-center justify-center rounded-full border-2 border-action">
        <span className="size-1 rounded-full bg-action" />
      </span>
      <span className="min-w-0 flex-1 truncate">{t('nextStep', { current: currentIndex + 1, total: journey.length })}</span>
      <button
        type="button"
        disabled={busy}
        className="relative hit-area inline-flex shrink-0 items-center gap-1 font-medium text-foreground underline underline-offset-2 disabled:opacity-50"
        onClick={() => setPanel(panel === 'message' ? 'none' : 'message')}
      >
        <MessageSquare className="size-4" />
        {t('message')}
      </button>
    </div>
  ) : null
  const footerAction = confirming ? (
    <div className="grid gap-2">
      <Button size="lg" className="h-12 w-full" disabled={busy} onClick={confirming === 'arrived' ? handleArrived : handleComplete}>
        {isBusy(delivery, confirming) && <ShellLoader className="size-4" />}
        {confirming === 'arrived' ? t('confirmArrivedYes') : t('confirmCompleteYes')}
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="w-full"
        disabled={busy}
        onClick={() => {
          returnFocusRef.current = true
          setPanel('none')
        }}
      >
        {t('cancel')}
      </Button>
    </div>
  ) : reportFailed ? (
    <Button size="lg" variant="outline" className="h-12 w-full" onClick={() => retryRef.current?.()}>
      <RefreshCw className="size-4" />
      {t('retry')}
    </Button>
  ) : current?.key === 'rapport' ? (
    onOpenRapport ? (
      /* The one step whose form lives on this page: the button carries the eye
         there (the form scrolls to its Kurzbericht and puts the caret in it). */
      <Button size="lg" className="h-12 w-full" onClick={onOpenRapport}>
        <FileText className="size-4" />
        {t('rapportAction')}
      </Button>
    ) : null
  ) : current ? (
    <Button
      ref={takeReturnedFocus}
      size="lg"
      className="h-12 w-full"
      disabled={busy}
      onClick={() => setPanel(confirmPanelFor[current.key])}
    >
      {isBusy(delivery, current.key === 'arrived' ? 'arrived' : 'complete') ? (
        <ShellLoader className="size-4" />
      ) : current.key === 'arrived' ? (
        <MapPin className="size-4" />
      ) : (
        <Flag className="size-4" />
      )}
      {current.actionLabel}
    </Button>
  ) : null
  const footer =
    isCrew && footerAction && panel !== 'pickup-followup' ? (
      <LinkPageFooter status={footerStatus} liveStatus>{footerAction}</LinkPageFooter>
    ) : null
  const receiptInFooter = footer !== null && statusReport

  /* --- The follow-up (decision 24) ---------------------------------------
     Rendered INSIDE the chain, directly under «Beendet gemeldet · hh:mm» —
     it is that report's own question, and at the bottom of the section it
     read as a separate topic. With a vehicle standing at the address the
     answer is known: «Wir fahren selbst» leads as the primary choice and the
     Abholung drops to a quiet second — marked redundant, not disabled,
     because the vehicle leaving without the crew (driver called away) is
     rare but real. */
  const pickupFollowup = (
    <div ref={revealPanel} className="mt-2 rounded-lg border border-border bg-background p-3 space-y-3">
      <p className="text-sm font-medium">{tPickup('followupQuestion')}</p>
      {vehiclesOnSite.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {tPickup('hasVehicleHint', { vehicle: vehiclesOnSite.join(', ') })}
        </p>
      )}
      <Input
        placeholder={tPickup('notePlaceholder')}
        value={note}
        onChange={e => setNote(e.target.value)}
        className="text-sm"
      />
      {vehiclesOnSite.length > 0 ? (
        <div className="grid grid-cols-1 gap-2">
          <Button size="lg" disabled={busy} onClick={() => handlePickup(false)}>
            {isBusy(delivery, 'pickup') && <ShellLoader className="size-4" />}
            {tPickup('selfReturn')}
          </Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={() => handlePickup(true)}>
            {tPickup('needPickup')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          <Button size="lg" variant="outline" disabled={busy} onClick={() => handlePickup(false)}>
            {tPickup('selfReturn')}
          </Button>
          <Button size="lg" disabled={busy} onClick={() => handlePickup(true)}>
            {isBusy(delivery, 'pickup') && <ShellLoader className="size-4" />}
            {tPickup('needPickup')}
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <section className="rounded-xl bg-secondary/50 p-4 space-y-3">
      <h2 className="type-label text-muted-foreground">{t('title')}</h2>

      {isCrew && (
        <ol className="relative space-y-2">
          {/* The connector behind the markers — the chain reads as one journey. 2px at
              muted-foreground/70 (≥ 3:1 on this card, light and dark); `--border` was
              ~1.3:1 and the chain fell apart into dots (hill climb r18). */}
          <span aria-hidden className="absolute bottom-2 left-[7px] top-2 w-0.5 bg-muted-foreground/70" />
          {journey.map((step, index) => {
            const isCurrent = index === currentIndex
            return (
              <li key={step.key} className="relative flex items-start gap-2.5">
                {/* Marker, three states in a 16px slot centred on the connector:
                    done = a filled 12px muted dot with an 8px ✓ cut out of it (past,
                    read like the muted «… gemeldet · hh:mm» beside it – not green,
                    which is frei/verfügbar only); current = a 14px ink ring with a
                    4px ink centre (the step owed now, same ink as the button under
                    it); later = the hollow muted-foreground ring, ≥ 3:1 on the card
                    (a `--border` ring was ~1.3:1). A solid ink dot for «current»
                    read as «done» right above «Angekommen melden» (hill climb r19). */}
                <span
                  aria-hidden
                  className={`relative z-raised flex size-4 shrink-0 items-center justify-center ${isCurrent ? 'mt-1' : 'mt-[3px]'}`}
                >
                  {step.done ? (
                    <span className="flex size-3 items-center justify-center rounded-full bg-muted-foreground text-secondary">
                      <Check className="size-2" strokeWidth={3.5} />
                    </span>
                  ) : isCurrent ? (
                    <span className="flex size-3.5 items-center justify-center rounded-full border-2 border-action bg-secondary">
                      <span className="size-1 rounded-full bg-action" />
                    </span>
                  ) : (
                    <span className="size-3.5 rounded-full border-2 border-muted-foreground bg-secondary" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  {step.done ? (
                    <p className="pt-px text-sm text-muted-foreground">
                      {step.doneLabel}
                      {step.time ? <span className="tabular-nums"> · {step.time}</span> : null}
                    </p>
                  ) : isCurrent && (step.key !== 'rapport' || onOpenRapport) ? (
                    /* The step owed now. Its button is in the fixed footer (6C, phone
                       sweep 24.11.2026), so the chain only points there. */
                    <p className="pt-px text-base font-semibold">
                      {step.key === 'rapport' ? t('rapportBelow', { step: step.name }) : t('currentBelow', { step: step.name })}
                    </p>
                  ) : step.key === 'rapport' ? (
                    <p className="pt-px text-sm text-muted-foreground">{t('rapportNext')}</p>
                  ) : (
                    /* Not this step's turn, but never a trap: a crew that
                       skipped «Angekommen» can still report beendet through
                       the inline link. It stays a link, but 14/600 ink: a
                       12px muted word read as a footnote (hill climb r20);
                       `hit-area` pads it to the 44px touch floor. */
                    <p className="flex items-baseline gap-2 pt-px text-sm text-muted-foreground">
                      {step.name}
                      <button
                        type="button"
                        disabled={busy}
                        className="relative hit-area text-sm font-semibold text-foreground underline underline-offset-2 hover:decoration-2 disabled:opacity-50"
                        onClick={() => setPanel(confirmPanelFor[step.key])}
                      >
                        {t('reportNow')}
                      </button>
                    </p>
                  )}
                  {/* The beendet report's own question, right under its line —
                      wherever that line currently is in its render cycle. */}
                  {step.key === 'complete' && panel === 'pickup-followup' && pickupFollowup}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {/* --- Did it arrive? --------------------------------------------------
          The receipt for every one of the four reports, at section level rather
          than inside a panel: the Meldung panel closes on success, and the
          answer has to outlive it. `aria-live` because on a phone this line is
          often the only thing that changed. */}
      <div aria-live="polite" role="status">
        {!receiptInFooter && delivery.status === 'pending' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShellLoader className="size-4 shrink-0" />
            {t('sending', { label: delivery.label })}
          </p>
        )}

        {!receiptInFooter && delivery.status === 'sent' && (
          <p className="flex items-center gap-2 rounded-lg bg-success/15 px-3 py-2 text-sm text-foreground">
            <Check className="size-4 shrink-0" />
            <span className="min-w-0 break-words">{t('sent', { label: delivery.label })}</span>
          </p>
        )}

        {!receiptInFooter && delivery.status === 'failed' && (
          <div className="space-y-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 break-words">
                {t('failedTitle', { label: delivery.label })}
                <span className="block text-xs opacity-90">{t('failed')}</span>
              </span>
            </p>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={() => retryRef.current?.()}
            >
              <RefreshCw className="size-4" />
              {t('retry')}
            </Button>
          </div>
        )}
      </div>

      {/* Standing state, so a crew that already asked does not ask twice.
          Since sweep 27 §P3.1 it also answers the question the crew is actually
          standing there with — hat das jemand gesehen? — from real KP actions:
          a vehicle dispatched after the request, or the dismissed warning bell.
          Derived server-side; no operator ever clicks an "acknowledge". */}
      {pickupNeeded && (
        <div className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
          {/* One line — «Abholung gemeldet · 09:04 · wartet 12 Min». It used to be two that
              said «seit» twice. */}
          <p className="font-medium">
            {[
              tPickup('reported'),
              formatPickupSince(pickupSince),
              pickupSince ? tPickup('waitingShort', { duration: formatPickupWaiting(pickupSince) }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {assignment.pickup_note && <p className="text-xs opacity-80">{assignment.pickup_note}</p>}
          {assignment.pickup_vehicle ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
              <Check className="size-3.5 shrink-0" />
              {tPickup('ackVehicle', { vehicle: assignment.pickup_vehicle })}
            </p>
          ) : assignment.pickup_seen ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium opacity-90">
              <Check className="size-3.5 shrink-0" />
              {tPickup('ackSeen')}
            </p>
          ) : null}
        </div>
      )}

      {/* The request was answered: the KP cleared it, which its own UI words as
          «Abholung disponiert». Without this line the red box just vanished —
          to a crew in the rain, indistinguishable from a lost request. */}
      {!pickupNeeded && assignment.pickup_resolved_at && (
        <div className="rounded-lg bg-success/15 px-3 py-2 text-sm text-foreground">
          <p className="flex items-center gap-1.5 font-medium">
            <Check className="size-4 shrink-0" />
            {tPickup('ackResolved', { time: formatPickupSince(toDate(assignment.pickup_resolved_at)) })}
          </p>
        </div>
      )}

      {/* The requests, one visual weight below the journey: grey underlined
          links, the house idiom — one is a state report, these are asks. Spaced
          by the gap, no «·» between them: a separator span dangled at the end of
          a line whenever the second link wrapped. While a pickup is open the
          first link no longer offers to ask again — it adjusts the note. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-0.5 text-sm">
        {isCrew && completed && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            onClick={() => setPanel(panel === 'pickup' ? 'none' : 'pickup')}
          >
            <CarTaxiFront className="size-3.5" />
            {pickupNeeded ? tPickup('noteLink') : tPickup('requestLong')}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          onClick={() => setPanel(panel === 'message' ? 'none' : 'message')}
        >
          <MessageSquare className="size-3.5" />
          {t('messageTitle')}
        </button>
      </div>

      {/* --- Abholung, opened deliberately rather than as a follow-up --------
          Asking only. The "Abgeholt" half of this panel was removed after the
          first field test (§18.9): nobody sitting in the car that just picked
          them up gets the phone back out to say so, and an unpressed button is
          worse than none — it makes the amber chip on the board look stale
          instead of unanswered. Clearing is the KP's, on the chip itself.
          Re-opening it with a changed note is allowed and simply updates the
          note; the waiting time stays where it started. */}
      {panel === 'pickup' && (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <p className="text-sm">{pickupNeeded ? tPickup('alreadyRequested') : tPickup('requestQuestion')}</p>
          <Input
            placeholder={tPickup('notePlaceholder')}
            value={note}
            onChange={e => setNote(e.target.value)}
            className="text-sm"
          />
          <Button size="lg" className="w-full" disabled={busy} onClick={() => handlePickup(true)}>
            {isBusy(delivery, 'pickup') && <ShellLoader className="size-4" />}
            {pickupNeeded ? tPickup('updateNote') : tPickup('needPickup')}
          </Button>
        </div>
      )}

      {/* --- Freitext-Meldung ------------------------------------------------ */}
      {panel === 'message' && (
        <div ref={revealPanel} className="rounded-lg border border-border p-3 space-y-3">
          <p ref={focusInPlace} tabIndex={-1} className="text-sm font-medium outline-none">{t('messageTitle')}</p>
          {/* The two requests the KP has to ACT on, structured (R13): what and
              how many, so the board reads «Tauchpumpe ×2», not prose. Fixed
              buttons, not station chips — they open a picker. */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-auto min-w-0 whitespace-normal py-2 text-left"
              disabled={busy}
              onClick={() => openAsk('material')}
            >
              <Package className="size-4" />
              {tAsk('material')}
            </Button>
            <Button
              variant="outline"
              className="h-auto min-w-0 whitespace-normal py-2 text-left"
              disabled={busy}
              onClick={() => openAsk('personnel')}
            >
              <Users className="size-4" />
              {tAsk('personnel')}
            </Button>
          </div>
          {/* Station config, not translation (decision 20) — a brigade rewords
              these without a translation round. */}
          {messageChips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {messageChips.map(chip => (
                <Button
                  key={chip}
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => handleMessage(chip)}
                >
                  {chip}
                </Button>
              ))}
            </div>
          )}
          {/* Input and Send have to be the same box. `Input` is a fixed h-9 (36px)
              and does not stretch, while the default Button is min-h-44 — so the
              send button stood 8px taller than the field it belongs to. Both are
              pinned to 44px here: this is a phone surface, so 44 is the floor,
              and `icon` keeps the button square instead of a wide slab. */}
          <div className="flex items-stretch gap-2">
            <Input
              {...messageField.controlProps}
              placeholder={t('messagePlaceholder')}
              value={message}
              maxLength={500}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && messageField.check()) handleMessage(message)
              }}
              className="h-11 text-sm"
            />
            <Button
              size="icon"
              aria-label={t('send')}
              disabled={busy}
              onClick={() => messageField.check() && handleMessage(message)}
            >
              {isBusy(delivery, 'message') ? <ShellLoader className="size-4" /> : <Send className="size-4" />}
            </Button>
          </div>
          <FormMessage id={formMessageId('feld-message')}>{messageField.error}</FormMessage>
        </div>
      )}
      {/* --- «Material nötig» / «Verstärkung nötig» (R13) ------------------ */}
      {(panel === 'request-material' || panel === 'request-personnel') && (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <p className="text-sm font-medium">
            {panel === 'request-material' ? tAsk('materialQuestion') : tAsk('personnelQuestion')}
          </p>
          {panel === 'request-material' && (
            <>
              <Input
                {...askItemField.controlProps}
                placeholder={tAsk('materialPlaceholder')}
                value={askItem}
                maxLength={120}
                autoComplete="off"
                onChange={e => setAskItem(e.target.value)}
                className="h-11 text-sm"
              />
              <FormMessage id={formMessageId('feld-ask-item')}>{askItemField.error}</FormMessage>
              {materialMatches.length > 0 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label={tAsk('materialListLabel')}>
                  {materialMatches.map(name => (
                    <Button
                      key={name}
                      variant={askItem.trim() === name ? 'selected' : 'secondary'}
                      size="sm"
                      onClick={() => setAskItem(name)}
                    >
                      {name}
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}
          {/* How many — a stepper, because a number keyboard over a wet
              screen is two taps more than «+». */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{tAsk('quantity')}</span>
            <Button
              variant="outline"
              size="icon"
              aria-label={tAsk('decrease')}
              disabled={askQuantity <= 1}
              onClick={() => setAskQuantity(q => Math.max(1, q - 1))}
            >
              <Minus className="size-4" />
            </Button>
            <span className="min-w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">
              {askQuantity}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label={tAsk('increase')}
              disabled={askQuantity >= 99}
              onClick={() => setAskQuantity(q => Math.min(99, q + 1))}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          {panel === 'request-personnel' && (
            <Input
              placeholder={tAsk('personnelWhatPlaceholder')}
              value={askItem}
              maxLength={120}
              autoComplete="off"
              onChange={e => setAskItem(e.target.value)}
              className="h-11 text-sm"
            />
          )}
          <Input
            placeholder={tAsk('notePlaceholder')}
            value={askNote}
            maxLength={500}
            autoComplete="off"
            onChange={e => setAskNote(e.target.value)}
            className="h-11 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setPanel('message')}>
              {t('cancel')}
            </Button>
            <Button
              disabled={busy}
              onClick={() => handleAsk(panel === 'request-material' ? 'material' : 'personnel')}
            >
              {isBusy(delivery, 'message') ? <ShellLoader className="size-4" /> : <Send className="size-4" />}
              {tAsk('send')}
            </Button>
          </div>
        </div>
      )}

      {footer}

      {/* --- What was asked, and what the KP did about it (R13) -------------
          Read off the KP's real actions: «Vom KP gesehen» once somebody closed
          the bell entry or started on it, «KP: in Arbeit», «erledigt · 14:32».
          Every crew member at this address sees the same list — nobody asks
          for the second pump twice. */}
      {requests.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{tAsk('listTitle')}</p>
          <ul className="space-y-1.5">
            {requests.map(request => {
              const state = fieldSideState(request)
              const doneTime = timeOf(request.done_at)
              return (
                <li
                  key={request.id}
                  className={`rounded-lg px-3 py-2 text-sm ${
                    state === 'done'
                      ? 'bg-success/15 text-foreground'
                      : 'bg-background'
                  }`}
                >
                  <p className="break-words font-medium">{fieldRequestLabel(request, tRequest)}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs opacity-80">
                    {state !== 'sent' && <Check className="size-3.5 shrink-0" />}
                    {state === 'done'
                      ? request.done_by_name
                        ? tAsk('stateDoneBy', { time: doneTime ?? '', name: request.done_by_name })
                        : tAsk('stateDone', { time: doneTime ?? '' })
                      : state === 'in_progress'
                        ? tAsk('stateInProgress')
                        : state === 'seen'
                          ? tAsk('stateSeen')
                          : tAsk('stateSent')}
                  </p>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
