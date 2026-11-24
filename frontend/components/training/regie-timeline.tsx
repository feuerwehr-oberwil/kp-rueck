'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { MoreHorizontal, Pause, Play, Timer } from 'lucide-react'

import { useIntlLocale } from '@/lib/date-locale'
import { formatTime } from '@/lib/format-time'
import { countdownText, formatClock, regieTimeline, type RegieTimelineEntry } from '@/lib/training-regie'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DriveProgress, useStepLabel } from '@/components/training/regie-labels'
import { useRegie } from '@/components/training/regie-provider'

/** How many rows «Danach» and «Vorhin» show before «Alle zeigen». */
const FOLDED_ROWS = 5

/** The words of one timeline row: where, and what happens there. */
function useEntryText() {
  const t = useTranslations('training.regie')
  const stepLabel = useStepLabel()
  const { operationById, placeOf } = useRegie()
  return (entry: RegieTimelineEntry) => {
    if (entry.kind === 'automatik') return { place: t('automatikNext'), what: t('automatikNextHint') }
    const op = operationById.get(entry.incident.incident_id)
    return { place: op ? placeOf(op) : '', what: stepLabel(entry.step.key) }
  }
}

/** «Als Nächstes»: the earliest due thing, its countdown, and «Jetzt» / «Halten» / ⋯. */
function NextCard({ entry }: { entry: RegieTimelineEntry | undefined }) {
  const t = useTranslations('training.regie')
  const { clock, operationById, actions, isBusy, openIncident } = useRegie()
  const text = useEntryText()

  if (!entry) {
    return (
      <Card className="gap-1 py-4">
        <CardContent className="px-4 sm:px-6">
          <p className="type-label text-muted-foreground">{t('next')}</p>
          <p className="mt-1 font-medium">{t('nothingNext')}</p>
          <p className="text-xs text-muted-foreground">{t('nothingNextHint')}</p>
        </CardContent>
      </Card>
    )
  }

  const due = entry.dueAt - clock < 1000
  const { place, what } = text(entry)
  const op = entry.kind === 'step' ? operationById.get(entry.incident.incident_id) : undefined
  const busy = op ? isBusy(`step:${op.id}`) || isBusy(`hold:${op.id}`) : isBusy('alarm') || isBusy('automatik')

  return (
    <Card className={cn('gap-3 py-4', due && 'border-warning/70 bg-warning/10')}>
      <CardContent className="space-y-3 px-4 sm:px-6">
        <div>
          <p className={cn('type-label', due ? 'text-warning-foreground' : 'text-muted-foreground')}>
            {t('nextWhen', { when: countdownText(entry.dueAt, clock, (key, values) => (key === 'in' ? t('in', values) : t('due'))) })}
          </p>
          <p className="mt-1 text-lg font-semibold break-words">{place}</p>
          <p className="text-sm text-muted-foreground">
            {what}
            {entry.kind === 'step' && entry.step.rolling && (
              <>
                {' · '}
                <DriveProgress step={entry.step} />
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={busy}
            onClick={() =>
              entry.kind === 'automatik' ? void actions.alarm('normal') : op && void actions.runStep(op, entry.step.key)
            }
          >
            {t('now')}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() =>
              entry.kind === 'automatik'
                ? void actions.setAutomatik(false)
                : void actions.setHeld(entry.incident.incident_id, true)
            }
          >
            <Pause className="size-4" />
            {entry.kind === 'automatik' ? t('automatikOff') : t('hold')}
          </Button>
          {op && (
            <Button variant="outline" size="icon" onClick={() => openIncident(op.id)} aria-label={t('allActions', { place })}>
              <MoreHorizontal className="size-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** One «Danach» row: the time left, what happens where, and its hold toggle. */
function LaterRow({ entry }: { entry: RegieTimelineEntry }) {
  const t = useTranslations('training.regie')
  const { clock, actions, isBusy, openIncident } = useRegie()
  const { place, what } = useEntryText()(entry)
  const incidentId = entry.kind === 'step' ? entry.incident.incident_id : null
  return (
    <li className="flex min-h-11 items-center gap-2 border-b border-border/60 last:border-b-0">
      <button
        type="button"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left text-sm"
        onClick={() => incidentId && openIncident(incidentId)}
        disabled={!incidentId}
      >
        <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{formatClock(entry.dueAt - clock)}</span>
        <span className="min-w-0 flex-1 break-words">
          {entry.kind === 'automatik' ? place : t('placeWhat', { place, what })}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        disabled={incidentId ? isBusy(`hold:${incidentId}`) : isBusy('automatik')}
        onClick={() => (incidentId ? void actions.setHeld(incidentId, true) : void actions.setAutomatik(false))}
        aria-label={incidentId ? t('holdPlace', { place }) : t('automatikOff')}
        title={incidentId ? t('holdPlace', { place }) : t('automatikOff')}
      >
        <Pause className="size-4 text-muted-foreground" />
      </Button>
    </li>
  )
}

/** «Vorhin»: what the Regie did (Autopilot, «Jetzt», injects, alarms), newest first. */
function History() {
  const t = useTranslations('training.regie')
  const locale = useIntlLocale()
  const { state } = useRegie()
  const [all, setAll] = useState(false)
  if (!state || state.history.length === 0) return null
  const items = all ? state.history : state.history.slice(0, FOLDED_ROWS)
  return (
    <section aria-labelledby="regie-history">
      <h2 id="regie-history" className="type-label mb-1 text-muted-foreground">
        {t('history')}
      </h2>
      <ul className="text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={`${item.at}-${item.text}`} className="flex gap-3 border-b border-border/60 py-2 last:border-b-0">
            <span className="w-14 shrink-0 tabular-nums">{formatTime(item.at, locale)}</span>
            <span className="min-w-0 flex-1 break-words">
              {item.by === 'trainer' ? t('byTrainer', { text: item.text }) : item.text}
            </span>
          </li>
        ))}
      </ul>
      {state.history.length > FOLDED_ROWS && (
        <Button variant="ghost" size="sm" className="mt-1 text-muted-foreground" onClick={() => setAll(!all)}>
          {all ? t('showFewer') : t('showAll', { count: state.history.length })}
        </Button>
      )}
    </section>
  )
}

/**
 * The left column's timeline: «Als Nächstes» (the earliest due step or Automatik alarm,
 * counting down at 1 Hz), «Danach» (the following ones, each with its hold toggle) and
 * «Vorhin». Every time comes from the server; the pause stops the clock they count on.
 */
export function RegieTimeline() {
  const t = useTranslations('training.regie')
  const { state } = useRegie()
  const [allLater, setAllLater] = useState(false)
  if (!state) return null
  const [next, ...later] = regieTimeline(state)
  const shownLater = allLater ? later : later.slice(0, FOLDED_ROWS)

  return (
    <>
      <NextCard entry={next} />
      {later.length > 0 && (
        <section aria-labelledby="regie-later">
          <h2 id="regie-later" className="type-label mb-1 text-muted-foreground">
            {t('later')}
          </h2>
          <ul>
            {shownLater.map((entry) => (
              <LaterRow
                key={entry.kind === 'step' ? `${entry.incident.incident_id}:${entry.step.key}` : 'automatik'}
                entry={entry}
              />
            ))}
          </ul>
          {later.length > FOLDED_ROWS && (
            <Button variant="ghost" size="sm" className="mt-1 text-muted-foreground" onClick={() => setAllLater(!allLater)}>
              {allLater ? t('showFewer') : t('showAll', { count: later.length })}
            </Button>
          )}
        </section>
      )}
      <History />
    </>
  )
}

/**
 * The drill's clock and its Pause, in a strip that stays at the top of the page while the
 * trainer scrolls (owner 24.11.: not in the header bar). The page makes it sticky: the
 * wrapper must be a direct child of the scroll container, or it scrolls away with its parent. «Übung» before the first start, then
 * «Übung läuft · m:ss»; the button only once there is something to pause.
 */
export function RegieRunStrip() {
  const t = useTranslations('training.regie')
  const { state, clock, receivedAt, actions, isBusy } = useRegie()
  if (!state) return null
  const paused = !!state.paused_at
  // The server's un-paused run time, ticking on from when it came (`clock` stands still while paused).
  const running = state.running_seconds == null ? null : state.running_seconds * 1000 + (clock - receivedAt)
  const title =
    running === null
      ? t('titleIdle')
      : paused
        ? t('titlePaused', { time: formatClock(running) })
        : t('titleRunning', { time: formatClock(running) })
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 shadow-sm">
      <p className="min-w-0 flex-1 truncate text-base font-semibold tabular-nums" title={title}>
        {title}
      </p>
      {running !== null && (
        <Button
          variant={paused ? 'selected' : 'outline'}
          aria-pressed={paused}
          disabled={isBusy('regie')}
          onClick={() => void actions.setRegie({ paused: !paused })}
          aria-label={paused ? t('resume') : t('pause')}
          className="shrink-0"
        >
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          {paused ? t('resumeShort') : t('pauseShort')}
        </Button>
      )}
    </div>
  )
}

/** Shown in place of «Als Nächstes» while the whole drill is paused. */
export function PausedNote() {
  const t = useTranslations('training.regie')
  const { state } = useRegie()
  if (!state?.paused_at) return null
  return (
    <p className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
      <Timer className="size-4 shrink-0" />
      {t('pausedNote')}
    </p>
  )
}
