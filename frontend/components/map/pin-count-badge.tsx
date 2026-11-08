/** The badge: 18px tall, standing 7px beyond the pin's right edge and 6px above its top. */
const BADGE_SIZE = 18
const BADGE_OUT_RIGHT = 7
const BADGE_OUT_TOP = 6

/**
 * Where the badge lies relative to the centre of a `pinSize` pin (px, y down) – for the overlap
 * bubbles (`clusterPins`' `badge`), so a neighbour that would cover the count joins instead.
 */
export function pinBadgeCircle(pinSize: number) {
  return {
    dx: pinSize / 2 + BADGE_OUT_RIGHT - BADGE_SIZE / 2,
    dy: -(pinSize / 2 + BADGE_OUT_TOP - BADGE_SIZE / 2),
    size: BADGE_SIZE,
  }
}

/**
 * The count on a same-address pin (`lib/map-spots.ts`, owner pick 3B): «3» in a small ink pill at
 * the pin's top-right, ringed in the card colour so it stands off the basemap and the pin alike.
 * Set inside a `relative` box the size of the pin – the map's `SpotMarker` and the legend's key.
 * Ink, not a priority colour: the pin under it already says how urgent; this only says how many.
 */
export function PinCountBadge({ count }: { count: number }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute flex items-center justify-center rounded-full border-2 border-card bg-foreground px-1 font-mono text-2xs font-bold leading-none tabular-nums text-background"
      style={{ right: -BADGE_OUT_RIGHT, top: -BADGE_OUT_TOP, height: BADGE_SIZE, minWidth: BADGE_SIZE }}
    >
      {count}
    </span>
  )
}
