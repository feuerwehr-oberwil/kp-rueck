"use client"

import { useEffect, useMemo } from 'react'
import { Calendar, ChevronRight, Plus } from 'lucide-react'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Kbd } from '@/components/ui/kbd'
import { LoadingStatus } from '@/components/ui/shell-loader'
import { TrainingBadge } from '@/components/training-mode-chrome'
import { useEvent } from '@/lib/contexts/event-context'
import { recentOpenEvents } from '@/lib/recent-events'
import type { Event } from '@/lib/types/incidents'

/**
 * The board's start screen when no Ereignis is chosen (fresh browser, after a logout).
 * An open Ereignis opened in the last 24 h is a row to continue; the most recently active
 * one carries the ink «Öffnen» and ↵ (UX-DESKTOP-06 – at 3 am the loudest button must not
 * split the storm evening into two Ereignisse). None → the fallback card, where «Neues
 * Ereignis» is the main action. Rendered by `app/page.tsx` only.
 */
export function EventSelectionEmptyState() {
  const t = useTranslations('events')
  const tTraining = useTranslations('kanban')
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  const router = useRouter()
  const { events, isLoading, setSelectedEvent } = useEvent()

  const recent = useMemo(() => recentOpenEvents(events, now), [events, now])
  const first = recent[0]

  const open = (event: Event) => {
    setSelectedEvent(event)
    router.push('/')
  }

  // ↵ opens the first row – only while nothing else has focus, so Enter on a focused
  // «Neues Ereignis» (or anywhere in an open dialog/palette) stays that control's own.
  useEffect(() => {
    if (!first) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.repeat) return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.target !== document.body) return
      e.preventDefault()
      setSelectedEvent(first)
      router.push('/')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [first, setSelectedEvent, router])

  const opened = (event: Event) => {
    const at = new Date(event.created_at)
    const time = format.dateTime(at, { hour: '2-digit', minute: '2-digit' })
    return at.toDateString() === now.toDateString()
      ? t('emptyState.openedToday', { time })
      : t('emptyState.openedYesterday', { time })
  }

  return (
    // `min-h-full` of the shell's <main>, never `h-screen`: the shell is `h-dvh`, and on iOS
    // Safari 100vh is the LARGE viewport (toolbar collapsed) — taller than the dvh <main> it sits
    // in while the toolbar shows, so a screen that fits scrolled by the difference (owner,
    // iPhone, 02.10.2026). `min-` so a short landscape phone can still scroll to the buttons.
    <div className="flex min-h-full items-center justify-center bg-background p-4">
      {isLoading && events.length === 0 ? (
        <LoadingStatus size="surface" className="text-sm">{t('emptyState.loading')}</LoadingStatus>
      ) : first ? (
        <Card className="w-full max-w-2xl animate-fade-in-up" data-testid="event-start-recent">
          <CardContent className="space-y-5 p-6 md:p-10">
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('emptyState.title')}</h1>
              <p className="text-base text-muted-foreground">{t('emptyState.recentDescription')}</p>
            </div>

            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {recent.map((event) => (
                <li key={event.id} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words text-[15px] font-semibold">{event.name}</span>
                      {event.training_flag && <TrainingBadge label={tTraining('dashboard.training')} />}
                    </div>
                    <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
                      {t('page.incidentCountShort', { count: event.incident_count })}
                      {' · '}
                      {opened(event)}
                      {' · '}
                      {t('emptyState.lastActive', { rel: format.relativeTime(new Date(event.last_activity_at), now) })}
                    </p>
                  </div>
                  <Button
                    variant={event === first ? 'default' : 'outline'}
                    className="shrink-0"
                    onClick={() => open(event)}
                    aria-keyshortcuts={event === first ? 'Enter' : undefined}
                    aria-label={`${event.name}: ${t('emptyState.open')}`}
                  >
                    {t('emptyState.open')}
                    {event === first && (
                      <Kbd aria-hidden className="bg-action-foreground/15 text-current">↵</Kbd>
                    )}
                  </Button>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => router.push('/events?action=create')}>
                <Plus className="size-4" />
                {t('emptyState.createButton')}
              </Button>
              <Button variant="ghost" className="ml-auto" onClick={() => router.push('/events')}>
                {t('emptyState.allEvents')}
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="w-full max-w-2xl animate-fade-in-up" data-testid="event-start-fallback">
          <CardContent className="space-y-5 p-6 text-center md:p-12">
            {/* A neutral tile, standing still: red means priority and danger here, and a pulse
                says «something is happening» — neither is true of an empty start screen. */}
            <div className="flex justify-center">
              <div className="rounded-full bg-muted p-4 md:p-5">
                <Calendar className="h-10 w-10 text-muted-foreground md:h-12 md:w-12" aria-hidden="true" />
              </div>
            </div>

            <div className="space-y-3">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('emptyState.title')}</h1>
              <p className="mx-auto max-w-md text-base text-muted-foreground">{t('emptyState.description')}</p>
            </div>

            <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
              <Button size="lg" className="min-h-[52px] hover-delight" onClick={() => router.push('/events?action=create')}>
                <Plus className="size-4" />
                {t('emptyState.createButton')}
              </Button>
              <Button size="lg" variant="outline" className="min-h-[52px] hover-delight" onClick={() => router.push('/events')}>
                {t('emptyState.viewButton')}
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
