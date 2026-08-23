'use client'

/**
 * The KP's settable field reports (plan 25, decision 28, §18.19 — plan 26 §5.2).
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
 * **"Reko vor Ort" joins it here, and ONLY here** (plan 26, decision 15). The
 * Reko block used to render its own "vor Ort seit …" line; that line is gone,
 * not linked, because a fact displayed in two places is a fact that will
 * disagree with itself. Same reason it is a control and not just a reading: over
 * the radio is how "Reko meldet: vor Ort" usually arrives, and until now it had
 * nowhere to land. Accepted price: the Reko block alone no longer says whether
 * Reko is on site.
 *
 * **Provenance is never faked**: a KP write leaves the personnel columns NULL
 * and the audit-log entry carries the operator, so "im KP erfasst" is a real
 * state and not a guess dressed up as a crew report.
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Binoculars, CarTaxiFront, Flag, Loader2, MapPin, MessageSquare, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { DETAIL_CONTROL_INDENT, DetailGroupHeading } from '@/components/kanban/detail-field'
import { apiClient, type ApiIncidentTimelineEvent } from '@/lib/api-client'
import type { ApiFieldReportUpdate } from '@/lib/api/types'
import { useOperations, type Operation } from '@/lib/contexts/operations-context'
import { usePersonnel } from '@/lib/contexts/personnel-context'
import { getActiveLocale } from '@/lib/i18n-messages'
import { applyTimeEdit, toTimeInput } from '@/lib/field-time'

interface FieldReportsRowProps {
  operation: Operation
  canEdit?: boolean
  /**
   * Which of the two settable Funkmeldungen this mount shows.
   *
   * They belong to different questions, and since the detail split Reko off
   * into a tab of its own they belong to different tabs: «Reko vor Ort» is part
   * of the reconnaissance, «Abholung nötig» is what the Schadenplatz still
   * needs. Default is both, for any mount that wants the pair.
   */
  only?: readonly Row[]
}

type Row = 'rekoArrived' | 'pickup'

