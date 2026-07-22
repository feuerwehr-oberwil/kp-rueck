"use client"

/**
 * RouteStopList — shared ordered, drag-reorderable stop list for one Auftrag.
 *
 * Extracted from the Routen-Editor modal so both the modal (Phase 2) and the
 * `/map` Routenplanung panel (Phase 3) render an identical list without
 * duplicating the row UI or the reorder monitor.
 *
 * The list renders `displayOrder` (which may be a pending optimize preview) while
 * the reorder drag base uses the authoritative `stopIds`. A modal-/panel-local
 * `monitorForElements` turns `route-stop-drag` drops into a `reorder(orderedIds)`
 * call; resource drops (`person`/`vehicle`/`material` → `group-stop`) are handled
 * elsewhere (the page-level board drag hook), keyed off the source type so the two
 * monitors never collide.
 */

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine"
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"
import { DropIndicator } from "@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box"
import { GripVertical, Check, CircleDashed, ChevronDown, Navigation, Flame, X, Trash2, Wand2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { useOperations, type Operation, type OperationStatus } from "@/lib/contexts/operations-context"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isLocated } from "@/lib/utils/route-geo"
import { stopStatusBorderClass } from "@/lib/kanban-utils"
import type { RouteStartMode } from "@/lib/hooks/use-route-planning"

export type StopState = "erledigt" | "laeuft" | "offen"

// ── Optimize-from wand ───────────────────────────────────────────────────────
// A single wand icon button (shared by the Routen-Editor modal, the /map
// Routenplanung panel and the Aufträge sheet) that, on click, opens a dropdown of
// start anchors. Picking one runs `onOptimize(start)` immediately — there is no
// preselected "Start ab" select anymore. Callers pass their own translated labels
// + availability so the component stays i18n-namespace agnostic.
export interface RouteStartOption {
  value: RouteStartMode
  label: string
  /** Disabled when the anchor is unavailable (e.g. no vehicle GPS fix). */
  disabled?: boolean
}

