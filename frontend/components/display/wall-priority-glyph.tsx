"use client"

/**
 * The priority mark before an address on BOTH walls – the wall board's card
 * (`incident-card.tsx`) and the wall status list's incident rows – so the two
 * draw one glyph (hill climb r10). The drawing is the shared `PriorityGlyph`
 * (the board card's chevron up / dash / chevron down, the shared mark colour)
 * at its `wall` geometry: 0.875rem wide (half as tall) at a 2px round stroke,
 * centred in a fixed 1rem gutter.
 *
 * The gutter is as tall as the address's FIRST line, so the mark centres on that
 * line however far the address wraps: pass the address's font size and line
 * height in em as `lineClassName` (`text-xl h-[1.15em]` for a
 * `text-xl leading-[1.15]` address).
 *
 * Usage: `<WallPriorityGlyph priority={p} lineClassName="text-xl h-[1.15em]" />`
 */

import { PriorityGlyph } from "@/components/ui/priority-glyph"
import type { Priority } from "@/lib/priority"
import { cn } from "@/lib/utils"

export function WallPriorityGlyph({ priority, lineClassName }: { priority: Priority; lineClassName: string }) {
  return (
    <span className={cn("flex w-4 shrink-0 items-center", lineClassName)}>
      <PriorityGlyph priority={priority} size="wall" />
    </span>
  )
}
