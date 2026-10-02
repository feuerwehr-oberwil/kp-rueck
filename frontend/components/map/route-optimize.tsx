"use client"

/**
 * «Reihenfolge optimieren» — the one action behind all three entry points (the
 * Routen-Editor modal, the `/map` Routenplanung panel and the Aufträge sheet).
 *
 * It used to be copied into each of them, which is how an unguarded undo ended up
 * in three places. Now there is one implementation:
 *
 * - The menu shows every start anchor with where it is and how fresh, BEFORE
 *   anything runs; the basis («Vorschlag nach Luftlinie · Planungshilfe») heads it.
 * - Running saves at once (as before) and the toast names the start actually
 *   used — including «Ersatzstandort» and «nicht verfügbar – ab erstem Stopp».
 * - «Rückgängig» is conditional on the server: the old order is restored only if
 *   the route still has exactly the order this optimisation produced, checked
 *   under the Auftrag lock (`restoreGroupStops` → 409). Otherwise the operator
 *   reads «Nicht mehr rückgängig machbar – Auftrag geändert» and the newer work
 *   stays. A second click on the same toast does nothing.
 */

import { useCallback, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { AlertTriangle } from "lucide-react"
import { useGroups } from "@/lib/contexts/groups-context"
import { useIntlLocale } from "@/lib/date-locale"
import type { useRoutePlanning } from "@/lib/hooks/use-route-planning"
import {
  describeRouteStart,
  describeStartOption,
  routeStartSummary,
  type RouteStart,
  type RouteStartMode,
} from "@/lib/route-start"
import { cn } from "@/lib/utils"
import { RouteOptimizeMenu, type RouteStartOption } from "./route-stop-list"

type Planning = Pick<ReturnType<typeof useRoutePlanning>, "group" | "anchors" | "optimizeFrom" | "reorder">

const START_MODES: RouteStartMode[] = ["magazin", "vehicle", "first"]

interface LastRun {
  groupId: string
  /** The order the optimisation produced (and saved). */
  ids: string[]
  start: RouteStart
}

const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i])

export function useRouteOptimizeAction(planning: Planning) {
  const t = useTranslations("map.routeOptimize")
  const locale = useIntlLocale()
  const { restoreGroupStops } = useGroups()
  const [lastRun, setLastRun] = useState<LastRun | null>(null)

  const startOptions: RouteStartOption[] = START_MODES.map((mode) => {
    const text = describeStartOption(mode, planning.anchors, t, Date.now(), locale)
    return { value: mode, label: text.label, detail: text.detail, caution: text.caution, disabled: !text.available }
  })

  const undo = useCallback(
    async (groupId: string, previous: string[], produced: string[]) => {
      const outcome = await restoreGroupStops(groupId, previous, produced)
      if (outcome === "restored") {
        setLastRun((run) => (run?.groupId === groupId ? null : run))
        toast.success(t("undone"))
      } else if (outcome === "conflict") {
        toast.error(t("undoConflict"), { description: t("undoConflictDetail") })
      } else {
        toast.error(t("undoFailed"))
      }
    },
    [restoreGroupStops, t],
  )

  const runOptimize = useCallback(
    async (mode: RouteStartMode) => {
      const group = planning.group
      if (!group) return
      const previous = group.stopIds
      const { ids, start } = planning.optimizeFrom(mode)
      if (ids.length === 0 || !start) return
      const startLine = t("startLine", { start: routeStartSummary(describeRouteStart(start, t, Date.now(), locale)) })
      if (sameOrder(ids, previous)) {
        toast.info(t("unchanged"), { description: startLine })
        return
      }
      const persisted = await planning.reorder(ids)
      if (!persisted) return
      setLastRun({ groupId: group.id, ids, start })
      // Bound to THIS group and THIS result: switching the panel to another
      // Auftrag before clicking must not restore anything there.
      let used = false
      toast.success(t("optimized"), {
        description: startLine,
        action: {
          label: t("undo"),
          onClick: () => {
            if (used) return
            used = true
            void undo(group.id, previous, ids)
          },
        },
      })
    },
    [planning, t, locale, undo],
  )

  // The note under the list is only true while the route still has the order the
  // optimisation produced; any later drag/add/remove makes it history.
  const group = planning.group
  const activeRun = lastRun && group && lastRun.groupId === group.id && sameOrder(lastRun.ids, group.stopIds) ? lastRun : null

  return { startOptions, runOptimize, lastRun: activeRun }
}

/** The wand + menu, wired to the shared action. */
export function RouteOptimizeButton({
  action,
  disabled,
  className,
}: {
  action: ReturnType<typeof useRouteOptimizeAction>
  disabled?: boolean
  className?: string
}) {
  const t = useTranslations("map.routeOptimize")
  return (
    <RouteOptimizeMenu
      options={action.startOptions}
      basisLabel={t("basis")}
      menuLabel={t("startHeading")}
      optimizeLabel={t("optimize")}
      disabled={disabled}
      onOptimize={(start) => void action.runOptimize(start)}
      className={className}
    />
  )
}

/**
 * One quiet line under the stop list after an optimisation: what the order is
 * based on and where it started. Disappears as soon as the order changes.
 */
export function RouteOptimizeNote({
  action,
  className,
}: {
  action: ReturnType<typeof useRouteOptimizeAction>
  className?: string
}) {
  const t = useTranslations("map.routeOptimize")
  const locale = useIntlLocale()
  if (!action.lastRun) return null
  const text = describeRouteStart(action.lastRun.start, t, Date.now(), locale)
  return (
    <p
      className={cn(
        "flex items-start gap-1 text-xs leading-snug",
        text.caution ? "text-warning-foreground" : "text-muted-foreground",
        className,
      )}
      role="status"
    >
      {text.caution && <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />}
      <span>{t("note", { start: routeStartSummary(text) })}</span>
    </p>
  )
}
