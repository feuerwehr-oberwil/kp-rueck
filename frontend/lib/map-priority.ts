
/**
 * The priority mark the Lagekarte draws, so priority is never colour alone (sweep hill climb r1,
 * finding 6): the board's chevron up / dash / chevron down, inside every incident marker (and its
 * legend swatch) and beside every address in the map's list.
 *
 * Lucide's 24-unit icons cannot nest legibly in a 22–24px fill, so `priorityGlyphPath` draws the
 * three shapes at marker scale; `markerGlyphInk` picks dark ink or white for the fill underneath –
 * the priority fills all take ink, a «Färben nach» colour may be dark enough to need white (the
 * glyph stays, so priority survives recolouring). The same path is the board card's, both walls'
 * and the map list's mark beside an address (`components/ui/priority-glyph.tsx`).
 */

/**
 * SVG path of the glyph centred on (cx, cy). `scale` is the marker size / 24: on the 32px pin
 * at rest the glyph is ≈11×5px, drawn with a 2px round stroke.
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
