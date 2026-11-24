"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Check, Truck } from "lucide-react"
import { PersonName } from "@/components/person-name"
import { STATION_FUNCTION_ICONS, stationFunctionLabel } from "@/components/kanban/person-function-labels"
import { usePersonFunctions } from "@/components/kanban/use-person-functions"
import type { PersonFunctionItem } from "@/lib/person-functions"

interface PersonContextMenuProps {
  children: React.ReactNode
  personnelId: string
  personnelName: string
}

/**
 * Right click on a person: every function as a tick – one Fahrer row per vehicle, then Reko,
 * Magazin, Telefondienst, Kommandoposten. Items and toggles come from `usePersonFunctions`, the
 * same source as the left-click popover (`components/board/person-popover.tsx`), so both show
 * the same ticks.
 *
 * Telefondienst is a role, not a page: the holder gets the call form on their own `/feld`.
 * Kommandoposten unlocks nothing: it says this person is running the board, so the KP is not
 * offered its own operators as crew.
 */
export function PersonContextMenu({ children, personnelId, personnelName }: PersonContextMenuProps) {
  const t = useTranslations("kanban")
  const [open, setOpen] = useState(false)
  const { items, toggle, dialogs } = usePersonFunctions({ personnelId, personnelName, enabled: open })

  const row = (item: PersonFunctionItem) => {
    const Icon = item.kind === "driver" ? Truck : STATION_FUNCTION_ICONS[item.functionType]
    return (
      <ContextMenuItem
        key={item.key}
        onClick={() => toggle(item)}
        className={item.kind === "driver" ? "flex items-center justify-between" : undefined}
      >
        <div className="flex items-center">
          {item.held && <Check className="mr-2 h-4 w-4" />}
          <Icon className={`mr-2 h-4 w-4 ${!item.held ? "ml-6" : ""}`} />
          {item.kind === "driver" ? item.vehicleName : stationFunctionLabel(t, item.functionType)}
        </div>
        {item.kind === "driver" && item.holder && (
          <span className="text-xs text-muted-foreground ml-2">
            (<PersonName name={item.holder.name} personnelId={item.holder.personnelId} />)
          </span>
        )}
      </ContextMenuItem>
    )
  }

  const driverItems = items.filter((item) => item.kind === "driver")
  const stationItems = items.filter((item) => item.kind === "station")

  return (
    <>
      <ContextMenu onOpenChange={setOpen}>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {driverItems.map(row)}
          {driverItems.length > 0 && <ContextMenuSeparator />}
          {stationItems.map(row)}
        </ContextMenuContent>
      </ContextMenu>
      {dialogs}
    </>
  )
}
