"use client"

/**
 * Dienstzeiten — a quick view of who is here, since when, for how long, and how
 * much they have done (owner, 08.10.2026: «a quick view who is here for how long
 * and has done how much»). Deliberately NOT a relief planner and not a
 * re-alarming tool: it reads, it does not schedule.
 *
 * - Longest on duty first: the question is «wer ist am längsten dran».
 * - Time on duty runs from check-in (lib/crew-duty.ts), amber/red from the
 *   station's fatigue threshold — the same clock the bell's grouped warning uses.
 * - «Einsätze» = distinct incidents + Aufträge worked this Ereignis, finished and
 *   current (GET /events/{id}/personnel-activity). Only the backend knows
 *   the finished ones; everything else on the row comes from the board itself, so
 *   «Jetzt» says exactly what the Personen-Leiste says.
 *
 * A footer sheet like Fahrzeuge: docked above the toolbar on the desktop, a
 * bottom sheet on the phone. Opened from the Personen-Leiste's foot, the command
 * palette («Dienstzeiten») and the phone's Personal sheet.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Clock } from "lucide-react"
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { FooterSheet } from "@/components/ui/footer-sheet"
import { useMinuteTick } from "@/components/ui/incident-time"
import { personFunctionLabel } from "@/components/kanban/draggable-person"
import { OnDutyTime, useOnDutyLabel } from "@/components/kanban/on-duty-time"
import { apiClient } from "@/lib/api-client"
import { countPastThreshold, sortByTimeOnDuty } from "@/lib/crew-duty"
import type { Person } from "@/lib/contexts/operations-context"
import type { PersonEngagement } from "@/lib/hooks/use-person-engagements"
import { abbreviateRank } from "@/lib/roster-order"
import { cn } from "@/lib/utils"

/** Einsätze per person id; `null` = not loaded yet, `'failed'` = could not ask. */
type Counts = Map<string, number> | null | "failed"

/** Columns on a desktop: name · seit · im Einsatz · Einsätze · jetzt. The phone stacks. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[minmax(0,1.3fr)_3.5rem_4.5rem_4rem_minmax(0,1.5fr)]"

/**
 * Asks the backend how many Einsätze each person has worked, while `active`.
 *
 * Asked again when `signature` changes — who is on which incident or Auftrag, as the
 * board itself sees it. That is exactly when a count can move (a new assignment is a
 * new engagement), it is scoped to this Ereignis by construction, and it costs nothing
 * while assignments elsewhere change. A change while a request is out is not dropped:
 * one trailing request follows. A failed request keeps the last answer on screen.
 */
function useEinsatzCounts(eventId: string | null, active: boolean, signature: string): Counts {
  const [counts, setCounts] = useState<Counts>(null)
  const inFlight = useRef(false)
  const again = useRef(false)

  const load = useCallback(async () => {
    if (!eventId) return
    if (inFlight.current) {
      again.current = true
      return
    }
    inFlight.current = true
    try {
      do {
        again.current = false
        try {
          const rows = await apiClient.getEventPersonnelActivity(eventId)
          setCounts(new Map(rows.map((row) => [row.personnel_id, row.assignment_count])))
        } catch {
          setCounts((previous) => (previous instanceof Map ? previous : "failed"))
        }
      } while (again.current)
    } finally {
      inFlight.current = false
    }
  }, [eventId])

  useEffect(() => {
    setCounts(null)
  }, [eventId])

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(load, 400)
    return () => clearTimeout(timer)
  }, [active, load, signature])

  return counts
}

interface CrewDutySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string | null
  /** The board's roster: everybody checked in for this Ereignis. */
  personnel: Person[]
  /** Where each person is, by name — the same map the Personen-Leiste reads. */
  personEngagements: Map<string, PersonEngagement>
  fatigueHours: number
}

