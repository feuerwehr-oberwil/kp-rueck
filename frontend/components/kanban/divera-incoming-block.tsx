'use client'

/**
 * «Anrückend» — who answered the Divera alarm and has not arrived yet.
 *
 * Shown in the Appell and at the top of the Personen-Leiste. Self-contained: it reads
 * `GET /api/divera/events/{id}/responses` while it is on screen and renders NOTHING when
 * Divera is not configured or nothing on this Ereignis came from Divera.
 *
 * The rules (shared with KP Front):
 * - A Divera answer never checks anybody in. Every row offers the ordinary check-in —
 *   one click, the same write the roll-call does — and the person then drops out of here.
 * - «kommt nicht» is its own group, muted but identifiable: ✕ and the words, never colour
 *   only, and not red (red is priority/danger on this board). Check-in is still offered —
 *   most likely they are not there, unless they misclicked.
 * - The arrival time is an ESTIMATE (answer time + the status's minutes): «ca. 21:52».
 */

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShellLoader } from '@/components/ui/shell-loader'
import { formatClock, groupIncoming, showsIncoming, type IncomingPerson } from '@/lib/divera-responses'
import { useDiveraResponses } from '@/lib/hooks/use-divera-responses'
import { getActiveLocale } from '@/lib/i18n-messages'
import { abbreviateRank } from '@/lib/roster-order'
import { cn } from '@/lib/utils'

interface DiveraIncomingBlockProps {
  eventId: string | null
  /** False while the surface is hidden — no reads then. */
  enabled?: boolean
  /** Personnel ids present right now; they are not «anrückend» any more. */
  checkedInIds: ReadonlySet<string>
  /** Editors only; a viewer sees the list without the button. */
  canCheckIn: boolean
  /** The surface's own check-in (it keeps its optimistic state and refreshes the roster). */
  onCheckIn: (personnelId: string) => Promise<void>
  className?: string
}

export function DiveraIncomingBlock({
  eventId,
  enabled = true,
  checkedInIds,
  canCheckIn,
  onCheckIn,
  className,
}: DiveraIncomingBlockProps) {
  const t = useTranslations('kanban.diveraIncoming')
  const summary = useDiveraResponses(eventId, enabled)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  if (!showsIncoming(summary)) return null

  const groups = groupIncoming(summary, checkedInIds)
  const locale = getActiveLocale()

  const checkIn = async (personnelId: string) => {
    if (busy.has(personnelId)) return
    setBusy((previous) => new Set(previous).add(personnelId))
    try {
      await onCheckIn(personnelId)
    } catch {
      toast.error(t('checkInFailed'))
    } finally {
      setBusy((previous) => {
        const next = new Set(previous)
        next.delete(personnelId)
        return next
      })
    }
  }

  const countParts = [
    t('countComing', { count: summary.counts.coming }),
    t('countNotComing', { count: summary.counts.not_coming }),
    ...(summary.counts.other > 0 ? [t('countOther', { count: summary.counts.other })] : []),
    ...(summary.unanswered > 0 ? [t('countUnanswered', { count: summary.unanswered })] : []),
  ]

  const row = (person: IncomingPerson, tone: 'coming' | 'other' | 'notComing') => (
    <DiveraIncomingRow
      key={person.ucr_id}
      person={person}
      tone={tone}
      locale={locale}
      canCheckIn={canCheckIn}
      busy={busy.has(person.personnel_id)}
      onCheckIn={() => checkIn(person.personnel_id)}
    />
  )

  return (
    <section
      aria-label={t('title', { count: groups.coming.length })}
      className={cn('rounded-md border border-border bg-muted/30 px-2 py-2', className)}
      data-testid="divera-incoming"
    >
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('title', { count: groups.coming.length })}
        </h3>
        <span className="shrink-0 text-[10px] text-muted-foreground">{t('source')}</span>
      </div>
      <p className="px-1 text-xs text-muted-foreground break-words">
        {summary.answered === 0 ? t('noAnswersYet', { addressed: summary.addressed }) : countParts.join(' · ')}
      </p>

      {groups.coming.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">{groups.coming.map((person) => row(person, 'coming'))}</ul>
      ) : summary.counts.coming > 0 ? (
        <p className="mt-1 px-1 text-xs text-muted-foreground">{t('allHere')}</p>
      ) : null}

      {groups.other.length > 0 && (
        <div className="mt-2">
          <h4 className="px-1 text-xs font-medium text-muted-foreground">
            {t('otherGroup', { count: groups.other.length })}
          </h4>
          <ul className="mt-0.5 space-y-0.5">{groups.other.map((person) => row(person, 'other'))}</ul>
        </div>
      )}

      {groups.notComing.length > 0 && (
        <div className="mt-2">
          <h4 className="flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
            <X className="size-3.5 shrink-0" aria-hidden="true" />
            {t('notComingGroup', { count: groups.notComing.length })}
          </h4>
          <ul className="mt-0.5 space-y-0.5">{groups.notComing.map((person) => row(person, 'notComing'))}</ul>
        </div>
      )}

      {groups.unmapped > 0 && (
        <p className="mt-2 px-1 text-xs text-muted-foreground break-words">
          {t('unmapped', { count: groups.unmapped })}
        </p>
      )}
    </section>
  )
}

