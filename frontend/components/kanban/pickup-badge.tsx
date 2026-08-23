'use client'

/**
 * The amber "Abholung" chip (plan 25, decision 24).
 *
 * One component, several mounts — kanban card, map view, Restliste, wall
 * display as a chip, and the incident detail as a `banner` — because the pickup
 * is a driving job and whoever assigns it is looking at wherever things are. It
 * carries the waiting time on purpose: "Abholung" alone says nothing at 02:00,
 * "Abholung · seit 23:14" says who to send first.
 *
 * It stays on a card that has been moved to `complete`. That is not an
 * oversight to tidy up later: completing an incident auto-releases the
 * personnel while the crew is physically still at the address, so this chip is
 * the only thing left saying they are there.
 *
 * **The chip is also the way it goes away** (§18.9). `/feld` used to carry an
 * "Abgeholt" button and it was removed: nobody standing at the kerb with wet
 * gloves taps a phone to report that the car they are already sitting in
 * arrived. Clearing is the KP's job — it is the KP that dispatched the car —
 * so the chip is the button. Passing `incidentId` turns it into one; it then
 * asks before clearing, because the waiting time is the only record of how
 * long they stood there and a mis-click erases it.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CarTaxiFront, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { useOperations } from '@/lib/contexts/operations-context'
import { formatPickupSince, formatPickupWaiting } from '@/lib/pickup'

/** Everything the chip does happens inside the chip — nothing above it reacts. */
function stopEvent(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

interface PickupBadgeProps {
  requestedAt: Date | null | undefined
  note?: string
  /** `compact` drops the waiting time — for the map, where space is scarcer.
   *  `banner` is the boxed call to action used in the detail (modal Übersicht
   *  column / panel strip under the tabs): the same fact stated as a sentence,
   *  in the shape of the «Feld meldet …» nudge next to it. */
  variant?: 'default' | 'compact' | 'banner'
  className?: string
  /**
   * Which incident this pickup belongs to. Supplying it makes the chip the
   * KP's "Abholung disponiert" control; leaving it out keeps the chip a label.
   */
  incidentId?: string
  /** False for a viewer — the chip stays readable and stops being a button. */
  canEdit?: boolean
  /** Called after the pickup was cleared, so the mount can refresh its list. */
  onCleared?: () => void | Promise<void>
}

export function PickupBadge({
  requestedAt,
  note,
  variant = 'default',
  className,
  incidentId,
  canEdit = true,
  onCleared,
}: PickupBadgeProps) {
  const t = useTranslations('feld.pickup')
  // The provider wraps the whole app in the root layout, so this is safe at
  // every mount. Waiting for the ~5 s poll to drop an amber chip you just
  // cleared is exactly the kind of "did that work?" the board must not create.
  const { refreshOperations } = useOperations()
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const since = formatPickupSince(requestedAt)
  const waiting = formatPickupWaiting(requestedAt)
  const clearable = Boolean(incidentId) && canEdit

  const handleClear = async () => {
    if (!incidentId) return
    setClearing(true)
    try {
      // No success toast: the KP operator pressed this button and confirmed it in
      // a dialog, and the badge disappears in front of them. Announcing it back
      // tells them something they just did — and while the detail modal is open
      // the toast lands on top of it, where it is in the way rather than useful.
      // A FAILURE still speaks up: that is the case they cannot see.
      await apiClient.setIncidentFieldReport(incidentId, { pickup_needed: false })
      await refreshOperations()
      await onCleared?.()
    } catch (error) {
      console.error('Failed to clear pickup:', error)
      toast.error(t('clearFailed'))
    } finally {
      setClearing(false)
    }
  }

  const tooltip = [note, waiting ? t('waitingTooltip', { duration: waiting }) : null]
    .filter(Boolean)
    .join(' · ')

  const body = (
    <>
      {clearing ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
      ) : (
        <CarTaxiFront className="h-3 w-3 shrink-0 group-hover/pickup:hidden" aria-hidden />
      )}
      {clearable && !clearing && (
        <Check className="hidden h-3 w-3 shrink-0 group-hover/pickup:block" aria-hidden />
      )}
      <span>{t('badge')}</span>
      {variant === 'default' && since && (
        <span className="font-normal opacity-80">{t('since', { time: since })}</span>
      )}
    </>
  )

  const chrome = cn(
    // nowrap: in a narrow card header the chip broke «seit 15:43» onto its own
    // line inside the pill — the chip wraps as a whole or not at all.
    'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium',
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    className,
  )

  // The dialog is a portal in the DOM but still a CHILD in the React tree, and
  // React bubbles portalled events to the React parent. So a click on
  // "Abholung disponiert" – or on Abbrechen, or anywhere on the overlay – reached
  // the kanban card's own onClick and opened the incident behind the dialog.
  // `display: contents` so this wrapper adds no box of its own to the row it
  // sits in (the dialog itself renders elsewhere).
  const confirmDialog = (
    <span className="contents" onClick={stopEvent} onPointerDown={stopEvent} onMouseDown={stopEvent}>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('clearConfirmTitle')}
        description={
          waiting ? t('clearConfirmBodyWaiting', { duration: waiting }) : t('clearConfirmBody')
        }
        confirmText={t('clear')}
        onConfirm={handleClear}
      />
    </span>
  )

  if (variant === 'banner') {
    // Same shape as FieldStatusNudge's `detail` variant — a boxed sentence with
    // its action on the right — because to the operator these are the same kind
    // of thing: something the field reported that the KP still has to answer.
    // Amber rather than the nudge's primary tint: «Abholung» is amber
    // everywhere else on the board, and the colour is the fastest read.
    // No dismiss X: the waiting crew does not go away by being waved away, so
    // «Abholung disponiert» is the only way out (§18.9).
    return (
      <>
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg p-3 text-xs',
            'border border-amber-500/30 bg-amber-500/5',
            className,
          )}
        >
          <div className="flex min-w-[11rem] flex-1 items-start gap-2">
            <CarTaxiFront
              className="mt-px h-3.5 w-3.5 flex-shrink-0 text-amber-700 dark:text-amber-400"
              aria-hidden
            />
            <span className="min-w-0 text-foreground">
              {waiting ? `${t('badge')} – ${t('waiting', { duration: waiting })}` : t('badge')}
              {note ? <span className="text-muted-foreground"> · {note}</span> : null}
            </span>
          </div>
          {clearable && (
            <div className="ml-auto flex flex-shrink-0 items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={clearing}
                onClick={(event) => {
                  event.stopPropagation()
                  setConfirming(true)
                }}
              >
                {clearing && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {t('clear')}
              </Button>
            </div>
          )}
        </div>

        {confirmDialog}
      </>
    )
  }

  if (!clearable) {
    return (
      <span className={chrome} title={tooltip}>
        {body}
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        // The card is draggable and the chip sits inside it: without stopping
        // the pointer the "click" is swallowed as the start of a drag.
        onPointerDown={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation()
          setConfirming(true)
        }}
        disabled={clearing}
        title={[t('clear'), tooltip].filter(Boolean).join(' · ')}
        className={cn(
          chrome,
          'group/pickup cursor-pointer transition-colors',
          'hover:bg-amber-200 dark:hover:bg-amber-900/70',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1',
        )}
      >
        {body}
      </button>

      {confirmDialog}
    </>
  )
}
