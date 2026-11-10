'use client'

/**
 * The way into the Alarmeingang: an inbox icon in the page header, beside the bell, always
 * there, with the number of NEW alarms (`countNewAlarms`) on it. A toggle – pressed while the
 * sheet is open, a second click closes it. Rendered by `PageNavigation` (desktop header);
 * the phone reaches the same sheet through «Mehr» (`AlarmInboxMenuCount`).
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Inbox } from 'lucide-react'
import { useAuth } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toggleAlarmInbox, useAlarmInboxOpen, useAlarmPool } from './alarm-inbox-store'
import { countNewAlarms, nextNewExpiry } from './alarm-groups'

export function AlarmInboxButton() {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return null
  return <AlarmInboxToggle />
}

/** «9+» past nine, like the bell. */
const badgeText = (count: number) => (count > 9 ? '9+' : String(count))

/**
 * The number of new alarms, re-counted when the oldest of them turns 24 hours old – on a quiet
 * page nothing else would render the icon again, and the alarm would stay «neu».
 */
function useNewAlarmCount(): number {
  const { emergencies } = useAlarmPool()
  const [now, setNow] = useState(() => Date.now())
  const expiry = nextNewExpiry(emergencies, now)
  useEffect(() => {
    if (expiry === null) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, expiry - Date.now()))
    return () => clearTimeout(timer)
  }, [expiry])
  return countNewAlarms(emergencies, now)
}

function AlarmInboxToggle() {
  const t = useTranslations('divera.inbox')
  const open = useAlarmInboxOpen()
  const count = useNewAlarmCount()
  return (
    <Button
      variant={open ? 'selected' : 'ghost'}
      size="icon"
      onClick={toggleAlarmInbox}
      className="relative h-9 w-9 md:h-10 md:w-10"
      aria-label={t('entryAria', { count })}
      aria-pressed={open}
      title={t('title')}
      // ALARM_INBOX_TRIGGER_ATTR – the sheet measures the header from here
      data-alarm-inbox-trigger=""
    >
      <Inbox className="size-4 md:size-5" />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 font-mono text-xs font-semibold text-background"
        >
          {badgeText(count)}
        </span>
      )}
    </Button>
  )
}

/** The count beside «Alarmeingang» in the phone's «Mehr» sheet; nothing when none is new. */
export function AlarmInboxMenuCount({ className }: { className?: string }) {
  const count = useNewAlarmCount()
  if (count === 0) return null
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 font-mono text-xs font-semibold text-background',
        className,
      )}
    >
      {badgeText(count)}
    </span>
  )
}