function DiveraIncomingRow({
  person,
  tone,
  locale,
  canCheckIn,
  busy,
  onCheckIn,
}: {
  person: IncomingPerson
  tone: 'coming' | 'other' | 'notComing'
  locale: string
  canCheckIn: boolean
  busy: boolean
  onCheckIn: () => void
}) {
  const t = useTranslations('kanban.diveraIncoming')
  const answered = formatClock(person.answered_at, locale)
  const eta = formatClock(person.eta, locale)
  const name = person.name?.trim() || `#${person.ucr_id}`
  const notComing = tone === 'notComing'

  const facts: ReactNode[] = []
  if (notComing) facts.push(<span key="nc">{t('notComing')}</span>)
  else if (tone === 'other') facts.push(<span key="st">{person.status_name}</span>)
  if (eta) {
    facts.push(
      <span key="eta" className="font-medium text-foreground" title={t('etaTitle', { status: person.status_name })}>
        {t('eta', { time: eta })}
      </span>
    )
  }
  if (answered) facts.push(<span key="at">{t('answeredAt', { time: answered })}</span>)
  if (person.note) facts.push(<span key="note">«{person.note}»</span>)

  return (
    <li
      className={cn('flex items-center gap-2 rounded-md px-1 py-1', notComing && 'text-muted-foreground')}
      data-kind={person.kind}
    >
      {notComing && <X className="size-3.5 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={cn('min-w-0 truncate text-sm', notComing ? 'font-normal' : 'font-medium text-foreground')}
            title={name}
          >
            {name}
          </span>
          {person.role && (
            <span className="shrink-0 text-xs text-muted-foreground" title={person.role}>
              {abbreviateRank(person.role)}
            </span>
          )}
          {person.tags.length > 0 && (
            <span className="min-w-0 truncate text-[10px] text-muted-foreground" title={person.tags.join(', ')}>
              {person.tags.join(' · ')}
            </span>
          )}
        </div>
        {facts.length > 0 && (
          <div className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground break-words">
            {facts.flatMap((fact, i) => (i === 0 ? [fact] : [<span key={`s${i}`} aria-hidden="true">·</span>, fact]))}
          </div>
        )}
      </div>
      {canCheckIn && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="shrink-0"
          disabled={busy}
          onClick={onCheckIn}
          aria-label={t('checkInLabel', { name })}
          title={t('checkInLabel', { name })}
        >
          {busy ? <ShellLoader /> : <Check className="size-3.5" />}
          {t('checkIn')}
        </Button>
      )}
    </li>
  )
}