export function FieldReportsRow({ operation, canEdit = true, only }: FieldReportsRowProps) {
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

  /** "Reko meldet: vor Ort" — a different table, the same gesture. */
  const saveRekoArrived = useCallback(
    async (at: string | null | undefined) => {
      setSaving('rekoArrived')
      try {
        await apiClient.setRekoArrived(operation.id, at)
        await refreshOperations()
      } catch (error) {
        console.error('Failed to save reko arrival:', error)
        toast.error(t('saveFailed'))
      } finally {
        setSaving(null)
      }
    },
    [operation.id, refreshOperations, t],
  )

  /**
   * "vom Feld, Muster Hans" versus "im KP erfasst".
   *
   * `personnelId === null` with a timestamp present IS the KP case — that is
   * the whole provenance rule, read straight off the absence of the FK.
   *
   * Deliberately WITHOUT the clock (image #14): the line only ever renders
   * while the row is on, and an on row carries the time input right next to
   * it — «von der Reko, 17:56 … [17:56]» said one fact twice per row. The
   * Meldungen thread below keeps its timed wording; there is no input there.
   */
  const provenance = (at: Date | null | undefined, personnelId: string | null | undefined): string | null => {
    if (!at) return null
    if (!personnelId) return t('fromKpPlain')
    return t('fromFieldPlain', { name: nameById.get(personnelId) ?? t('unknownPerson') })
  }

  type ReportRow = {
    key: Row
    icon: React.ReactNode
    label: string
    at: Date | null | undefined
    on: boolean
    by: string | null | undefined
    /** Overrides `provenance()` where the channel is not readable off a
     *  personnel FK — the Reko arrival lives on `reko_reports`, and the board
     *  carries the answer as a flag rather than an id it would have to resolve. */
    line?: string | null
    onToggle: (checked: boolean) => void
    onTimeChange: (time: string) => void
  }

  const rows: ReportRow[] = ([
    {
      key: 'rekoArrived',
      icon: <Binoculars className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />,
      label: t('rekoArrived'),
      at: operation.rekoArrivedAt,
      on: Boolean(operation.rekoArrivedAt),
      by: null,
      // Time-less on purpose — the input next to it shows the clock. No name
      // either: the arrival is reported by whoever holds the Reko link, and
      // inventing one would be the guessed attribution the provenance rule
      // exists to prevent.
      line: operation.rekoArrivedAt ? t(operation.rekoArrivedByKp ? 'fromKpPlain' : 'fromRekoPlain') : null,
      onToggle: checked => saveRekoArrived(checked ? undefined : null),
      onTimeChange: time => {
        const next = applyTimeEdit(operation.rekoArrivedAt, time)
        if (next) saveRekoArrived(next.toISOString())
      },
    },
    {
      key: 'pickup',
      icon: <CarTaxiFront className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />,
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
  ] as ReportRow[]).filter(row => !only || only.includes(row.key))

  // Same shape as Nachbarhilfe and «Am Warten» on the Übersicht: a label, a
  // switch, and the field that qualifies it underneath while it is on. The
  // bordered card with its own explanatory sentence made two settable rows look
  // like a form of their own — the sentence lives on as the heading's `title`.
  return (
    <div className="space-y-1">
      {/* The heading earns its place only over a GROUP. Above a single row it
          repeats what the row's own label says — «Funkmeldungen / Reko vor Ort»
          is one line of chrome for one line of content. */}
      {rows.length > 1 && (
        <p
          title={t('reportsDescription')}
          className="text-xs font-semibold text-muted-foreground"
        >
          {t('reportsTitle')}
        </p>
      )}

      {/* Space separates the rows, not rules. Under a single row — which is what
          both real mounts render — a rule is a line with nothing on the far side
          of it, and it read as a divider belonging to whatever came next. */}
      <div className="space-y-2">
        {rows.map(row => {
          const line = row.line !== undefined ? row.line : provenance(row.at, row.by)
          return (
            <div key={row.key}>
              {/* One row unit — `min-h-8`, the height of the time input — in
                  every state. The `h-8` input exists only while the row is on,
                  so without a floor the line was 20px off and 32px on, and
                  everything below it jumped by 12px the moment somebody flipped
                  the switch. The floor is also what makes the two rows the same
                  height as each other: they are meant to be interchangeable
                  blocks, and «Reko vor Ort» and «Abholung nötig» sit in
                  different tabs of the same panel. */}
              <div className="flex min-h-8 items-center justify-between gap-3">
                {/* The whole line up to the controls toggles, not just the words
                    (§P2.9) — a real <button>, so it is one more tab stop but a
                    reachable one. tabIndex -1 keeps the Switch the keyboard's
                    single control; the button is the mouse's bigger target.
                    `flex-1` is what makes it the WHOLE line: the button used to
                    shrink to its text, which left the gap between the label and
                    the switch — the widest part of a `justify-between` row —
                    inert. The pointer was over the row, the row looked like one
                    target, and nothing happened. */}
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={!canEdit || saving === row.key}
                  onClick={() => row.onToggle(!row.on)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left disabled:cursor-default"
                >
                  {/* The 120px grey gutter every other row of the detail uses,
                      so «Reko vor Ort» and «Abholung nötig» line their switches
                      up with the toggles on Übersicht instead of pinning them to
                      the far edge of whatever column they land in. Two controls
                      of the same kind, one column. */}
                  <span className="flex w-[120px] shrink-0 items-center gap-1.5 text-xs leading-tight text-muted-foreground">
                    {row.icon}
                    {row.label}
                  </span>
                  {/* `text-sm` on the box, not just the label: the icon is
                      centred against this box, and a larger inherited font would
                      stretch it and leave the glyph sitting high.
                      `truncate` is what keeps the floor a fixed height at 420px:
                      the provenance appears with the toggle, and a long one
                      («vom Feld, …») would otherwise wrap onto a second line and
                      move the content below all over again. The full sentence
                      stays reachable on hover. */}
                  {/* Only the provenance left here — the label moved into the
                      gutter above. Still truncating: a long «vom Feld, …» would
                      otherwise wrap and move everything below it. */}
                  <div
                    className="min-w-0 truncate text-xs text-muted-foreground"
                    title={line ? `${row.label} – ${line}` : row.label}
                  >
                    {line}
                  </div>
                </button>
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

              {/* The one thing that may still grow the row, and it is a control
                  the operator asked for by flipping the switch — exactly one
                  more row unit (4px + `h-7`), never a ragged amount.
                  The «Wartet seit …» line that used to sit under it is gone: a
                  pickup that is on always renders `PickupBadge` as a banner at
                  the top of the same detail, which says the same duration, so
                  this was the third copy of one timestamp (banner, provenance,
                  line) and 20px of the jump. */}
              {row.key === 'pickup' && row.on && (
                // Lined up with the switch above it, not with the icon: the
                // label gutter is 120px + the row's 8px gap. `pl-6` dated from
                // when the label sat right after a 16px glyph.
                <div className={cn("mt-1", DETAIL_CONTROL_INDENT)}>
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
                    className="h-7 text-sm"
                  />
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
 * Schadenplatz, in one thread — and, since sweep 27 §P3.2, the KP's own
 * «Meldung an den Trupp» going the other way, sent from the box at the bottom.
 *
 * Four kinds of entry, chronological: **Angekommen**, **Einsatz beendet**, the
 * crew's Freitext-Meldungen, and the KP's messages to the squad. The first two
 * used to be toggles above (§18.19) — they are information, not a switch an
 * operator flips, because the status itself lives in the columns. Until this
 * thread existed a `field_message` became a notification and an audit-log entry
 * and appeared on the incident nowhere at all: the bell is dismissible, and
 * once dismissed the sentence was gone from every surface an operator looks at.
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
  canEdit = true,
}: {
  operation: Operation
  events: ApiIncidentTimelineEvent[] | null
  isLoading: boolean
  failed: boolean
  onRetry: () => void
  /** False for viewers — the send box's POST would 403, so it is not offered. */
  canEdit?: boolean
}) {
  const t = useTranslations('feld.kp')
  const { personnel } = usePersonnel()
  const nameById = useMemo(() => new Map(personnel.map(p => [p.id, p.name])), [personnel])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  /** Send one sentence to the squad — then reload the thread it lands in. */
  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await apiClient.sendKpFieldMessage(operation.id, text)
      // The typed text survives a failure — only a delivered message clears it.
      setDraft('')
      onRetry()
    } catch (error) {
      console.error('Failed to send KP message:', error)
      toast.error(t('sendFailed'))
    } finally {
      setSending(false)
    }
  }, [draft, sending, operation.id, onRetry, t])

  const entries = useMemo<ThreadEntry[]>(() => {
    const rows: ThreadEntry[] = (events ?? [])
      .filter(
        event =>
          (event.event_type === 'field_message' || event.event_type === 'kp_message') && event.message,
      )
      .map(event => ({
        at: new Date(event.timestamp),
        // `source === 'kp'` is the dictated one; a message with no actor name
        // cannot be attributed either way and reads as the KP's own note.
        fromField: event.event_type === 'field_message' && event.source !== 'kp' && Boolean(event.actor_name),
        // The KP's own message TO the squad — the other direction (§P3.2).
        toField: event.event_type === 'kp_message',
        who: event.actor_name ?? null,
        message: event.message ?? '',
      }))

    // Provenance rule, unchanged and read the same way everywhere: a personnel
    // FK means the crew tapped it, its absence means the KP wrote it down —
    // unless the GPS automation stamped it (§18.24), which is a third thing and
    // must be worded as one. "im KP erfasst" about a machine's inference names
    // an operator who did nothing.
    const report = (
      at: Date | null | undefined,
      by: string | null | undefined,
      label: string,
      byAutomation = false,
    ) => {
      if (!at) return
      rows.push({
        at,
        fromField: Boolean(by),
        byAutomation: byAutomation && !by,
        who: by ? (nameById.get(by) ?? t('unknownPerson')) : null,
        label,
      })
    }
    report(
      operation.fieldArrivedAt,
      operation.fieldArrivedBy,
      t('arrived'),
      operation.fieldArrivedByAutomation,
    )
    report(operation.fieldCompleteReportedAt, operation.fieldCompleteReportedBy, t('complete'))

    return rows.sort((a, b) => a.at.getTime() - b.at.getTime())
  }, [
    events,
    nameById,
    operation.fieldArrivedAt,
    operation.fieldArrivedBy,
    operation.fieldArrivedByAutomation,
    operation.fieldCompleteReportedAt,
    operation.fieldCompleteReportedBy,
    t,
  ])

  // No card around the thread («Nur Abstand»): the heading names it and
  // whitespace separates it from the Funkmeldung row above and the release
  // list below. The display modal already frames it in a DisclosureSection,
  // where the border made it a box in a box.
  return (
    <div className="space-y-3">
      <DetailGroupHeading
        icon={<MessageSquare className="h-3.5 w-3.5 shrink-0" />}
        action={
          entries.length > 0 ? (
            <span className="text-xs tabular-nums text-muted-foreground">{entries.length}</span>
          ) : null
        }
      >
        {t('messagesTitle')}
      </DetailGroupHeading>

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
                {/* Provenance, the same rule for all kinds: a name for a crew
                    report, "im KP erfasst" for a dictated one, "automatisch
                    (GPS)" for one the automation inferred — and "an den Trupp"
                    for the KP's own message going the other way (§P3.2). */}
                {entry.toField
                  ? t('toField', {
                      name: entry.who ?? t('unknownPerson'),
                      time: formatMessageTime(entry.at),
                    })
                  : entry.fromField && entry.who
                    ? t('fromField', { name: entry.who, time: formatMessageTime(entry.at) })
                    : entry.byAutomation
                      ? t('fromAutomation', { time: formatMessageTime(entry.at) })
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
              ) : entry.toField ? (
                <p className="flex items-start gap-1.5 break-words">
                  <Send className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">{entry.message}</span>
                </p>
              ) : (
                <p className="break-words">{entry.message}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      {/* «Meldung an Trupp» (§P3.2) — one line, one send. The squad reads it on
          /feld within one poll; there is deliberately no delivery receipt,
          because the radio never had one either. */}
      {canEdit && (
        <div className="flex items-stretch gap-2 pt-1">
          <Input
            placeholder={t('sendPlaceholder')}
            value={draft}
            maxLength={500}
            disabled={sending}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void send()
            }}
            className="h-8 text-sm"
          />
          <Button
            size="icon-xs"
            variant="outline"
            className="h-8 w-8 shrink-0"
            aria-label={t('send')}
            title={t('send')}
            disabled={sending || !draft.trim()}
            onClick={() => void send()}
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
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
  /** The KP's own message TO the squad (§P3.2) — the other direction. */
  toField?: boolean
  /** Neither the crew nor the KP: the GPS automation stamped it (§18.24). */
  byAutomation?: boolean
  who: string | null
  label?: string
  message?: string
}
