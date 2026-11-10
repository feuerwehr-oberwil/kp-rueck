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
 *
 * Two looks over the same rows: the dense list (the modal) and, with
 * `timelineColor`, the timeline of the `/map` Routenplanung panel – both share the
 * drag/drop wiring (`useStopRowDnd`) and the right-click menu (`StopRowMenu`).
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
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
import { AlertTriangle, GripVertical, Check, CircleDashed, ChevronDown, Navigation, Flame, Trash2, Wand2 } from "lucide-react"
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
import { moveInList, type MoveTo } from "@/lib/move-in-list"
import { MoveMenuItems, ReorderMenu } from "@/components/ui/reorder-menu"
import { stopStatusBorderClass, stopStatusTextClass } from "@/lib/kanban-utils"
import type { RouteStartMode } from "@/lib/route-start"

export type StopState = "erledigt" | "laeuft" | "offen"

// ── Optimize-from wand ───────────────────────────────────────────────────────
// A single wand icon button (shared by the Routen-Editor modal, the /map
// Routenplanung panel and the Aufträge sheet) that, on click, opens a dropdown of
// start anchors. Picking one runs `onOptimize(start)` immediately — there is no
// preselected "Start ab" select anymore. Callers pass their own translated labels
// + availability so the component stays i18n-namespace agnostic.
//
// Each anchor shows WHERE it would start before anything runs (provenance + time:
// «Ersatzstandort – Magazin nicht eingerichtet», «TLF 1 · 14:32»), so choosing
// is also correcting; `basisLabel` heads the menu with what the result is — a
// straight-line suggestion, not a road route (see `lib/route-start.ts`).
export interface RouteStartOption {
  value: RouteStartMode
  label: string
  /** Second line: where exactly this anchor is and how fresh. */
  detail?: string
  /** Fallback / stale: rendered as a caution (icon + warning colour). */
  caution?: boolean
  /** Disabled when the anchor is unavailable (e.g. no vehicle GPS fix). */
  disabled?: boolean
}

