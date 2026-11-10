'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { LoadingStatus, ShellLoader } from '@/components/ui/shell-loader'
import { Textarea } from '@/components/ui/textarea'
import { apiClient } from '@/lib/api-client'
import type { ApiStandbyConflict, ApiStandbyConflicts } from '@/lib/api/types'
import { useAuth } from '@/lib/contexts/auth-context'
import { useStandby } from '@/lib/contexts/standby-context'
import { getIntlLocale } from '@/lib/date-locale'
import { getOperationStatusLabel } from '@/lib/status-labels'
import { cn } from '@/lib/utils'

type Choice = 'kept' | 'other' | 'both'
type Side = ApiStandbyConflict['kept_on']

// Columns the sync stamps on every write; they follow whatever is chosen and are never shown.
const BOOKKEEPING = new Set(['updated_at', 'last_activity_at'])

function time(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString(getIntlLocale(), { hour: '2-digit', minute: '2-digit' }) : ''
}

/**
 * The conflicts of one Ereignis (variant «Seitenleiste» of the 2026-11-09 mocks): what both
 * systems changed while they could not talk, the version that stands, and the one that lost.
 *
 * On the system that leads, each conflict is decided with one choice – this version, the
 * other one, or for text «Beide zusammen», both one below the other in a field that can be
 * rewritten – and «Übernehmen». The other system, and a viewer, see the same list to read.
 * Decided ones fold away under «n erledigt». Mount it per Ereignis (`key`).
 */
