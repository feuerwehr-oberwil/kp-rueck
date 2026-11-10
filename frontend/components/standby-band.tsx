'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { StandbyConflictsSheet } from '@/components/standby-conflicts-sheet'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FormMessage } from '@/components/ui/form-message'
import { useEvent } from '@/lib/contexts/event-context'
import { type StandbyLead, useStandby } from '@/lib/contexts/standby-context'
import { getIntlLocale } from '@/lib/date-locale'
import { formatDurationLong } from '@/lib/duration'
import { cn } from '@/lib/utils'

function clock(date: Date, seconds: boolean): string {
  return date.toLocaleTimeString(getIntlLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  })
}

// The sync runs every few seconds; past this the other system counts as not reached.
const HEARD_WITHIN_MS = 60_000
// «Is somebody still working there?» – the warning in the takeover dialogs.
const WORKING_WITHIN_MS = 90_000

function heardRecently(lead: StandbyLead | null, withinMs = HEARD_WITHIN_MS): boolean {
  return !!lead?.contactAt && Date.now() - lead.contactAt.getTime() < withinMs
}

type BandKind = 'mirror' | 'offline' | 'led-elsewhere' | 'conflicts'

/**
 * The permanent band of the standby box and, while a box leads the open Ereignis, of the
 * hosted board (variants 1A/2A of the 2026-11-09 mocks). Never dismissable; on every device,
 * the takeover button on the desktop only.
 *
 * - Box, mirror (grey): «Spiegel von KP Rück Online · Stand 19:30:12 · nur ansehen» and
 *   «Dieses Ereignis offline übernehmen …».
 * - Box, leading (amber): «Offline geführt · seit 19:42 · alles an KP Rück Online übertragen
 *   · Stand …», or how long the hosted board has not been reached and how much is waiting.
 * - Hosted board, the box leads (grey): «Geführt auf KP Rück Offline · seit 19:42 · Stand …
 *   · Neues erfassen geht, Bestehendes ändern nicht» and «Hier übernehmen …».
 * - Hosted board, leading, with open conflicts from the box: a grey band to reach them.
 *
 * Open conflicts add «n Konflikte ›», which opens the list (`StandbyConflictsSheet`).
 * Renders nothing on a board no standby box ever touched.
 */