export function RouteOptimizeMenu({
  options,
  menuLabel,
  basisLabel,
  optimizeLabel,
  disabled,
  onOptimize,
  className,
}: {
  options: RouteStartOption[]
  /** Small heading above the start options (e.g. "Start ab"). */
  menuLabel: string
  /** What the optimisation is based on, above everything (e.g. «Vorschlag nach Luftlinie · Planungshilfe»). */
  basisLabel?: string
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
          <Wand2 className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-elevated max-w-[min(20rem,calc(100vw-2rem))]">
        {basisLabel && (
          <DropdownMenuLabel className="text-xs font-medium text-foreground">{basisLabel}</DropdownMenuLabel>
        )}
        <DropdownMenuLabel className="pt-0 text-xs font-normal text-muted-foreground">{menuLabel}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            disabled={o.disabled}
            onClick={() => onOptimize(o.value)}
            className="flex-col items-start gap-0.5"
          >
            <span>{o.label}</span>
            {o.detail && (
              <span
                className={cn(
                  "flex items-start gap-1 text-xs leading-snug",
                  o.caution ? "text-warning-foreground" : "text-muted-foreground",
                )}
              >
                {o.caution && <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />}
                {o.detail}
              </span>
            )}
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
// truth = the incident's status). The collapsed states — Eingegangen → Disponiert →
// Im Einsatz → Rückfahrt → Abgeschlossen — map onto real incident statuses; the
// control is a menu of all of them.
export type MirrorStatus = Extract<OperationStatus, "incoming" | "enroute" | "active" | "returning" | "complete">
export const MIRROR_ORDER: MirrorStatus[] = ["incoming", "enroute", "active", "returning", "complete"]

/** Collapse the full incident status onto one of the four mirror columns. */
export function toMirrorStatus(op: Operation | undefined): MirrorStatus {
  if (!op) return "incoming"
  if (op.status === "complete") return "complete"
  if (op.status === "returning") return "returning"
  if (op.status === "active") return "active"
  if (op.status === "enroute") return "enroute"
  // incoming, reko and reko_done all read as "Offen".
  return "incoming"
}

/** The icon beside a stop row. `cls` comes from `stopStatusTextClass`, i.e. from
 *  the one status colour table (STATUS_ACCENT) — it sits directly next to the
 *  row's left edge, which uses `stopStatusBorderClass` from the same table, and
 *  the two used to be typed out separately and could drift. */
export const MIRROR_CONFIG: Record<MirrorStatus, { labelKey: string; Icon: typeof CircleDashed; cls: string }> = {
  incoming: { labelKey: "offen", Icon: CircleDashed, cls: stopStatusTextClass("incoming") },
  enroute: { labelKey: "disponiert", Icon: Navigation, cls: stopStatusTextClass("enroute") },
  active: { labelKey: "einsatz", Icon: Flame, cls: stopStatusTextClass("active") },
  returning: { labelKey: "beendet", Icon: Check, cls: stopStatusTextClass("returning") },
  complete: { labelKey: "abgeschlossen", Icon: Check, cls: stopStatusTextClass("complete") },
}

/**
 * Stop status control — mirrors the board columns. One button that says the
 * status in full and opens a menu of all of them; a click never changes the
 * status by itself (it used to advance to the next one, which read as a display).
 * Every label is laid out invisibly in the same cell, so the button is as wide as
 * the longest one in the current language: no label is cut and the rows of a list
 * stay aligned. A completed stop is not reopened from here.
 */
export function StopStatusControl({
  op,
  onSetStatus,
}: {
  op: Operation | undefined
  onSetStatus: (status: MirrorStatus) => void
}) {
  const t = useTranslations("kanban.stopStatus")
  const current = toMirrorStatus(op)
  const conf = MIRROR_CONFIG[current]
  const Icon = conf.Icon
  const done = current === "complete"
  const label = t(conf.labelKey)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={done}>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex h-6 flex-shrink-0 items-center gap-1 rounded-sm border border-border/60 px-1.5 text-xs font-medium whitespace-nowrap transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset disabled:cursor-default disabled:hover:bg-transparent",
            conf.cls,
          )}
          aria-label={done ? label : t("change", { label })}
        >
          <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span className="grid text-left">
            {MIRROR_ORDER.map((s) => (
              <span
                key={s}
                aria-hidden={s !== current}
                className={cn("col-start-1 row-start-1", s !== current && "invisible")}
              >
                {t(MIRROR_CONFIG[s].labelKey)}
              </span>
            ))}
          </span>
          {!done && <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="z-elevated" onClick={(e) => e.stopPropagation()}>
        {MIRROR_ORDER.map((s) => {
          const c = MIRROR_CONFIG[s]
          const SIcon = c.Icon
          return (
            <DropdownMenuItem key={s} onClick={() => onSetStatus(s)}>
              <SIcon className={cn("mr-2 h-4 w-4", c.cls)} />
              {t(c.labelKey)}
              {s === current && <Check className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
  /** The Auftrag's colour: renders the stops as `<li>` timeline items (numbered
   *  nodes in the route-pin look, on a line in this colour) for the caller's
   *  `<ol>` instead of the dense rows. The `/map` Routenplanung panel uses it. */
  timelineColor?: string
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
  timelineColor,
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

  // The menu way to reorder («Nach oben / Nach unten»): the same write as a drop,
  // off the authoritative order. Off while dragging is off (preview, read-only).
  const canMove = !reorderDisabled && !readOnly
  const move = (incidentId: string, to: MoveTo) => {
    const next = moveInList(stopIds, stopIds.indexOf(incidentId), to)
    if (next) onReorder(next)
  }

  return (
    <>
      {displayOrder.map((incidentId, index) =>
        timelineColor ? (
          <TimelineStopRow
            key={incidentId}
            groupId={groupId}
            incidentId={incidentId}
            index={index}
            count={displayOrder.length}
            onMove={canMove ? (to) => move(incidentId, to) : undefined}
            op={operationsById.get(incidentId)}
            color={timelineColor}
            reorderDisabled={reorderDisabled || readOnly}
            onSelect={() => onSelectStop(incidentId)}
            selected={focusStopId === incidentId}
            onSetStatus={readOnly ? undefined : onSetStopStatus}
            onRemove={readOnly ? undefined : onRemoveStop}
            allowComplete={allowComplete}
          />
        ) : (
          <StopListRow
            key={incidentId}
            groupId={groupId}
            incidentId={incidentId}
            index={index}
            count={displayOrder.length}
            onMove={canMove ? (to) => move(incidentId, to) : undefined}
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
        ),
      )}
    </>
  )
}

/**
 * Drag source (by its handle) + drop target for one stop row — shared by the dense
 * row and the timeline row. `ref` goes on the row, `handleRef` on its grip button.
 * The `group-stop` drop contract is the one the page-level useKanbanDragDrop monitor
 * assigns resources by; the list's own monitor reorders `route-stop-drag` sources.
 */
function useStopRowDnd(groupId: string, incidentId: string, index: number, reorderDisabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)
  const [isDropOver, setIsDropOver] = useState(false)

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

  return { ref, handleRef, closestEdge, isDropOver }
}

/**
 * Right-click on a stop row: the same per-stop actions as its controls and its ⋮ menu. The
 * trigger wraps a PLAIN div (the dnd/click row is the child) so the draggable
 * ref + handlers don't clobber the contextmenu listener — the forwarding-div
 * pattern used for the Auftrag header.
 */
function StopRowMenu({
  incidentId,
  index,
  count,
  mirror,
  onSetStatus,
  onMove,
  onRemove,
  allowComplete,
  children,
}: {
  incidentId: string
  index: number
  count: number
  onMove?: (to: MoveTo) => void
  mirror: MirrorStatus
  onSetStatus?: (incidentId: string, status: MirrorStatus) => void
  onRemove?: (incidentId: string) => void
  allowComplete: boolean
  children: ReactNode
}) {
  const t = useTranslations("kanban.routenEditorModal")
  const tStatus = useTranslations("kanban.stopStatus")
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-max min-w-52 max-w-[min(22rem,var(--radix-context-menu-content-available-width))] [&_[data-slot=context-menu-item]]:whitespace-nowrap [&_[data-slot=context-menu-sub-trigger]]:whitespace-nowrap">
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
        {onSetStatus && onMove && <ContextMenuSeparator />}
        {onMove && <MoveMenuItems Item={ContextMenuItem} index={index} count={count} onMove={onMove} />}
        {(onSetStatus || onMove) && onRemove && <ContextMenuSeparator />}
        {onRemove && (
          <ContextMenuItem onClick={() => onRemove(incidentId)} className="text-destructive focus:text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            {t("removeStop")}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * The ⋮ at the end of a stop row: «Nach oben / Nach unten / An den Anfang» and
 * «Stopp entfernen». Nothing at all on a read-only row.
 */
function StopRowActions({
  label,
  index,
  count,
  onMove,
  onRemove,
}: {
  /** The stop's address (or type) – names the button. */
  label: string
  index: number
  count: number
  onMove?: (to: MoveTo) => void
  onRemove?: () => void
}) {
  const t = useTranslations("kanban.routenEditorModal")
  if (!onMove && !onRemove) return null
  return (
    <ReorderMenu label={t("stopActions", { name: label })} index={index} count={count} onMove={onMove} className="flex-shrink-0">
      {onRemove && (
        <DropdownMenuItem variant="destructive" onClick={onRemove}>
          <Trash2 className="mr-2 h-4 w-4" />
          {t("removeStop")}
        </DropdownMenuItem>
      )}
    </ReorderMenu>
  )
}

interface StopListRowProps {
  groupId: string
  incidentId: string
  index: number
  /** Stops in the list – with `onMove`, what the ⋮ menu's move entries need. */
  count: number
  /** Reorder without dragging; absent while reordering is off. */
  onMove?: (to: MoveTo) => void
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
  count,
  onMove,
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
  const { ref, handleRef, closestEdge, isDropOver } = useStopRowDnd(groupId, incidentId, index, reorderDisabled)

  const { formatLocation } = useOperations()
  const mirror = toMirrorStatus(op)
  const mirrorConf = MIRROR_CONFIG[mirror]
  // Primary line = the address (home city stripped); the incident type is the
  // muted secondary line; the Meldung shows on hover (title on the wrapper).
  const name = op ? getIncidentTypeLabel(op.incidentType) : incidentId
  const address = op?.location ? formatLocation(op.location) : undefined

  const MirrorIcon = mirrorConf.Icon

  return (
    <div className="relative">
      {closestEdge === "top" && <DropIndicator edge="top" gap="2px" />}
      <StopRowMenu incidentId={incidentId} index={index} count={count} onMove={onMove} mirror={mirror} onSetStatus={onSetStatus} onRemove={onRemove} allowComplete={allowComplete}>
      <div
        ref={ref}
        onClick={onSelect}
        className={cn(
          // Column layout: [handle] [number] [status — fixed width] [name/address — flex].
          "flex cursor-pointer items-center gap-2 rounded-md border-l-2 px-1.5 py-1.5 text-sm transition-colors hover:bg-muted/40",
          stopStatusBorderClass(mirror),
          selected && "bg-sel-wash ring-1 ring-sel-edge",
          isDropOver && "bg-sel-wash ring-2 ring-sel-line",
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
        <StopRowActions
          label={address ?? name}
          index={index}
          count={count}
          onMove={onMove}
          onRemove={onRemove ? () => onRemove(incidentId) : undefined}
        />
      </div>
      </StopRowMenu>
      {closestEdge === "bottom" && <DropIndicator edge="bottom" gap="2px" />}
    </div>
  )
}

// ── Timeline ─────────────────────────────────────────────────────────────────
// The `/map` Routenplanung list: every row hangs off a node on one vertical line
// (start → stops → «Stopp hinzufügen»). The caller owns the `<ol>`; these are its
// items. A row is `TIMELINE_ROW` with a `TimelineNode` inside it.

/** A timeline row's box: room on the left for the node, at least a touch target tall. */
export const TIMELINE_ROW = "relative flex min-h-11 w-full items-start gap-2 rounded-md py-1 pr-1 pl-10 text-left"

/**
 * One `<li>` of the timeline: the connector from this node down to the next one,
 * in `lineColor` (an Auftrag colour; default the muted ink). The last item of the
 * `<ol>` draws no connector.
 */
export function RouteTimelineItem({ lineColor, children }: { lineColor?: string; children: ReactNode }) {
  return (
    <li className="group/tl relative pb-1.5">
      <span
        aria-hidden
        // Node bottom (row padding 4px + 28px) to the next item's node top (4px into it).
        className={cn("absolute top-8 -bottom-1 left-[17px] w-0.5 group-last/tl:hidden", !lineColor && "bg-muted-foreground/35")}
        style={lineColor ? { backgroundColor: lineColor, opacity: 0.45 } : undefined}
      />
      {children}
    </li>
  )
}

/** The round node at a timeline row's left: 28px with the white ring the map's route pins wear. */
export function TimelineNode({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-1 left-1 z-[1] flex size-7 items-center justify-center rounded-full border-2 border-white text-xs leading-none font-bold text-white shadow-sm",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  )
}

// The node's outer frame says the stop's column the way its pin on the map does
// (group-routes.tsx after STATUS_GROUP_BORDER_STYLE): Offen dashed, Disponiert /
// Einsatz solid, Beendet dotted and faded – never a status colour.
const NODE_FRAME: Record<MirrorStatus, string> = {
  incoming: "outline-dashed",
  enroute: "outline-solid",
  active: "outline-solid",
  returning: "outline-dotted opacity-60",
  complete: "outline-dotted opacity-60",
}

interface TimelineStopRowProps {
  groupId: string
  incidentId: string
  index: number
  /** Stops in the list – with `onMove`, what the ⋮ menu's move entries need. */
  count: number
  /** Reorder without dragging; absent while reordering is off. */
  onMove?: (to: MoveTo) => void
  op: Operation | undefined
  color: string
  reorderDisabled: boolean
  onSelect: () => void
  selected: boolean
  onSetStatus?: (incidentId: string, status: MirrorStatus) => void
  onRemove?: (incidentId: string) => void
  allowComplete: boolean
}

/**
 * A stop in the timeline: its number on a node in the Auftrag's colour (the same
 * number as its pin on the map), the address over up to two lines, then
 * «Nr · Typ» and – where the list is wide enough – the Meldung. Drag handle and ✕
 * on the right; right-click offers the same as the dense row.
 */
function TimelineStopRow({
  groupId,
  incidentId,
  index,
  count,
  onMove,
  op,
  color,
  reorderDisabled,
  onSelect,
  selected,
  onSetStatus,
  onRemove,
  allowComplete,
}: TimelineStopRowProps) {
  const t = useTranslations("kanban.routenEditorModal")
  const tStatus = useTranslations("kanban.stopStatus")
  const { ref, handleRef, closestEdge, isDropOver } = useStopRowDnd(groupId, incidentId, index, reorderDisabled)
  const { formatLocation } = useOperations()
  const mirror = toMirrorStatus(op)
  const type = op ? getIncidentTypeLabel(op.incidentType) : incidentId
  const address = op?.location ? formatLocation(op.location) : undefined
  const meldung = op?.notes.split("\n")[0].trim() ?? ""
  const located = isLocated(op)
  const number = op?.number ?? null
  // The full second line for the hover title (the Meldung hides in a narrow list).
  const metaTitle = [number, address ? type : null, located ? null : t("noCoords"), op?.notes || null]
    .filter((part) => part !== null)
    .join(" · ")

  return (
    <RouteTimelineItem lineColor={color}>
      {closestEdge === "top" && <DropIndicator edge="top" gap="2px" />}
      <StopRowMenu incidentId={incidentId} index={index} count={count} onMove={onMove} mirror={mirror} onSetStatus={onSetStatus} onRemove={onRemove} allowComplete={allowComplete}>
        <div
          ref={ref}
          onClick={onSelect}
          className={cn(
            TIMELINE_ROW,
            "cursor-pointer transition-colors hover:bg-muted/40",
            selected && "bg-sel-wash ring-1 ring-sel-edge",
            isDropOver && "bg-sel-wash ring-2 ring-sel-line",
          )}
        >
          <TimelineNode className={cn("outline-2 outline-foreground/55", NODE_FRAME[mirror])} style={{ backgroundColor: color }}>
            {index + 1}
          </TimelineNode>
          <div className="min-w-0 flex-1 pt-1 leading-tight">
            <div className="line-clamp-2 text-sm font-medium break-words hyphens-auto" title={address ?? type}>
              {address ?? type}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground" title={metaTitle || undefined}>
              <span className="sr-only">{tStatus(MIRROR_CONFIG[mirror].labelKey)} · </span>
              {number !== null && <span className="font-mono tabular-nums">{number}</span>}
              {number !== null && address && " · "}
              {address && type}
              {!located && (
                <>
                  {(number !== null || address) && " · "}
                  <span className="text-muted-foreground/80">{t("noCoordsBadge")}</span>
                </>
              )}
              {/* The Meldung only once the list is wide enough to carry it (≥ 24rem). */}
              {meldung && <span className="hidden @sm:inline"> · {meldung}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center pt-0.5">
            <button
              ref={handleRef}
              type="button"
              onClick={(e) => e.stopPropagation()}
              // Read-only: no handle at all rather than a dead one.
              className="inline-flex size-6 cursor-grab items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:hidden"
              disabled={reorderDisabled}
              aria-label={t("dragStop")}
              title={t("dragStop")}
            >
              <GripVertical className="size-3.5" />
            </button>
            <StopRowActions
              label={address ?? type}
              index={index}
              count={count}
              onMove={onMove}
              onRemove={onRemove ? () => onRemove(incidentId) : undefined}
            />
          </div>
        </div>
      </StopRowMenu>
      {closestEdge === "bottom" && <DropIndicator edge="bottom" gap="2px" />}
    </RouteTimelineItem>
  )
}
