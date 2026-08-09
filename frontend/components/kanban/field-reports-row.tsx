'use client'

/**
 * "Abholung" — the KP's one settable field report (plan 25, decision 28, §18.19).
 *
 * This was three toggles: Angekommen, Einsatz beendet, Abholung. The first two
 * are gone as *controls*. Status belongs to the columns — `Einsatz` and
 * `Abgeschlossen` — and a second settable control for the same fact is a second
 * truth to keep in step. What matters is that the field can **tell** the KP, so
 * both reports now read as entries in the Meldungen thread below, timestamped
 * and attributed, next to the crew's own sentences. The nudge stays: "Feld
 * meldet beendet — nach Abgeschlossen verschieben?" is exactly the shape this
 * change is after, the field informs and the KP decides.
 *
 * Abholung keeps its control, and deliberately: it has no column to be moved
 * into, and clearing it is a real KP action (the chip does the same job on the
 * card and in the Restliste).
 *
 * **Provenance is never faked**: a KP write leaves the personnel columns NULL
 * and the audit-log entry carries the operator, so "im KP erfasst" is a real
 * state and not a guess dressed up as a crew report.
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CarTaxiFront, Flag, Loader2, MapPin, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { apiClient, type ApiIncidentTimelineEvent } from '@/lib/api-client'
import type { ApiFieldReportUpdate } from '@/lib/api/types'
import { useOperations, type Operation } from '@/lib/contexts/operations-context'
import { usePersonnel } from '@/lib/contexts/personnel-context'
import { getActiveLocale } from '@/lib/i18n-messages'
import { applyTimeEdit, toTimeInput } from '@/lib/field-time'
import { formatPickupWaiting } from '@/lib/pickup'

interface FieldReportsRowProps {
  operation: Operation
  canEdit?: boolean
}

type Row = 'pickup'

export function FieldReportsRow({ operation, canEdit = true }: FieldReportsRowProps) {
  const t = useTranslations('feld.kp')
  const { refreshOperations } = useOperations()
  const { personnel } = usePersonnel()
  const [saving, setSaving] = useState<Row | null>(null)
  const [note, setNote] = useState(operation.pickupNote ?? '')

  const nameById = useMemo(() => new Map(personnel.map(p => [p.id, p.name])), [personnel])

  const save = useCallback(
    async (row: Row, update: ApiFieldReportUpdate) => {
      setSaving(row)
      try {
        await apiClient.setIncidentFieldReport(operation.id, update)
        await refreshOperations()
      } catch (error) {
        console.error('Failed to save field report:', error)
        toast.error(t('saveFailed'))
      } finally {
        setSaving(null)
      }
    },
    [operation.id, refreshOperations, t],
  )

  /**
   * "vom Feld, Muster Hans, 23:14" versus "im KP erfasst, 23:14".
   *
   * `personnelId === null` with a timestamp present IS the KP case — that is
   * the whole provenance rule, read straight off the absence of the FK.
   */
  const provenance = (at: Date | null | undefined, personnelId: string | null | undefined): string | null => {
    if (!at) return null
    const time = at.toLocaleTimeString(getActiveLocale(), { hour: '2-digit', minute: '2-digit' })
    if (!personnelId) return t('fromKp', { time })
    return t('fromField', { name: nameById.get(personnelId) ?? t('unknownPerson'), time })
  }

  const rows: Array<{
    key: Row
    icon: React.ReactNode
    label: string
    at: Date | null | undefined
    on: boolean
    by: string | null | undefined
    onToggle: (checked: boolean) => void
    onTimeChange: (time: string) => void
  }> = [
    {
      key: 'pickup',
      icon: <CarTaxiFront className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
      label: t('pickup'),
      at: operation.pickupRequestedAt,
      on: Boolean(operation.pickupNeeded),
      by: operation.pickupRequestedBy,
      onToggle: checked => save('pickup', { pickup_needed: checked, pickup_note: checked ? note || null : null }),
      onTimeChange: time => {
        const next = applyTimeEdit(operation.pickupRequestedAt, time)
        if (next) save('pickup', { pickup_needed: true, pickup_note: note || null, pickup_requested_at: next.toISOString() })
      },
    },
  ]

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div>
        <Label className="text-sm font-semibold">{t('pickupTitle')}</Label>
        {/* Says out loud that this is the radio-message path, so nobody looks
            for a field device that does not exist. */}
        <p className="text-xs text-muted-foreground">{t('pickupDescription')}</p>
      </div>

      <div className="space-y-2.5">
        {rows.map(row => {
          const line = provenance(row.at, row.by)
          return (
            <div key={row.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {row.icon}
                  <div className="min-w-0">
                    <span className="text-sm">{row.label}</span>
                    {line && <p className="text-xs text-muted-foreground truncate">{line}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {row.on && (
                    <Input
                      type="time"
                      aria-label={t('timeLabel', { what: row.label })}
                      value={toTimeInput(row.at)}
                      disabled={!canEdit || saving === row.key}
                      onChange={e => row.onTimeChange(e.target.value)}
                      className="h-8 w-[7.5rem] text-xs"
                    />
                  )}
                  {saving === row.key ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Switch
                      aria-label={row.label}
                      checked={row.on}
                      disabled={!canEdit}
                      onCheckedChange={row.onToggle}
                    />
                  )}
                </div>
              </div>

              {row.key === 'pickup' && row.on && (
                <div className="space-y-1.5 pl-6">
                  <Input
                    placeholder={t('pickupNotePlaceholder')}
                    value={note}
                    disabled={!canEdit}
                    onChange={e => setNote(e.target.value)}
                    onBlur={() => {
                      if ((note || '') !== (operation.pickupNote ?? '')) {
                        save('pickup', { pickup_needed: true, pickup_note: note || null })
                      }
                    }}
                    className="text-sm"
                  />
                  {operation.pickupRequestedAt && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {t('waiting', { duration: formatPickupWaiting(operation.pickupRequestedAt) })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * "Meldungen vom Feld" — everything the crew told the KP about one
 * Schadenplatz, in one thread.
 *
 * Three kinds of entry, chronological: **Angekommen**, **Einsatz beendet** and
 * the Freitext-Meldungen. The first two used to be toggles above (§18.19) —
 * they are information, not a switch an operator flips, because the status
 * itself lives in the columns. Until this thread existed a `field_message`
 * became a notification and an audit-log entry and appeared on the incident
 * nowhere at all: the bell is dismissible, and once dismissed the sentence was
 * gone from every surface an operator looks at.
 *
 * The two reports are read straight off the incident rather than out of the
 * timeline feed: the board already carries `fieldArrivedAt` / `fieldArrivedBy`
 * and their beendet twins, and they are what the `/feld` action writes. One
 * fewer thing that can be missing because a feed request failed.
 *
 * Newest **last**, like every message thread anybody has ever read — the
 * Verlauf tab is the newest-first surface, and it carries the same entries
 * interleaved with status changes and assignments.
 */
export function FieldMessageThread({
  operation,
  events,
  isLoading,
  failed,
  onRetry,
}: {
  operation: Operation
  events: ApiIncidentTimelineEvent[] | null
  isLoading: boolean
  failed: boolean
  onRetry: () => void
}) {
  const t = useTranslations('feld.kp')
  const { personnel } = usePersonnel()
  const nameById = useMemo(() => new Map(personnel.map(p => [p.id, p.name])), [personnel])

  const entries = useMemo<ThreadEntry[]>(() => {
    const rows: ThreadEntry[] = (events ?? [])
      .filter(event => event.event_type === 'field_message' && event.message)
      .map(event => ({
        at: new Date(event.timestamp),
        // `source === 'kp'` is the dictated one; a message with no actor name
        // cannot be attributed either way and reads as the KP's own note.
        fromField: event.source !== 'kp' && Boolean(event.actor_name),
        who: event.actor_name ?? null,
        message: event.message ?? '',
      }))

    // Provenance rule, unchanged and read the same way everywhere: a personnel
    // FK means the crew tapped it, its absence means the KP wrote it down.
    const report = (at: Date | null | undefined, by: string | null | undefined, label: string) => {
      if (!at) return
      rows.push({
        at,
        fromField: Boolean(by),
        who: by ? (nameById.get(by) ?? t('unknownPerson')) : null,
        label,
      })
    }
    report(operation.fieldArrivedAt, operation.fieldArrivedBy, t('arrived'))
    report(operation.fieldCompleteReportedAt, operation.fieldCompleteReportedBy, t('complete'))

    return rows.sort((a, b) => a.at.getTime() - b.at.getTime())
  }, [
    events,
    nameById,
    operation.fieldArrivedAt,
    operation.fieldArrivedBy,
    operation.fieldCompleteReportedAt,
    operation.fieldCompleteReportedBy,
    t,
  ])

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm font-semibold">{t('messagesTitle')}</Label>
        {entries.length > 0 && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{entries.length}</span>
        )}
      </div>

      {isLoading && entries.length === 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </p>
      )}

      {failed && (
        <p className="text-xs text-destructive">
          {t('messagesLoadFailed')}{' '}
          <button type="button" onClick={onRetry} className="underline">
            {t('messagesRetry')}
          </button>
        </p>
      )}

      {!isLoading && !failed && entries.length === 0 && (
        <p className="text-xs italic text-muted-foreground/60">{t('messagesEmpty')}</p>
      )}

      {entries.length > 0 && (
        <ol className="space-y-2">
          {entries.map((entry, index) => (
            <li key={`${entry.at.toISOString()}:${index}`} className="text-sm">
              <p className="text-xs text-muted-foreground">
                {/* Provenance, the same rule for all three kinds: a name for a
                    crew report, "im KP erfasst" for a dictated one. */}
                {entry.fromField && entry.who
                  ? t('fromField', { name: entry.who, time: formatMessageTime(entry.at) })
                  : t('fromKp', { time: formatMessageTime(entry.at) })}
              </p>
              {entry.label ? (
                <p className="flex items-center gap-1.5 font-medium">
                  {entry.label === t('arrived') ? (
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Flag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {entry.label}
                </p>
              ) : (
                <p className="break-words">{entry.message}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function formatMessageTime(at: Date): string {
  return at.toLocaleTimeString(getActiveLocale(), { hour: '2-digit', minute: '2-digit' })
}

/**
 * One line of the thread. `label` is a report (Angekommen / Einsatz beendet),
 * `message` is what somebody wrote — never both.
 */
interface ThreadEntry {
  at: Date
  fromField: boolean
  who: string | null
  label?: string
  message?: string
}