export function StandbyConflictsSheet({
  open,
  onOpenChange,
  eventId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string
}) {
  const t = useTranslations('standby.conflicts')
  const standby = useStandby()
  const { isEditor } = useAuth()
  const [data, setData] = useState<ApiStandbyConflicts | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await apiClient.getStandbyConflicts(eventId)
      if (!result) throw new Error('no answer') // the GET gave up after its retries
      setData(result)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [eventId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const here: Side = standby.mirror ? 'standby' : 'hosted'
  const openOnes = data?.conflicts.filter((c) => !c.resolved_at) ?? []
  const done = data?.conflicts.filter((c) => c.resolved_at) ?? []
  const leader: Side = data?.decidable ? here : here === 'standby' ? 'hosted' : 'standby'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>
            {t(data?.decidable === false ? 'introReadOnly' : 'intro', { leader: t(`side.${leader}`) })}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-3 px-4 pb-4">
          {!data && !failed && <LoadingStatus size="surface">{t('loading')}</LoadingStatus>}
          {failed && <EmptyState compact title={t('loadFailed')} description={t('loadFailedHint')} />}
          {data && openOnes.length === 0 && <EmptyState compact title={t('noneOpen')} description={t('noneOpenHint')} />}
          {openOnes.map((conflict) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              here={here}
              leader={leader}
              decidable={(data?.decidable ?? false) && isEditor}
              onDone={async () => {
                await load()
                await standby.refresh()
              }}
            />
          ))}
          {done.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">{t('done', { count: done.length })}</summary>
              <ul className="mt-2 space-y-1">
                {done.map((c) => (
                  <li key={c.id} className="text-muted-foreground">
                    {heading(c, t)} · {t(`resolution.${c.resolution ?? 'kept'}`)} · {c.resolved_by} {time(c.resolved_at)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

type T = ReturnType<typeof useTranslations<'standby.conflicts'>>

function columnLabel(column: string, t: T): string {
  return t.has(`columns.${column}`) ? t(`columns.${column}`) : column
}

function heading(conflict: ApiStandbyConflict, t: T): string {
  const parts: string[] = []
  if (conflict.subject?.number != null) parts.push(t('einsatz', { number: conflict.subject.number }))
  if (conflict.subject?.address) parts.push(conflict.subject.address)
  if (conflict.table_name !== 'incidents') {
    parts.push(t.has(`tables.${conflict.table_name}`) ? t(`tables.${conflict.table_name}`) : conflict.table_name)
  }
  return parts.join(' · ') || t('unknownSubject')
}

function shown(conflict: ApiStandbyConflict): string[] {
  const columns = Object.keys(conflict.columns ?? {}).filter((c) => !BOOKKEEPING.has(c))
  return columns.length > 0 ? columns : Object.keys(conflict.columns ?? {})
}

function display(column: string, value: unknown, t: T): string {
  if (value === null || value === undefined || value === '') return t('empty')
  if (column === 'status' && typeof value === 'string') return getOperationStatusLabel(value)
  if (typeof value === 'boolean') return t(value ? 'yes' : 'no')
  return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)
}

function ConflictCard({
  conflict,
  here,
  leader,
  decidable,
  onDone,
}: {
  conflict: ApiStandbyConflict
  here: Side
  leader: Side
  decidable: boolean
  onDone: () => Promise<void>
}) {
  const t = useTranslations('standby.conflicts')
  const columns = shown(conflict)
  const lostOn: Side = conflict.kept_on === 'standby' ? 'hosted' : 'standby'
  const sideName = (side: Side) => (side === here ? t('here') : t(`side.${side}`))
  const joinable = conflict.kind === 'field' && columns.every((c) => conflict.columns?.[c]?.text)
  const [choice, setChoice] = useState<Choice>('kept')
  const [joined, setJoined] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      columns.map((c) => [c, [conflict.columns?.[c]?.kept, conflict.columns?.[c]?.lost].filter(Boolean).join('\n')]),
    ),
  )
  const [saving, setSaving] = useState(false)

  const options: { value: Choice; side?: Side; label: string; body?: string }[] =
    conflict.kind === 'field'
      ? [
          { value: 'kept', side: conflict.kept_on, label: sideName(conflict.kept_on), body: values(conflict, columns, 'kept', t) },
          { value: 'other', side: lostOn, label: sideName(lostOn), body: values(conflict, columns, 'lost', t) },
          ...(joinable ? [{ value: 'both' as const, label: t('both') }] : []),
        ]
      : conflict.kind === 'deleted'
        ? conflict.deleted_on === conflict.kept_on
          ? [
              { value: 'kept', side: conflict.kept_on, label: sideName(conflict.kept_on), body: t('stayDeleted') },
              { value: 'other', side: lostOn, label: sideName(lostOn), body: t('restore') },
            ]
          : [
              { value: 'kept', side: conflict.kept_on, label: sideName(conflict.kept_on), body: t('keep') },
              { value: 'other', side: lostOn, label: sideName(lostOn), body: t('delete') },
            ]
        : [{ value: 'kept', side: conflict.kept_on, label: sideName(conflict.kept_on), body: t('duplicate') }]

  async function decide() {
    setSaving(true)
    try {
      await apiClient.resolveStandbyConflict(conflict.id, choice, choice === 'both' ? joined : undefined)
      await onDone()
    } catch {
      toast.error(t('resolveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const title = [heading(conflict, t), conflict.kind === 'field' ? columns.map((c) => columnLabel(c, t)).join(', ') : t(`kind.${conflict.kind}`)]
    .filter(Boolean)
    .join(' · ')

  return (
    <section
      aria-label={title}
      className="rounded-lg border border-amber-500/40 bg-amber-50/60 p-3 dark:border-amber-400/30 dark:bg-amber-950/20"
    >
      <h3 className="mb-2 break-words text-sm font-semibold">{title}</h3>
      {conflict.kind !== 'field' && conflict.row && <SavedRow row={conflict.row} />}
      <div role={decidable ? 'radiogroup' : undefined} aria-label={title} className="space-y-1.5">
        {options.map((option) => {
          const selected = choice === option.value
          const content = (
            <>
              {option.body ? (
                <>
                  <span className="block text-xs text-muted-foreground">
                    {option.label}
                    {option.side === lostOn && conflict.lost_at ? ` · ${time(conflict.lost_at)}` : ''}
                  </span>
                  <span className="block whitespace-pre-wrap break-words">{option.body}</span>
                </>
              ) : (
                <span className="block font-medium">{option.label}</span>
              )}
            </>
          )
          return decidable ? (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setChoice(option.value)}
              className={cn(
                'block w-full rounded-md border bg-background px-3 py-2 text-left text-sm',
                selected ? 'sel-choice' : 'hover:bg-muted',
              )}
            >
              {content}
            </button>
          ) : (
            <div key={option.value} className="rounded-md border bg-background px-3 py-2 text-sm">
              {content}
            </div>
          )
        })}
      </div>
      {decidable && choice === 'both' && (
        <div className="mt-2 space-y-2">
          {columns.map((c) => (
            <label key={c} className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">{columnLabel(c, t)}</span>
              <Textarea
                value={joined[c] ?? ''}
                onChange={(event) => setJoined((prev) => ({ ...prev, [c]: event.target.value }))}
                rows={4}
              />
            </label>
          ))}
        </div>
      )}
      {decidable ? (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="outline" onClick={() => void decide()} disabled={saving}>
            {saving && <ShellLoader />}
            {t('apply')}
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{t('decidedThere', { leader: t(`side.${leader}`) })}</p>
      )}
    </section>
  )
}

function values(conflict: ApiStandbyConflict, columns: string[], which: 'kept' | 'lost', t: T): string {
  return columns
    .map((c) => {
      const value = display(c, conflict.columns?.[c]?.[which], t)
      return columns.length > 1 ? `${columnLabel(c, t)}: ${value}` : value
    })
    .join('\n')
}

/** The row a deletion or a duplicate is about, by its named fields – so the choice is not blind. */
function SavedRow({ row }: { row: Record<string, unknown> }) {
  const t = useTranslations('standby.conflicts')
  const fields = Object.entries(row).filter(
    ([column, value]) => !BOOKKEEPING.has(column) && t.has(`columns.${column}`) && value != null && value !== '',
  )
  if (fields.length === 0) return null
  return (
    <dl className="mb-2 space-y-0.5 rounded-md bg-background/70 px-3 py-2 text-sm">
      <dt className="sr-only">{t('savedRow')}</dt>
      {fields.map(([column, value]) => (
        <dd key={column} className="whitespace-pre-wrap break-words">
          <span className="text-muted-foreground">{columnLabel(column, t)}: </span>
          {display(column, value, t)}
        </dd>
      ))}
    </dl>
  )
}
