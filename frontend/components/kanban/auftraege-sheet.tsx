"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
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
import {
  Plus,
  ChevronRight,
  ChevronDown,
  GripVertical,
  MoreHorizontal,
  Map as MapIcon,
  Check,
  CircleDashed,
  CircleDot,
  Trash2,
  Copy,
  Route,
} from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/components/ui/use-mobile"
import { useGroups, type IncidentGroup } from "@/lib/contexts/groups-context"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import type { GroupResourceType, IncidentGroupMode } from "@/lib/api-client"

// Six-swatch palette for the inline create / colour picker. Kept small and
// distinct so routes read apart at a glance on board + map.
const SWATCHES = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"] as const

// Derived checklist state of a single stop, straight from its incident status.
type StopState = "erledigt" | "laeuft" | "offen"

function deriveStopState(op: Operation | undefined): StopState {
  if (!op) return "offen"
  if (op.status === "returning" || op.status === "complete") return "erledigt"
  if (op.status === "active") return "laeuft"
  return "offen"
}

interface AuftraegeSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When the sheet is opened from a board chip, expand + scroll to this group. */
  focusGroupId?: string | null
  /** Opens the shared NewEmergencyModal with the group preset (streamlined "+ Stop"). */
  onAddStop: (groupId: string) => void
  /** Reuses the page's existing ResourceAssignmentDialog flow for one stop. */
  onAssignResource: (resourceType: "crew" | "vehicles" | "materials", operationId: string) => void
  /** Opens the existing OperationDetailModal for a stop. */
  onOpenDetail: (operationId: string) => void
  /** Opens the Routen-Editor modal for a route; optional stop to centre/focus on. */
  onOpenRoutenEditor?: (groupId: string, focusIncidentId?: string) => void
}

