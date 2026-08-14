"use client"

/**
 * DriverStayGlyph — «bleibt der Fahrer beim Fahrzeug, oder fährt er zurück?»
 *
 * One vehicle chip's driver-stay STATE, as the board has always drawn it:
 * a MapPin for a driver who stays at the address, a dimmer Undo2 for one who
 * takes the vehicle back. The click that toggles it is a control and stays
 * with whoever owns it (the kanban card wraps this in a button); the glyph
 * itself is information and belongs on every surface that shows a vehicle —
 * the board, the wall display and the phone's detail sheet.
 *
 * It exists because that glyph pair had been hand-rolled per surface, and
 * hand-rolled renderings in this codebase drift: the wall and the board
 * already disagreed on whether an *unknown* stay renders as «zurück»
 * (board) or as nothing at all (wall). Nothing is the honest answer — an
 * absent assignment flag is not the same statement as "he is coming back" —
 * so that is what this does, and `undefined` renders nothing.
 *
 * `className` is for size only, and most callers need none: inside a Badge the
 * chip's own `[&>svg]:size-3` already governs, which is the 12px the board and
 * the wall draw.
 */

import { useTranslations } from "next-intl"
import { MapPin, Undo2 } from "lucide-react"

import { cn } from "@/lib/utils"

export function DriverStayGlyph({
  stays,
  className,
}: {
  /** `undefined` when the assignment carries no answer — draws nothing. */
  stays: boolean | undefined
  className?: string
}) {
  const t = useTranslations("kanban.common")

  if (stays === undefined) return null

  // Two brightnesses, one hierarchy: a driver who STAYS is the fact worth
  // spotting on a full board (his vehicle is parked and blocked in), so it
  // gets the stronger glyph. «Fährt zurück» is the default state of the world.
  return stays ? (
    <MapPin
      className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/70", className)}
      aria-label={t("driverStays")}
    />
  ) : (
    <Undo2
      className={cn("h-3 w-3 flex-shrink-0 text-muted-foreground/40", className)}
      aria-label={t("driverReturns")}
    />
  )
}
