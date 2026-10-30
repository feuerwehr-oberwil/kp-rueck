'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FormMessage } from '@/components/ui/form-message'
import { useEvent } from '@/lib/contexts/event-context'
import { useStandby } from '@/lib/contexts/standby-context'
import { getIntlLocale } from '@/lib/date-locale'

function clock(date: Date, seconds: boolean): string {
  return date.toLocaleTimeString(getIntlLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  })
}

/**
 * The standby box's permanent band (variant A of the 2026-10-30 mocks), over every page and on
 * every device, never dismissable – it is what says that this board is not the hosted one.
 *
 * - Mirror: «Spiegel von KP Rück Online · Stand 19:30:12 · nur ansehen», and on the desktop,
 *   for editors and admins with an Ereignis open, the one action: «Dieses Ereignis offline
 *   übernehmen …», confirmed in one dialog.
 * - The open Ereignis was taken offline: amber, «Offline geführt seit 19:42 · «Name» wird
 *   nicht mehr synchronisiert».
 *
 * Renders nothing outside a standby box (`useStandby().mirror`).
 */
export function StandbyBand() {
  const t = useTranslations('standby')
  const standby = useStandby()
  const { selectedEvent } = useEvent()
  const [confirming, setConfirming] = useState(false)

  if (!standby.mirror) return null

  if (selectedEvent && standby.selectedDetached) {
    const since = standby.detached.get(selectedEvent.id)
    return (
      <div
        data-standby-band="offline"
        role="note"
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/50 bg-amber-500 px-4 py-1.5 text-sm text-amber-950"
      >
        <span className="text-xs font-extrabold uppercase tracking-[2px]">{t('offline.label')}</span>
        <span className="min-w-0 break-words font-semibold">
          {t('offline.text', { time: since ? clock(since, false) : '–', name: selectedEvent.name })}
        </span>
      </div>
    )
  }

  const stand = standby.lastReceivedAt ? clock(standby.lastReceivedAt, true) : null
  return (
    <div
      data-standby-band="mirror"
      role="note"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted px-4 py-1.5 text-sm text-foreground"
    >
      <span className="text-xs font-extrabold uppercase tracking-[2px]">{t('mirror.label')}</span>
      <span className="min-w-0 flex-1 break-words text-muted-foreground">
        {stand
          ? t(standby.current ? 'mirror.current' : 'mirror.stale', { time: stand })
          : t('mirror.never')}
      </span>
      {selectedEvent && standby.canTakeOver && (
        <Button size="sm" className="hidden md:inline-flex" onClick={() => setConfirming(true)}>
          {t('takeover.button')}
        </Button>
      )}
      {selectedEvent && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('takeover.title', { name: selectedEvent.name })}
          description={t('takeover.description')}
          confirmText={t('takeover.confirm')}
          onConfirm={async () => {
            try {
              await standby.takeOver(selectedEvent.id)
            } catch {
              toast.error(t('takeover.failed'))
            }
          }}
        >
          <p className="text-sm text-muted-foreground">{t('takeover.others')}</p>
          {standby.current && <FormMessage tone="advice">{t('takeover.reachable')}</FormMessage>}
        </ConfirmDialog>
      )}
    </div>
  )
}
