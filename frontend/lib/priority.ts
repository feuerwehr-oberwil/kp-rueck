/**
 * Single source of truth for priority visuals.
 *
 * Before this module there were 6+ parallel copies (kanban-utils, map-colors,
 * display board, mobile cards, printable map, …) that drifted: "Tief" vs
 * "Niedrig" labels, blue vs green for low, yellow vs amber for medium.
 * Priority colours carry meaning for operators — they must be identical on the
 * board, the map, the display and in print. Two of those copies survived until
 * now, in the two cards that matter most (`components/kanban/draggable-operation.tsx`
 * and `components/display/incident-card.tsx`); both import from here.
 *
 * There is one table per ROLE, never one per surface. The roles differ in what
 * they can afford to say, and `low` is where that shows:
 *
 *  · The CARD tables (`PRIORITY_EDGE_CLASSES` / `PRIORITY_CARD_CLASSES`) render
 *    `low` as the card's own border — the absence of a signal. `low` is the
 *    DEFAULT priority (`operation.priority || "low"`), so most cards are low:
 *    colouring them would paint the board, and it would paint it the same
 *    emerald that already means «frei / verfügbar» on the resource dots and
 *    «Reko» on the board column. A colour that means two things is the defect
 *    this table exists to prevent.
 *  · The MARK tables (`PRIORITY_COLORS` / `PRIORITY_DOT_CLASSES` /
 *    `PRIORITY_TEXT_CLASSES`) are used where a mark has to EXIST — a map
 *    marker, a dot in a list, the chevron in the priority picker. There `low`
 *    is emerald, because the alternative (grey) is already taken by
 *    `MAP_COLORS.offline`, i.e. "priority unknown".
 *
 * Both readings are always accompanied by a shape or a word (the chevron on a
 * card, the label in a picker), so neither relies on colour alone.
 */

import { AlertCircle, AlertTriangle, Info, type LucideIcon } from "lucide-react"

export type Priority = "high" | "medium" | "low"

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: "Hoch",
  medium: "Mittel",
  low: "Niedrig",
}

/** Semantic hex colours — used for map markers and colour-by accents. */
export const PRIORITY_COLORS: Record<Priority, string> = {
  high: "#ef4444", // red — destructive
  medium: "#f59e0b", // amber — warning
  low: "#10b981", // emerald — low urgency
}

export const PRIORITY_ICONS: Record<Priority, LucideIcon> = {
  high: AlertTriangle,
  medium: AlertCircle,
  low: Info,
}

/**
 * Tailwind classes for the small priority dot rendered on cards/lists.
 * The single source that mobile cards, the token board, the map and the
 * display board all draw from — before this, medium drifted between
 * orange/yellow/amber and low between green/emerald across views.
 */
export const PRIORITY_DOT_CLASSES: Record<Priority, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-emerald-500",
}

/** Matching text/icon tint (e.g. the up/down/flat priority chevron). */
export const PRIORITY_TEXT_CLASSES: Record<Priority, string> = {
  high: "text-red-600 dark:text-red-400",
  medium: "text-amber-600 dark:text-amber-400",
  low: "text-emerald-600 dark:text-emerald-400",
}

/**
 * The card's left edge. On EVERY surface that draws an incident as a card or a
 * row — the kanban board, the wall board, the wall status list — the left edge
 * means PRIORITY and nothing else. Status is carried by the column the card
 * sits in and by the section it is grouped under.
 *
 * The classes are semantic tokens rather than a palette step because the edge
 * is the same statement as the priority chevron next to it, which has always
 * used `destructive`/`warning`.
 *
 * `low` closes the border instead of colouring it: the 4px edge is always
 * present to keep the box from shifting, so making it transparent would punch
 * a light gap into the card's outline where the other three sides carry one.
 */
export const PRIORITY_EDGE_CLASSES: Record<Priority, string> = {
  high: "border-l-destructive",
  medium: "border-l-warning",
  low: "border-l-border",
}

/**
 * The full priority treatment of an incident CARD: the edge, plus the wash,
 * ring and pulse a high-priority card carries so it is found from across the
 * room. Dense list rows take `PRIORITY_EDGE_CLASSES` alone.
 *
 * Caution when composing with `cn()`: `priority-high-pulse` animates
 * `box-shadow` outright (globals.css), so the `ring-*` here — and any
 * `shadow-*` a caller adds — is overwritten on a high card. Selection and
 * keyboard focus therefore use `outline-*`, which is a separate property. A
 * bare `border-foreground` would twMerge away `border-l-*`; spell out the
 * three other sides instead.
 */
export const PRIORITY_CARD_CLASSES: Record<Priority, string> = {
  high: `${PRIORITY_EDGE_CLASSES.high} priority-high-pulse bg-destructive/[0.08] dark:bg-destructive/[0.12] ring-1 ring-destructive/20 dark:ring-destructive/30`,
  medium: PRIORITY_EDGE_CLASSES.medium,
  low: PRIORITY_EDGE_CLASSES.low,
}

/** Tint for the up/flat/down priority chevron on a card. Matches the edge. */
export const PRIORITY_ICON_CLASSES: Record<Priority, string> = {
  high: "text-destructive",
  medium: "text-warning-foreground",
  low: "text-muted-foreground/50",
}
