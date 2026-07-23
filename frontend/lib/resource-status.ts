/**
 * Single source of truth for resource availability colours (audit UI pass).
 *
 * Personnel, vehicles and materials share one three-state availability model:
 * free, in-use, or out. Before this module the "in use / assigned" state drew
 * as orange on the display board but amber in the mobile sheets, and every
 * view hand-rolled its own emerald/amber/orange class strings. Assigned =
 * amber, available = emerald, everywhere.
 */

export type ResourceState = "available" | "assigned" | "unavailable" | "maintenance"

/** Normalize the raw personnel/vehicle/material status strings the API sends
 *  (available | assigned | planned | unavailable | maintenance) onto the
 *  shared state. Anything unknown degrades to "unavailable". */
export function toResourceState(status: string | null | undefined): ResourceState {
  switch (status) {
    case "available":
      return "available"
    case "assigned":
    case "planned":
      return "assigned"
    case "maintenance":
      return "maintenance"
    default:
      return "unavailable"
  }
}

/** Dot / swatch fill for a resource's availability. */
export const RESOURCE_STATE_DOT_CLASSES: Record<ResourceState, string> = {
  available: "bg-emerald-500",
  assigned: "bg-amber-500",
  unavailable: "bg-muted-foreground/40",
  maintenance: "bg-muted-foreground/40",
}

/** Outline-badge tint (text + border) for the same states. */
export const RESOURCE_STATE_BADGE_CLASSES: Record<ResourceState, string> = {
  available: "text-emerald-700 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800/50",
  assigned: "text-amber-700 border-amber-200 dark:text-amber-400 dark:border-amber-800/50",
  unavailable: "text-muted-foreground border-border",
  maintenance: "text-muted-foreground border-border",
}
