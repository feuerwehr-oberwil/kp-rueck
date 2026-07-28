"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Info, Loader2, ArrowRight, UserPlus, UserMinus, Truck, Package } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { apiClient, type ApiIncidentTimelineEvent } from "@/lib/api-client"
import { STATUS_LABELS } from "@/lib/types/incidents"
import { cn } from "@/lib/utils"

interface IncidentTimelinePopoverProps {
  incidentId: string
}

/**
 * (i) button in the operation-detail-modal header that reveals a popover
 * with the merged incident timeline (status changes + resource assignments).
 *
 * Static load on open; subscribe to WS later (B2 v2) if operators need it.
 */
export function IncidentTimelinePopover({ incidentId }: IncidentTimelinePopoverProps) {
  const t = useTranslations('kanban')
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<ApiIncidentTimelineEvent[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTimeline = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await apiClient.getIncidentTimeline(incidentId)
      setEvents(result.events)
    } catch (err) {
      console.error("Failed to load timeline:", err)
      setError(t('timeline.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }, [incidentId, t])

  useEffect(() => {
    if (open) loadTimeline()
  }, [open, loadTimeline])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('timeline.showAria')}
        >
          <Info className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[420px] p-0 flex flex-col max-h-[min(70vh,520px)]"
        // Radix Dialog locks scroll on the body via react-remove-scroll. The
        // Popover renders in a portal outside the Dialog tree, so wheel/touch
        // events get blocked. Stop propagation here so the inner div can scroll.
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-2.5 shrink-0">
          <h3 className="text-sm font-semibold">{t('timeline.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('timeline.subtitle')}</p>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {!isLoading && error && (
            <div className="px-4 py-6 text-sm text-destructive">{error}</div>
          )}
          {!isLoading && !error && events && events.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground">{t('timeline.empty')}</div>
          )}
          {!isLoading && !error && events && events.length > 0 && (
            <ol className="divide-y divide-border">
              {events.map((event, idx) => (
                <TimelineRow key={idx} event={event} />
              ))}
            </ol>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TimelineRow({ event }: { event: ApiIncidentTimelineEvent }) {
  const time = formatTime(event.timestamp)
  return (
    <li className="flex items-center gap-3 px-4 py-2 text-xs">
      <span className="font-mono text-muted-foreground tabular-nums shrink-0">{time}</span>
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <EventIcon event={event} />
        <span className="truncate">
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
    if (!status) return "—"
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
