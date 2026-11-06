"use client"

/**
 * A folded column on both wall boards (`app/display/board/page.tsx`,
 * `token-board.tsx`): the narrow rail that still carries the column's count,
 * its overdue mark and its name, so a closed column never hides the thing that
 * needed looking at. A click opens the column again.
 *
 * Read across, not sideways (hill climb r19): the rail's name used to run
 * rotated 90° in 12px caps, the one label on the wall nobody could read from
 * the room. Now the count stands at 16/600 on top and the column's SHORT name
 * («ABGESCHL.», `display.board.railLabel`) under it in the column heads' wall
 * caps; the rail is as wide as that word (or the overdue chip) and no wider.
 * The full name is the rail's accessible name and `title`. Below `sm` the
 * boards stack (lib/wall-stack) and the rail becomes a full-width row, which
 * has the room for the full name.
 *
 * Usage: `<WallFoldedColumn columnId={column.id} operations={ops} onOpen={…} />`.
 */

import { useTranslations } from "next-intl"
import { ChevronRight } from "lucide-react"
import type { Operation, OperationStatus } from "@/lib/contexts/operations-context"
import { STATUS_ACCENT, WALL_COLUMN_COUNT_CLASS, WALL_COLUMN_HEADER_CLASS, type columns } from "@/lib/kanban-utils"
import { WALL_STACK_FOLDED } from "@/lib/wall-stack"
import { WallColumnAgeChip } from "@/components/display/wall-column-age-chip"
import { cn } from "@/lib/utils"

export function WallFoldedColumn({ columnId, operations, onOpen }: {
  columnId: (typeof columns)[number]["id"]
  operations: readonly Operation[]
  onOpen: () => void
}) {
  const t = useTranslations("display.board")
  const tk = useTranslations("kanban.columns")
  const title = t("collapsedColumnTitle", { title: tk(columnId), count: operations.length })
  // `columnId` IS a status (see kanban-utils), so the lookup cannot miss.
  const accent = STATUS_ACCENT[columnId as OperationStatus]
  return (
    <button
      type="button"
      data-column={columnId}
      onClick={onOpen}
      title={title}
      aria-label={title}
      className={cn(
        "relative flex flex-shrink-0 flex-col items-center gap-2 overflow-hidden rounded-lg border border-border bg-card px-1.5 pb-3 pt-3 transition-colors hover:bg-foreground/5",
        WALL_STACK_FOLDED,
      )}
    >
      {/* The status key, as on an open column: a 2px rule across the top. */}
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", accent?.dot)} />
      <ChevronRight aria-hidden className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <span className={cn(WALL_COLUMN_COUNT_CLASS, "h-7 min-w-7 text-base leading-5")}>{operations.length}</span>
      <span className={cn(WALL_COLUMN_HEADER_CLASS, "whitespace-nowrap")}>
        <span className="max-sm:hidden">{t(`railLabel.${columnId}`)}</span>
        <span className="sm:hidden">{tk(columnId)}</span>
      </span>
      <WallColumnAgeChip operations={operations} />
    </button>
  )
}
