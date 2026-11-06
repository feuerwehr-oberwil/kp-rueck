import { PRIORITY_COLORS } from "./priority"
import { STATUS_GROUP_BORDER_STYLE, type StatusGroup } from "./types/incidents"
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
  /** Same hue as `--info`. Used for selected/highlighted markers + GPS-online dots, and as
   *  the fill under the white ⌂ / vehicle glyphs – hence blue-600, not 500 (3.7:1 under white;
   *  600 holds 5.2:1). */
  info: "#2563eb",
  /** Tailwind gray-500 — used as the "offline / no signal" marker fill. */
  offline: "#6b7280",
} as const

/**
 * The status frame («Rahmen») around every incident dot and route stop: its DASH style carries
 * the status group (`STATUS_GROUP_BORDER_STYLE`), never a colour. One geometry per surface – the
 * markers and the legend's key both draw through `incidentPinRings`, so the key draws what the
 * map shows; the route pins' CSS outline takes `width`.
 *
 * - `width` / `desktop`: the 32px pin – a 24px priority core, a clear 2px white gap, then the
 *   shared 2px frame, its `STATUS_GROUP_BORDER_STYLE` pattern stretched to a whole number of
 *   periods so no seam (hill climb r12: on the old 24px pin a 15px core and a 2.5px halo squeezed
 *   solid / dashed / dotted into one grey ring).
 * - `phone` (≤ 767px or a coarse pointer, `COMPACT_MAP_QUERY` in lib/map-labels.ts – the same
 *   test as the label rule): a 32px pin with a 3px frame, a 2px white gap before the fill, and
 *   dash patterns laid out on the ring's circumference so dashes stand clearly apart and dots are
 *   round (hill climb r6: the thin 2px solid/dashed/dotted rings ran together in a cluster).
 *
 * `fillR = r - fillInset` is the fill circle; its white `halo` stroke is centred on that edge, so
 * the visible core is `2·fillR - halo` and the gap is `halo` wide when `fillInset = width + halo/2`.
 *
 * `color` is for frames ON the basemap (light by day, the dimmed mid grey at night – gray-700
 * reads on both). The legend sits on the card instead, where gray-700 vanished in dark mode
 * (hill climb r2): it strokes its samples with the `--muted-foreground` token.
 */
export const STATUS_RING = {
  color: "#374151",
  width: 2,
  desktop: { size: 32, highlightedSize: 36, width: 2, fillInset: 3, halo: 2 },
  phone: { size: 32, highlightedSize: 36, width: 3, fillInset: 4, halo: 2, dashes: 8, dots: 12 },
} as const

/** Outer diameter of an incident pin: at rest or selected, desktop or phone. */
export function incidentPinSize(highlighted: boolean, compact: boolean): number {
  const geometry = compact ? STATUS_RING.phone : STATUS_RING.desktop
  return highlighted ? geometry.highlightedSize : geometry.size
}

/**
 * Everything an incident pin (or its legend sample) draws, for an SVG of `size`: the fill circle
 * (`fillR`, stroked white by `halo`) and the status frame (`ringR`, `ringWidth`, dash pattern +
 * line cap). Desktop keeps the patterns of `STATUS_GROUP_BORDER_STYLE`, stretched to a whole
 * number of periods; the phone spreads `dashes` dashes or `dots` round dots evenly over the frame.
 * Either way no seam where the pattern ends.
 */
export function incidentPinRings(size: number, compact: boolean, group: StatusGroup) {
  const r = size / 2
  const geometry = compact ? STATUS_RING.phone : STATUS_RING.desktop
  const ringR = r - geometry.width / 2
  let dasharray: string = STATUS_GROUP_BORDER_STYLE[group].dasharray
  let linecap: "butt" | "round" = "butt"
  const circumference = 2 * Math.PI * ringR
  if (!compact && dasharray !== "none") {
    const [dash, gap] = dasharray.split(",").map(Number)
    const stretch = circumference / (Math.round(circumference / (dash + gap)) * (dash + gap))
    dasharray = `${(dash * stretch).toFixed(2)},${(gap * stretch).toFixed(2)}`
  }
  if (compact && group !== "active") {
    if (group === "open") {
      const period = circumference / STATUS_RING.phone.dashes
      dasharray = `${(period * 0.55).toFixed(2)},${(period * 0.45).toFixed(2)}`
    } else {
      // A near-zero dash with a round cap is a dot of the stroke's width.
      dasharray = `0.01,${(circumference / STATUS_RING.phone.dots - 0.01).toFixed(2)}`
      linecap = "round"
    }
  }
  return { r, fillR: r - geometry.fillInset, halo: geometry.halo, ringR, ringWidth: geometry.width, dasharray, linecap }
}

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
 * Hues the board does not already speak: not red (Hoch), amber (Mittel), green
 * (frei), violet (Reko) or fuchsia (Im Einsatz) – a green route read as «frei»
 * on the wall (sweep 2026-10, VISUAL-13). Blue, cyan, lime, indigo, brown, teal.
 * A route keeps the colour it was stored with; only new choices come from here.
 */
export const AUFTRAG_SWATCHES = ["#3b82f6", "#06b6d4", "#84cc16", "#6366f1", "#a16207", "#14b8a6"] as const
