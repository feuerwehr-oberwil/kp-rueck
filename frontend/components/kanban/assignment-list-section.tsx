"use client"

import { Check, Minus, Siren, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** The tile grid of every block: three columns from `sm`, ONE below it, so a phone shows a
 *  name in full («Hoffmann Lisa», not «Hoffmann L…») and the where-note gets the width. */
export const TILE_GRID = "grid grid-cols-1 sm:grid-cols-3 gap-2"
/** Every line under a tile's name is 12/16 – a fact in plain `text-xs` muted, a note in
 *  `type-caption` (12/500; amber only where it asks for a look: where it is, a role held
 *  elsewhere on a tile that names no place, «kein Fahrer») – and the
 *  name stays 14/500, the one thing to read first. Tiles align their contents to the TOP: a grid row is as tall as
 *  its tallest tile, and centred contents put the names of one row at different heights. */
export const TILE_META = "type-caption"
/** Where an occupied resource currently is: `head` names the place (number · address, an
 *  Auftrag's name, or the generic «Im Einsatz»), `detail` the rest («Einsatzart: Meldung», may
 *  be absent), `full` everything untruncated for the hover title and the confirm copy. */
export type OccupancyLabel = { head: string; detail?: string; full: string }

/** Something a person holds besides their place – a driven vehicle, Reko, Magazin … */
export type TileRole = { label: string; Icon: LucideIcon }

/** A 12px glyph at the start of a 16px caption line. */
export const TILE_META_ICON = "mt-0.5 h-3 w-3 flex-shrink-0"

/**
 * A tile's «where is it now» note, inside two lines: line 1 the place at 12/16 600 with its
 * glyph (what the Einsatz is found by), line 2 the rest at 12/16 500 – each one line with an
 * ellipsis, the full text in `title`. One evenly weighted two-line passage ran number, address,
 * type and Meldung together (hill climb r13). Only the place is amber – it is ANOTHER
 * commitment, «schau hin»; the Meldung under it is a fact and muted, or fourteen busy tiles
 * were an amber wall (hill climb r18). Shared by the crew, vehicle and material tiles.
 *
 * `roles` (crew tiles only) are what the person holds besides – the vehicle they drive, Reko …
 * They ride on line 1 after the place, muted with their glyph («15 · Bättwilerstrasse 7 · 🚚
 * Mawa»), and never shrink: the place ellipsizes first. On lines of their own they made one busy
 * tile four lines tall, and the grid row stretched every tile beside it (hill climb r19).
 */
export function ElsewhereNote({ label, roles }: { label: OccupancyLabel; roles?: readonly TileRole[] }) {
  const title = roles?.length ? [label.full, ...roles.map(role => role.label)].join(' · ') : label.full
  return (
    <span
      title={title}
      className="mt-0.5 flex max-w-full items-start gap-1 overflow-hidden text-amber-700 dark:text-amber-400"
    >
      <Siren className={TILE_META_ICON} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-start">
          <span className="truncate text-xs font-semibold">{label.head}</span>
          {roles?.map(role => (
            <span key={role.label} className="ml-1 flex shrink-0 items-start gap-1 type-caption text-muted-foreground">
              <span aria-hidden>·</span>
              <role.Icon className={TILE_META_ICON} aria-hidden />
              {role.label}
            </span>
          ))}
        </span>
        {label.detail && <span className="block truncate type-caption text-muted-foreground">{label.detail}</span>}
      </span>
    </span>
  )
}

/**
 * The tick box at the start of every tile (person, vehicle, «Zu Fuss», material, module
 * header): a 16px square, 4px corners, 1.5px edge; ticked = `--sel` fill with a white ✓, a
 * partly ticked module the same fill with a dash. The empty edge is muted ink at 70 %, not
 * `--input`: light `--input` sits ≈1.2:1 on the card, and an empty box nobody can see reads as
 * a tile with no state; 70 % keeps it ≈3:1 (WCAG 1.4.11) and under the ✓'s weight. Drawn, not a `<Checkbox/>`: the
 * whole tile is the button, and a button may not hold another. A square because the dialog is
 * a multi-select – the hollow ring it replaced was a radio's shape and the app's «gebunden»
 * mark (hill climb r20). The tile around it keeps the selection look (wash + edge).
 * `mt-0.5` centres the box on the name's 20px line.
 */
export function TileCheck({ checked, animate }: { checked: boolean | "partial"; animate?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px]",
        checked ? "border-sel bg-sel text-primary-foreground" : "border-muted-foreground/70",
        animate && "animate-check-appear",
      )}
    >
      {checked === "partial" ? (
        <Minus className="size-3" strokeWidth={3} />
      ) : checked ? (
        <Check className="size-3" strokeWidth={3} />
      ) : null}
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
 * The label is the board's `type-label` (12/600 caps, wider tracking), not a hand-rolled
 * 11px caps line: at 11px Sora's word space rounds to 2px – narrower than the caps' own
 * letter gaps – and «Bereits im Einsatz» read «BEREITSIM EINSATZ» (hill climb r18).
 *
 * Shared by the resource assignment dialog's crew and vehicle lists and by
 * `MaterialAssignmentList`.
 */
export function ListSection({ label, tone, children }: { label: string; tone: 'free' | 'busy'; children: React.ReactNode }) {
  return (
    <section>
      <h3
        className="mb-2 flex items-center gap-2.5 type-label text-muted-foreground"
        data-tone={tone}
      >
        {label}
        <span className="h-px flex-1 bg-border/60" />
      </h3>
      {children}
    </section>
  )
}
