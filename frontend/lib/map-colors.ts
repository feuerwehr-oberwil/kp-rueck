import { PRIORITY_COLORS } from "./priority"
/**
 * Named map-marker colors.
 *
 * Markers, hover bubbles and GL paint properties all take literal colors:
 * a MapLibre `line-color` is a style value, not a stylesheet, and the DOM
 * markers draw inline SVG outside the app's themed tree. Rather than
 * scatter raw hex values across half a dozen files, we keep them here and
 * reference by name.
 *
 * These two are DEVICE state, not incident state — "is this vehicle
 * reporting?" — which is why they are the only named colours left here.
 * Status and priority marker fills come from `PRIORITY_MARKER_COLORS` below
 * and `INCIDENT_TYPE_MARKER_COLORS` further down; the table used to also
 * carry `destructive` / `warning` / `success` mirrors of the semantic tokens,
 * which nothing ever consumed and which read as a palette clash against the
 * incident-type hues they duplicated.
 */

export const MAP_COLORS = {
  /** Same hue as `--info`. Used for selected/highlighted markers + GPS-online dots. */
  info: "#3b82f6",
  /** Tailwind gray-500 — used as the "offline / no signal" marker fill. */
  offline: "#6b7280",
} as const

/**
 * Map from incident priority → marker fill color. Re-exported from
 * `lib/priority.ts` rather than restated, so the board, the display wall, the
 * print view and the map cannot drift: high = red, medium = amber, low =
 * emerald. Mutually exclusive with `INCIDENT_TYPE_MARKER_COLORS` — a marker
 * is filled by priority or by Einsatzart, never by both, and the legend says
 * which is active.
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

/**
 * The colours an operator can give an Auftrag (route) – the swatch row in the
 * Aufträge sheet, the Routenplanung panel and the Auftrag templates. A new
 * route takes the next one in turn.
 *
 * Hues the board does not already speak: the old row was red (= Hoch), amber
 * (= Mittel), emerald (= frei / Niedrig, byte-identical) and blue (= Disponiert),
 * so a green route read as «frei» on the wall (sweep 2026-10, VISUAL-13).
 * Violet, pink, cyan, lime, indigo, brown. A route keeps the colour it was
 * stored with; only new choices come from here.
 */
export const AUFTRAG_SWATCHES = ["#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#6366f1", "#a16207"] as const
