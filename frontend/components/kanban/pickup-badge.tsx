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
 */

import { useTranslations } from 'next-intl'
import { CarTaxiFront } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatPickupSince, formatPickupWaiting } from '@/lib/pickup'

interface PickupBadgeProps {
  requestedAt: Date | null | undefined
  note?: string
  /** `compact` drops the waiting time — for the map, where space is scarcer. */
  variant?: 'default' | 'compact'
  className?: string
}

export function PickupBadge({ requestedAt, note, variant = 'default', className }: PickupBadgeProps) {
  const t = useTranslations('feld.pickup')
  const since = formatPickupSince(requestedAt)
  const waiting = formatPickupWaiting(requestedAt)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium',
        'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
        className
      )}
      title={[note, waiting ? t('waitingTooltip', { duration: waiting }) : null].filter(Boolean).join(' · ')}
    >
      <CarTaxiFront className="h-3 w-3 shrink-0" aria-hidden />
      <span>{t('badge')}</span>
      {variant === 'default' && since && (
        <span className="font-normal opacity-80">{t('since', { time: since })}</span>
      )}
    </span>
  )
}