export function AuftraegeSheet({
  open,
  onOpenChange,
  focusGroupId,
  onAddStop,
  onAssignResource,
  onOpenDetail,
  onOpenRoutenEditor,
}: AuftraegeSheetProps) {
  const t = useTranslations("kanban.auftraege")
  const isMobile = useIsMobile()
  const { groups, isLoaded, createGroup, updateGroup, deleteGroup, reorderGroupStops, removeStop, copySquad } =
    useGroups()
  const { operations, updateOperation } = useOperations()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState<string>(SWATCHES[0])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())

  // Expand + scroll to a group when the sheet is opened from a board chip.
  useEffect(() => {
    if (!open || !focusGroupId) return
    setExpanded((prev) => new Set(prev).add(focusGroupId))
    // Defer to let the row mount before scrolling.
    const id = window.setTimeout(() => {
      rowRefs.current.get(focusGroupId)?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 60)
    return () => window.clearTimeout(id)
  }, [open, focusGroupId])

  // Sheet-local monitor: reorders stops within a route (source `group-stop-drag`).
  // Resource / card drops onto these same targets are handled by the shared
  // board drag hook, keyed off the *source* type, so the two never collide.
  useEffect(() => {
    if (!open) return
    return monitorForElements({
      onDrop({ source, location }) {
        const dest = location.current.dropTargets[0]
        if (!dest) return
        const s = source.data
        const d = dest.data
        if (s.type !== "group-stop-drag" || d.type !== "group-stop") return
        if (s.groupId !== d.groupId) return

        const group = groups.find((g) => g.id === s.groupId)
        if (!group) return

        const fromId = s.incidentId as string
        const toId = d.incidentId as string
        if (fromId === toId) return

        const edge = extractClosestEdge(dest.data)
        const current = group.stopIds
        const without = current.filter((id) => id !== fromId)
        let targetIndex = without.indexOf(toId)
        if (targetIndex === -1) return
        if (edge === "bottom") targetIndex += 1
        const reordered = [...without.slice(0, targetIndex), fromId, ...without.slice(targetIndex)]
        reorderGroupStops(group.id, reordered)
      },
    })
  }, [open, groups, reorderGroupStops])

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const startCreate = () => {
    setNewName(t("defaultName", { n: groups.length + 1 }))
    setNewColor(SWATCHES[groups.length % SWATCHES.length])
    setCreating(true)
  }

  const confirmCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(false)
    const created = await createGroup({ name, color: newColor })
    if (created) setExpanded((prev) => new Set(prev).add(created.id))
  }

  return (
    <>
      <Sheet modal={isMobile} open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          hideCloseButton={!isMobile}
          overlayOffset={isMobile ? undefined : "42px"}
          nonModal={!isMobile}
          className={cn("flex flex-col max-w-4xl mx-auto px-6 py-4", isMobile ? "max-h-[75vh]" : "max-h-[85vh]")}
          style={isMobile ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" } : undefined}
          onInteractOutside={
            isMobile
              ? undefined
              : (e) => {
                  const target = e.target as HTMLElement
                  if (target.closest("footer") || target.closest('[role="dialog"]')) {
                    e.preventDefault()
                  }
                }
          }
        >
          <SheetHeader className="p-0">
            <div className="flex items-center justify-between gap-4">
              <div>
                <SheetTitle>{t("title")}</SheetTitle>
                <SheetDescription>{t("description")}</SheetDescription>
              </div>
              <Button size="sm" variant="outline" onClick={startCreate} className="flex-shrink-0 gap-1.5">
                <Plus className="h-4 w-4" />
                {t("newAuftrag")}
              </Button>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto mt-3 pb-10 space-y-2">
            {/* Inline create row */}
            {creating && (
              <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.03] px-3 py-2.5">
                <Route className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <Input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmCreate()
                    if (e.key === "Escape") setCreating(false)
                  }}
                  className="h-8 flex-1"
                  placeholder={t("namePlaceholder")}
                />
                <div className="flex items-center gap-1">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      onClick={() => setNewColor(c)}
                      className={cn(
                        "h-5 w-5 rounded-full border transition-transform",
                        newColor === c ? "ring-2 ring-offset-1 ring-offset-background ring-foreground/40 scale-110" : "",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <Button size="sm" className="h-8" onClick={confirmCreate} disabled={!newName.trim()}>
                  {t("create")}
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setCreating(false)}>
                  {t("cancel")}
                </Button>
              </div>
            )}

            {isLoaded && groups.length === 0 && !creating && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Route className="h-10 w-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
              </div>
            )}

            {groups.map((group) => (
              <AuftragCard
                key={group.id}
                group={group}
                operations={operations}
                expanded={expanded.has(group.id)}
                onToggle={() => toggleExpanded(group.id)}
                isRenaming={renamingId === group.id}
                renameValue={renameValue}
                setRenameValue={setRenameValue}
                onStartRename={() => {
                  setRenamingId(group.id)
                  setRenameValue(group.name)
                }}
                onCommitRename={() => {
                  const v = renameValue.trim()
                  if (v && v !== group.name) updateGroup(group.id, { name: v })
                  setRenamingId(null)
                }}
                onCancelRename={() => setRenamingId(null)}
                onSetMode={(mode) => updateGroup(group.id, { mode })}
                onRequestDelete={() => setDeleteId(group.id)}
                onAddStop={() => onAddStop(group.id)}
                onOpenRoutenEditor={(focusIncidentId) => onOpenRoutenEditor?.(group.id, focusIncidentId)}
                onAssignResource={onAssignResource}
                onOpenDetail={onOpenDetail}
                onRemoveStop={(incidentId) => removeStop(group.id, incidentId)}
                onMarkDone={(incidentId) => updateOperation(incidentId, { status: "complete" })}
                onCopySquad={async (resourceTypes) => {
                  const sourceId = group.stopIds[0]
                  if (!sourceId) return
                  const result = await copySquad(group.id, sourceId, resourceTypes)
                  if (result) {
                    toast.success(t("copyToast", { copied: result.copied, skipped: result.skipped }))
                  }
                }}
                registerRowRef={(el) => rowRefs.current.set(group.id, el)}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) deleteGroup(deleteId)
                setDeleteId(null)
              }}
            >
              {t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface AuftragCardProps {
  group: IncidentGroup
  operations: Operation[]
  expanded: boolean
  onToggle: () => void
  isRenaming: boolean
  renameValue: string
  setRenameValue: (v: string) => void
  onStartRename: () => void
  onCommitRename: () => void
  onCancelRename: () => void
  onSetMode: (mode: IncidentGroupMode) => void
  onRequestDelete: () => void
  onAddStop: () => void
  onOpenRoutenEditor: (focusIncidentId?: string) => void
  onAssignResource: (resourceType: "crew" | "vehicles" | "materials", operationId: string) => void
  onOpenDetail: (operationId: string) => void
  onRemoveStop: (incidentId: string) => void
  onMarkDone: (incidentId: string) => void
  onCopySquad: (resourceTypes: GroupResourceType[]) => void
  registerRowRef: (el: HTMLDivElement | null) => void
}

function AuftragCard({
  group,
  operations,
  expanded,
  onToggle,
  isRenaming,
  renameValue,
  setRenameValue,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onSetMode,
  onRequestDelete,
  onAddStop,
  onOpenRoutenEditor,
  onAssignResource,
  onOpenDetail,
  onRemoveStop,
  onMarkDone,
  onCopySquad,
  registerRowRef,
}: AuftragCardProps) {
  const t = useTranslations("kanban.auftraege")
  const headerRef = useRef<HTMLDivElement>(null)
  const [isDropOver, setIsDropOver] = useState(false)

  const opById = useMemo(() => new Map(operations.map((o) => [o.id, o] as const)), [operations])
  const source = group.stopIds.length ? opById.get(group.stopIds[0]) : undefined
  const sourceId = group.stopIds[0] ?? null

  const total = group.stopIds.length
  const done = group.stopIds.reduce((n, id) => (deriveStopState(opById.get(id)) === "erledigt" ? n + 1 : n), 0)

  const vehicleName = source?.vehicles[0] ?? null
  const persCount = source?.crew.length ?? 0
  const squadSummary = useMemo(() => {
    if (!vehicleName && persCount === 0) return t("noSquad")
    if (group.mode === "vehicle_only") return `${vehicleName ?? "—"} · ${t("pendeldienst")}`
    return `${vehicleName ?? t("noVehicle")} · ${t("persLabel", { count: persCount })}`
  }, [group.mode, vehicleName, persCount, t])

  // Register the header as a drop target for resource / card drags (shared hook).
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    return dropTargetForElements({
      element: el,
      getData: () => ({ type: "group-row", groupId: group.id }),
      canDrop: ({ source: src }) => {
        const type = src.data.type
        return type === "operation" || type === "person" || type === "driver-vehicle" || type === "material" || type === "material-group"
      },
      onDragEnter: () => setIsDropOver(true),
      onDragLeave: () => setIsDropOver(false),
      onDrop: () => setIsDropOver(false),
    })
  }, [group.id])

  return (
    <div
      ref={registerRowRef}
      className={cn("rounded-lg border bg-card transition-colors", isDropOver && "ring-2 ring-primary/50 bg-primary/[0.04]")}
    >
      {/* Header row */}
      <div ref={headerRef} className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={onToggle} className="flex-shrink-0 text-muted-foreground hover:text-foreground" aria-label={t("toggle")}>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span
          className="h-3 w-3 rounded-full flex-shrink-0 border border-black/10"
          style={{ backgroundColor: group.color ?? "var(--muted-foreground)" }}
        />
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={onCommitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCommitRename()
                if (e.key === "Escape") onCancelRename()
              }}
              className="h-7 max-w-xs"
            />
          ) : (
            <button
              onClick={onStartRename}
              className="font-semibold text-sm truncate hover:underline decoration-dotted underline-offset-2 text-left"
              title={t("rename")}
            >
              {group.name}
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[160px]">{squadSummary}</span>
        <span className="text-xs font-medium tabular-nums text-muted-foreground flex-shrink-0">
          {t("progress", { done, total })}
        </span>

        {/* Mode segmented control */}
        <div className="flex items-center rounded-md border overflow-hidden flex-shrink-0">
          <button
            onClick={() => onSetMode("squad")}
            className={cn(
              "px-2 py-1 text-[11px] transition-colors",
              group.mode === "squad" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("modeSquad")}
          </button>
          <button
            onClick={() => onSetMode("vehicle_only")}
            className={cn(
              "px-2 py-1 text-[11px] transition-colors border-l",
              group.mode === "vehicle_only"
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("modeVehicleOnly")}
          </button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onStartRename}>{t("rename")}</DropdownMenuItem>
            <DropdownMenuItem onClick={onRequestDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Expanded checklist */}
      {expanded && (
        <div className="border-t px-3 py-2 space-y-0.5">
          {group.stopIds.length === 0 && <p className="py-2 text-xs text-muted-foreground">{t("noStops")}</p>}
          {group.stopIds.map((incidentId, index) => (
            <StopRow
              key={incidentId}
              groupId={group.id}
              incidentId={incidentId}
              index={index}
              op={opById.get(incidentId)}
              onRemove={() => onRemoveStop(incidentId)}
              onMarkDone={() => onMarkDone(incidentId)}
              onOpenDetail={() => onOpenDetail(incidentId)}
              onOpenMap={onOpenRoutenEditor}
            />
          ))}

          {/* Row footer actions */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onAddStop}>
              <Plus className="h-3.5 w-3.5" />
              {t("addStop")}
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => onOpenRoutenEditor()}>
              <MapIcon className="h-3.5 w-3.5" />
              {t("routenEditor")}
            </Button>

            {sourceId && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5">
                    {t("assignSquad")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => onAssignResource("vehicles", sourceId)}>{t("assignVehicle")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onAssignResource("crew", sourceId)}>{t("assignCrew")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onAssignResource("materials", sourceId)}>{t("assignMaterial")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <CopyPicker mode={group.mode} disabled={total < 2 || !sourceId} onConfirm={onCopySquad} />
          </div>
        </div>
      )}
    </div>
  )
}

interface StopRowProps {
  groupId: string
  incidentId: string
  index: number
  op: Operation | undefined
  onRemove: () => void
  onMarkDone: () => void
  onOpenDetail: () => void
  onOpenMap: (focusIncidentId?: string) => void
}

function StopRow({ groupId, incidentId, index, op, onRemove, onMarkDone, onOpenDetail, onOpenMap }: StopRowProps) {
  const t = useTranslations("kanban.auftraege")
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
        getInitialData: () => ({ type: "group-stop-drag", groupId, incidentId, index }),
      }),
      dropTargetForElements({
        element: el,
        // Serves two source kinds: `group-stop-drag` (reorder, handled by the
        // sheet-local monitor) and resource drags (assign, handled by the shared
        // board hook). Both read `{ groupId, incidentId }`.
        getData: ({ input }) =>
          attachClosestEdge({ type: "group-stop", groupId, incidentId, index }, { element: el, input, allowedEdges: ["top", "bottom"] }),
        onDragEnter: ({ self, source }) => {
          if (source.data.type === "group-stop-drag") setClosestEdge(extractClosestEdge(self.data))
          else setIsDropOver(true)
        },
        onDrag: ({ self, source }) => {
          if (source.data.type === "group-stop-drag") setClosestEdge(extractClosestEdge(self.data))
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
  }, [groupId, incidentId, index])

  const StateIcon = state === "erledigt" ? Check : state === "laeuft" ? CircleDot : CircleDashed
  const stateClass =
    state === "erledigt" ? "text-emerald-600 dark:text-emerald-400" : state === "laeuft" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/60"
  const stateLabel = state === "erledigt" ? t("stateDone") : state === "laeuft" ? t("stateActive") : t("stateOpen")

  return (
    <div className="relative">
      {closestEdge === "top" && <DropIndicator edge="top" gap="2px" />}
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-muted/40",
          isDropOver && "ring-2 ring-primary/50 bg-primary/[0.04]",
        )}
      >
        <button ref={handleRef} className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0" aria-label={t("dragStop")}>
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="tabular-nums text-xs text-muted-foreground w-4 flex-shrink-0">{index + 1}.</span>
        <StateIcon className={cn("h-4 w-4 flex-shrink-0", stateClass)} />
        <span className="min-w-0 flex-1 truncate">{op?.location ?? incidentId}</span>
        <span className={cn("text-xs flex-shrink-0 hidden sm:inline", stateClass)}>{stateLabel}</span>
        {/* [Karte] — opens the Routen-Editor centred on this stop. */}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs flex-shrink-0"
          onClick={() => onOpenMap(incidentId)}
        >
          {t("map")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpenDetail}>{t("openDetail")}</DropdownMenuItem>
            {state !== "erledigt" && <DropdownMenuItem onClick={onMarkDone}>{t("markDone")}</DropdownMenuItem>}
            <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
              {t("removeStop")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {closestEdge === "bottom" && <DropIndicator edge="bottom" gap="2px" />}
    </div>
  )
}

