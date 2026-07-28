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
const REMOVE_BUTTON_VISIBILITY =
  "opacity-70 transition-opacity hover:opacity-100 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"

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
    <Badge variant={variant} className={cn("group transition-colors", className)} title={title}>
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className={cn(
            "inline-flex items-center justify-center min-h-[24px] min-w-[24px] -mr-1 rounded-sm",
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
