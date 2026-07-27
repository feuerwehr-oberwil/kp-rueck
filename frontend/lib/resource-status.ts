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

/**
 * A person's availability as the board must READ it, not as the API happens to store it.
 *
 * A Reko is an Auftrag: that person is out looking at something and cannot be sent anywhere else.
 * It is not an incident assignment though, so it never sets `status: "assigned"` — which left
 * five people on Reko drawn emerald and counted in «7 verfügbar» while all five were out.
 * The header number is the one thing a Kommandant reads off this board, so it has to mean what
 * it says.
 *
 * Deliberately NOT folded into `toResourceState`: that one normalizes an API status string and is
 * shared with vehicles and material, which have no Reko.
 */
export function personResourceState(
  p: { status?: string | null; isReko?: boolean },
): ResourceState {
  const base = toResourceState(p.status)
  return base === "available" && p.isReko ? "assigned" : base
}

/**
 * A material's availability as the board must READ it.
 *
 * Consumables (Ölbindemittel, Schaummittel, Bindevlies …) are stocked, not lent out: handing some
 * to an incident does not make the depot empty, and nobody waits for them to come back. They are
 * flagged `consumable` in the Materialverwaltung, and the assignment picker has always let them
 * be assigned regardless of status — only the Status-Tafel still painted them amber and counted
 * them as gone, which reads as «wir haben kein Ölbindemittel mehr».
 *
 * Non-consumables are unchanged: one Tauchpumpe assigned is one Tauchpumpe away.
 */
export function materialResourceState(
  m: { status?: string | null; consumable?: boolean },
): ResourceState {
  if (m.consumable) return "available"
  return toResourceState(m.status)
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