export function RouteOptimizeMenu({
  options,
  menuLabel,
  optimizeLabel,
  disabled,
  onOptimize,
  className,
}: {
  options: RouteStartOption[]
  /** Small heading above the start options (e.g. "Start ab"). */
  menuLabel: string
  /** Tooltip / aria-label on the wand trigger (e.g. "Reihenfolge optimieren"). */
  optimizeLabel: string
  disabled?: boolean
  onOptimize: (start: RouteStartMode) => void
  className?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          disabled={disabled}
          title={optimizeLabel}
          aria-label={optimizeLabel}
          className={className}
        >
          <Wand2 className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[70]">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{menuLabel}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} disabled={o.disabled} onClick={() => onOptimize(o.value)}>
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Derived checklist state of a single stop, straight from its incident status. */
export function deriveStopState(op: Operation | undefined): StopState {
  if (!op) return "offen"
  if (op.status === "returning" || op.status === "complete") return "erledigt"
  if (op.status === "active") return "laeuft"
  return "offen"
}

// ── Kanban-column mirror ─────────────────────────────────────────────────────
// A stop's status control is a mirror of the board columns (single source of
// truth = the incident's status). Four collapsed states — Offen → Disponiert →
// Einsatz → Beendet — map onto real incident statuses; left-click advances to
// the next, a caret menu jumps to any.
export type MirrorStatus = Extract<OperationStatus, "incoming" | "enroute" | "active" | "returning" | "complete">
export const MIRROR_ORDER: MirrorStatus[] = ["incoming", "enroute", "active", "returning", "complete"]

/** Collapse the full incident status onto one of the four mirror columns. */
export function toMirrorStatus(op: Operation | undefined): MirrorStatus {
  if (!op) return "incoming"
  if (op.status === "complete") return "complete"
  if (op.status === "returning") return "returning"
  if (op.status === "active") return "active"
  if (op.status === "enroute") return "enroute"
  // incoming, ready (Reko) and rekoDone all read as "Offen".
  return "incoming"
}

export const MIRROR_CONFIG: Record<MirrorStatus, { labelKey: string; Icon: typeof CircleDashed; cls: string }> = {
  incoming: { labelKey: "offen", Icon: CircleDashed, cls: "text-muted-foreground/70" },
  enroute: { labelKey: "disponiert", Icon: Navigation, cls: "text-blue-600 dark:text-blue-400" },
  active: { labelKey: "einsatz", Icon: Flame, cls: "text-amber-600 dark:text-amber-400" },
  returning: { labelKey: "beendet", Icon: Check, cls: "text-emerald-600 dark:text-emerald-400" },
  complete: { labelKey: "abgeschlossen", Icon: Check, cls: "text-emerald-700 dark:text-emerald-300" },
}

/**
 * Stop status control — mirrors the board columns. Left-click advances to the
 * next column; the caret opens a menu to jump to any of the four. `compact`
 * hides the text label (icon only), used in the dense sheet checklist.
 */
export function StopStatusControl({
  op,
  onSetStatus,
  compact = false,
}: {
  op: Operation | undefined
  onSetStatus: (status: MirrorStatus) => void
  compact?: boolean
}) {
  const t = useTranslations("kanban.stopStatus")
  const current = toMirrorStatus(op)
  const conf = MIRROR_CONFIG[current]
  const Icon = conf.Icon
  const next = current === "complete" ? null : MIRROR_ORDER[MIRROR_ORDER.indexOf(current) + 1]

  return (
    // One cohesive bordered pill: the icon+label button and the caret share a
    // single border and height (a thin inner divider separates the caret), so
    // there is no gap/seam or offset box between them.
    <div
      className={cn(
        "inline-flex h-6 flex-shrink-0 items-stretch overflow-hidden rounded-md border border-border/60",
        !compact && "w-28",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (next) onSetStatus(next)
        }}
        className={cn(
          "flex items-center gap-1 px-1.5 text-xs font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          compact ? "justify-center" : "min-w-0 flex-1 justify-start",
          conf.cls,
          !next && "cursor-default",
        )}
        title={next ? t("advance", { label: t(MIRROR_CONFIG[next].labelKey) }) : t(conf.labelKey)}
        aria-label={next ? t("advance", { label: t(MIRROR_CONFIG[next].labelKey) }) : t(conf.labelKey)}
        disabled={!next}
      >
        <Icon className="h-3.5 w-3.5 flex-shrink-0" />
        {!compact && <span className="truncate">{t(conf.labelKey)}</span>}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center border-l border-border/60 px-0.5 text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            title={t("jumpTo")}
            aria-label={t("jumpTo")}
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[70]">
          {(current === "complete" ? (["complete"] as MirrorStatus[]) : MIRROR_ORDER).map((s) => {
            const c = MIRROR_CONFIG[s]
            const SIcon = c.Icon
            return (
              <DropdownMenuItem
                key={s}
                onClick={(e) => {
                  e.stopPropagation()
                  onSetStatus(s)
                }}
              >
                <SIcon className={cn("mr-2 h-4 w-4", c.cls)} />
                {t(c.labelKey)}
                {s === current && <Check className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

interface RouteStopListProps {
  groupId: string
  /** Authoritative stop order — the reorder base (ignores any preview). */
  stopIds: string[]
  /** Order to render (a pending optimize preview overrides `stopIds`). */
  displayOrder: string[]
  operationsById: Map<string, Operation>
  /** Stops whose position changed in the current preview (amber ring). */
  changedPositions: Set<string>
  /** Disable drag reordering (e.g. while an optimize preview is pending). */
  reorderDisabled: boolean
  onReorder: (orderedIds: string[]) => void
  focusStopId: string | null
  onSelectStop: (id: string) => void
  /** Gate the reorder monitor (false when the host list is not visible). */
  enabled?: boolean
  /** When provided, the status icon becomes the kanban-column mirror control. */
  onSetStopStatus?: (incidentId: string, status: MirrorStatus) => void
  /** When provided, each row shows a ✕ that detaches the stop from the route. */
  onRemoveStop?: (incidentId: string) => void
  /** Show the advance/jump status control (false → plain status marker, e.g. the
   *  `/map` Routenplanung panel where status isn't advanced from the planner). */
  showStatusControl?: boolean
  /** Offer "Abgeschlossen" in the row context menu. Default true. Set false on
   *  surfaces whose `onSetStopStatus` doesn't route through the completion flow
   *  (material prompt + returning-vehicle check), e.g. the `/map` planner. */
  allowComplete?: boolean
  readOnly?: boolean
}

export function RouteStopList({
  groupId,
  stopIds,
  displayOrder,
  operationsById,
  changedPositions,
  reorderDisabled,
  onReorder,
  focusStopId,
  onSelectStop,
  enabled = true,
  onSetStopStatus,
  onRemoveStop,
  showStatusControl = true,
  allowComplete = true,
  readOnly = false,
}: RouteStopListProps) {
  // Reorder monitor: source `route-stop-drag` reordered onto a `group-stop`
  // target computes the new order off the authoritative `stopIds`.
  useEffect(() => {
    if (!enabled || !groupId || readOnly) return
    return monitorForElements({
      onDrop({ source, location }) {
        const dest = location.current.dropTargets[0]
        if (!dest) return
        const s = source.data
        const d = dest.data
        if (s.type !== "route-stop-drag" || d.type !== "group-stop") return
        if (s.groupId !== groupId || d.groupId !== groupId) return

        const fromId = s.incidentId as string
        const toId = d.incidentId as string
        if (fromId === toId) return

        const edge = extractClosestEdge(dest.data)
        const without = stopIds.filter((id) => id !== fromId)
        let targetIndex = without.indexOf(toId)
        if (targetIndex === -1) return
        if (edge === "bottom") targetIndex += 1
        const next = [...without.slice(0, targetIndex), fromId, ...without.slice(targetIndex)]
        onReorder(next)
      },
    })
  }, [enabled, groupId, stopIds, onReorder, readOnly])

  return (
    <>
      {displayOrder.map((incidentId, index) => (
        <StopListRow
          key={incidentId}
          groupId={groupId}
          incidentId={incidentId}
          index={index}
          op={operationsById.get(incidentId)}
          changed={changedPositions.has(incidentId)}
          reorderDisabled={reorderDisabled || readOnly}
          onSelect={() => onSelectStop(incidentId)}
          selected={focusStopId === incidentId}
          onSetStatus={readOnly ? undefined : onSetStopStatus}
          onRemove={readOnly ? undefined : onRemoveStop}
          showStatusControl={showStatusControl}
          allowComplete={allowComplete}
        />
      ))}
    </>
  )
}

interface StopListRowProps {
  groupId: string
  incidentId: string
  index: number
  op: Operation | undefined
  changed: boolean
  reorderDisabled: boolean
  onSelect: () => void
  selected: boolean
  onSetStatus?: (incidentId: string, status: MirrorStatus) => void
  onRemove?: (incidentId: string) => void
  showStatusControl?: boolean
  allowComplete?: boolean
}

export function StopListRow({
  groupId,
  incidentId,
  index,
  op,
  changed,
  reorderDisabled,
  onSelect,
  selected,
  onSetStatus,
  onRemove,
  showStatusControl = true,
  allowComplete = true,
}: StopListRowProps) {
  const t = useTranslations("kanban.routenEditorModal")
  const tStatus = useTranslations("kanban.stopStatus")
  const ref = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)
  const [isDropOver, setIsDropOver] = useState(false)

  const { formatLocation } = useOperations()
  const mirror = toMirrorStatus(op)
  const mirrorConf = MIRROR_CONFIG[mirror]
  // Primary line = the address (home city stripped); the incident type is the
  // muted secondary line; the Meldung shows on hover (title on the wrapper).
  const name = op ? getIncidentTypeLabel(op.incidentType) : incidentId
  const address = op?.location ? formatLocation(op.location) : undefined

  useEffect(() => {
    const el = ref.current
    const handle = handleRef.current
    if (!el || !handle) return
    return combine(
      draggable({
        element: el,
        dragHandle: handle,
        canDrag: () => !reorderDisabled,
        getInitialData: () => ({ type: "route-stop-drag", groupId, incidentId, index }),
      }),
      dropTargetForElements({
        element: el,
        // Same `group-stop` contract the sheet/hook use: the page-level
        // useKanbanDragDrop monitor assigns resources dropped here; the list's
        // own monitor reorders `route-stop-drag` sources.
        getData: ({ input }) =>
          attachClosestEdge(
            { type: "group-stop", groupId, incidentId, index },
            { element: el, input, allowedEdges: ["top", "bottom"] },
          ),
        onDragEnter: ({ self, source }) => {
          if (source.data.type === "route-stop-drag") setClosestEdge(extractClosestEdge(self.data))
          else setIsDropOver(true)
        },
        onDrag: ({ self, source }) => {
          if (source.data.type === "route-stop-drag") setClosestEdge(extractClosestEdge(self.data))
        },
        onDragLeave: () => {
          setClosestEdge(null)
          setIsDropOver(false)
        },
        onDrop: () => {
          setClosestEdge(null)
          setIsDropOver(false)
        },
      }),
    )
  }, [groupId, incidentId, index, reorderDisabled])

  const MirrorIcon = mirrorConf.Icon

  return (
    <div className="relative">
      {closestEdge === "top" && <DropIndicator edge="top" gap="2px" />}
      {/* Right-click exposes the same per-stop actions as the row controls. The
          trigger wraps a PLAIN div (the actual dnd/click row lives inside) so the
          draggable ref + handlers don't clobber the contextmenu listener — the
          forwarding-div pattern used for the Auftrag header. */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
      <div
        ref={ref}
        onClick={onSelect}
        className={cn(
          // Column layout: [handle] [number] [status — fixed width] [name/address — flex].
          "flex cursor-pointer items-center gap-2 rounded-md border-l-2 px-1.5 py-1.5 text-sm transition-colors hover:bg-muted/40",
          stopStatusBorderClass(mirror),
          selected && "bg-primary/[0.06] ring-1 ring-primary/40",
          isDropOver && "bg-primary/[0.04] ring-2 ring-primary/50",
          changed && "ring-1 ring-amber-500/70",
        )}
      >
        <button
          ref={handleRef}
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0 cursor-grab text-muted-foreground/50 hover:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
          disabled={reorderDisabled}
          aria-label={t("dragStop")}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="w-6 flex-shrink-0 text-right tabular-nums text-xs text-muted-foreground">{index + 1}.</span>
        {onSetStatus && showStatusControl ? (
          <StopStatusControl op={op} onSetStatus={(s) => onSetStatus(incidentId, s)} />
        ) : (
          <MirrorIcon className={cn("h-4 w-4 flex-shrink-0", mirrorConf.cls)} />
        )}
        {op?.notes ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="min-w-0 flex-1 cursor-default leading-tight">
                <div className="truncate font-medium">{address ?? name}</div>
                {address && <div className="truncate text-xs text-muted-foreground">{name}</div>}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap">{op.notes}</TooltipContent>
          </Tooltip>
        ) : (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-medium">{address ?? name}</div>
            {address && <div className="truncate text-xs text-muted-foreground">{name}</div>}
          </div>
        )}
        {!isLocated(op) && (
          <span className="flex-shrink-0 text-xs text-muted-foreground/70" title={t("noCoords")}>
            {t("noCoordsBadge")}
          </span>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(incidentId)
            }}
            className="flex-shrink-0 rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={t("removeStop")}
            aria-label={t("removeStop")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          {onSetStatus &&
            (mirror === "complete"
              ? (["complete"] as MirrorStatus[])
              : allowComplete
                ? MIRROR_ORDER
                : MIRROR_ORDER.filter((s) => s !== "complete")
            ).map((s) => {
              const c = MIRROR_CONFIG[s]
              const SIcon = c.Icon
              return (
                <ContextMenuItem key={s} onClick={() => onSetStatus(incidentId, s)}>
                  <SIcon className={cn("mr-2 h-4 w-4", c.cls)} />
                  {tStatus(c.labelKey)}
                  {s === mirror && <Check className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
                </ContextMenuItem>
              )
            })}
          {onSetStatus && onRemove && <ContextMenuSeparator />}
          {onRemove && (
            <ContextMenuItem
              onClick={() => onRemove(incidentId)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("removeStop")}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {closestEdge === "bottom" && <DropIndicator edge="bottom" gap="2px" />}
    </div>
  )
}
