import { PRIORITY_COLORS } from "./priority"
/**
 * Named map-marker colors.
 *
 * Markers, hover bubbles and GL paint properties all take literal colors:
 * a MapLibre `line-color` is a style value, not a stylesheet, and the DOM
 * markers draw inline SVG outside the app's themed tree. Rather than
 * scatter raw hex values across half a dozen files, we keep them here and
 * reference by name. The values mirror the semantic tokens in app/globals.css
 * (`--destructive`, `--warning`, `--success`, `--info`); if those tokens
 * ever change, change these too.
 */

export const MAP_COLORS = {
  /** Same hue as `--destructive`. */
  destructive: "#ef4444",
  /** Same hue as `--warning`. */
  warning: "#eab308",
  /** Same hue as `--success`. */
  success: "#22c55e",
  /** Same hue as `--info`. Used for selected/highlighted markers + GPS-online dots. */
  info: "#3b82f6",
  /** Tailwind gray-500 — used as the "offline / no signal" marker fill. */
  offline: "#6b7280",
} as const

/**
 * Map from incident priority → marker fill color. Mirrors the priority
 * styling we use across the kanban/display board (high=red, medium=yellow,
 * low=green).
 */
export const PRIORITY_MARKER_COLORS: Record<"high" | "medium" | "low", string> = PRIORITY_COLORS

/**
 * Incident type → marker fill. An explicit table, because the alternative was a HASH of the
 * type name: every colour was accidental, which is how «Ölwehr» came out green and collided
 * with a route's green on the same map.
 *
 * The hue tracks the HAZARD, not the paperwork. Confirmed with the Kommandant 2026-07-27:
 *   · BMA / Unechte Alarme is a second, darker red — a fire alarm is a fire until proven
 *     otherwise, so it must not read as «ignore me», but it must be tellable apart from a
 *     confirmed Brandbekämpfung at a glance.
 *   · Strassenrettung green, Dienstleistungen violet.
 *
 * Only used when «Färben nach → Einsatzart» is chosen; priority stays the default colouring.
 */
export const INCIDENT_TYPE_MARKER_COLORS: Record<string, string> = {
  brandbekaempfung: "#ef4444",        // red-500
  bma_unechte_alarme: "#991b1b",      // red-800 — same family, clearly darker
  elementarereignis: "#3b82f6",       // blue-500
  oelwehr: "#f97316",                 // orange-500
  chemiewehr: "#eab308",              // yellow-500
  strahlenwehr: "#d946ef",            // fuchsia-500
  strassenrettung: "#22c55e",         // green-500
  technische_hilfeleistung: "#14b8a6",// teal-500
  einsatz_bahnanlagen: "#92400e",     // amber-800 — brown
  dienstleistungen: "#8b5cf6",        // violet-500
  diverse_einsaetze: "#64748b",       // slate-500
  // WinFAP statistics categories rather than dispatch types; they should not draw the eye.
  gerettete_menschen: "#64748b",
  gerettete_tiere: "#64748b",
}
