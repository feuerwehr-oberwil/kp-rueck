/**
 * A «·» meta line («Stopp 1 von 4 · Pio · 3 Pers · 1 Gerät») that breaks only BETWEEN facts:
 * each fact's own spaces become non-breaking, so a figure never strands its unit on the next
 * line («1 / Gerät», hill climb r22). Render the facts with the separator kept with the
 * FOLLOWING fact – `metaFacts(parts).join(' ·\u00a0')`: the plain space before the dot is the
 * only break, so a wrapped line starts with «· 1 Gerät» and never ends on a dangling dot.
 */
export function metaFacts(parts: string[]): string[] {
  return parts.map((part) => part.replace(/ /g, '\u00a0'))
}
