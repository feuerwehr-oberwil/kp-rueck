"use client"

import { useId, useRef, useState, type ComponentProps, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { CircleMinus, X, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePointerFine } from "@/lib/hooks/use-pointer-fine"
import { cn } from "@/lib/utils"

/** One row of the touch menu above the destructive «remove» row. */
export interface ChipMenuAction {
  label: string
  /** A 16px glyph: a Lucide icon element, or the «EL» badge. */
  icon?: ReactNode
  onSelect: () => void
}

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
  /** Touch menu: the label's name (the person's or vehicle's name). */
  menuTitle?: string
  /** Touch menu: the label's muted detail after the name (rank, call sign,
   *  driver …). A node so a caller can pass a component that looks the value up — the menu
   *  content only mounts while open, so a closed chip pays nothing for it. */
  menuSubtitle?: ReactNode
  /** Touch menu: rows above the separator, in order («Details öffnen» first). */
  menuActions?: ChipMenuAction[]
  /** Touch menu: the destructive row's label. Defaults to `removeTitle`. */
  removeLabel?: string
  /** Touch menu: the destructive row's icon. */
  removeIcon?: LucideIcon
}

// Mouse only: the ✕ collapses to hover/focus-reveal in a 12px slot that is
// still RESERVED, so the chip's width never changes. `pointer-fine:` replaced
// `sm:` (2026-09-23): the breakpoint stood in for «has a mouse», and a 1180 px
// command-post tablet is far past `sm` — it got the hover-reveal ✕, invisible
// and still live under a finger, so a thumb resting on a name could take a
// person off an Einsatz. Without a fine pointer there is no ✕ at all; a tap
// opens the chip menu instead (decision 27 B), where removal is a deliberate
// second tap on its own, separated row.
//
// Both hover alternatives were built and rejected by looking at them:
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
// The hit area is 24px via an invisible `after` overlay, which costs no layout
// because it is absolutely positioned.
const REMOVE_BUTTON_VISIBILITY =
  "hidden pointer-fine:inline-flex items-center justify-center w-3 rounded-sm " +
  "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 " +
  "relative after:absolute after:-inset-1.5 after:content-['']"

// The menu is sized like the card's right-click menu (draggable-operation.tsx),
// not as a touch-only special: the primitive's own 32px rows (`px-2 py-1.5
// text-sm`), a 16px icon with `mr-2`, `p-1` around, `w-max` from 13rem to
// 22rem, a one-line label instead of a header block. The first build had 44px
// rows under a two-line header and read as a different kind of object next to
// the menus the same operators already know; the user asked for the card's
// sizes (2026-09-23). The rows are still full-width targets, and removal stays
// behind a separator, so it is never the row a thumb lands on first.
const MENU_CONTENT =
  "w-max min-w-52 max-w-[min(22rem,var(--radix-dropdown-menu-content-available-width))] " +
  "[&_[data-slot=dropdown-menu-item]]:whitespace-nowrap"

/** Every row keeps the icon column, so labels line up with or without one. */
function MenuIcon({ icon }: { icon: ReactNode }) {
  return (
    <span className="mr-2 flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
      {icon}
    </span>
  )
}

