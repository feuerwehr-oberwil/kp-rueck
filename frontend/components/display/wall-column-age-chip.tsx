"use client"

/**
 * The «something here has sat too long» mark beside a WALL column's count –
 * on both wall boards (`app/display/board/page.tsx`, `token-board.tsx`), on
 * the open column's header and on its folded strip.
 *
 * It used to be an 8px red dot on the count badge: red for what the age rule
 * calls amber, no word (the names only in a hover `title` nobody at a wall can
 * open), and next to a Hoch card it read as «Hoch». Now it says what it means:
 * the age chip's Timer glyph + how many + from when, «2 ≥ 60'», 14/18 600
 * tabular like the count beside it, in the card age chip's own colour for the
 * WORST of them (`ageChipClass`: amber from 60', red only from 120'). The
 * thresholds are `ageLevel`'s – a Fachentscheidung, not touched here.
 *
 * Renders nothing while no incident in the column has reached 60'.
 *
 * Usage: `<WallColumnAgeChip operations={columnOps} />`, `folded` on the 48px
 * strip, where it runs vertically like the strip's label.
 */

import { useTranslations } from "next-intl"
import { Timer } from "lucide-react"
import type { Operation } from "@/lib/contexts/operations-context"
import { ageChipClass, ageLevel } from "@/lib/kanban-utils"
import { getIncidentLocationLabel } from "@/lib/incident-types"
import { cn } from "@/lib/utils"

/** Where `ageLevel` turns «warn», in minutes – the chip's «≥ 60'». Pinned to it
 *  by the test. Said in the card's minute notation, not via `formatDuration`,
 *  which would read «1h 0'». */
export const AGED_FROM_MINUTES = 60

/** The age the wall counts from: time in the current status (the card's age chip). */
const ageSince = (op: Pick<Operation, "statusChangedAt" | "dispatchTime">) => op.statusChangedAt || op.dispatchTime

export function WallColumnAgeChip({ operations, folded = false }: {
  operations: readonly Operation[]
  folded?: boolean
}) {
  const t = useTranslations("display.board")
  const aged = operations.filter((op) => ageLevel(ageSince(op)) !== "normal")
  if (aged.length === 0) return null

  // The oldest one decides the colour: one incident past 120' is reason enough.
  const oldest = aged.reduce((a, b) => (ageSince(b).getTime() < ageSince(a).getTime() ? b : a))
  // The names, up to three, for a desk that opens the wall with a mouse.
  const title = t("columnAlarmTitle", {
    count: aged.length,
    titles: aged.slice(0, 3).map((op) => getIncidentLocationLabel(op)).join(", ")
      + (aged.length > 3 ? ` ${t("columnAlarmMore", { count: aged.length - 3 })}` : ""),
  })

  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        // The count chip's geometry and type (WALL_COLUMN_COUNT_CLASS), its
        // neutral fill too: the colour is the text's, as on the card's age.
        "inline-flex flex-shrink-0 items-center gap-1 rounded-sm bg-foreground/10 text-sm leading-[1.125rem] tabular-nums whitespace-nowrap",
        folded ? "w-6 py-1.5 [writing-mode:vertical-rl]" : "h-6 px-1.5",
        ageChipClass(ageSince(oldest)),
        "font-semibold",
      )}
    >
      <Timer aria-hidden className="h-3.5 w-3.5 flex-shrink-0" />
      {t("columnAgedChip", { count: aged.length, threshold: `${AGED_FROM_MINUTES}'` })}
    </span>
  )
}
