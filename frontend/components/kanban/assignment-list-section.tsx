"use client"

import { cn } from "@/lib/utils"

/** The tile grid of every block: three columns from `sm`, ONE below it, so a phone shows a
 *  name in full («Hoffmann Lisa», not «Hoffmann L…») and the where-note gets the width. */
export const TILE_GRID = "grid grid-cols-1 sm:grid-cols-3 gap-2"
/** A tile's «where is it now» note: one truncated line in the grid, up to two lines on the
 *  phone's single column. Tone (amber) comes from the caller. */
export const ELSEWHERE_NOTE = "mt-0.5 flex max-w-full items-center max-sm:items-start gap-1 overflow-hidden text-2xs font-medium"
export const ELSEWHERE_TEXT = "min-w-0 sm:truncate max-sm:line-clamp-2 max-sm:break-words"

/**
 * The rule above one of the two blocks the lists are split into.
 *
 * Deliberately a rule and not a `<Separator/>` with a label beside it: the
 * heading has to be readable as "everything below this is spoken for" while the
 * eye is moving. Both headings are neutral (owner decision 2026-10, «quieter»
 * pass): the label says it, and the amber note on each busy row says where —
 * an amber heading plus amber-tinted tiles turned half the dialog orange.
 * `tone` stays as the semantic marker of the block.
 *
 * Shared by the resource assignment dialog's crew and vehicle lists and by
 * `MaterialAssignmentList`.
 */
export function ListSection({ label, tone, children }: { label: string; tone: 'free' | 'busy'; children: React.ReactNode }) {
  return (
    <section>
      <h3
        className={cn(
          "mb-2 flex items-center gap-2.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground",
        )}
        data-tone={tone}
      >
        {label}
        <span className="h-px flex-1 bg-border/60" />
      </h3>
      {children}
    </section>
  )
}