/**
 * A resource chip (crew / vehicle / material / group) with a remove action.
 *
 * With a mouse: the hover-reveal ✕, as always. Centralizes the
 * `stopPropagation` + reveal skeleton that had been hand-rolled ~10× across the
 * detail panel, kanban card and route sections.
 *
 * Without a fine pointer (tablets, phones): no ✕; a tap opens a menu — label
 * (`menuTitle` / `menuSubtitle`), the caller's `menuActions`, a separator, and
 * the destructive remove row. The chip's tap used to fall through to whatever
 * the surrounding block opens (the card opens its detail); callers that had
 * such a behaviour pass it as the first action, so it stays one extra tap away
 * instead of disappearing.
 *
 * The menu opens on `click`, not `pointerdown` (Radix's trigger default): a
 * finger that starts a scroll or a card drag on a chip never produces a click,
 * so neither opens a menu under it. That is why the Radix trigger is an inert
 * overlay used only as the anchor, and the chip itself does the opening.
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
  menuTitle,
  menuSubtitle,
  menuActions,
  removeLabel,
  removeIcon: RemoveIcon = CircleMinus,
}: RemovableChipProps) {
  const pointerFine = usePointerFine()
  const hasMenu = !pointerFine && (!!onRemove || (menuActions?.length ?? 0) > 0)

  if (!hasMenu) {
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
            className={cn(REMOVE_BUTTON_VISIBILITY, removeButtonClassName)}
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

  return (
    <ChipWithMenu
      variant={variant}
      className={className}
      title={title}
      onRemove={onRemove}
      removeTitle={removeTitle}
      menuTitle={menuTitle}
      menuSubtitle={menuSubtitle}
      menuActions={menuActions}
      removeLabel={removeLabel}
      RemoveIcon={RemoveIcon}
    >
      {children}
    </ChipWithMenu>
  )
}

function ChipWithMenu({
  children,
  variant,
  className,
  title,
  onRemove,
  removeTitle,
  menuTitle,
  menuSubtitle,
  menuActions,
  removeLabel,
  RemoveIcon,
}: Omit<RemovableChipProps, "removeIcon" | "removeIconClassName" | "removeButtonClassName" | "removeTabIndex"> & {
  RemoveIcon: LucideIcon
}) {
  const t = useTranslations("kanban.chipMenu")
  const [open, setOpen] = useState(false)
  const chipRef = useRef<HTMLSpanElement>(null)
  const labelId = useId()
  const actions = menuActions ?? []
  const destructiveLabel = removeLabel ?? removeTitle ?? t("remove")

  // Only events that start INSIDE the chip open it. The menu is portalled, but
  // React still bubbles its clicks and keys through this component — without
  // the check, choosing a row would reopen the menu it just closed.
  const ownEvent = (e: React.SyntheticEvent) => e.currentTarget.contains(e.target as Node)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Badge
        ref={chipRef}
        variant={variant}
        className={cn(
          "group relative transition-[color,box-shadow]",
          className,
          open && "ring-2 ring-primary/50",
        )}
        title={title}
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          if (!ownEvent(e)) return
          // The chip's own action, not the block's around it (the card opens
          // its detail on any tap — that is now the menu's first row).
          e.stopPropagation()
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault()
            e.stopPropagation()
            setOpen(true)
          }
        }}
      >
        {children}
        {/* Anchor only: positions the menu on the chip. Inert, so Radix's
            pointerdown toggle never runs — the chip opens on click, above. */}
        <DropdownMenuTrigger asChild>
          <span aria-hidden="true" className="pointer-events-none absolute inset-0" />
        </DropdownMenuTrigger>
      </Badge>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className={MENU_CONTENT}
        aria-labelledby={menuTitle ? labelId : undefined}
        aria-label={menuTitle ? undefined : destructiveLabel}
        // The chip, not Radix's inert anchor, gets focus back.
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          chipRef.current?.focus({ preventScroll: true })
        }}
        // Portalled, but React bubbles through the tree: a row's click must not
        // reach the card (which would open its detail on top of the action).
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {menuTitle && (
          <>
            {/* One line at the label's own size — who this is, then the
                muted detail (rank, call sign, driver …) after a middle dot. */}
            <DropdownMenuLabel className="flex min-w-0 items-baseline gap-1.5">
              <span id={labelId} className="truncate">{menuTitle}</span>
              {menuSubtitle && (
                <span className="truncate text-xs font-normal text-muted-foreground">· {menuSubtitle}</span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {actions.map((action) => (
          <DropdownMenuItem key={action.label} onSelect={action.onSelect}>
            <MenuIcon icon={action.icon} />
            {action.label}
          </DropdownMenuItem>
        ))}
        {onRemove && (
          <>
            {actions.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              {/* Coloured here: the item's destructive tint only reaches a
                  DIRECT child svg, and MenuIcon wraps it. */}
              <MenuIcon icon={<RemoveIcon className="text-destructive" />} />
              {destructiveLabel}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
