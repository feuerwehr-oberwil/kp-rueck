"use client"

/**
 * The incident's Verlauf, rendered inline.
 *
 * It used to be an (i) popover in the modal header — a second, floating scroll
 * container stacked on top of a dialog that already had one, opened by a button
 * nobody found. It is now the Verlauf tab's own content: always expanded, no
 * toggle, scrolling with the tab like everything else.
 *
 * Three kinds of entry, one chronology: status changes, resource assignments,
 * and the crew's Freitext-Meldungen. The messages are the reason this is a list
 * and not a popover — until they were merged in, what came in over the radio
 * lived only in a dismissible notification.
 *
 * The events themselves are fetched once per detail view by
 * `useIncidentTimeline` and handed down, because the Rapport tab's message
 * thread reads the same feed.
 */

import { useTranslations } from "next-intl"
import { ArrowRight, Loader2, MessageSquare, Package, Send, Truck, UserMinus, UserPlus } from "lucide-react"

import type { ApiIncidentTimelineEvent } from "@/lib/api-client"
import { STATUS_LABELS } from "@/lib/types/incidents"
import { cn } from "@/lib/utils"

export interface IncidentTimelineProps {
  events: ApiIncidentTimelineEvent[] | null
  isLoading: boolean
  failed: boolean
  onRetry: () => void
  className?: string
}

export function IncidentTimeline({ events, isLoading, failed, onRetry, className }: IncidentTimelineProps) {
  const t = useTranslations('kanban')

  return (
    <div className={cn("rounded-lg border border-border", className)} data-testid="incident-timeline">
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold">{t('timeline.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('timeline.subtitle')}</p>
      </div>

      {isLoading && (
        <p className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </p>
      )}

      {!isLoading && failed && (
        <div className="px-3 py-3 text-xs text-destructive">
          {t('timeline.loadFailed')}{' '}
          <button type="button" onClick={onRetry} className="underline">
            {t('timeline.retry')}
          </button>
        </div>
      )}

      {!isLoading && !failed && events && events.length === 0 && (
        <p className="px-3 py-3 text-xs italic text-muted-foreground/60">{t('timeline.empty')}</p>
      )}

      {!isLoading && !failed && events && events.length > 0 && (
        <ol className="divide-y divide-border">
          {events.map((event, idx) => (
            <TimelineRow key={idx} event={event} />
          ))}
        </ol>
      )}
    </div>
  )
}

function TimelineRow({ event }: { event: ApiIncidentTimelineEvent }) {
  const time = formatTime(event.timestamp)
  const isMessage = event.event_type === "field_message" || event.event_type === "kp_message"
  return (
    <li className={cn("flex gap-3 px-3 py-2 text-xs", isMessage ? "items-start" : "items-center")}>
      <span className={cn("shrink-0 font-mono tabular-nums text-muted-foreground", isMessage && "pt-px")}>{time}</span>
      <div className={cn("flex min-w-0 flex-1 gap-2", isMessage ? "items-start" : "items-center")}>
        <EventIcon event={event} />
        {/* A message is a sentence, not a label: it wraps instead of being cut
            off at the column edge. The other two kinds stay one truncated line. */}
        <span className={cn("min-w-0", isMessage ? "flex-1 break-words" : "truncate")}>
          <EventLabel event={event} />
        </span>
      </div>
    </li>
  )
}

function EventIcon({ event }: { event: ApiIncidentTimelineEvent }) {
  if (event.event_type === "status_change") {
    return <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
  }
  if (event.event_type === "field_message") {
    return <MessageSquare className="mt-px h-3.5 w-3.5 shrink-0 text-info" />
  }
  if (event.event_type === "kp_message") {
    // The KP's own «Meldung an den Trupp» (§P3.2) — outbound, so not the
    // inbound message's info tint.
    return <Send className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
  // Translate known statuses; unknown values fall back to the raw status string.
  const statusLabel = (status: string | null | undefined): string => {
    if (!status) return "–"
    return status in STATUS_LABELS ? t(`statusLabels.${status}`) : status
  }
  if (event.event_type === "status_change") {
    const from = statusLabel(event.from_status)
    const to = statusLabel(event.to_status)
    return (
      <>
        <span className="text-muted-foreground">{from}</span>
        <span className="text-muted-foreground mx-1">→</span>
        <span className="text-foreground font-medium">{to}</span>
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
