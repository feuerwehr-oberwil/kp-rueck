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
import { GripVertical, Check, CircleDot, CircleDashed } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Operation } from "@/lib/contexts/operations-context"
import { isLocated } from "@/lib/utils/route-geo"

export type StopState = "erledigt" | "laeuft" | "offen"

/** Derived checklist state of a single stop, straight from its incident status. */
export function deriveStopState(op: Operation | undefined): StopState {
  if (!op) return "offen"
  if (op.status === "returning" || op.status === "complete") return "erledigt"
  if (op.status === "active") return "laeuft"
  return "offen"
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
}: RouteStopListProps) {
  // Reorder monitor: source `route-stop-drag` reordered onto a `group-stop`
  // target computes the new order off the authoritative `stopIds`.
  useEffect(() => {
    if (!enabled || !groupId) return
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
  }, [enabled, groupId, stopIds, onReorder])

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
          reorderDisabled={reorderDisabled}
          onSelect={() => onSelectStop(incidentId)}
          selected={focusStopId === incidentId}
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
}: StopListRowProps) {
  const t = useTranslations("kanban.routenEditorModal")
  const ref = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)
  const [isDropOver, setIsDropOver] = useState(false)

  const state = deriveStopState(op)

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

  const StateIcon = state === "erledigt" ? Check : state === "laeuft" ? CircleDot : CircleDashed
  const stateClass =
    state === "erledigt"
      ? "text-emerald-600 dark:text-emerald-400"
      : state === "laeuft"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground/60"

  return (
    <div className="relative">
      {closestEdge === "top" && <DropIndicator edge="top" gap="2px" />}
      <div
        ref={ref}
        onClick={onSelect}
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-muted/40",
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
        <span className="w-4 flex-shrink-0 tabular-nums text-xs text-muted-foreground">{index + 1}.</span>
        <StateIcon className={cn("h-4 w-4 flex-shrink-0", stateClass)} />
        <span className="min-w-0 flex-1 truncate">{op?.location ?? incidentId}</span>
        {!isLocated(op) && (
          <span className="flex-shrink-0 text-xs text-muted-foreground/70" title={t("noCoords")}>
            {t("noCoordsBadge")}
          </span>
        )}
      </div>
      {closestEdge === "bottom" && <DropIndicator edge="bottom" gap="2px" />}
    </div>
  )
}
