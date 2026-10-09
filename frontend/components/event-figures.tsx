"use client"

/**
 * Kennzahlen of one Ereignis — the live Lage numbers and the Reaktionszeiten.
 *
 * One view for three places: the board's «Kennzahlen» footer sheet (on a training
 * Ereignis it is the Übungsauswertung), the status wall (`/display/status`) and the
 * Ereignisse list (any past Ereignis). Presentational: the numbers come from the
 * backend (`services/reaction_times.py`), which computes the stage times the PDF's
 * Reaktionszeiten table prints — the wall and the debrief cannot disagree.
 *
 * Calm on purpose: neutral bars and numbers, red only where the board uses it
 * (a «hoch» Meldung still waiting). Priority is always named in words beside its dot.
 */

import { useTranslations } from "next-intl"
import type { ApiEventFigures, ApiPriorityFigures, ApiStageFigures } from "@/lib/api-client"
import { formatDuration } from "@/lib/duration"
import { ageLevel } from "@/lib/kanban-utils"
import { PRIORITY_DOT_CLASSES, type Priority } from "@/lib/priority"
import { cn } from "@/lib/utils"
import { useEventFigures } from "@/lib/hooks/use-event-figures"
import { LoadingStatus } from "@/components/ui/shell-loader"
import { EmptyState } from "@/components/ui/empty-state"

export type EventFiguresDensity = "panel" | "wall"

export interface EventFiguresViewProps {
  figures: ApiEventFigures
  /** Turns the oldest waiting «hoch» Meldung into a button that opens it. */
  onOpenIncident?: (incidentId: string) => void
  /** How the oldest waiting Meldung is named — the board's location label when
   *  the caller has the incident, else its title. */
  incidentLabel?: (incidentId: string) => string | undefined
  /** `wall` = the status display's column: tighter, no definitions footnote. */
  density?: EventFiguresDensity
  className?: string
}

const STAGES = ["dispatched", "on_scene", "closed"] as const
type StageKey = (typeof STAGES)[number]

function seconds(value: number | null): string {
  return value === null ? "–" : formatDuration(value * 1000)
}

export function EventFiguresView({
  figures,
  onOpenIncident,
  incidentLabel,
  density = "panel",
  className,
}: EventFiguresViewProps) {
  const t = useTranslations("events.figures")
  const wall = density === "wall"
  const priorityLabel: Record<Priority | "all", string> = {
    high: t("priorityHigh"),
    medium: t("priorityMedium"),
    low: t("priorityLow"),
    all: t("priorityAll"),
  }
  const stageLabel: Record<StageKey, string> = {
    dispatched: t("toDispatched"),
    on_scene: t("toOnScene"),
    closed: t("toClosed"),
  }
  const byPriority = new Map(figures.by_priority.map((p) => [p.priority, p]))
  const waitingOf = (p: Priority) => byPriority.get(p)?.waiting ?? 0

  const oldest = figures.oldest_waiting_high
  const oldestSince = oldest ? new Date(oldest.created_at) : null
  const oldestAge = oldestSince ? formatDuration(Date.now() - oldestSince.getTime()) : null
  const oldestName = oldest ? incidentLabel?.(oldest.incident_id) || oldest.title : null

  const rows: ApiPriorityFigures[] = [
    ...(["high", "medium", "low"] as const).map((p) => byPriority.get(p)).filter((r): r is ApiPriorityFigures => !!r),
    figures.overall,
  ]

  return (
    // `@container`: the same view sits in a 720px sheet, a 300–480px wall column and a
    // phone dialog — the count tiles go 2×2 by the room they get, not the window.
    <div className={cn("@container flex flex-col", wall ? "gap-3 p-3 xl:p-4" : "gap-4", className)} data-testid="event-figures">
      {/* ── Counts ── */}
      <dl className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
        <Count label={t("total")} value={figures.total} wall={wall} />
        <Count
          label={t("waiting")}
          value={figures.waiting}
          wall={wall}
          detail={t("waitingByPriority", { high: waitingOf("high"), medium: waitingOf("medium"), low: waitingOf("low") })}
        />
        <Count label={t("inProgress")} value={figures.in_progress} wall={wall} />
        <Count label={t("done")} value={figures.done} wall={wall} />
      </dl>

      {/* ── Oldest waiting «hoch» ── the one number somebody should act on. */}
      {oldest && oldestSince ? (
        <OldestWaiting
          label={t("oldestHigh")}
          name={oldestName ?? ""}
          age={t("waitingSince", { age: oldestAge ?? "" })}
          overdue={ageLevel(oldestSince) !== "normal"}
          openLabel={t("openIncident")}
          onOpen={onOpenIncident ? () => onOpenIncident(oldest.incident_id) : undefined}
        />
      ) : (
        figures.total > 0 && <p className="text-sm text-muted-foreground">{t("noWaitingHigh")}</p>
      )}

      {/* ── Reaktionszeiten: median, P90 underneath ── */}
      <section aria-labelledby="figures-reaction-title" className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 id="figures-reaction-title" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("reactionTitle")}
          </h3>
          <span className="text-xs text-muted-foreground">{t("reactionHint")}</span>
        </div>
        <table className="w-full table-fixed border-collapse text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="w-[28%] py-1 pr-2 font-medium">{t("colPriority")}</th>
              {STAGES.map((stage) => (
                <th key={stage} scope="col" className="py-1 pr-2 font-medium">{stageLabel[stage]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.priority}
                className={cn("border-t border-border align-top", row.priority === "all" && "font-medium")}
              >
                <th scope="row" className="py-1.5 pr-2 text-left font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {row.priority !== "all" && (
                      <span className={cn("size-2 shrink-0 rounded-full", PRIORITY_DOT_CLASSES[row.priority])} aria-hidden />
                    )}
                    {priorityLabel[row.priority]}
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {t("incidentCount", { count: row.total })}
                  </span>
                </th>
                {STAGES.map((stage) => (
                  <StageCell
                    key={stage}
                    stage={row[stage]}
                    title={t("cellTitle", {
                      stage: stageLabel[stage],
                      priority: priorityLabel[row.priority],
                      median: seconds(row[stage].median_seconds),
                      p90: seconds(row[stage].p90_seconds),
                      count: row[stage].count,
                    })}
                    p90Label={(value) => t("p90", { value })}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── One bar per priority: Eingang → Disponiert ── */}
      <DispatchBars
        rows={figures.by_priority}
        title={t("chartTitle")}
        legendMedian={t("legendMedian")}
        legendP90={t("legendP90")}
        priorityLabel={priorityLabel}
        noneLabel={t("noneYet")}
      />

      {!wall && <p className="text-xs text-muted-foreground">{t("definitions")}</p>}
    </div>
  )
}

/**
 * The view with its own data: loads and polls the Kennzahlen of `eventId` while
 * `enabled` (the board sheet passes its `open`), and says what it is doing while it
 * has nothing to show.
 */
export function EventFiguresPanel({
  eventId,
  enabled = true,
  ...view
}: Omit<EventFiguresViewProps, "figures"> & { eventId: string | null | undefined; enabled?: boolean }) {
  const t = useTranslations("events.figures")
  const { figures, failed } = useEventFigures(eventId, { enabled })
  if (!eventId) return <EmptyState compact title={t("noEvent")} />
  if (!figures) {
    return failed ? (
      <p role="alert" className="py-6 text-center text-sm text-destructive">{t("loadFailed")}</p>
    ) : (
      <div className="flex justify-center py-8">
        <LoadingStatus size="surface" className="text-sm">{t("loading")}</LoadingStatus>
      </div>
    )
  }
  if (figures.total === 0) return <EmptyState compact title={t("empty")} />
  return (
    <>
      {failed && <p role="status" className="mb-2 text-xs text-muted-foreground">{t("stale")}</p>}
      <EventFiguresView figures={figures} {...view} />
    </>
  )
}

function Count({ label, value, detail, wall }: { label: string; value: number; detail?: string; wall: boolean }) {
  return (
    <div className="flex min-w-0 flex-col rounded-md border border-border bg-muted/30 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-semibold tabular-nums leading-tight", wall ? "text-xl xl:text-2xl" : "text-2xl")}>{value}</dd>
      {detail && <dd className="break-words text-xs text-muted-foreground">{detail}</dd>}
    </div>
  )
}

