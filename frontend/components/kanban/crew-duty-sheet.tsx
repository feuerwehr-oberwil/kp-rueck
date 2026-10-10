"use client"

/**
 * Dienstzeiten — a quick view of who is here, since when, for how long, and how
 * much they have done (owner, 08.10.2026: «a quick view who is here for how long
 * and has done how much»). Deliberately NOT a relief planner and not a
 * re-alarming tool: it reads, it does not schedule.
 *
 * - Longest on duty first by default; every column sorts (a click on its head,
 *   again for the other way round), so «who has done the most / the least» is one
 *   click (owner, 10.10.2026). Free / im Einsatz and a name filter narrow it.
 * - «Pause» = on duty and on nothing: time since check-in minus the time on an
 *   incident or Auftrag (`assigned_minutes`, overlaps counted once).
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
import { ArrowDown, ArrowUp, Clock, Filter } from "lucide-react"
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { FooterSheet } from "@/components/ui/footer-sheet"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/search-input"
import { EmptyState } from "@/components/ui/empty-state"
import { useIsMobile } from "@/components/ui/use-mobile"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useMinuteTick } from "@/components/ui/incident-time"
import { personFunctionLabel } from "@/components/kanban/draggable-person"
import { OnDutyTime, useOnDutyLabel } from "@/components/kanban/on-duty-time"
import { apiClient } from "@/lib/api-client"
import {
  CREW_DUTY_FIRST_DIRECTION,
  countPastThreshold,
  dutyMinutes,
  filterCrewDuty,
  sortCrewDuty,
  type CrewDutyEntry,
  type CrewDutyFilter,
  type CrewDutySortKey,
  type SortDirection,
} from "@/lib/crew-duty"
import { formatDuration } from "@/lib/duration"
import type { Person } from "@/lib/contexts/operations-context"
import type { PersonEngagement } from "@/lib/hooks/use-person-engagements"
import { abbreviateRank } from "@/lib/roster-order"
import { cn } from "@/lib/utils"

/** What the server says per person: Einsätze and minutes on something, as of `at`. */
interface Activity {
  count: number
  assigned: number
}
/** Per person id; `null` = not loaded yet, `'failed'` = could not ask. */
type Counts = { byId: Map<string, Activity>; at: number } | null | "failed"

/** Desktop columns: name · seit · anwesend · eingesetzt · Pause · Einsätze · jetzt. The phone stacks. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[minmax(0,1.3fr)_3.5rem_5.5rem_5.5rem_4.5rem_4.75rem_minmax(0,1.2fr)]"

const COLUMNS: { key: CrewDutySortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "colName" },
  { key: "since", label: "colSince" },
  { key: "onDuty", label: "colOnDuty" },
  { key: "assigned", label: "colAssigned" },
  { key: "pause", label: "colPause" },
  { key: "count", label: "colCount", numeric: true },
  { key: "now", label: "colNow" },
]

/**
 * Asks the backend how many Einsätze each person has worked, and how long they have been
 * on something, while `active`.
 *
 * Asked again when `signature` changes — who is on which incident or Auftrag, as the
 * board itself sees it. That is exactly when a count can move (a new assignment is a
 * new engagement), it is scoped to this Ereignis by construction, and it costs nothing
 * while assignments elsewhere change. A change while a request is out is not dropped:
 * one trailing request follows. A failed request keeps the last answer on screen.
 * Between answers the minutes run on locally (see `CrewDutySheet`).
 */
