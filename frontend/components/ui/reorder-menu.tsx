"use client"

import type { ComponentType, ReactNode } from "react"
import { useTranslations } from "next-intl"
import { ArrowDown, ArrowUp, ArrowUpToLine, MoreVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { MoveTo } from "@/lib/move-in-list"

/** What a dropdown item and a context-menu item have in common. */
type MenuItem = ComponentType<{ onClick?: () => void; disabled?: boolean; children?: ReactNode }>

interface MoveProps {
  /** Position of the row in its list, and the list's length. */
  index: number
  count: number
  onMove: (to: MoveTo) => void
}

/**
 * «Nach oben» / «Nach unten» / «An den Anfang» as menu entries – the way to reorder
 * a dragged list with the keyboard or a finger. `Item` is the menu's own item
 * component, so the same three entries sit in a ⋮ menu and in a right-click menu.
 * A move that changes nothing is greyed out, not hidden: the menu keeps its shape.
 */
export function MoveMenuItems({ Item, index, count, onMove }: MoveProps & { Item: MenuItem }) {
  const t = useTranslations("common.reorder")
  return (
    <>
      <Item disabled={index === 0} onClick={() => onMove("up")}>
        <ArrowUp className="mr-2 h-4 w-4" />
        {t("moveUp")}
      </Item>
      <Item disabled={index >= count - 1} onClick={() => onMove("down")}>
        <ArrowDown className="mr-2 h-4 w-4" />
        {t("moveDown")}
      </Item>
      {count > 2 && (
        <Item disabled={index === 0} onClick={() => onMove("top")}>
          <ArrowUpToLine className="mr-2 h-4 w-4" />
          {t("moveTop")}
        </Item>
      )}
    </>
  )
}

/**
 * The ⋮ button of a row in a reorderable list: the move entries, then the row's
 * other actions as `children` (below a separator). `label` names the row for the
 * button («Reihenfolge von Atemschutz ändern»). Without `onMove` (reordering is
 * off just now) only the other actions remain.
 */
export function ReorderMenu({
  label,
  children,
  className,
  index,
  count,
  onMove,
}: Omit<MoveProps, "onMove"> & { onMove?: MoveProps["onMove"]; label: string; children?: ReactNode; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={className}
          aria-label={label}
          title={label}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-elevated" onClick={(e) => e.stopPropagation()}>
        {onMove && <MoveMenuItems Item={DropdownMenuItem} index={index} count={count} onMove={onMove} />}
        {onMove && children && <DropdownMenuSeparator />}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
