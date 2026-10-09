"use client"

import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"

/**
 * An Einsatz's number within its Ereignis («14») — what ⌘K takes and the radio
 * says. One look everywhere it stands before an address (board card, wall
 * display, detail header, Lagekarte label): quiet mono, so the address stays
 * the heading. Renders nothing for an Einsatz without one (optimistic card,
 * older backend). Plain-text places use `getIncidentRefLabel`, which prefixes it.
 */
export function IncidentNumber({ number, className }: { number?: number | null; className?: string }) {
  const t = useTranslations("kanban.card")
  if (number == null) return null
  return (
    <span
      className={cn("font-mono font-medium tabular-nums text-muted-foreground", className)}
      title={t("numberTitle", { number })}
    >
      {number}
    </span>
  )
}