function OldestWaiting({
  label,
  name,
  age,
  overdue,
  openLabel,
  onOpen,
}: {
  label: string
  name: string
  age: string
  overdue: boolean
  openLabel: string
  onOpen?: () => void
}) {
  const body = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="min-w-0 break-words font-medium">{name}</span>
        <span className={cn("shrink-0 text-sm font-semibold tabular-nums", overdue ? "text-destructive" : "text-foreground")}>
          {age}
        </span>
      </span>
    </>
  )
  // Hoch keeps its red edge here like on the board card (CLAUDE.md → Colour roles).
  const frame = "flex w-full flex-col gap-0.5 rounded-md border border-border border-l-[3px] border-l-destructive bg-destructive/5 px-3 py-2 text-left"
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cn(frame, "hover:bg-destructive/10")} title={openLabel}>
      {body}
    </button>
  ) : (
    <div className={frame}>{body}</div>
  )
}

function StageCell({ stage, title, p90Label }: { stage: ApiStageFigures; title: string; p90Label: (value: string) => string }) {
  if (stage.count === 0) {
    return <td className="py-1.5 pr-2 text-muted-foreground" title={title}>–</td>
  }
  return (
    <td className="py-1.5 pr-2" title={title}>
      <span className="block font-semibold">{seconds(stage.median_seconds)}</span>
      <span className="block text-xs text-muted-foreground">{p90Label(seconds(stage.p90_seconds))}</span>
    </td>
  )
}

/**
 * Median (solid) and the stretch to P90 (faint) on one shared scale, so «hoch is
 * dispatched faster than niedrig» reads without a number. Neutral ink: the bars
 * carry magnitude, the label beside them carries the priority.
 */
function DispatchBars({
  rows,
  title,
  legendMedian,
  legendP90,
  priorityLabel,
  noneLabel,
}: {
  rows: ApiPriorityFigures[]
  title: string
  legendMedian: string
  legendP90: string
  priorityLabel: Record<Priority | "all", string>
  noneLabel: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.dispatched.p90_seconds ?? 0))
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        <span className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-foreground/70" />{legendMedian}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-foreground/25" />{legendP90}</span>
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const median = row.dispatched.median_seconds
          const p90 = row.dispatched.p90_seconds
          const label = priorityLabel[row.priority]
          return (
            <li key={row.priority} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-sm">
              <span className="truncate" title={label}>{label}</span>
              <span className="relative h-3 overflow-hidden rounded-sm bg-foreground/[0.06]" aria-hidden>
                {p90 !== null && (
                  <span className="absolute inset-y-0 left-0 rounded-sm bg-foreground/25" style={{ width: `${(p90 / max) * 100}%` }} />
                )}
                {median !== null && (
                  <span
                    className="absolute inset-y-0 left-0 rounded-sm bg-foreground/70"
                    // A 0' median still gets a sliver, so «instant» is not mistaken for «no data».
                    style={{ width: `max(3px, ${(median / max) * 100}%)` }}
                  />
                )}
              </span>
              <span className="min-w-[4.5rem] text-right tabular-nums text-muted-foreground">
                {median === null ? noneLabel : `${seconds(median)} · ${seconds(p90)}`}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
