"use client"

import { cn } from "@/lib/utils"

/** The tile grid of every block: three columns from `sm`, ONE below it, so a phone shows a
 *  name in full («Hoffmann Lisa», not «Hoffmann L…») and the where-note gets the width. */
export const TILE_GRID = "grid grid-cols-1 sm:grid-cols-3 gap-2"
/** Every line under a tile's name is 12/16 – a fact in plain `text-xs` muted, a note that asks
 *  for a look (amber: where it is, a function, «kein Fahrer») in `type-caption` (12/500) – and the
 *  name stays 14/500, the one thing to read first. Tiles align their contents to the TOP: a grid row is as tall as
 *  its tallest tile, and centred contents put the names of one row at different heights. */
export const TILE_META = "type-caption"
/** A tile's «where is it now» note: up to two lines, then an ellipsis (full text in `title`) –
 *  one dense ellipsis line hid the Einsatz it named (hill climb r2). Tone (amber) comes from the
 *  caller; its icon takes `TILE_META_ICON` so it sits on the first line. */
export const ELSEWHERE_NOTE = "mt-0.5 flex max-w-full items-start gap-1 overflow-hidden type-caption"
export const ELSEWHERE_TEXT = "min-w-0 line-clamp-2 break-words"
/** A 12px glyph at the start of a 16px caption line. */
export const TILE_META_ICON = "mt-0.5 h-3 w-3 flex-shrink-0"

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
