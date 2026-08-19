'use client'

/**
 * The four field actions on `/feld` (plan 25, phase 1, decision 13).
 *
 * Angekommen · Einsatz beendet · Abholung · Meldung an den KP. They sit above
 * the (later) Rapport form because they are what a crew does *while* working —
 * the form is what it does afterwards, and a phone in the rain gets one tap,
 * not a scroll.
 *
 * **Angekommen and Einsatz beendet ask first (§18.18).** A misplaced tap on a
 * wet phone cannot be undone from the field — only the KP can clear either of
 * them — so both open the same one-line follow-up panel the Abholung question
 * uses rather than a foreign dialog. One question, one tap. Abholung and Meldung
 * already have their own panels and are left exactly as they were.
 *
 * The one piece of real logic here is the **Abholung follow-up** (decision 24):
 * tapping *Einsatz beendet* immediately asks "Kommt ihr selbst zurück?", because
 * that is the moment the answer is known. It is deliberately a second request,
 * not a field on the first one — the *beendet* report reaches the KP even if the
 * crew walks away from the question. "Abholung nötig" is not a status: a
 * Schadenplatz can be finished and still have three people standing in the rain.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  CarTaxiFront,
  Check,
  CircleAlert,
  Flag,
  Loader2,
  MapPin,
  MessageSquare,
  RotateCcw,
  Send,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiClient, type ApiFeldAssignment, type ApiFieldReportState } from '@/lib/api-client'
import { deliveryReducer, IDLE, isBusy, type FeldActionKind } from '@/lib/feld-delivery'
import { formatPickupSince, formatPickupWaiting } from '@/lib/pickup'

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
  /** Report the new server state up so the list row re-renders. */
  onReported: (state: ApiFieldReportState) => void
}

function toDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function FeldActions({ assignment, personnelId, token, messageChips, onReported }: FeldActionsProps) {
  const t = useTranslations('feld.actions')
  const tPickup = useTranslations('feld.pickup')
  const [panel, setPanel] = useState<FeldPanel>('none')
  const [note, setNote] = useState(assignment.pickup_note ?? '')
  const [message, setMessage] = useState('')
  // One state machine for all four reports: pending → sent | failed. A tap that
  // silently does nothing is the thing being fixed here, so every path ends in
  // a visible answer.
  const [delivery, dispatch] = useReducer(deliveryReducer, IDLE)
  // What "Nochmals senden" repeats. Held in a ref rather than in state: it is a
  // closure over the request, not something the render reads.
  const retryRef = useRef<(() => void) | null>(null)
  const attemptRef = useRef(0)

  const busy = delivery.status === 'pending'

  const arrived = Boolean(assignment.arrived_at)
  const arrivedByAutomation = arrived && assignment.arrived_by_automation
  const completed = Boolean(assignment.field_complete_reported_at)
  const pickupNeeded = assignment.pickup_needed
  const pickupSince = toDate(assignment.pickup_requested_at)
  // The vehicles parked at (or travelling with) this Schadenplatz — everything
  // whose driver did not «fährt zurück» (stays === false). If one is standing
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
    const ok = await run('message', trimmed, async () => {
      await apiClient.feldSendMessage(assignment.incident_id, personnelId, token, trimmed)
    })
    // The typed text survives a failure — the input is only cleared once the KP
    // has it. Retyping a Meldung in the rain is not an acceptable retry.
    if (ok) {
      setMessage('')
      setPanel('none')
    }
  }

  // Only the crew working a Schadenplatz can arrive at it, end it or ask for an
  // Abholung — the server refuses those three from a driver or a Magazin person
  // (plan 26, decision 11). Rendering them anyway would be four buttons of which
  // two answer 403, which is worse than three that all work. A Meldung is open
  // to anybody who can see the row: noticing something is not a crew privilege.
  const isCrew = assignment.source === 'crew'

  return (
    <section className="rounded-xl bg-secondary/50 p-4 space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t('title')}</h2>

      <div className={isCrew ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
        {isCrew && (
          <>
        <Button
          variant={arrived ? 'secondary' : 'default'}
          size="lg"
          className="h-14 flex-col gap-0.5"
          disabled={arrived || busy}
          onClick={() => setPanel(panel === 'confirm-arrived' ? 'none' : 'confirm-arrived')}
        >
          {isBusy(delivery, 'arrived') ? (
            <Loader2 className="size-4 animate-spin" />
          ) : arrived ? (
            <Check className="size-4" />
          ) : (
            <MapPin className="size-4" />
          )}
          {/* Three states, not two (§18.24). "Angekommen erkannt" is what the
              GPS automation stamped when an assigned vehicle reached the
              address: the board already knows, so the crew is not asked to
              confirm it — but the button must not claim they reported it
              either. A crew that went zu Fuss or was dropped off has no
              vehicle, so the plain "Angekommen" tap is unchanged and stays the
              only route for them. */}
          <span className="text-sm">
            {arrived ? (arrivedByAutomation ? t('arrivedAuto') : t('arrivedDone')) : t('arrived')}
          </span>
        </Button>

        <Button
          variant={completed ? 'secondary' : 'default'}
          size="lg"
          className="h-14 flex-col gap-0.5"
          disabled={busy}
          onClick={() => setPanel(panel === 'confirm-complete' ? 'none' : 'confirm-complete')}
        >
          {isBusy(delivery, 'complete') ? (
            <Loader2 className="size-4 animate-spin" />
          ) : completed ? (
            <Check className="size-4" />
          ) : (
            <Flag className="size-4" />
          )}
          <span className="text-sm">{completed ? t('completeDone') : t('complete')}</span>
        </Button>

        {/* Abholung and Meldung carry `font-semibold` where the two red ones
            carry the Button's own `font-medium`. Not an inconsistency: all four
            compute to 500, but white on the red fill reads visibly heavier than
            white on the near-black outline, and the four are one group of quick
            actions — so the darker pair is nudged up to MATCH, not to stand out. */}
        <Button
          variant="outline"
          size="lg"
          className="h-14 flex-col gap-0.5"
          disabled={busy}
          onClick={() => setPanel(panel === 'pickup' ? 'none' : 'pickup')}
        >
          <CarTaxiFront className="size-4" />
          <span className="text-sm font-semibold">{tPickup('request')}</span>
        </Button>
          </>
        )}

        <Button
          variant="outline"
          size="lg"
          className="h-14 flex-col gap-0.5"
          disabled={busy}
          onClick={() => setPanel(panel === 'message' ? 'none' : 'message')}
        >
          <MessageSquare className="size-4" />
          <span className="text-sm font-semibold">{t('message')}</span>
        </Button>
      </div>

      {/* Standing state, so a crew that already asked does not ask twice.
          Since sweep 27 §P3.1 it also answers the question the crew is actually
          standing there with — hat das jemand gesehen? — from real KP actions:
          a vehicle dispatched after the request, or the dismissed warning bell.
          Derived server-side; no operator ever clicks an "acknowledge". */}
      {pickupNeeded && (
        <div className="rounded-lg bg-amber-100 dark:bg-amber-900/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-medium">
            {tPickup('badge')}
            {formatPickupSince(pickupSince) ? ` · ${tPickup('since', { time: formatPickupSince(pickupSince) })}` : ''}
          </p>
          {pickupSince && (
            <p className="text-xs opacity-80">{tPickup('waiting', { duration: formatPickupWaiting(pickupSince) })}</p>
          )}
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
          «Abholung disponiert». Without this line the amber box just vanished —
          to a crew in the rain, indistinguishable from a lost request. */}
      {!pickupNeeded && assignment.pickup_resolved_at && (
        <div className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
          <p className="flex items-center gap-1.5 font-medium">
            <Check className="size-4 shrink-0" />
            {tPickup('ackResolved', { time: formatPickupSince(toDate(assignment.pickup_resolved_at)) })}
          </p>
        </div>
      )}

      {/* --- Did it arrive? --------------------------------------------------
          The receipt for every one of the four reports, at section level rather
          than inside a panel: the Meldung panel closes on success, and the
          answer has to outlive it. `aria-live` because on a phone this line is
          often the only thing that changed. */}
      <div aria-live="polite" role="status">
        {delivery.status === 'pending' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            {t('sending', { label: delivery.label })}
          </p>
        )}

        {delivery.status === 'sent' && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
            <Check className="size-4 shrink-0" />
            <span className="min-w-0 break-words">{t('sent', { label: delivery.label })}</span>
          </p>
        )}

        {delivery.status === 'failed' && (
          <div className="space-y-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
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
              <RotateCcw className="size-4" />
              {t('retry')}
            </Button>
          </div>
        )}
      </div>

      {/* --- Ask first (§18.18) ---------------------------------------------
          Same panel shape as the Abholung question below, deliberately: one
          line, one tap, no modal. Neither report can be taken back from a
          phone — the KP is the only surface that can clear them — and a thumb
          in the rain hits the wrong half of a 2×2 grid often enough that the
          first field test found it.

          The **Ja goes on top**, directly under the question: it is the answer
          the panel was opened to give, and it was sitting below Abbrechen —
          the one arrangement where the thumb's resting position is the way
          out rather than the way through. */}
      {(panel === 'confirm-arrived' || panel === 'confirm-complete') && (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <p className="text-sm font-medium">
            {panel === 'confirm-arrived' ? t('confirmArrivedQuestion') : t('confirmCompleteQuestion')}
          </p>
          <div className="grid grid-cols-1 gap-2">
            <Button
              size="lg"
              disabled={busy}
              onClick={panel === 'confirm-arrived' ? handleArrived : handleComplete}
            >
              {panel === 'confirm-arrived' ? t('confirmArrivedYes') : t('confirmCompleteYes')}
            </Button>
            <Button size="lg" variant="outline" disabled={busy} onClick={() => setPanel('none')}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* --- The follow-up (decision 24) ------------------------------------
          With a vehicle standing at the address the answer is known: «Wir
          fahren selbst» leads as the primary choice and the Abholung drops to
          a quiet second — marked redundant, not disabled, because the vehicle
          leaving without the crew (driver called away) is rare but real. */}
      {panel === 'pickup-followup' && (
        <div className="rounded-lg border border-border p-3 space-y-3">
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
                {isBusy(delivery, 'pickup') && <Loader2 className="size-4 animate-spin" />}
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
                {isBusy(delivery, 'pickup') && <Loader2 className="size-4 animate-spin" />}
                {tPickup('needPickup')}
              </Button>
            </div>
          )}
        </div>
      )}

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
            {isBusy(delivery, 'pickup') && <Loader2 className="size-4 animate-spin" />}
            {pickupNeeded ? tPickup('updateNote') : tPickup('needPickup')}
          </Button>
        </div>
      )}

      {/* --- Freitext-Meldung ------------------------------------------------ */}
      {panel === 'message' && (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <p className="text-sm font-medium">{t('messageTitle')}</p>
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
              placeholder={t('messagePlaceholder')}
              value={message}
              maxLength={500}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleMessage(message)
              }}
              className="h-11 text-sm"
            />
            <Button
              size="icon"
              aria-label={t('send')}
              disabled={busy || !message.trim()}
              onClick={() => handleMessage(message)}
            >
              {isBusy(delivery, 'message') ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
