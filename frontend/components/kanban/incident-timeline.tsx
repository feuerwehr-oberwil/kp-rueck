"use client"

/**
 * The incident's Verlauf, rendered inline.
 *
 * It used to be an (i) popover in the modal header — a second, floating scroll
 * container stacked on top of a dialog that already had one, opened by a button
 * nobody found. It is now the Verlauf tab's own content: always expanded, no
 * toggle, scrolling with the tab like everything else.
 *
 * One chronology: status changes, resource assignments, the crew's
 * Freitext-Meldungen, the facts a notification announced (vor Ort, Abholung,
 * «fährt selbst», Reko, GPS am Einsatzort …), and every saved change of the Reko report
 * (`reko_change`: who, Feld or KP, which field, old → new – owner pick 23.11.2026, the
 * Reko tab shows none of it). The messages and the facts are the reason this is a list
 * and not a popover — until they were merged in, what came in over the radio lived only
 * in a dismissible notification. A fact is the journal's own row for this card, worded
 * by the drawer's `JournalText`.
 *
 * The events themselves are fetched once per detail view by
 * `useIncidentTimeline` and handed down, because the Rapport tab's message
 * thread reads the same feed.
 */

import { useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, ArrowRight, Binoculars, ClipboardCheck, Combine, MessageSquare, Package, Send, Split, Truck, UserMinus, UserPlus } from "lucide-react"

import type { ApiIncidentTimelineEvent } from "@/lib/api-client"
import type { RekoChangeValue } from "@/lib/api/types"
import { formatAgo, formatDurationHours } from "@/lib/duration"
import { listDiff, textExcerpts } from "@/lib/reko-change"
import { isIncidentStatus } from "@/lib/types/incidents"
import { cn } from "@/lib/utils"
import { LoadingStatus, ShellLoader } from "@/components/ui/shell-loader"
import { Button } from "@/components/ui/button"
import { JournalText } from "@/components/journal/journal-text"

export interface IncidentTimelineProps {
  events: ApiIncidentTimelineEvent[] | null
  isLoading: boolean
  failed: boolean
  onRetry: () => void
  /** «Trennen» on a merge that still stands (R2) — absent for a viewer. */
  onUnmerge?: (mergedIncidentId: string) => Promise<void>
  className?: string
}

