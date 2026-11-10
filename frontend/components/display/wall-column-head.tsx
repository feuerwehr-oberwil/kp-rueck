"use client"

/**
 * The line inside an open WALL column's head – both wall boards
 * (`app/display/board/page.tsx`, `token-board.tsx`) draw it inside their fold
 * button: chevron, the column's name, its count, and at the right end the
 * overdue chip (`WallColumnAgeChip`, nothing while no card has reached 60′).
 *
 * The count chip stands 8px after the name – it is the name's figure – and the
 * overdue chip at the head's far end, pushed apart by whatever room is left
 * (hill climb r22: name, «⏱ 2 ≥ 60'» and «2» 4–6px apart read as one cluster
 * «2 ≥ 60' 2»). 6px is the least between them – at 1920 «REKO ABGESCHLOSSEN 2
 * ⏱ 2 ≥ 60'» has only a few px to spare on one line (the age chip is 6px
 * tighter than the count chip for that), and a wider gap wraps the name.
 * The name wraps instead of truncating (`WALL_TEXT_WRAP`): in Sora, at 1280,
 * «DISPONIERT / …» and «REKO ABGESC…» were all a wall could read of three heads.
 * Name and count are inline text, so a wrapped name keeps its count right
 * after its last word rather than beside the block.
 *
 * Usage: `<WallColumnHead name={tk(`columns.${id}`)} operations={columnOps} />`
 */

import { ChevronDown } from "lucide-react"
import type { Operation } from "@/lib/contexts/operations-context"
import { WALL_COLUMN_COUNT_CLASS, WALL_COLUMN_HEADER_CLASS, WALL_TEXT_WRAP } from "@/lib/kanban-utils"
import { cn } from "@/lib/utils"
import { WallColumnAgeChip } from "@/components/display/wall-column-age-chip"

export function WallColumnHead({ name, operations }: { name: string; operations: readonly Operation[] }) {
  return (
    <div className="flex items-center gap-1.5">
      <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <div className={cn("min-w-0 flex-1", WALL_TEXT_WRAP)}>
        <h2 className={cn("inline", WALL_COLUMN_HEADER_CLASS)}>{name}</h2>
        <span className={cn(WALL_COLUMN_COUNT_CLASS, "ml-2 align-middle")}>{operations.length}</span>
      </div>
      <WallColumnAgeChip operations={operations} />
    </div>
  )
}
