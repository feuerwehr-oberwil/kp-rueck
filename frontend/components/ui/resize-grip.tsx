"use client"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ResizableWidth } from "@/lib/hooks/use-resizable-width"

/**
 * The drag edge of a resizable panel – fed by `useResizableWidth`.
 *
 * Render it as the flex sibling right where the two panes meet (before a right-hand
 * panel, after a left-hand one): it takes no width itself and lays a 24px hit strip
 * centred on the seam, so neither pane's `overflow-hidden` clips it. At rest a short
 * pill; on hover, focus and while dragging the seam turns into the selection line.
 * `label` names the separator for screen readers, `hint` is the tooltip («Breite
 * ziehen · Doppelklick: Standard»), shown on the panel's outer side.
 */
export function ResizeGrip({
  resize,
  side,
  label,
  hint,
}: {
  resize: ResizableWidth
  /** The panel edge this grip moves – the tooltip opens away from the panel. */
  side: "left" | "right"
  label: string
  hint: string
}) {
  return (
    <div className="relative z-10 w-0 shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            {...resize.gripProps}
            aria-label={label}
            data-dragging={resize.dragging || undefined}
            className="group/grip absolute inset-y-0 -left-3 flex w-6 cursor-col-resize touch-none items-center justify-center outline-none"
          >
            {/* The seam line: only while hovered, focused or dragged. */}
            <span
              aria-hidden
              className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-sel-line opacity-0 transition-opacity group-hover/grip:opacity-100 group-focus-visible/grip:opacity-100 group-data-[dragging]/grip:opacity-100"
            />
            <span
              aria-hidden
              className="h-10 w-1 rounded-full bg-muted-foreground/50 transition-colors group-hover/grip:bg-sel-line group-focus-visible/grip:bg-sel-line group-data-[dragging]/grip:bg-sel-line"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side={side}>{hint}</TooltipContent>
      </Tooltip>
    </div>
  )
}
