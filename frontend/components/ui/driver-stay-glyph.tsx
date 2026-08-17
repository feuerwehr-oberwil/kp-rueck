"use client"

/**
 * DriverStayGlyph — «bleibt der Fahrer beim Fahrzeug, oder fährt er zurück?»
 *
 * One vehicle chip's driver-stay STATE on every surface that only *shows* it:
 * the wall display and the phone's detail sheet. The click that toggles it is a
 * control and stays with whoever owns it — the kanban card and the side panel
 * draw their own, because a button on a red chip is not the same object as a
 * label on a grey one.
 *
 * **A word, not a pictogram.** This used to be a bare 12px MapPin against a
 * bare 12px Undo2 at 40 % opacity, and the two states were told apart by
 * whoever already knew to look. Reading a board is not a memory game: both
 * states are now written out in full — «bleibt vor Ort» / «fährt zurück» — and
 * the one that costs something (a vehicle parked and blocked in at an address)
 * carries the amber the board uses everywhere else for exactly that. Short
 * forms exist for the two surfaces where the chip is also a button and space is
 * the constraint; a screen that can only be read gets the whole sentence.
 *
 * `undefined` still renders nothing: an absent assignment flag is not the same
 * statement as "he is coming back", and the wall and the board used to disagree
 * about that.
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

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-2xs font-semibold leading-4 whitespace-nowrap",
        stays
          ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
          : "bg-muted-foreground/15 text-muted-foreground",
        className,
      )}
    >
      {stays ? <MapPin className="h-3 w-3 shrink-0" /> : <Undo2 className="h-3 w-3 shrink-0" />}
      {t(stays ? "driverStaysFull" : "driverReturnsFull")}
    </span>
  )
}
