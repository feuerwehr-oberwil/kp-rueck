"use client"

import type { ComponentType } from "react"
import { useLocale } from "next-intl"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** From which rail width the exit button shows its word beside the ✕: the header's icon,
 *  title, gaps and «✕ Beenden» side by side, measured per language (the French title is
 *  half as long again). Static class names, so Tailwind sees them. */
const EXIT_LABEL_ROOM: Record<string, string> = {
  de: "@min-[19.5rem]/rail:inline",
  fr: "@min-[24.5rem]/rail:inline",
}

/**
 * Header of a /map rail mode (Routenplanung, Reko-Modus): icon, title and the exit, with
 * the rule under it. Both modes use it, so switching between them moves neither the header
 * nor the picker row below it (VIS.13).
 *
 * The exit never wraps. Where the rail (`@container/rail`, the map page) has the room it
 * reads «✕ <exit>»; narrower it is the ✕ alone, named `exitLabel` – the same words as its
 * tooltip. It used to wrap under the title in a narrow rail. The longer French title takes
 * a second line in the narrowest rails instead.
 */
export function RailHeader({
  icon: Icon,
  title,
  exit,
  exitLabel = exit,
  onExit,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  /** The word beside the ✕ («Beenden»). */
  exit: string
  /** Accessible name and tooltip of the exit («Routenplanung beenden»); default `exit`. */
  exitLabel?: string
  onExit: () => void
}) {
  const locale = useLocale()
  return (
    <div className="mb-4 flex items-center justify-between gap-2 border-b pb-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 break-words text-lg font-bold">{title}</h2>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 shrink-0 gap-1.5 px-2 max-md:h-11 max-md:min-w-11"
            onClick={onExit}
            aria-label={exitLabel}
          >
            <X className="size-3.5" />
            <span className={cn("hidden", EXIT_LABEL_ROOM[locale] ?? EXIT_LABEL_ROOM.de)}>{exit}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{exitLabel}</TooltipContent>
      </Tooltip>
    </div>
  )
}
