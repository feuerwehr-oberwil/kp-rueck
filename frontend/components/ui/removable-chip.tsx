"use client"

import { type ComponentProps, type ReactNode } from "react"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface RemovableChipProps {
  children: ReactNode
  variant?: ComponentProps<typeof Badge>["variant"]
  className?: string
  /** Native title/tooltip on the badge. */
  title?: string
  /** Remove handler. Omit to render a read-only chip (no X button). */
  onRemove?: () => void
  /** Tooltip on the remove button. */
  removeTitle?: string
  /** X icon size — detail panels use h-3 w-3, compact cards h-2.5 w-2.5. */
  removeIconClassName?: string
  /** Extra classes on the remove button (margin, hover colour). */
  removeButtonClassName?: string
  /** Defaults to 0 so the X is keyboard-reachable; pass -1 to skip the tab order. */
  removeTabIndex?: number
}

// Touch-first visibility: the X stays faintly visible (opacity-70) on touch
// devices — the command-post tablets — and only collapses to hover/focus-reveal
// from the `sm` breakpoint up, where a mouse exists. Before this, chips used
// `opacity-0 group-hover` and the remove button was unreachable by touch.
//
// From `sm` up the reserved slot shrinks from 24px to 12px — on a board full of
// names, 24px of empty gutter per chip is a column of wasted width — but it is
// still RESERVED, and the chip's width never changes.
//
// Both alternatives were built and rejected by looking at them:
//
//   Overlaying the label. Chip backgrounds are translucent (`bg-secondary`
//   plus a `bg-destructive/20` hover tint), so nothing painted on the button is
//   opaque enough to hide what is under it — the X landed on top of the last
//   letter of the name.
//
//   Expanding from zero width on hover. These chips sit in a `flex-wrap` row,
//   so growing one can push it past the wrap point onto the next line, which
//   moves it out from under the cursor, which un-hovers it, which shrinks it
//   back onto the first line, which hovers it again. The chip oscillates for as
//   long as the pointer rests near a wrap boundary.
//
// The hit area is restored to 24px with an invisible `after` overlay, which
// costs no layout because it is absolutely positioned.
const REMOVE_BUTTON_VISIBILITY =
  "opacity-70 transition-opacity hover:opacity-100 focus:opacity-100 " +
  "sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 " +
  "sm:min-w-0 sm:w-3 relative after:absolute after:-inset-1.5 after:content-['']"

/**
 * A resource chip (crew / vehicle / material / group) with a hover-reveal
 * remove button. Centralizes the `stopPropagation` + `opacity-0
 * group-hover:opacity-100` X-button skeleton that had been hand-rolled ~10×
 * across the detail panel, kanban card and route sections. Everything
 * chip-specific (label, leading icon, driver-stay toggle) is passed as
 * children; only the removable-badge shell lives here.
 */
export function RemovableChip({
  children,
  variant = "secondary",
  className,
  title,
  onRemove,
  removeTitle,
  removeIconClassName = "h-3 w-3",
  removeButtonClassName,
  removeTabIndex = 0,
}: RemovableChipProps) {
  return (
    <Badge variant={variant} className={cn("group relative transition-colors", className)} title={title}>
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className={cn(
            // The 24px minimum is a TOUCH target and it was setting the height
            // of every chip on the board — a 16px label in a 28px pill. From
            // `sm` up the `after` overlay below provides the target instead, so
            // the chip can shrink back to the size of its own text.
            "inline-flex items-center justify-center min-h-[24px] min-w-[24px] -mr-1 rounded-sm sm:min-h-0",
            "sm:mr-0",
            REMOVE_BUTTON_VISIBILITY,
            removeButtonClassName
          )}
          title={removeTitle}
          aria-label={removeTitle}
          tabIndex={removeTabIndex}
        >
          <X className={removeIconClassName} />
        </button>
      )}
    </Badge>
  )
}