export function StandbyBand() {
  const t = useTranslations('standby')
  const tDuration = useTranslations('common.duration')
  const standby = useStandby()
  const { selectedEvent } = useEvent()
  const [confirming, setConfirming] = useState(false)
  const [conflictsOpen, setConflictsOpen] = useState(false)

  const lead = standby.selectedLead
  const kind: BandKind | null = standby.mirror
    ? standby.selectedLedHere
      ? 'offline'
      : 'mirror'
    : !standby.selectedLedHere
      ? 'led-elsewhere'
      : (lead?.open_conflicts ?? 0) > 0
        ? 'conflicts'
        : null
  if (!kind) return null

  const ago = (date: Date) => formatDurationLong(Date.now() - date.getTime(), tDuration)
  const name = selectedEvent?.name ?? ''
  let label: string
  let text: string
  if (kind === 'mirror') {
    const stand = standby.lastReceivedAt ? clock(standby.lastReceivedAt, true) : null
    label = t('mirror.label')
    text = stand ? t(standby.current ? 'mirror.current' : 'mirror.stale', { time: stand }) : t('mirror.never')
  } else if (kind === 'offline') {
    const since = lead ? clock(lead.since, false) : '–'
    const pending = lead?.pending ?? 0
    label = t('offline.label')
    text = !lead?.contactAt
      ? t('offline.never', { since, count: pending })
      : heardRecently(lead)
        ? pending > 0
          ? t('offline.waiting', { since, count: pending, time: clock(lead.contactAt, true) })
          : t('offline.sent', { since, time: clock(lead.contactAt, true) })
        : t('offline.unreachable', { since, lost: clock(lead.contactAt, false), count: pending })
  } else if (kind === 'led-elsewhere') {
    const since = lead ? clock(lead.since, false) : '–'
    label = t('ledElsewhere.label')
    text = !lead?.contactAt
      ? t('ledElsewhere.never', { since })
      : heardRecently(lead)
        ? t('ledElsewhere.current', { since, time: clock(lead.contactAt, true) })
        : t('ledElsewhere.silent', { since, time: clock(lead.contactAt, true), ago: ago(lead.contactAt) })
  } else {
    label = t('conflicts.label')
    text = t('conflicts.text')
  }

  const openConflicts = lead?.open_conflicts ?? 0
  const canTake = !!selectedEvent && standby.canTakeOver && (kind === 'mirror' || kind === 'led-elsewhere')
  const amber = kind === 'offline'

  return (
    <div
      data-standby-band={kind}
      role="note"
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-sm',
        amber ? 'border-amber-500/50 bg-amber-500 text-amber-950' : 'border-border bg-muted text-foreground',
      )}
    >
      <span className="shrink-0 text-xs font-extrabold uppercase tracking-[2px]">{label}</span>
      {/* A basis, not just flex-1: on a phone the sentence wraps under the label and keeps
          the full width, instead of shrinking into a column that breaks words apart. */}
      <span className={cn('min-w-0 flex-[1_1_16rem] break-words', amber ? 'font-semibold' : 'text-muted-foreground')}>
        {text}
      </span>
      {selectedEvent && openConflicts > 0 && (
        <Button
          size="sm"
          variant="outline"
          className={cn(amber && 'border-amber-900/40 bg-amber-50 text-amber-950 hover:bg-amber-100')}
          onClick={() => setConflictsOpen(true)}
        >
          {t('conflicts.open', { count: openConflicts })}
        </Button>
      )}
      {canTake && (
        <Button size="sm" className="hidden md:inline-flex" onClick={() => setConfirming(true)}>
          {t(kind === 'mirror' ? 'takeover.button' : 'takeBack.button')}
        </Button>
      )}
      {selectedEvent && canTake && kind === 'mirror' && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('takeover.title', { name })}
          description={t('takeover.description')}
          confirmText={t('takeover.confirm')}
          onConfirm={async () => {
            try {
              await standby.takeOver(selectedEvent.id)
            } catch (error) {
              toast.error(t('takeover.failed'))
              throw error // the dialog stays open for another try
            }
          }}
        >
          <p className="text-sm text-muted-foreground">{t('takeover.others')}</p>
          {standby.current && <FormMessage tone="advice">{t('takeover.reachable')}</FormMessage>}
        </ConfirmDialog>
      )}
      {selectedEvent && canTake && kind === 'led-elsewhere' && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('takeBack.title', { name })}
          description={t('takeBack.description')}
          confirmText={t('takeBack.confirm')}
          onConfirm={async () => {
            try {
              await standby.takeOver(selectedEvent.id)
            } catch (error) {
              toast.error(t('takeBack.failed'))
              throw error // the dialog stays open for another try
            }
          }}
        >
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg bg-muted px-3 py-2 text-sm">
            <dt className="text-muted-foreground">{t('takeBack.heard')}</dt>
            <dd className="text-right tabular-nums">
              {!lead?.contactAt
                ? t('takeBack.heardNever')
                : Date.now() - lead.contactAt.getTime() < 60_000
                  ? t('takeBack.heardJustNow', { time: clock(lead.contactAt, true) })
                  : t('takeBack.heardAt', { time: clock(lead.contactAt, true), ago: ago(lead.contactAt) })}
            </dd>
            <dt className="text-muted-foreground">{t('takeBack.pending')}</dt>
            <dd className="text-right tabular-nums">{t('takeBack.pendingCount', { count: lead?.pending ?? 0 })}</dd>
          </dl>
          <p className="text-sm text-muted-foreground">{t('takeBack.later')}</p>
          {heardRecently(lead, WORKING_WITHIN_MS) && <FormMessage tone="advice">{t('takeBack.working')}</FormMessage>}
        </ConfirmDialog>
      )}
      {selectedEvent && (
        // Keyed: another Ereignis never shows (or decides) the previous one's list while it loads.
        <StandbyConflictsSheet
          key={selectedEvent.id}
          open={conflictsOpen}
          onOpenChange={setConflictsOpen}
          eventId={selectedEvent.id}
        />
      )}
    </div>
  )
}
