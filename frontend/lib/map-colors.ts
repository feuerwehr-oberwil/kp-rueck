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
 * `live` / `offline` are DEVICE state, not incident state — "is this vehicle
 * reporting?"; `ink` is every mark that is a THING rather than a state: the two
 * fixed places (firestation, Magazin), a reporting vehicle's label, its GPS trail,
 * the vehicle → Einsatz line, the priority glyph and the status frame. Blue is
 * an Auftrag's colour and nothing else on the map (sweep 17.11., COL-04 A).
 * Status and priority marker fills come from `PRIORITY_MARKER_COLORS` below
 * and `INCIDENT_TYPE_MARKER_COLORS` further down; the table used to also
 * carry `destructive` / `warning` / `success` mirrors of the semantic tokens,
 * which nothing ever consumed and which read as a palette clash against the
 * incident-type hues they duplicated.
 */

/** THE map ink (slate-800): a thing, not a state, so no hue (hill climb r18, COL-09). It
 *  holds white text (14:1) and reads on the light basemap and the dimmed night one alike. */
export const MAP_INK = "#1e293b"

/** THE «nothing here» grey: an incident with no value in the «Färben nach» dimension, a pin
 *  in no Auftrag in the pickers. One grey for one meaning (COL-09) – lighter than `offline`. */
export const MAP_NONE = "#9ca3af"

export const MAP_COLORS = {
  /** The «sendet» dot on a reporting vehicle's ink label (emerald-500 = `--free`): a live
   *  device, told by its SHAPE – a dot on the label – not by a hue on the whole pill. */
  live: "#10b981",
  /** Tailwind gray-500 — the "offline / no signal" frame of a vehicle pill. */
  offline: "#6b7280",
  /** Under the white ⌂ of the firestation and the Magazin: a PLACE, not a state. */
  station: MAP_INK,
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
 * `color` is for frames ON the basemap (light by day, the dimmed mid grey at night – the map
 * ink reads on both). The legend sits on the card instead, where gray-700 vanished in dark mode
 * (hill climb r2): it strokes its samples with the `--muted-foreground` token.
 */
export const STATUS_RING = {
  color: MAP_INK,
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
 * light slate. Mutually exclusive with `INCIDENT_TYPE_MARKER_COLORS` — a marker
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
 *
 * THE ONE EXCEPTION to the colour roles (owner, 17.11.2026, COL-11 A): these hues follow the
 * hazard and were agreed with the Kommandant before the roles, so Brand is red like Hoch,
 * Strassenrettung green like frei, Dienstleistungen violet like Reko, Strahlenwehr fuchsia like
 * Im Einsatz. Allowed because it is map-only, opt-in and always drawn with its legend
 * (docs/DESIGN.md → Colour roles).
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
 * on the wall (sweep 2026-10, VISUAL-13). Petrol, cyan, lime, indigo, brown, teal.
 * Not the saturated blue either: since XAPP-06 B that is «ausgewählt» (`--sel`),
 * so the first swatch moved from #2c72e5 to petrol for NEW Aufträge (17.11.2026).
 * Stored colours are left alone – an old blue route keeps its blue.
 *
 * Dark enough for the white stop numbers on the route pins and the Routenplanung
 * timeline (≥ 4.5:1, owner 08.11.2026 «Darker route colours»): each is
 * `darkenForWhiteText` of the lighter swatch it replaced (cyan-500, lime-500,
 * indigo-500, yellow-700, teal-500). A route keeps the colour it was stored with,
 * and those older ones are drawn through the same function.
 */
export const AUFTRAG_SWATCHES = ["#0e6680", "#008299", "#528400", "#6365f0", "#a16207", "#008578"] as const

/**
 * «Färben nach Reko / Fahrzeug» (and a route stored without a colour): a hashed hue from the
 * Auftrag family widened to ten (owner, 17.11.2026, ENT-05 B) – the six swatches, the first
 * swatch's old blue, and three more tones that speak no role: steel blue, olive, sand brown.
 * A storm evening rarely has more than ten Reko people or vehicles; every tone holds white text.
 * The table it replaced hashed into red, green, violet and pink – a Reko person came out «Hoch».
 */
export const GROUP_PALETTE = [...AUFTRAG_SWATCHES, "#2c72e5", "#4b6a88", "#6b6b1f", "#7c5a3a"] as const

/**
 * «Färben nach Reko»: the group palette WITHOUT the two near-twins of petrol (#008299 cyan,
 * #008578 teal – the three side by side read as one person, feedback 19.11.2026), in a turn
 * that never puts two alike next to each other. The Reko people of an Ereignis take these in
 * the order they became Reko (`rekoColorOrder` in lib/kanban-utils.ts): no repeat until all
 * eight are out.
 */
export const REKO_PALETTE = ["#0e6680", "#a16207", "#6365f0", "#528400", "#7c5a3a", "#2c72e5", "#6b6b1f", "#4b6a88"] as const

// --- Darker for white text ------------------------------------------------

/** WCAG AA for normal text: the stop numbers are 12–14px bold. */
const WHITE_TEXT_CONTRAST = 4.5

type Rgb = [number, number, number]

const parseHex = (hex: string): Rgb | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const digits = m[1].length === 3 ? [...m[1]].map((d) => d + d).join("") : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255)
  return [r, g, b]
}
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
/** Linear sRGB → `#rrggbb`, each channel clipped to the gamut. */
const toHex = (rgb: Rgb) =>
  `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255).toString(16).padStart(2, "0")).join("")}`