function useActivity(eventId: string | null, active: boolean, signature: string): Counts {
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
          setCounts({
            byId: new Map(rows.map((row) => [row.personnel_id, { count: row.assignment_count, assigned: row.assigned_minutes ?? 0 }])),
            at: Date.now(),
          })
        } catch {
          setCounts((previous) => (previous && previous !== "failed" ? previous : "failed"))
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
  const tKanban = useTranslations("kanban")
  const isMobile = useIsMobile()
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
  const counts = useActivity(eventId, open, signature)
  const over = countPastThreshold(personnel, fatigueHours)

  const [sortKey, setSortKey] = useState<CrewDutySortKey>("onDuty")
  const [direction, setDirection] = useState<SortDirection>("desc")
  const [filter, setFilter] = useState<CrewDutyFilter>("all")
  const [query, setQuery] = useState("")
  const sortBy = (key: CrewDutySortKey) => {
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setDirection(CREW_DUTY_FIRST_DIRECTION[key])
    }
  }

  const now = Date.now()
  const entries: CrewDutyEntry[] = personnel.map((person) => {
    const engagement = personEngagements.get(person.name)
    const onDuty = dutyMinutes(person.checkedInAt, now)
    const activity = counts && counts !== "failed" ? counts.byId.get(person.id) ?? { count: 0, assigned: 0 } : null
    // The server's minutes are as of its answer; whoever is out now has been out since.
    const assigned =
      activity === null || onDuty === null
        ? null
        : Math.min(onDuty, activity.assigned + (engagement ? Math.max(0, Math.floor((now - (counts as { at: number }).at) / 60_000)) : 0))
    return {
      id: person.id,
      name: person.name,
      checkedInAt: person.checkedInAt ?? null,
      onDuty,
      assigned,
      pause: assigned === null || onDuty === null ? null : Math.max(0, onDuty - assigned),
      count: activity?.count ?? null,
      now: engagement?.short || personFunctionLabel(person, tKanban) || null,
    }
  })
  const freeCount = entries.filter((e) => e.now === null).length
  const rows = sortCrewDuty(filterCrewDuty(entries, filter, query), sortKey, direction)
  const byId = new Map(personnel.map((person) => [person.id, person]))
  const filterLabel = filter === "free" ? t("filterFree") : filter === "busy" ? t("filterBusy") : null
  const sortLabel = (key: CrewDutySortKey) => t(COLUMNS.find((c) => c.key === key)!.label)

  return (
    <FooterSheet
      open={open}
      onOpenChange={onOpenChange}
      // The frame and header every footer sheet shares: px-6 py-4, the plain title with
      // its line underneath, the controls on the right.
      className="flex flex-col gap-0 max-w-4xl mx-auto px-6 py-4 pb-sheet-safe sm:pb-4 modal-h-tall"
    >
      <SheetHeader
        // Phone: the sheet's ✕ (44px, absolute) sits in this header, not on the first row.
        className="min-h-11 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 p-0 pr-10 shrink-0 sm:min-h-0 sm:pr-0"
      >
        <div className="min-w-0">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription className="truncate">
            {fatigueHours > 0 && over > 0
              ? t("summaryOver", { present: personnel.length, over, hours: fatigueHours })
              : t("summary", { present: personnel.length })}
          </SheetDescription>
        </div>
        {!isMobile && personnel.length > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            <div role="group" aria-label={t("filter")} className="flex items-center gap-1">
              {(["all", "free", "busy"] as const).map((key) => (
                <Button
                  key={key}
                  size="xs"
                  variant={filter === key ? "selected" : "outline"}
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                >
                  {t(key === "all" ? "filterAll" : key === "free" ? "filterFree" : "filterBusy")}
                  <span className="tabular-nums text-muted-foreground">
                    {key === "all" ? entries.length : key === "free" ? freeCount : entries.length - freeCount}
                  </span>
                </Button>
              ))}
            </div>
            <SearchInput
              size="sm"
              value={query}
              onValueChange={setQuery}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              containerClassName="w-48"
              className="h-7 text-xs"
            />
          </div>
        )}
      </SheetHeader>

      {isMobile && personnel.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            containerClassName="min-w-0 flex-1"
          />
          {/* Phone: ONE square funnel — the filter and the sort (CLAUDE.md → phone filters). */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={filter !== "all" ? "selected" : "outline"}
                size="icon"
                className="size-11 shrink-0"
                aria-label={filterLabel ? t("filterOn", { filter: filterLabel }) : t("filter")}
                title={filterLabel ? t("filterOn", { filter: filterLabel }) : t("filter")}
              >
                <Filter aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {filter !== "all" && (
                <>
                  <DropdownMenuItem onSelect={() => setFilter("all")} className="min-h-[44px]">
                    <span className="flex-1">{t("showAll")}</span>
                    <span className="tabular-nums text-muted-foreground">{entries.length}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {(["free", "busy"] as const).map((key) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={filter === key}
                  onCheckedChange={(checked) => setFilter(checked ? key : "all")}
                  className="min-h-[44px] data-[state=checked]:sel-choice"
                >
                  <span className="flex-1">{t(key === "free" ? "filterFree" : "filterBusy")}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {key === "free" ? freeCount : entries.length - freeCount}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t("sortBy")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sortKey} onValueChange={(key) => sortBy(key as CrewDutySortKey)}>
                {COLUMNS.filter((c) => c.key !== "since").map((column) => (
                  <DropdownMenuRadioItem
                    key={column.key}
                    value={column.key}
                    onSelect={(event) => event.preventDefault()}
                    className="min-h-[44px]"
                  >
                    <span className="flex-1">{t(column.label)}</span>
                    {sortKey === column.key &&
                      (direction === "asc" ? <ArrowUp className="size-3.5" aria-label={t("sortAsc")} /> : <ArrowDown className="size-3.5" aria-label={t("sortDesc")} />)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <div className="relative mt-2.5 flex-1 overflow-y-auto pb-2">
        {personnel.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            title={t("emptyFilteredTitle")}
            action={{
              label: t("resetFilter"),
              onClick: () => {
                setFilter("all")
                setQuery("")
              },
            }}
          />
        ) : (
          <>
            {/* Column heads only where there are columns; each one sorts. */}
            <div className={cn(ROW_GRID, "hidden px-3 pb-1 sm:grid")} role="group" aria-label={t("sortBy")}>
              {COLUMNS.map((column) => {
                const active = sortKey === column.key
                const Arrow = direction === "asc" ? ArrowUp : ArrowDown
                return (
                  <button
                    key={column.key}
                    type="button"
                    onClick={() => sortBy(column.key)}
                    aria-pressed={active}
                    title={column.key === "count" ? t("countTitle") : column.key === "pause" ? t("pauseTitle") : t("sortByColumn", { column: t(column.label) })}
                    className={cn(
                      "-mx-1 inline-flex min-w-0 cursor-pointer items-center gap-0.5 rounded-sm px-1 py-0.5 text-[11px] font-medium uppercase tracking-wide",
                      column.numeric && "justify-end",
                      active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{t(column.label)}</span>
                    {active && <Arrow className="size-3 shrink-0" aria-label={t(direction === "asc" ? "sortAsc" : "sortDesc")} />}
                  </button>
                )
              })}
            </div>
            <ul className="space-y-1" aria-label={t("title")}>
              {rows.map((entry) => (
                <CrewDutyRow
                  key={entry.id}
                  person={byId.get(entry.id)!}
                  entry={entry}
                  failed={counts === "failed"}
                  fatigueHours={fatigueHours}
                />
              ))}
            </ul>
            {isMobile && <p className="mt-2 text-xs text-muted-foreground">{t("sortedBy", { column: sortLabel(sortKey) })}</p>}
          </>
        )}
      </div>
    </FooterSheet>
  )
}

/** «3h 40'», «–» while unknown. */
function minutes(value: number | null): string {
  return value === null ? "–" : formatDuration(value * 60_000)
}

function CrewDutyRow({
  person,
  entry,
  failed,
  fatigueHours,
}: {
  person: Person
  entry: CrewDutyEntry
  /** The server could not be asked: Einsätze and minutes on something are unknown. */
  failed: boolean
  fatigueHours: number
}) {
  const t = useTranslations("kanban.crewDuty")
  const duty = useOnDutyLabel(person.checkedInAt, fatigueHours)
  const loading = entry.count === null && !failed
  const unknown = (value: number | null, text: string) => (value === null ? (loading ? "…" : "–") : text)
  const countText = unknown(entry.count, String(entry.count))
  const countTitle = failed ? t("countUnavailable") : t("countTitle")

  return (
    <li
      className={cn(ROW_GRID, "items-baseline rounded-md border bg-card px-3 py-2 text-sm")}
      // The row reads as one sentence to a screen reader; the cells are its parts.
      aria-label={[
        person.name,
        duty?.label,
        entry.pause !== null ? t("pauseLong", { duration: minutes(entry.pause) }) : null,
        typeof entry.count === "number" ? t("count", { count: entry.count }) : null,
        entry.now ?? t("free"),
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
      <span className="hidden font-mono text-xs tabular-nums sm:inline">
        {unknown(entry.assigned, minutes(entry.assigned))}
      </span>
      <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:inline" title={t("pauseTitle")}>
        {unknown(entry.pause, minutes(entry.pause))}
      </span>
      <span className="hidden text-right font-mono text-xs tabular-nums sm:inline" title={countTitle}>
        {countText}
      </span>
      <span className={cn("hidden min-w-0 truncate text-xs sm:inline", entry.now ? "" : "text-muted-foreground")} title={entry.now ?? undefined}>
        {entry.now ?? t("free")}
      </span>

      {/* Phone: one quiet line under the name — seit · Pause · Einsätze · jetzt. */}
      <span className="col-span-2 mt-0.5 min-w-0 truncate text-xs text-muted-foreground sm:hidden">
        {[
          duty ? t("since", { time: duty.since }) : null,
          entry.pause !== null ? t("pauseShort", { duration: minutes(entry.pause) }) : null,
          typeof entry.count === "number" ? t("count", { count: entry.count }) : null,
          entry.now ?? t("free"),
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
