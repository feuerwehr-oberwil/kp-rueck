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
      className="pointer-events-none absolute -right-[7px] -top-[6px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card bg-foreground px-1 font-mono text-2xs font-bold leading-none tabular-nums text-background"
    >
      {count}
    </span>
  )
}