export function IncidentTimeline({ events, isLoading, failed, onRetry, onUnmerge, className }: IncidentTimelineProps) {
  const t = useTranslations('kanban')
  const tLoading = useTranslations('common')

  // No card around the list and no hairlines inside it («Nur Abstand»): the
  // heading names the block, whitespace separates the entries. The display
  // modal mounts this inside its own DisclosureSection frame, which used to
  // make it a box in a box.
  return (
    <div className={cn("space-y-1.5", className)} data-testid="incident-timeline">
      <div>
        <h3 className="text-sm font-semibold">{t('timeline.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('timeline.subtitle')}</p>
      </div>

      {isLoading && (
        <LoadingStatus className="py-2 text-xs">{tLoading('loading')}</LoadingStatus>
      )}

      {!isLoading && failed && (
        <div className="py-1 text-xs text-destructive">
          {t('timeline.loadFailed')}{' '}
          <button type="button" onClick={onRetry} className="underline">
            {t('timeline.retry')}
          </button>
        </div>
      )}

      {!isLoading && !failed && events && events.length === 0 && (
        <p className="py-1 text-xs italic text-muted-foreground/60">{t('timeline.empty')}</p>
      )}

      {!isLoading && !failed && events && events.length > 0 && (
        <ol>
          {events.map((event, idx) => (
            <TimelineRow key={idx} event={event} onUnmerge={onUnmerge} />
          ))}
        </ol>
      )}
    </div>
  )
}

function TimelineRow({
  event,
  onUnmerge,
}: {
  event: ApiIncidentTimelineEvent
  onUnmerge?: (mergedIncidentId: string) => Promise<void>
}) {
  const t = useTranslations('duplicates')
  const [splitting, setSplitting] = useState(false)
  const time = formatTime(event.timestamp)
  const isMessage =
    event.event_type === "field_message" ||
    event.event_type === "kp_message" ||
    event.event_type === "merge" ||
    event.event_type === "journal" ||
    event.event_type === "reko_change"
  // A merged report can be split off again for as long as the merge stands.
  const splittable = event.event_type === "merge" && event.merge_active && event.merged_incident_id && onUnmerge
  // A move the operator confirmed after «Gerade geändert» – the board it came from was stale.
  const stale = event.event_type === "status_change" && Boolean(event.seen_status)
  return (
    <li className={cn("flex gap-3 py-1 text-xs", isMessage || stale ? "items-start" : "items-center")}>
      <span className={cn("shrink-0 font-mono tabular-nums text-muted-foreground", (isMessage || stale) && "pt-px")}>{time}</span>
      <div className="min-w-0 flex-1">
        <div className={cn("flex min-w-0 gap-2", isMessage ? "items-start" : "items-center")}>
          <EventIcon event={event} />
          {/* A message is a sentence, not a label: it wraps instead of being cut
              off at the column edge. The other two kinds stay one truncated line. */}
          <span className={cn("min-w-0", isMessage ? "flex-1 break-words" : "truncate")}>
            <EventLabel event={event} />
          </span>
          {splittable && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="shrink-0"
              title={t('timeline.splitHint')}
              disabled={splitting}
              onClick={async () => {
                setSplitting(true)
                try {
                  await onUnmerge(event.merged_incident_id!)
                } finally {
                  setSplitting(false)
                }
              }}
            >
              {splitting ? <ShellLoader className="size-3.5" /> : <Split className="size-3.5" />}
              {t('timeline.split')}
            </Button>
          )}
        </div>
        {stale && <StaleMark event={event} />}
      </div>
    </li>
  )
}

/** «war schon abgeschlossen (vor 3')» under a stale move: where the card really stood, and for how long. */
function StaleMark({ event }: { event: ApiIncidentTimelineEvent }) {
  const t = useTranslations('kanban')
  const tDuration = useTranslations('common.duration')
  const status = event.from_status ?? ''
  const ago = formatAgo((event.stale_seconds ?? 0) * 1000, tDuration)
  return (
    <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-sm border border-warning/45 px-1.5 py-px text-2xs font-semibold text-warning-foreground">
      <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">
        {status === 'complete'
          ? t('timeline.staleComplete', { ago })
          : t('timeline.stale', { statusLabel: isIncidentStatus(status) ? t(`columns.${status}`) : status, ago })}
      </span>
    </span>
  )
}

function EventIcon({ event }: { event: ApiIncidentTimelineEvent }) {
  if (event.event_type === "status_change") {
    return <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
  }
  if (event.event_type === "merge") {
    return <Combine className="mt-px h-3.5 w-3.5 shrink-0 text-warning-foreground" />
  }
  if (event.event_type === "unmerge") {
    return <Split className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  }
  if (event.event_type === "field_message") {
    return <MessageSquare className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  }
  if (event.event_type === "kp_message") {
    // The KP's own «Meldung an den Trupp» (§P3.2) — outbound; both directions
    // are muted, the icon tells them apart.
    return <Send className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  }
  if (event.event_type === "reko_change") {
    return <Binoculars className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  }
  if (event.event_type === "journal") {
    return <ClipboardCheck className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  }
  if (event.event_type === "assignment") {
    if (event.resource_type === "vehicle") {
      return <Truck className={cn("h-3.5 w-3.5 shrink-0", event.assignment_action === "unassigned" ? "text-muted-foreground" : "text-foreground")} />
    }
    if (event.resource_type === "material") {
      return <Package className={cn("h-3.5 w-3.5 shrink-0", event.assignment_action === "unassigned" ? "text-muted-foreground" : "text-foreground")} />
    }
    // personnel
    if (event.assignment_action === "unassigned") {
      return <UserMinus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    }
    return <UserPlus className="h-3.5 w-3.5 text-foreground shrink-0" />
  }
  return null
}

function EventLabel({ event }: { event: ApiIncidentTimelineEvent }) {
  const t = useTranslations('kanban')
  const tDuplicates = useTranslations('duplicates')
  // Translate known statuses; unknown values fall back to the raw status string.
  const statusLabel = (status: string | null | undefined): string => {
    if (!status) return "–"
    return isIncidentStatus(status) ? t(`columns.${status}`) : status
  }
  if (event.event_type === "status_change") {
    // A stale move reads as the operator made it – from what their board showed;
    // the mark under it says where the card really stood.
    const from = statusLabel(event.seen_status ?? event.from_status)
    const to = statusLabel(event.to_status)
    return (
      <>
        <span className="text-muted-foreground">{from}</span>
        <span className="text-muted-foreground mx-1">→</span>
        <span className="text-foreground font-medium">{to}</span>
        {event.actor_name && <span className="text-muted-foreground"> · {event.actor_name}</span>}
      </>
    )
  }

  if (event.event_type === "field_message") {
    // No actor name means the audit entry carried neither a person nor a user —
    // it still has to read as somebody's sentence, not as an orphan string.
    const who = event.actor_name ?? t('timeline.unknown')
    return (
      <>
        <span className="font-medium text-foreground">{who}</span>
        <span className="text-muted-foreground">: </span>
        <span className="text-foreground">{event.message}</span>
      </>
    )
  }

  if (event.event_type === "kp_message") {
    // «B. Eichenberger an Trupp: …» — the outbound direction said in two words.
    const who = event.actor_name ?? t('timeline.unknown')
    return (
      <>
        <span className="font-medium text-foreground">{who}</span>
        <span className="text-muted-foreground"> {t('timeline.kpMessageVerb')}: </span>
        <span className="text-foreground">{event.message}</span>
      </>
    )
  }

  if (event.event_type === "merge" || event.event_type === "unmerge") {
    // «Meldung zusammengeführt · B. Eichenberger: Weitere Meldung 14:32 (Telefon): …»
    return (
      <>
        <span className="font-medium text-foreground">
          {event.event_type === "merge" ? tDuplicates('timeline.merged') : tDuplicates('timeline.unmerged')}
        </span>
        {event.actor_name && <span className="text-muted-foreground"> · {event.actor_name}</span>}
        {event.message && <span className="text-muted-foreground">: </span>}
        {event.message && <span className="text-foreground">{event.message}</span>}
      </>
    )
  }

  if (event.event_type === "reko_change") {
    return <RekoChangeLabel event={event} />
  }

  if (event.event_type === "journal" && event.journal_kind) {
    // «Fährt selbst zurück · Meier Anna», «Fahrzeug am Einsatzort: TLF 1 (GPS)»
    return (
      <>
        <JournalText entry={{ kind: event.journal_kind, data: event.journal_data ?? null }} text={event.message ?? null} />
        {event.actor_name && <span className="text-muted-foreground"> · {event.actor_name}</span>}
      </>
    )
  }

  if (event.event_type === "assignment") {
    const verb = event.assignment_action === "unassigned" ? t('timeline.removed') : t('timeline.assigned')
    const verbClass = event.assignment_action === "unassigned" ? "text-muted-foreground" : "text-foreground"
    const name = event.resource_name ?? t('timeline.unknown')
    return (
      <>
        <span className="text-foreground font-medium">{name}</span>
        <span className={cn("ml-1", verbClass)}>{verb}</span>
      </>
    )
  }

  return null
}

/**
 * «Keller Marco (Feld) · Zusammenfassung: «… steckt fest.» → «… steckt fest, Lenker …»»
 *
 * Lists say what moved (+Einsturz · −Feuer, +2 Fotos), texts show both ends cut to what
 * changed (`textExcerpts`), the rest old → new. An empty end reads «leer».
 */
function RekoChangeLabel({ event }: { event: ApiIncidentTimelineEvent }) {
  const t = useTranslations('kanban')
  const tForm = useTranslations('reko.form')
  const tReport = useTranslations('reko.reportSection')
  const source = event.source === 'kp' ? t('timeline.rekoKp') : t('timeline.rekoFeld')
  const from = event.old_value
  const to = event.new_value

  const fieldLabel = (() => {
    switch (event.reko_field) {
      case 'is_relevant': return tForm('relevantQuestion')
      case 'dangers': return tForm('dangers')
      case 'dangers_other': return tForm('otherDangers')
      case 'personnel_count': return tForm('personnelCount')
      case 'estimated_duration_hours': return tReport('durationLabel')
      case 'vehicles_needed': return tReport('vehiclesLabel')
      case 'equipment_needed': return tReport('equipmentLabel')
      case 'power_supply': return tForm('powerSupply')
      case 'summary_text': return tForm('summary')
      case 'additional_notes': return tReport('notesShort')
      case 'photos': return tForm('photos')
      default: return event.reko_field ?? t('timeline.unknown')
    }
  })()

  const dangerLabel = (key: string): string => {
    switch (key) {
      case 'fire': return tReport('dangerBadges.fire')
      case 'fire_danger': return tReport('dangerBadges.fire_danger')
      case 'explosion': return tReport('dangerBadges.explosion')
      case 'collapse': return tReport('dangerBadges.collapse')
      case 'chemical': return tReport('dangerBadges.chemical')
      case 'electrical': return tReport('dangerBadges.electrical')
      default: return key
    }
  }

  /** One end of an old → new change, or null for an empty field. */
  const plain = (value: RekoChangeValue): string | null => {
    if (value === null || value === undefined || value === '') return null
    switch (event.reko_field) {
      case 'is_relevant': return value ? tForm('yes') : tForm('no')
      case 'estimated_duration_hours': return typeof value === 'number' ? formatDurationHours(value) : String(value)
      case 'power_supply':
        switch (value) {
          case 'available': return tForm('powerLabels.available')
          case 'unavailable': return tForm('powerLabels.unavailable')
          case 'emergency_needed': return tForm('powerLabels.emergency_needed')
          default: return String(value)
        }
      default: return Array.isArray(value) ? (value.length ? value.join(', ') : null) : String(value)
    }
  }

  let change: ReactNode
  if (event.reko_field === 'dangers' || event.reko_field === 'photos') {
    const { added, removed } = listDiff(from, to)
    const parts = event.reko_field === 'photos'
      ? [
          added.length ? t('timeline.rekoPhotosAdded', { count: added.length }) : null,
          removed.length ? t('timeline.rekoPhotosRemoved', { count: removed.length }) : null,
        ]
      : [...added.map(key => `+${dangerLabel(key)}`), ...removed.map(key => `−${dangerLabel(key)}`)]
    change = <span className="text-foreground">{parts.filter(Boolean).join(' · ')}</span>
  } else {
    const isText = event.reko_field === 'summary_text' || event.reko_field === 'additional_notes'
      || event.reko_field === 'dangers_other'
    const ends = isText
      ? textExcerpts(plain(from), plain(to))
      : { from: plain(from), to: plain(to) }
    const quote = (text: string | null) => (text === null ? null : isText ? `«${text}»` : text)
    change = (
      <>
        <span className="text-muted-foreground">{quote(ends.from) ?? t('timeline.rekoEmpty')}</span>
        <span className="text-muted-foreground mx-1">→</span>
        <span className="text-foreground">{quote(ends.to) ?? t('timeline.rekoEmpty')}</span>
      </>
    )
  }

  return (
    <>
      <span className="font-medium text-foreground">{event.actor_name ?? source}</span>
      {event.actor_name && <span className="text-muted-foreground"> ({source})</span>}
      <span className="text-muted-foreground"> · {fieldLabel}: </span>
      {change}
    </>
  )
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const isSameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  const ss = String(date.getSeconds()).padStart(2, "0")
  if (isSameDay) return `${hh}:${mm}:${ss}`
  const dd = String(date.getDate()).padStart(2, "0")
  const mo = String(date.getMonth() + 1).padStart(2, "0")
  return `${dd}.${mo} ${hh}:${mm}`
}