interface CopyPickerProps {
  mode: IncidentGroupMode
  disabled: boolean
  onConfirm: (resourceTypes: GroupResourceType[]) => void
}

function CopyPicker({ mode, disabled, onConfirm }: CopyPickerProps) {
  const t = useTranslations("kanban.auftraege")
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState<Record<GroupResourceType, boolean>>({
    vehicle: true,
    personnel: mode !== "vehicle_only",
    material: mode !== "vehicle_only",
  })

  // Re-seed from the mode each time the picker opens.
  useEffect(() => {
    if (open) {
      setPick({ vehicle: true, personnel: mode !== "vehicle_only", material: mode !== "vehicle_only" })
    }
  }, [open, mode])

  const selected = (Object.keys(pick) as GroupResourceType[]).filter((k) => pick[k])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary" className="h-8 gap-1.5" disabled={disabled}>
          <Copy className="h-3.5 w-3.5" />
          {t("copyToAll")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 space-y-3">
        <p className="text-xs font-medium text-muted-foreground">{t("copyPickerTitle")}</p>
        {(["vehicle", "personnel", "material"] as GroupResourceType[]).map((type) => (
          <label key={type} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={pick[type]} onCheckedChange={(v) => setPick((p) => ({ ...p, [type]: v === true }))} />
            {t(`resource_${type}`)}
          </label>
        ))}
        <Button
          size="sm"
          className="w-full"
          disabled={selected.length === 0}
          onClick={() => {
            onConfirm(selected)
            setOpen(false)
          }}
        >
          {t("copyConfirm")}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
