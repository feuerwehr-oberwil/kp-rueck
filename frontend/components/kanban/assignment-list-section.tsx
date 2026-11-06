"use client"

import { Siren } from "lucide-react"
import { cn } from "@/lib/utils"

/** The tile grid of every block: three columns from `sm`, ONE below it, so a phone shows a
 *  name in full («Hoffmann Lisa», not «Hoffmann L…») and the where-note gets the width. */
export const TILE_GRID = "grid grid-cols-1 sm:grid-cols-3 gap-2"
/** Every line under a tile's name is 12/16 – a fact in plain `text-xs` muted, a note that asks
 *  for a look (amber: where it is, a function, «kein Fahrer») in `type-caption` (12/500) – and the
 *  name stays 14/500, the one thing to read first. Tiles align their contents to the TOP: a grid row is as tall as
 *  its tallest tile, and centred contents put the names of one row at different heights. */
export const TILE_META = "type-caption"
/** Where an occupied resource currently is: `head` names the place (number · address, an
 *  Auftrag's name, or the generic «Im Einsatz»), `detail` the rest («Einsatzart: Meldung», may
 *  be absent), `full` everything untruncated for the hover title and the confirm copy. */
export type OccupancyLabel = { head: string; detail?: string; full: string }

/** A 12px glyph at the start of a 16px caption line. */
export const TILE_META_ICON = "mt-0.5 h-3 w-3 flex-shrink-0"

/**
 * A tile's amber «where is it now» note, inside two lines: line 1 the place at 12/16 600 (what
 * the Einsatz is found by), line 2 the rest at 12/500 – each one line with an ellipsis, the full
 * text in `title`. One evenly weighted two-line passage ran number, address, type and Meldung
 * together (hill climb r13). Amber because it is ANOTHER commitment; shared by the crew, vehicle
 * and material tiles.
 */
export function ElsewhereNote({ label }: { label: OccupancyLabel }) {
  return (
    <span
      title={label.full}
      className="mt-0.5 flex max-w-full items-start gap-1 overflow-hidden text-amber-700 dark:text-amber-400"
    >
      <Siren className={TILE_META_ICON} />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{label.head}</span>
        {label.detail && <span className="block truncate type-caption">{label.detail}</span>}
      </span>
    </span>
  )
}

/** An UNCHECKED tile under the pointer: the neutral edge and a quiet wash – no lift, no
 *  shadow, no slate, so a hover never competes with the checked tiles' slate wash + edge + ✓
 *  (hill climb r5). Only on unchecked tiles: a `hover:` edge on a checked one would take its
 *  slate edge away while the pointer rests on it. */
export const TILE_HOVER = "hover:border-border hover:bg-muted/40"

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
