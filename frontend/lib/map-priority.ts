import { ChevronDown, ChevronUp, Minus, type LucideIcon } from "lucide-react"
import type { Priority } from "./priority"

/**
 * The priority mark the Lagekarte draws, so priority is never colour alone (sweep hill climb r1,
 * finding 6): the board's chevron up / dash / chevron down, inside every incident marker (and its
 * legend swatch) and beside every address in the map's list.
 *
 * `PRIORITY_LIST_ICONS` is the board card's set (`draggable-operation.tsx`), tinted with
 * `PRIORITY_TEXT_CLASSES`. The marker cannot nest lucide's 24-unit icon legibly in a 15px fill,
 * so `priorityGlyphPath` redraws the same three shapes at marker scale; `markerGlyphInk` picks
 * dark ink or white for the fill underneath – the priority fills all take ink, a «Färben nach»
 * colour may be dark enough to need white (the glyph stays, so priority survives recolouring).
 * Both walls draw their mark before an address with the same path, larger
 * (`components/display/wall-priority-glyph.tsx`).
 */

export const PRIORITY_LIST_ICONS: Record<Priority, LucideIcon> = {
  high: ChevronUp,
  medium: Minus,
  low: ChevronDown,
}

/**
 * SVG path of the glyph centred on (cx, cy). `scale` is the marker size / 24: at rest the glyph
 * is 8×4px, drawn with a 2px round stroke.
 */
export function priorityGlyphPath(priority: string | null | undefined, cx: number, cy: number, scale = 1): string {
  const w = 4 * scale
  const h = 2 * scale
  if (priority === "high") return `M${cx - w} ${cy + h}L${cx} ${cy - h}L${cx + w} ${cy + h}`
  if (priority === "medium") return `M${cx - w} ${cy}L${cx + w} ${cy}`
  return `M${cx - w} ${cy - h}L${cx} ${cy + h}L${cx + w} ${cy - h}`
}

const INK = "#111827" // gray-900

/** Relative luminance (WCAG) of a `#rrggbb` / `#rgb` colour; anything else counts as mid-grey. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0.2
  const digits = m[1].length === 3 ? [...m[1]].map((d) => d + d).join("") : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(digits.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Glyph colour on a marker fill: whichever of ink and white contrasts more with it. */
export function markerGlyphInk(fill: string): string {
  const l = luminance(fill)
  const onInk = (l + 0.05) / (luminance(INK) + 0.05)
  const onWhite = 1.05 / (l + 0.05)
  return onInk >= onWhite ? INK : "#ffffff"
}
