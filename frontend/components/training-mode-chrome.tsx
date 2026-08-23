import { AlertTriangle } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * One treatment for «dieses Ereignis ist eine Übung», shared by every surface
 * that has window chrome of its own — the board header, the wall display and the
 * Übungs-Steuerung. An Ereignis is a drill or the real thing *as a whole*, so the
 * mode belongs on the frame; single cards, list rows and map pins carry no
 * training marker.
 *
 * `TrainingBand` is the 3px warning strip along the top edge. It is chrome, not
 * content, so it never competes with the priority colours inside the board — and
 * it is deliberately never animated and never dismissible: a two-hour drill would
 * train away anything that blinks or can be clicked shut.
 *
 * It is FIXED to the top of the viewport and takes NO layout height. In flow it
 * only pushed down the siblings of whichever surface rendered it: with the
 * Benachrichtigungen sidebar open, the board header sat 3px below the sidebar
 * header beside it, because that panel is a flex sibling of <main> and never saw
 * the strip. Out of flow there is nothing to push out of alignment, at any
 * viewport width, and the strip lies over sidebars and overlays instead of
 * beside them. `z-[90]` is above every panel and dialog but below the 2px
 * top-loading bar (`z-[100]`), which would otherwise be invisible underneath it.
 *
 * `TrainingBadge` is the word beside the Ereignis name. Colour alone must not
 * carry the meaning, so the triangle and the word travel with it. The label comes
 * from the caller because every surface already holds that string in its own
 * message namespace.
 */
export function TrainingBand({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none fixed inset-x-0 top-0 z-[90] h-[3px] bg-warning", className)}
    />
  )
}

export function TrainingBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning-foreground",
        className,
      )}
    >
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  )
}
