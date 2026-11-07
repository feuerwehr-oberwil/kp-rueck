"use client"

import { Fragment } from "react"
import { Check, Minus, Siren, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** The tile grid of every block: three columns from `sm`, ONE below it, so a phone shows a
 *  name in full («Hoffmann Lisa», not «Hoffmann L…») and the where-note gets the width. */
export const TILE_GRID = "grid grid-cols-1 sm:grid-cols-3 gap-2"
/** Every line under a tile's name is 12/16 – a fact in plain `text-xs` muted, a note in
 *  `type-caption` (12/500; amber only where it asks for a look: where it is – another
 *  commitment – and «kein Fahrer») – and the name stays 14/500, the one thing to read first.
 *  Tiles align their contents to the TOP: a grid row is as tall as its tallest tile, and
 *  centred contents put the names of one row at different heights. */
export const TILE_META = "type-caption"
/** Where an occupied resource currently is: `head` names the place (number · address, an
 *  Auftrag's name, or the generic «Im Einsatz»), `detail` the rest («Einsatzart: Meldung», may
 *  be absent), `full` everything untruncated for the hover title and the confirm copy.
 *  `swatch` is set (the Auftrag's colour, null when it has none) only when the place IS an
 *  Auftrag – the note then leads with its colour dot instead of the Einsatz glyph. */
export type OccupancyLabel = { head: string; detail?: string; full: string; swatch?: string | null }

/** Something a person holds besides their place – a driven vehicle, Reko, Magazin … */
export type TileRole = { label: string; Icon: LucideIcon }

/** A 12px glyph at the start of a 16px caption line. */
export const TILE_META_ICON = "mt-0.5 h-3 w-3 flex-shrink-0"

/** The glyph a where-note leads with: an Auftrag's colour dot (a route colour is never text –
 *  a dot beside neutral text), else `Icon` (the Einsatz siren unless a role names the place). */
function WhereGlyph({ label, Icon = Siren }: { label: OccupancyLabel; Icon?: LucideIcon }) {
  if (label.swatch !== undefined) {
    return (
      <span
        aria-hidden
        className="mt-1 size-2 shrink-0 rounded-full border border-black/10"
        style={{ backgroundColor: label.swatch ?? "var(--muted-foreground)" }}
      />
    )
  }
  return <Icon className={TILE_META_ICON} aria-hidden />
}

/**
 * A vehicle or material tile's «where is it now» note, inside two lines: line 1 the place at
 * 12/16 600 with its glyph (what the Einsatz is found by), line 2 the rest at 12/16 500 – each
 * one line with an ellipsis, the full text in `title`. Only the place is amber – it is ANOTHER
 * commitment, «schau hin»; the Meldung under it is a fact and muted (hill climb r13/r18).
 * Person tiles say it on their one line instead (`PersonTileLine`).
 */
export function ElsewhereNote({ label }: { label: OccupancyLabel }) {
  return (
    <span
      title={label.full}
      className="mt-0.5 flex max-w-full items-start gap-1 overflow-hidden text-amber-700 dark:text-amber-400"
    >
      <WhereGlyph label={label} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{label.head}</span>
        {label.detail && <span className="block truncate type-caption text-muted-foreground">{label.detail}</span>}
      </span>
    </span>
  )
}

/** Where a person is besides here: a binding (Einsatz / Auftrag) or a role that IS a place
 *  (Reko, Magazin …) – then `Icon` is that role's glyph. */
export type PersonWhere = OccupancyLabel & { Icon?: LucideIcon }

/**
 * The ONE line under every person tile's name (hill climb r23 – the final rule; r13/r19/r20/r22
 * moved these lines around): rank (muted) · where (amber, its glyph) · roles (muted, their
 * glyph – the driven vehicle last). One 12/16 line, a fixed 16px tall even when empty, so every
 * person tile is the same height and the grid has no ragged rows. The where part ellipsizes
 * first, the roles never shrink; the full text – the Meldung included, which no longer gets a
 * line of its own – is in `title`. Amber marks only the where part: it is ANOTHER commitment,
 * «schau hin»; rank and roles are facts.
 */
export function PersonTileLine({ rank, where, roles }: { rank?: string; where: PersonWhere | null; roles: readonly TileRole[] }) {
  const title = [rank, where?.full, ...roles.map(role => role.label)].filter(Boolean).join(" · ")
  const segments: { key: string; className: string; content: React.ReactNode }[] = []
  if (rank) segments.push({ key: "rank", className: "min-w-[3ch] truncate", content: rank })
  if (where) {
    segments.push({
      key: "where",
      className: "flex min-w-0 items-start gap-1 type-caption text-amber-700 dark:text-amber-400",
      content: <><WhereGlyph label={where} Icon={where.Icon} /><span className="truncate">{where.head}</span></>,
    })
  }
  for (const role of roles) {
    segments.push({
      key: role.label,
      className: "flex shrink-0 items-start gap-1",
      content: <><role.Icon className={TILE_META_ICON} aria-hidden />{role.label}</>,
    })
  }
  return (
    <p
      title={title || undefined}
      className="mt-0.5 flex h-4 max-w-full items-start overflow-hidden whitespace-nowrap text-xs text-muted-foreground"
    >
      {segments.map((segment, i) => (
        <Fragment key={segment.key}>
          {i > 0 && <span aria-hidden className="mx-1 shrink-0">·</span>}
          <span className={segment.className}>{segment.content}</span>
        </Fragment>
      ))}
    </p>
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
