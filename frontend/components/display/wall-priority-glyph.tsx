"use client"

/**
 * The priority mark before an address on BOTH walls – the wall board's card
 * (`incident-card.tsx`) and the wall status list's incident rows – so the two
 * draw one glyph (hill climb r10). The shape is the board card's chevron up /
 * dash / chevron down, drawn by the Lagekarte marker's `priorityGlyphPath`
 * and tinted like the card's edge (`PRIORITY_ICON_CLASSES`: Hoch red, Niedrig
 * the light slate grey mark).
 *
 * Geometry: a fixed 1rem gutter, the mark 0.875rem wide (half as tall) at a
 * 2px round stroke. Lucide's chevron fills only half of its 24-unit box, so at
 * 16px it drew an 8px mark at a 1.3px stroke – small and light from 4 m. The
 * gutter is as tall as the address's FIRST line, so the mark centres on that
 * line however far the address wraps: pass the address's font size and line
 * height in em as `lineClassName` (`text-xl h-[1.15em]` for a
 * `text-xl leading-[1.15]` address). Rem throughout, so the board's live root
 * size scales it too.
 *
 * Usage: `<WallPriorityGlyph priority={p} lineClassName="text-xl h-[1.15em]" />`
 */

import { useTranslations } from "next-intl"

import { priorityGlyphPath } from "@/lib/map-priority"
import { PRIORITY_ICON_CLASSES, type Priority } from "@/lib/priority"
import { cn } from "@/lib/utils"

/** The glyph's accessible name, per priority (`kanban.card.*`). */
const PRIORITY_ARIA = {
  high: "priorityHighAria",
  medium: "priorityMediumAria",
  low: "priorityLowAria",
} as const satisfies Record<Priority, string>

export function WallPriorityGlyph({ priority, lineClassName }: { priority: Priority; lineClassName: string }) {
  const t = useTranslations("kanban.card")
  return (
    <span className={cn("flex w-4 shrink-0 items-center", lineClassName)}>
      {/* 16-unit box = the 1rem gutter: a 14×7 mark centred, its 2-unit round
          stroke reaching exactly to the edges. */}
      <svg
        viewBox="0 0 16 16"
        role="img"
        aria-label={t(PRIORITY_ARIA[priority])}
        className={cn("h-4 w-4", PRIORITY_ICON_CLASSES[priority])}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={priorityGlyphPath(priority, 8, 8, 1.75)} />
      </svg>
    </span>
  )
}
