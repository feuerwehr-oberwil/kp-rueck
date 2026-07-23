/**
 * Single source of truth for priority visuals (audit UI pass).
 *
 * Before this module there were 6+ parallel copies (kanban-utils, map-colors,
 * display board, mobile cards, printable map, …) that drifted: "Tief" vs
 * "Niedrig" labels, blue vs green for low, yellow vs amber for medium.
 * Status colours carry meaning for operators — they must be identical on the
 * board, the map, the display and in print.
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