/** WCAG contrast of white text on a `#rrggbb` fill. */
export function whiteTextContrast(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 1
  const [r, g, b] = rgb.map(toLinear)
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05)
}

// OKLab ↔ linear sRGB (Björn Ottosson's matrices).
function linearToOklch([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, bb), Math.atan2(bb, a)]
}
function oklchToLinear(lightness: number, chroma: number, hue: number): Rgb {
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
const inGamut = (rgb: Rgb) => rgb.every((c) => c >= -1e-6 && c <= 1 + 1e-6)

/** The colour at this OKLCH lightness with the hue kept – chroma cut only where sRGB ends. */
function atLightness(lightness: number, chroma: number, hue: number): string {
  let fits = oklchToLinear(lightness, chroma, hue)
  if (!inGamut(fits)) {
    let [lo, hi] = [0, chroma]
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear(lightness, mid, hue))) lo = mid
      else hi = mid
    }
    fits = oklchToLinear(lightness, lo, hue)
  }
  return toHex(fits)
}

const darkened = new Map<string, string>()

/**
 * A route colour white text reads on (≥ 4.5:1): the colour itself when it already does,
 * otherwise the same hue lowered in OKLCH lightness just far enough. Every route colour on
 * screen goes through it – where a stored colour enters the client (`groups-context`,
 * `viewer-data`) and the hashed fallback in `colorAccent` – so the line, the numbered pins,
 * the timeline nodes and the board's accents all draw the one colour. Anything not `#rgb` /
 * `#rrggbb` comes back as it is.
 */
export function darkenForWhiteText(color: string): string {
  const cached = darkened.get(color)
  if (cached) return cached
  const rgb = parseHex(color)
  let result = color
  if (rgb && whiteTextContrast(color) < WHITE_TEXT_CONTRAST) {
    const [lightness, chroma, hue] = linearToOklch([toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])])
    // The lightest step that holds 4.5:1 – measured on the rounded hex, which is what is drawn.
    let [lo, hi] = [0, lightness]
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (whiteTextContrast(atLightness(mid, chroma, hue)) >= WHITE_TEXT_CONTRAST) lo = mid
      else hi = mid
    }
    result = atLightness(lo, chroma, hue)
  }
  darkened.set(color, result)
  return result
}
