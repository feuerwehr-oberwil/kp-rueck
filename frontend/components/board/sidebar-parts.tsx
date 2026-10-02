"use client"

/**
 * The resource sidebars' building blocks: the loading and empty states, the
 * «nur verfügbare» toggle, the bindings popover, and the two material rows.
 *
 * Presentational only — the board page owns the state and hands everything in.
 * Moved out of `app/page.tsx` verbatim (2026-09-23).
 */

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { ArrowRight, ArrowUpRight, Ban, CircleCheck, Loader2, Package2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { DraggableMaterial } from "@/components/kanban/draggable-material"
import { isNavigableBinding, shortDate, type BindingsPopoverState, type ResourceBinding } from "@/lib/board-sidebar"
import type { Material } from "@/lib/contexts/operations-context"
import { materialResourceState } from "@/lib/resource-status"
import { cn } from "@/lib/utils"

/**
 * What a resource sidebar shows while the first load is still in flight.
 *
 * The point is not to look like the list — it is to stop the sidebar from
 * lying. Both used to render nothing while their footers asserted «0/0
 * verfügbar», i.e. that the station has no crew and no material, which is a
 * statement rather than an absence of one. A spinner plus the «–/–» counter
 * says «wait» without saying anything false.
 *
 * Deliberately not a skeleton: keeping placeholder rows in the true shape of
 * the list means maintaining a second copy of the layout, and it buys nothing
 * here beyond what a spinner already says.
 */
export function SidebarLoading({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center py-10"
      aria-busy="true"
      aria-label={label}
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

/**
 * A sidebar with nothing to list, and the reason why.
 *
 * One shape for all three of them — nothing checked in, nothing recorded yet,
 * nothing matching the search — because they are the same statement with
 * different causes, and the operator's next step is what differs. The action is
 * grey and underlined, never coloured: on this board colour means status and
 * priority, so an inline text action must not borrow it.
 */
export function SidebarEmpty({
  message,
  action,
  onAction,
  actionHref,
}: {
  message: React.ReactNode
  action?: string
  onAction?: () => void
  actionHref?: string
}) {
  const actionClasses =
    'text-xs text-muted-foreground underline underline-offset-2 decoration-muted-foreground/50 transition-colors hover:text-foreground hover:decoration-foreground cursor-pointer'
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center animate-in fade-in duration-300">
      <p className="text-sm text-muted-foreground">{message}</p>
      {action && actionHref ? (
        <Link href={actionHref} className={actionClasses}>
          {action}
        </Link>
      ) : action && onAction ? (
        <button type="button" onClick={onAction} className={actionClasses}>
          {action}
        </button>
      ) : null}
    </div>
  )
}

/**
 * Sidebar filter: show only what can be assigned right now.
 *
 * Icon-only and 32px square so it sits flush with the 32px search field. The
 * check glyph is the same one the resource cards use for "verfügbar", so the
 * button reads as "keep the green ones" rather than as a generic funnel.
 */
export function AvailableOnlyToggle({
  active,
  onToggle,
  label,
}: {
  active: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <Button
      size="icon-xs"
      variant={active ? "secondary" : "ghost"}
      onClick={onToggle}
      aria-pressed={active}
      title={label}
      aria-label={label}
      className={cn(
        "flex-shrink-0 border",
        active
          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <CircleCheck className="size-4" />
    </Button>
  )
}

/**
 * Every binding of one busy resource, with a way to reach each.
 *
 * Deliberately shown only when there is something to choose: exactly one
 * incident binding still jumps straight there, which is the common case and the
 * behaviour operators already know.
 *
 * The popover also answers for a resource with NO binding — «keine Bindung» in
 * so many words. Both that case and «Zum Anspringen auswählen» over a list where
 * nothing IS navigable used to be silent: the hint promised an action that the
 * single row underneath it («TLF · Sonderfunktion · kein Einsatz») could not
 * deliver, and a free person produced no popover at all.
 */
export function BindingsPopoverBody({
  state,
  onGo,
  onClose,
}: {
  state: BindingsPopoverState
  onGo: (binding: ResourceBinding) => void
  onClose: () => void
}) {
  const t = useTranslations('kanban.common')
  const hasNavigable = state.bindings.some(isNavigableBinding)
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{state.title}</p>
          {state.subtitle && <p className="truncate text-2xs text-muted-foreground">{state.subtitle}</p>}
        </div>
        {state.bindings.length > 0 && (
          <Badge variant="outline" className="shrink-0 border-amber-200 text-amber-700 dark:border-amber-800/50 dark:text-amber-400">
            {t('bindingsCount', { count: state.bindings.length })}
          </Badge>
        )}
      </div>
      {state.bindings.length === 0 ? (
        <p className="text-2xs text-muted-foreground">{t('bindingsNone')}</p>
      ) : hasNavigable ? (
        <p className="text-2xs text-muted-foreground">{t('bindingsPick')}</p>
      ) : null}
      <div className="space-y-1">
        {state.bindings.map((binding) => {
          const reachable = isNavigableBinding(binding)
          return (
            <button
              key={binding.key}
              type="button"
              disabled={!reachable}
              onClick={() => { onGo(binding); onClose() }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                reachable ? "cursor-pointer hover:bg-muted/60" : "cursor-default",
              )}
            >
              {reachable ? (
                <ArrowRight className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              ) : (
                <Package2 className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{binding.label}</span>
                {binding.detail && <span className="block truncate text-2xs text-muted-foreground">{binding.detail}</span>}
              </span>
              {reachable
                ? <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                : <span className="shrink-0 text-2xs text-muted-foreground">–</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One material row in the sidebar, with its right-click menu.
 *
 * «Nicht einsatzbereit» is settable in two places that write the SAME field:
 * here and in the Materialverwaltung. One entry, no submenu, no reason picker
 * and no cause list — set or not set. Clicking it again releases the device.
 *
 * A flagged device does not render as a draggable card at all: it is a dashed,
 * dimmed row with the word on it, so it cannot be picked up and cannot be
 * mistaken for something merely busy. Colour carries none of that alone.
 */
export function MaterialSidebarRow({
  material,
  onClick,
  onToggleOutOfService,
  bindingsPopover,
  onCloseBindings,
  onGoBinding,
}: {
  material: Material
  onClick: () => void
  onToggleOutOfService: (material: Material, outOfService: boolean) => void
  bindingsPopover: BindingsPopoverState | null
  onCloseBindings: () => void
  onGoBinding: (binding: ResourceBinding) => void
}) {
  const t = useTranslations('kanban.common')
  const isOpen = bindingsPopover?.kind === 'material' && bindingsPopover.id === material.id
  return (
    <Popover open={isOpen} onOpenChange={(open) => { if (!open) onCloseBindings() }}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <PopoverAnchor asChild>
            <div>
              {material.outOfService ? (
                <div
                  onClick={onClick}
                  title={t('notReady')}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-transparent px-3 py-2 opacity-70"
                >
                  {/* Icon only: the Ban glyph plus the dashed frame already say
                      «nicht einsatzbereit», and repeating it in words pushed the
                      device name into an ellipsis. The word survives as the
                      accessible name and in the tooltip, so nothing is lost for
                      a screen reader or on hover. */}
                  <Ban className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">{t('notReady')}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-muted-foreground">{material.name}</span>
                    {material.outOfServiceSince && (
                      <span className="block text-2xs text-muted-foreground">
                        {t('notReadySince', { date: shortDate(material.outOfServiceSince) })}
                      </span>
                    )}
                  </span>
                </div>
              ) : (
                <DraggableMaterial material={material} onClick={onClick} />
              )}
            </div>
          </PopoverAnchor>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem
            checked={material.outOfService}
            onCheckedChange={(checked) => onToggleOutOfService(material, checked === true)}
          >
            {t('notReady')}
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent align="start" side="left" className="w-80 p-3">
        {bindingsPopover && (
          <BindingsPopoverBody state={bindingsPopover} onGo={onGoBinding} onClose={onCloseBindings} />
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Several indistinguishable devices as ONE row: «Wassersauger  3/4».
 *
 * Picking between four identical Sauger is a decision with no content, so the
 * sidebar stops asking. Dragging the row takes one FREE unit (the drop side
 * neither knows nor cares which); clicking asks where the taken ones are (the
 * bindings popover of the first assigned unit); the context menu's «nicht
 * einsatzbereit» takes one free unit out of service — the flagged device then
 * stands at the bottom of its depot as its own dashed row, individually
 * restorable, exactly as before.
 */
export function AggregatedMaterialRow({
  units,
  onOpenBindings,
  onToggleOutOfService,
  bindingsPopover,
  onCloseBindings,
  onGoBinding,
}: {
  units: Material[]
  /** Opens the combined popover — every taken unit's whereabouts at once. */
  onOpenBindings: (units: Material[]) => void
  onToggleOutOfService: (material: Material, outOfService: boolean) => void
  bindingsPopover: BindingsPopoverState | null
  onCloseBindings: () => void
  onGoBinding: (binding: ResourceBinding) => void
}) {
  const t = useTranslations('kanban.common')
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const freeUnits = units.filter((u) => materialResourceState(u) === 'available')
  const assignedUnit = units.find((u) => u.status === 'assigned')
  const dragUnit = freeUnits[0] ?? assignedUnit ?? units[0]
  const allTaken = freeUnits.length === 0
  // The popover may have been opened for ANY unit of this bundle.
  const isOpen = bindingsPopover?.kind === 'material' && units.some((u) => u.id === bindingsPopover.id)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    return draggable({
      element,
      getInitialData: () => ({ type: 'material', material: dragUnit }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    })
  }, [dragUnit])

  return (
    <Popover open={isOpen} onOpenChange={(open) => { if (!open) onCloseBindings() }}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <PopoverAnchor asChild>
            <div
              ref={ref}
              role="button"
              title={dragUnit.name}
              aria-grabbed={isDragging}
              onClick={() => onOpenBindings(units)}
              className={cn(
                "group draggable rounded-md px-2 py-1.5 transition-all hover:bg-muted/50",
                isDragging && "dragging",
                allTaken && "opacity-60 hover:opacity-100",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {dragUnit.name}
                </span>
                {/* The count IS the state: 0/4 needs no extra dot. Amber once
                    nothing is left — the depot answers «kann ich noch einen
                    holen?» at a glance. */}
                <span
                  className={cn(
                    "shrink-0 text-xs tabular-nums",
                    allTaken ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                  )}
                  title={t('aggregateCountTitle', { free: freeUnits.length, total: units.length })}
                >
                  {freeUnits.length}/{units.length}
                </span>
              </div>
            </div>
          </PopoverAnchor>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem
            checked={false}
            disabled={freeUnits.length === 0}
            onCheckedChange={() => {
              if (freeUnits[0]) onToggleOutOfService(freeUnits[0], true)
            }}
          >
            {t('notReadyOne')}
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent align="start" side="left" className="w-80 p-3">
        {bindingsPopover && (
          <BindingsPopoverBody state={bindingsPopover} onGo={onGoBinding} onClose={onCloseBindings} />
        )}
      </PopoverContent>
    </Popover>
  )
}
