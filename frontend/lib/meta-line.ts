/**
 * A card's meta line – facts in a row, «Stopp 1 von 4 · Pio · 1 Gerät».
 *
 * Such a line wraps on a narrow card, and it used to wrap at any space, so a
 * figure could end one line and its unit start the next («1 / Gerät»). Here
 * every fact is ONE unbreakable run (its spaces become no-break spaces) and
 * the facts join with « · », breakable only BEFORE the «·»: when the line
 * wraps, the separator goes down with the fact it introduces, never dangles at
 * a line's end. A fact longer than the whole line still breaks by the
 * element's own `overflow-wrap` – that is the caller's last resort, not ours.
 *
 * Plain text in, plain text out, so the same line serves a rendered row and a
 * `title`. Falsy parts drop out, so optional facts can be written inline:
 *
 *   metaFacts([t("card.auftragStopLine", { pos, total }), vehicleNames, materials > 0 && t(…)])
 *
 * One fact alone is just that fact, glued: `metaFacts([t("card.persCount", { count })])`.
 */

const NO_BREAK_SPACE = " "

/** Breakable space, then «·» glued to the fact after it. */
const SEPARATOR = ` ·${NO_BREAK_SPACE}`

export function metaFacts(parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .map((fact) => fact.replace(/\s+/g, NO_BREAK_SPACE))
    .join(SEPARATOR)
}
