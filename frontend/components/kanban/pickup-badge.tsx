'use client'

/**
 * The amber "Abholung" chip (plan 25, decision 24).
 *
 * One component, three mounts — kanban card, detail header, map view — because
 * the pickup is a driving job and whoever assigns it is looking at wherever
 * things are. It carries the waiting time on purpose: "Abholung" alone says
 * nothing at 02:00, "Abholung · seit 23:14" says who to send first.
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

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { useOperations } from '@/lib/contexts/operations-context'
import { formatPickupSince, formatPickupWaiting } from '@/lib/pickup'

interface PickupBadgeProps {
  requestedAt: Date | null | undefined
  note?: string
  /** `compact` drops the waiting time — for the map, where space is scarcer. */
  variant?: 'default' | 'compact'
  className?: string
  /**
   * Which incident this pickup belongs to. Supplying it makes the chip the
   * KP's "Abholung erledigt" control; leaving it out keeps the chip a label.
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
      await apiClient.setIncidentFieldReport(incidentId, { pickup_needed: false })
      toast.success(t('clearedToast'))
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
    'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium',
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    className,
  )

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
    </>
  )
}