export function CrewDutySheet({ open, onOpenChange, eventId, personnel, personEngagements, fatigueHours }: CrewDutySheetProps) {
  const t = useTranslations("kanban.crewDuty")
  useMinuteTick()
  // Who is where, as one string: changes exactly when an assignment does.
  const signature = useMemo(
    () =>
      personnel
        .map((person) => `${person.id}=${personEngagements.get(person.name)?.full ?? ""}`)
        .sort()
        .join("|"),
    [personnel, personEngagements],
  )
  const counts = useEinsatzCounts(eventId, open, signature)
  const rows = useMemo(() => sortByTimeOnDuty(personnel), [personnel])
  const over = countPastThreshold(personnel, fatigueHours)

  return (
    <FooterSheet
      open={open}
      onOpenChange={onOpenChange}
      className="flex flex-col gap-0 max-w-3xl mx-auto px-4 sm:px-6 pt-3 pb-sheet-safe sm:pb-4 modal-h-tall"
    >
      <SheetHeader
        // Phone: the sheet's ✕ (44px, absolute) sits in this header, not on the first row.
        className="min-h-11 flex-row items-baseline justify-between gap-4 p-0 pr-10 shrink-0 sm:min-h-0 sm:pr-0"
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <SheetTitle className="text-base">{t("title")}</SheetTitle>
          <SheetDescription className="truncate text-xs">
            {fatigueHours > 0 && over > 0
              ? t("summaryOver", { present: personnel.length, over, hours: fatigueHours })
              : t("summary", { present: personnel.length })}
          </SheetDescription>
        </div>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{t("sortHint")}</span>
      </SheetHeader>

      <div className="mt-2.5 flex-1 overflow-y-auto pb-2">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            {/* Column heads only where there are columns. */}
            <div
              aria-hidden="true"
              className={cn(ROW_GRID, "hidden px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid")}
            >
              <span>{t("colName")}</span>
              <span>{t("colSince")}</span>
              <span>{t("colOnDuty")}</span>
              <span className="text-right" title={t("countTitle")}>{t("colCount")}</span>
              <span>{t("colNow")}</span>
            </div>
            <ul className="space-y-1" aria-label={t("title")}>
              {rows.map((person) => (
                <CrewDutyRow
                  key={person.id}
                  person={person}
                  engagement={personEngagements.get(person.name)}
                  count={counts instanceof Map ? (counts.get(person.id) ?? 0) : counts}
                  fatigueHours={fatigueHours}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </FooterSheet>
  )
}

function CrewDutyRow({
  person,
  engagement,
  count,
  fatigueHours,
}: {
  person: Person
  engagement?: PersonEngagement
  count: number | null | "failed"
  fatigueHours: number
}) {
  const t = useTranslations("kanban.crewDuty")
  const tKanban = useTranslations("kanban")
  const duty = useOnDutyLabel(person.checkedInAt, fatigueHours)
  const now = engagement?.short || personFunctionLabel(person, tKanban) || null
  const countText =
    count === null ? "…" : count === "failed" ? "–" : String(count)
  const countTitle = count === "failed" ? t("countUnavailable") : t("countTitle")

  return (
    <li
      className={cn(ROW_GRID, "items-baseline rounded-md border bg-card px-3 py-2 text-sm")}
      // The row reads as one sentence to a screen reader; the cells are its parts.
      aria-label={[
        person.name,
        duty?.label,
        typeof count === "number" ? t("count", { count }) : null,
        now ?? t("free"),
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate font-medium" title={person.name}>{person.name}</span>
        {person.role && (
          <span className="shrink-0 text-xs text-muted-foreground" title={person.role}>
            {abbreviateRank(person.role)}
          </span>
        )}
      </span>
      <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:inline">{duty?.since ?? "–"}</span>
      <OnDutyTime checkedInAt={person.checkedInAt} fatigueHours={fatigueHours} className="text-right text-sm sm:text-left" />
      <span className="hidden text-right font-mono text-xs tabular-nums sm:inline" title={countTitle}>
        {countText}
      </span>
      <span className={cn("hidden min-w-0 truncate text-xs sm:inline", now ? "" : "text-muted-foreground")} title={now ?? undefined}>
        {now ?? t("free")}
      </span>

      {/* Phone: one quiet line under the name — seit · Einsätze · jetzt. */}
      <span className="col-span-2 mt-0.5 min-w-0 truncate text-xs text-muted-foreground sm:hidden">
        {[
          duty ? t("since", { time: duty.since }) : null,
          typeof count === "number" ? t("count", { count }) : null,
          now ?? t("free"),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </li>
  )
}

/** The way in: a quiet clock button (the Personen-Leiste's foot, the phone's Personal sheet). */
export function CrewDutyButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const t = useTranslations("kanban.crewDuty")
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("openTitle")}
      aria-label={t("openTitle")}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground transition-colors",
        "hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Clock className="size-3.5" />
      {t("openButton")}
    </button>
  )
}
