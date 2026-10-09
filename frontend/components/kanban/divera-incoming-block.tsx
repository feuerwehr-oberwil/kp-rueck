'use client'

/**
 * «Anrückend» — who answered «kommt» / «kommt nicht» on the Divera alarm and has not arrived.
 *
 * Shown in the Appell and at the top of the Personen-Leiste, to editors and admins only (the
 * endpoint answers a viewer 403; the block does not even ask). Self-contained: it reads
 * `GET /api/divera/events/{id}/responses` while it is on screen and renders NOTHING when
 * Divera is not configured or nothing recent on this Ereignis came from Divera.
 *
 * Yes/no only (owner decision): names grouped by «kommt» / «kommt nicht» and the two counts —
 * no answer time, estimate, status name or note. The rules (shared with KP Front):
 * - A Divera answer never checks anybody in. Every row offers the ordinary check-in —
 *   one click, the same write the roll-call does — and the person then drops out of here.
 * - «kommt nicht» is its own group, muted but identifiable: ✕ and the words, never colour
 *   only, and not red (red is priority/danger on this board). Check-in is still offered —
 *   most likely they are not there, unless they misclicked.
 */

import { Fragment, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShellLoader } from '@/components/ui/shell-loader'
import { groupIncoming, showsIncoming, type IncomingPerson } from '@/lib/divera-responses'
import { useDiveraResponses } from '@/lib/hooks/use-divera-responses'
import { abbreviateRank } from '@/lib/roster-order'
import { cn } from '@/lib/utils'

interface DiveraIncomingBlockProps {
  eventId: string | null
  /** False while the surface is hidden — no reads then. */
  enabled?: boolean
  /** Personnel with an attendance record (in, or in and out again) as this surface knows it
   *  right now; they are not «anrückend» any more. The backend's `attended` covers the rest. */
  attendedIds: ReadonlySet<string>
  /** Editors and admins. The endpoint is editor-only (as in KP Front), so without this the
   *  block is neither fetched nor rendered — a viewer never sees who is coming. */
  canCheckIn: boolean
  /** The surface's own check-in (it keeps its optimistic state and refreshes the roster). */
  onCheckIn: (personnelId: string) => Promise<void>
  className?: string
}

export function DiveraIncomingBlock({
  eventId,
  enabled = true,
  attendedIds,
  canCheckIn,
  onCheckIn,
  className,
}: DiveraIncomingBlockProps) {
  const t = useTranslations('kanban.diveraIncoming')
  const summary = useDiveraResponses(eventId, enabled && canCheckIn)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  if (!canCheckIn || !showsIncoming(summary)) return null

  const groups = groupIncoming(summary, attendedIds)

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

  const answered = summary.counts.coming + summary.counts.not_coming
  const countParts = [
    t('countComing', { count: summary.counts.coming }),
    t('countNotComing', { count: summary.counts.not_coming }),
  ]

  const row = (person: IncomingPerson) => (
    <DiveraIncomingRow
      key={person.personnel_id}
      person={person}
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
        {answered === 0
          ? t('noAnswersYet')
          : // One part never breaks inside itself in the narrow sidebar.
            countParts.map((part, i) => (
              <Fragment key={part}>
                {i > 0 && ' · '}
                <span className="whitespace-nowrap">{part}</span>
              </Fragment>
            ))}
      </p>

      {groups.coming.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">{groups.coming.map(row)}</ul>
      ) : summary.counts.coming > 0 ? (
        <p className="mt-1 px-1 text-xs text-muted-foreground">{t('allHere')}</p>
      ) : null}

      {groups.notComing.length > 0 && (
        <div className="mt-2">
          <h4 className="flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
            <X className="size-3.5 shrink-0" aria-hidden="true" />
            {t('notComingGroup', { count: groups.notComing.length })}
          </h4>
          <ul className="mt-0.5 space-y-0.5">{groups.notComing.map(row)}</ul>
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
  canCheckIn,
  busy,
  onCheckIn,
}: {
  person: IncomingPerson
  canCheckIn: boolean
  busy: boolean
  onCheckIn: () => void
}) {
  const t = useTranslations('kanban.diveraIncoming')
  const name = person.name.trim() || '–'
  const notComing = person.kind === 'not_coming'

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
        {/* The word, not only the ✕ and the muted tone: never colour (or a glyph) alone. */}
        {notComing && <div className="text-xs">{t('notComing')}</div>}
      </div>
      {canCheckIn && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          // Full strength on a muted «kommt nicht» row too: offered, not disabled.
          className="shrink-0 text-foreground"
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
