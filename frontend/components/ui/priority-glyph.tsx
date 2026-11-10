"use client"

/**
 * The priority mark of an incident card – chevron up / dash / chevron down,
 * drawn by the Lagekarte marker's `priorityGlyphPath` in a 1rem box and tinted
 * with the shared MARK colour (`PRIORITY_ICON_CLASSES`: Hoch red, Mittel amber,
 * Niedrig the light slate grey mark at full strength). One drawing for the
 * board card and both walls, so a Niedrig card never reads like a faint
 * disclosure chevron (hill climb r17).
 *
 * `size` is the surface's geometry: `card` = a 12px-wide mark at a 1.75px
 * stroke (desk board, beside a 16px address), `wall` = 14px at 2px for 4 m
 * (round 10). Lucide's chevron fills only half of its 24-unit box, which is why
 * neither surface uses it. Rem throughout, so the wall's live root size scales
 * it too.
 *
 * Usage: `<PriorityGlyph priority={p} size="card" />`
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

/** Mark width = 8 × scale units of the 16-unit box; stroke in the same units. */
const GEOMETRY = {
  card: { scale: 1.5, stroke: 1.75 },
  wall: { scale: 1.75, stroke: 2 },
} as const satisfies Record<string, { scale: number; stroke: number }>

export function PriorityGlyph({
  priority,
  size,
  className,
}: {
  priority: Priority
  size: keyof typeof GEOMETRY
  className?: string
}) {
  const t = useTranslations("kanban.card")
  const { scale, stroke } = GEOMETRY[size]
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={t(PRIORITY_ARIA[priority])}
      className={cn("h-4 w-4 shrink-0", PRIORITY_ICON_CLASSES[priority], className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={priorityGlyphPath(priority, 8, 8, scale)} />
    </svg>
  )
}
