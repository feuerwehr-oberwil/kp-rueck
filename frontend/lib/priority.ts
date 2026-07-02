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
  low: "#22c55e", // green — low urgency
}

export const PRIORITY_ICONS: Record<Priority, LucideIcon> = {
  high: AlertTriangle,
  medium: AlertCircle,
  low: Info,
}
