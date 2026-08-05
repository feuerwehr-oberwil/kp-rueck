'use client'

/**
 * EventClock — the board's primary clock, with a labelled mode menu.
 *
 * The pill used to show the wall clock and nothing else, which answers "what
 * time is it" but not "how long have we been at this" — and on a long Lage the
 * second question is the one that gets asked. Three modes, one at a time:
 *
 *   Dauer  ⏳  how long since the Ereignis started
 *   Zeit   🕐  the wall clock (default — it is what the pill always was)
 *   Start  🚩  when the Ereignis started
 *
 * Modelled on KP Front's Einsatzuhr, and deliberately a LABELLED menu rather
 * than tap-to-cycle: each row names its mode AND shows its current value, so
 * the reading is never ambiguous at 3am. A distinct icon per mode means the
 * pill itself says which of the three you are looking at. The choice is
 * per-device (localStorage), like the other board view preferences.
 *
 * With no event selected there is nothing to measure from, so it falls back to
 * the plain wall clock and hides the menu.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Clock, Hourglass, Flag, Check, ChevronDown } from 'lucide-react'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useCurrentTime } from '@/lib/hooks/use-current-time'
import { useEvent } from '@/lib/contexts/event-context'
import { readItem, writeItem } from '@/lib/utils/safe-storage'
import { cn } from '@/lib/utils'

export type EventClockMode = 'duration' | 'time' | 'start'

const MODES: EventClockMode[] = ['duration', 'time', 'start']
const MODE_ICON = { duration: Hourglass, time: Clock, start: Flag } as const
const STORAGE_KEY = 'kp-board-clockMode'

function isMode(value: string | null): value is EventClockMode {
  return value === 'duration' || value === 'time' || value === 'start'
}

/** "1h 04m" / "12m" — hours only once there are any, so the common case stays short. */
function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`
}

export function EventClock({ className }: { className?: string }) {
  const t = useTranslations('kanban.clock')
  const { currentTime, isMounted } = useCurrentTime()
  const { selectedEvent } = useEvent()

  const [mode, setMode] = useState<EventClockMode>('time')
  useEffect(() => {
    const saved = readItem(STORAGE_KEY)
    if (isMode(saved)) setMode(saved)
  }, [])
  const pickMode = (next: EventClockMode) => {
    setMode(next)
    writeItem(STORAGE_KEY, next)
  }

  const startedAt = selectedEvent?.created_at ?? null
  const wallClock = isMounted && currentTime ? currentTime.toLocaleTimeString('de-CH') : '--:--:--'

  const valueFor = (m: EventClockMode): string => {
    if (m === 'time') return wallClock
    if (!startedAt || !isMounted || !currentTime) return '--:--'
    if (m === 'start') return startedAt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
    return formatDuration(currentTime.getTime() - startedAt.getTime())
  }

  const pill = 'flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-1.5'
  const ActiveIcon = MODE_ICON[mode]

  // No Ereignis, no reference point — degrade to exactly the old wall clock.
  if (!startedAt) {
    return (
      <div className={cn(pill, className)}>
        <Clock className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-base font-semibold tabular-nums">{wallClock}</span>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(pill, 'transition-colors hover:bg-secondary', className)}
          title={t('menuLabel')}
          aria-label={`${t(`modes.${mode}`)}: ${valueFor(mode)}`}
        >
          <ActiveIcon className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-base font-semibold tabular-nums">{valueFor(mode)}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {MODES.map((m) => {
          const Icon = MODE_ICON[m]
          return (
            <DropdownMenuItem key={m} onSelect={() => pickMode(m)} className="cursor-pointer gap-2">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">{t(`modes.${m}`)}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{valueFor(m)}</span>
              {mode === m && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
