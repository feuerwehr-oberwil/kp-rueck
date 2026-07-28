"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import {
  Plus,
  ChevronRight,
  ChevronDown,
  GripVertical,
  MoreHorizontal,
  Map as MapIcon,
  Trash2,
  Route,
  Palette,
  Pencil,
  Wand2,
  Check,
  Info,
  Radio,
} from "lucide-react"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
import { useDialogDragGuard } from "@/lib/hooks/use-dialog-drag-guard"
import { useIsMobile } from "@/components/ui/use-mobile"
import { useFooterOffset } from "@/components/ui/footer-sheet"
import { useGroups, type IncidentGroup } from "@/lib/contexts/groups-context"
import { useOperations, type Operation, type OperationStatus } from "@/lib/contexts/operations-context"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { useRoutePlanning, type RouteStartMode } from "@/lib/hooks/use-route-planning"
import { StopStatusControl, RouteOptimizeMenu, toMirrorStatus, MIRROR_ORDER, MIRROR_CONFIG, type MirrorStatus } from "@/components/map/route-stop-list"
import { RouteResourceSections, ResourceSectionHeader } from "@/components/kanban/route-resource-sections"
import { AuftragRadioDialog } from "@/components/kanban/auftrag-radio-dialog"
import { stopStatusBorderClass } from "@/lib/kanban-utils"
import { isToastLayer } from "@/lib/toast-layer"
import type { GroupResources } from "@/lib/types/groups"

// Six-swatch palette for the inline create / colour picker. Kept small and
// distinct so routes read apart at a glance on board + map.
const SWATCHES = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"] as const

// True when an event originates inside ANY dialog layered over this sheet.
//
// Both roles, deliberately. The sheet is non-modal on desktop, so every click inside a dialog
// stacked on top of it arrives here as an "outside interaction". The guard used to look for
// `[role="dialog"]` only — but a Radix AlertDialog renders `role="alertdialog"`, and the
// confirm prompts that appear mid-assignment («Fahrzeug bereits im Einsatz» → «Mehrfach
// zuweisen», the Sonderfunktion confirm for Mannschaft) are exactly those. Answering one of
// them therefore dismissed the whole Aufträge-Slide-up, and only Material — which has no
// conflict prompt — appeared to behave.
function isDialogTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest('[role="dialog"], [role="alertdialog"]')
}

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
  /** Opens the incident picker to add EXISTING incidents as stops to the route. */
  onAddStop: (groupId: string) => void
  /** Opens the ResourceAssignmentDialog scoped to the ROUTE (works with 0 stops). */
  onAssignRouteResource: (resourceType: "crew" | "vehicles" | "materials", groupId: string) => void
  /** Opens the existing OperationDetailModal for a stop. */
  onOpenDetail: (operationId: string) => void
  /** Opens the Routen-Editor modal for a route; optional stop to centre/focus on. */
  onOpenRoutenEditor?: (groupId: string, focusIncidentId?: string) => void
  canEdit: boolean
  onSetStopStatus?: (incidentId: string, status: OperationStatus) => void
  /** Radio call sign of the station, for «Durchsage wiederholen». */
  funkrufname?: string
}

export function AuftraegeSheet({
  open,
  onOpenChange,
  focusGroupId,
  onAddStop,
  onAssignRouteResource,
  onOpenDetail,
  onOpenRoutenEditor,
  canEdit,
  onSetStopStatus,
  funkrufname = "Omega",
}: AuftraegeSheetProps) {
  const t = useTranslations("kanban.auftraege")
  const isMobile = useIsMobile()
  const footerOffset = useFooterOffset(open && !isMobile)
  const { dragGuardProps } = useDialogDragGuard(open)
  const {
    groups,
    isLoaded,
    createGroup,
    updateGroup,
    deleteGroup,
    reorderGroupStops,
    removeStop,
    unassignResource,
    getGroupResources,
  } = useGroups()
  const { operations } = useOperations()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState<string>(SWATCHES[0])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [radioGroupId, setRadioGroupId] = useState<string | null>(null)

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
    if (!open || !canEdit) return
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
  }, [open, canEdit, groups, reorderGroupStops])

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
    // Collapse every existing Auftrag and expand only the new one, so the
    // operator focuses on the route they just created.
    if (created) setExpanded(new Set([created.id]))
  }

  return (
    <>
      <Sheet modal={isMobile} open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          hideCloseButton={!isMobile}
          overlayOffset={isMobile ? undefined : footerOffset}
          nonModal={!isMobile}
          className={cn("flex flex-col max-w-4xl mx-auto px-6 py-4", isMobile ? "max-h-[75vh]" : "max-h-[85vh]")}
          style={isMobile ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" } : undefined}
          onPointerDownOutside={(e) => {
            // A sonner toast is portalled outside this non-modal sheet, so clicking
            // its "Rückgängig" action counts as an outside interaction and would
            // dismiss the sheet. Ignore interactions that target a toast.
            if (isToastLayer(e.target)) {
              e.preventDefault()
              return
            }
            dragGuardProps.onPointerDownOutside(e)
          }}
          onFocusOutside={dragGuardProps.onFocusOutside}
          onEscapeKeyDown={dragGuardProps.onEscapeKeyDown}
          // The toast case never arrives here — SheetContent filters it out for
          // every sheet in the app. What is left is this sheet's own business.
          onInteractOutside={(e) => {
            // Defensive: a stop reorder drag inside the sheet must not dismiss it.
            dragGuardProps.onInteractOutside(e)
            if (e.defaultPrevented) return
            if (isMobile) return
            const target = e.target as HTMLElement
            if (target.closest("footer") || isDialogTarget(target)) {
              e.preventDefault()
            }
          }}
        >
          <SheetHeader className="p-0">
            <div className="flex items-center justify-between gap-4">
              <div>
                <SheetTitle>{t("title")}</SheetTitle>
                <SheetDescription>{t("description")}</SheetDescription>
              </div>
              {canEdit && <Button size="sm" variant="outline" onClick={startCreate} className="flex-shrink-0 gap-1.5">
                <Plus className="h-4 w-4" />
                {t("newAuftrag")}
              </Button>}
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto mt-3 pb-10 space-y-3">
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
                resources={getGroupResources(group.id)}
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
                onChangeColor={(color) => updateGroup(group.id, { color })}
                onRequestDelete={() => setDeleteId(group.id)}
                onRepeatRadio={() => setRadioGroupId(group.id)}
                onAddStop={() => onAddStop(group.id)}
                onOpenRoutenEditor={(focusIncidentId) => onOpenRoutenEditor?.(group.id, focusIncidentId)}
                onAssignRouteResource={(resourceType) => onAssignRouteResource(resourceType, group.id)}
                onUnassignResource={(assignmentId) => unassignResource(group.id, assignmentId)}
                onOpenDetail={onOpenDetail}
                onRemoveStop={(incidentId) => removeStop(group.id, incidentId)}
                registerRowRef={(el) => rowRefs.current.set(group.id, el)}
                canEdit={canEdit}
                onSetStopStatus={onSetStopStatus}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <AuftragRadioDialog
        open={!!radioGroupId}
        onOpenChange={(o) => !o && setRadioGroupId(null)}
        group={groups.find((g) => g.id === radioGroupId) ?? null}
        funkrufname={funkrufname}
      />

      <AlertDialog open={canEdit && !!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
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
  resources: GroupResources
  expanded: boolean
  onToggle: () => void
  isRenaming: boolean
  renameValue: string
  setRenameValue: (v: string) => void
  onStartRename: () => void
  onCommitRename: () => void
  onCancelRename: () => void
  onChangeColor: (color: string) => void
  onRequestDelete: () => void
  onRepeatRadio: () => void
  onAddStop: () => void
  onOpenRoutenEditor: (focusIncidentId?: string) => void
  onAssignRouteResource: (resourceType: "crew" | "vehicles" | "materials") => void
  onUnassignResource: (assignmentId: string) => void
  onOpenDetail: (operationId: string) => void
  onRemoveStop: (incidentId: string) => void
  registerRowRef: (el: HTMLDivElement | null) => void
  canEdit: boolean
  onSetStopStatus?: (incidentId: string, status: OperationStatus) => void
}

function AuftragCard({
  group,
  operations,
  resources,
  expanded,
  onToggle,
  isRenaming,
  renameValue,
  setRenameValue,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onChangeColor,
  onRequestDelete,
  onRepeatRadio,
  onAddStop,
  onOpenRoutenEditor,
  onAssignRouteResource,
  onUnassignResource,
  onOpenDetail,
  onRemoveStop,
  onSetStopStatus,
  registerRowRef,
  canEdit,
}: AuftragCardProps) {
  const t = useTranslations("kanban.auftraege")
  const headerRef = useRef<HTMLDivElement>(null)
  const [isDropOver, setIsDropOver] = useState(false)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)

  // Shared routing hook — powers the in-row "Reihenfolge optimieren" action so the
  // sheet can optimize without opening the Routen-Editor modal (applies at once).
  const planning = useRoutePlanning(group.id)

  const runOptimize = async (start: RouteStartMode) => {
    const previous = group.stopIds
    const proposed = planning.optimize(start)
    if (proposed.length === 0) return
    const unchanged = proposed.every((id, i) => id === previous[i])
    if (unchanged) {
      toast.info(t("optimizeUnchanged"))
      return
    }
    const persisted = await planning.reorder(proposed)
    if (!persisted) return
    toast.success(t("optimized"), {
      action: { label: t("undo"), onClick: () => void planning.reorder(previous) },
    })
  }

  const optimizeStartOptions = [
    { value: "magazin" as const, label: t("startMagazin"), disabled: !planning.magazinCoords },
    { value: "vehicle" as const, label: t("startVehicle"), disabled: !planning.vehicleStart },
    { value: "first" as const, label: t("startFirst") },
  ]

  const opById = useMemo(() => new Map(operations.map((o) => [o.id, o] as const)), [operations])

  const total = group.stopIds.length
  const done = group.stopIds.reduce((n, id) => (deriveStopState(opById.get(id)) === "erledigt" ? n + 1 : n), 0)

  const squadSummary = useMemo(() => {
    const parts: string[] = []
    if (resources.vehicles.length) parts.push(resources.vehicles.map((v) => v.name).join(", "))
    if (resources.personnel.length) parts.push(t("persLabel", { count: resources.personnel.length }))
    if (resources.materials.length) parts.push(t("matLabel", { count: resources.materials.length }))
    return parts.length ? parts.join(" · ") : t("noSquad")
  }, [resources, t])

  // Register the header as a drop target for resource / card drags (shared hook).
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    if (!canEdit) return
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
  }, [group.id, canEdit])

  return (
    <div
      ref={registerRowRef}
      // The Auftrag card is the ONE strong boundary: a raised card with a route-
      // coloured left accent. Its inner sub-sections are borderless peers, so the
      // primary visual split is always between Aufträge, not within one.
      className={cn(
        "rounded-lg border border-l-[3px] bg-card shadow-sm transition-colors",
        isDropOver && "ring-2 ring-primary/50 bg-primary/[0.04]",
      )}
      style={{ borderLeftColor: group.color ?? "var(--border)" }}
    >
      {/* Header row — the whole row toggles expand/collapse. Right-click opens the
          same actions as the ⋮ menu (Umbenennen / Farbe / Optimieren / Löschen). */}
      <ContextMenu>
        {/* Radix ContextMenuTrigger needs to own `onContextMenu` + a ref on its
            child. Give it a PLAIN wrapper div and keep the pragmatic-dnd drop-target
            ref + the expand click/keyboard handlers on an inner div — overloading a
            single node with both the Slot ref and the dnd ref left the contextmenu
            listener unbound, so right-click did nothing (mirrors the board card,
            where the trigger wraps a plain div and the dnd ref lives inside). */}
        <ContextMenuTrigger asChild>
          <div>
          <div
            ref={headerRef}
            role="button"
            tabIndex={0}
            aria-label={t("toggle")}
            aria-expanded={expanded}
            onClick={onToggle}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onToggle()
              }
            }}
            className="flex cursor-pointer items-center gap-2 px-3 py-2.5"
          >
            <span className="flex-shrink-0 text-muted-foreground" aria-hidden>
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
            {/* Colour swatch — click to recolour the route (same palette as create). */}
            {canEdit ? <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("changeColor")}
                  title={t("changeColor")}
                  onClick={(e) => e.stopPropagation()}
                  className="h-3.5 w-3.5 flex-shrink-0 rounded-full border border-black/10 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  style={{ backgroundColor: group.color ?? "var(--muted-foreground)" }}
                />
              </PopoverTrigger>
              <ColorPickerContent
                selected={group.color}
                onPick={(c) => {
                  onChangeColor(c)
                  setColorPickerOpen(false)
                }}
              />
            </Popover> : <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full border border-black/10" style={{ backgroundColor: group.color ?? "var(--muted-foreground)" }} />}
            <div className="min-w-0 flex-1">
              {isRenaming ? (
                <Input
                  autoFocus
                  value={renameValue}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={onCommitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onCommitRename()
                    if (e.key === "Escape") onCancelRename()
                  }}
                  className="h-7 max-w-xs"
                />
              ) : (
                <span className="font-semibold text-sm truncate block">{group.name}</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[200px]">{squadSummary}</span>
            <span className="text-xs font-medium tabular-nums text-muted-foreground flex-shrink-0">
              {t("progress", { done, total })}
            </span>

            {canEdit && <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  // The menu's exit-animation focus-restore lands AFTER the popover
                  // opens and reads as a focus-outside, snapping the picker shut
                  // (opens-then-closes). Keep focus put so the picker stays open.
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <DropdownMenuItem onClick={onStartRename}>
                    <Pencil className="mr-2 h-4 w-4" />
                    {t("rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      // Defer so the closing dropdown doesn't steal focus from the popover.
                      window.setTimeout(() => setColorPickerOpen(true), 0)
                    }}
                  >
                    <Palette className="mr-2 h-4 w-4" />
                    {t("changeColor")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={total < 2} onClick={() => void runOptimize("magazin")}>
                    <Wand2 className="mr-2 h-4 w-4" />
                    {t("optimizeOrder")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onRepeatRadio}>
                    <Radio className="mr-2 h-4 w-4" />
                    {t("repeatRadio")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onRequestDelete} className="text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>}
          </div>
          </div>
        </ContextMenuTrigger>
        {canEdit && <ContextMenuContent className="w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onClick={onStartRename}>
            <Pencil className="mr-2 h-4 w-4" />
            {t("rename")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => window.setTimeout(() => setColorPickerOpen(true), 0)}>
            <Palette className="mr-2 h-4 w-4" />
            {t("changeColor")}
          </ContextMenuItem>
          <ContextMenuItem disabled={total < 2} onClick={() => void runOptimize("magazin")}>
            <Wand2 className="mr-2 h-4 w-4" />
            {t("optimizeOrder")}
          </ContextMenuItem>
          <ContextMenuItem onClick={onRepeatRadio}>
            <Radio className="mr-2 h-4 w-4" />
            {t("repeatRadio")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onRequestDelete} className="text-destructive focus:text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            {t("delete")}
          </ContextMenuItem>
        </ContextMenuContent>}
      </ContextMenu>

      {/* Expanded content — four PEER sub-sections of the Auftrag, all rendered
          with the same section-header template (icon + "Label (N)" + trailing
          action). Mannschaft / Fahrzeuge / Material come from the shared
          RouteResourceSections; Zugewiesene Einsätze is the fourth sibling. There
          is deliberately no "Ressourcen vs Einsätze" grouping — the Auftrag card
          itself is the only strong boundary. */}
      {expanded && (
        <div className="border-t px-3 pb-3 pt-1">
          {/* Mannschaft / Fahrzeuge / Material — shared per-type resource sections
              (icon + count heading + "+ Hinzufügen" + chips). All assign/remove
              actions target the ROUTE (works with 0 stops). */}
          <RouteResourceSections
            resources={resources}
            onAssign={onAssignRouteResource}
            onUnassign={onUnassignResource}
            readOnly={!canEdit}
          />

          {/* Zugewiesene Einsätze — the fourth peer section, same header template.
              The ordered stops the route works through: reorder by drag, status
              mirrors the board columns. */}
          <div className="mt-4">
            <ResourceSectionHeader
              icon={Route}
              label={t("stopsCount", { count: total })}
              action={
                <div className="flex items-center gap-1">
                  {/* Read-only repeat of the last Funkdurchsage — no canEdit gate,
                      a viewer reading it back over the radio changes nothing. */}
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={onRepeatRadio}>
                    <Radio className="h-3.5 w-3.5" />
                    {t("repeatRadio")}
                  </Button>
                  {/* A route only needs the editor once there's an actual route to
                      plan — hide it for 0/1 stop, where it's just a single pin. */}
                  {total >= 2 && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={() => onOpenRoutenEditor()}>
                      <MapIcon className="h-3.5 w-3.5" />
                      {t("routenEditor")}
                    </Button>
                  )}
                  {/* Optimize wand — the menu picks the start anchor and runs immediately. */}
                  {canEdit && <RouteOptimizeMenu
                    options={optimizeStartOptions}
                    menuLabel={t("optimizeStartHint")}
                    optimizeLabel={t("optimizeOrder")}
                    disabled={total < 2}
                    onOptimize={(start) => void runOptimize(start)}
                  />}
                </div>
              }
            />

            <div className="space-y-0.5">
              {group.stopIds.length === 0 && <p className="py-2 text-xs text-muted-foreground">{t("noStops")}</p>}
              {group.stopIds.map((incidentId, index) => (
                <StopRow
                  key={incidentId}
                  groupId={group.id}
                  incidentId={incidentId}
                  index={index}
                  op={opById.get(incidentId)}
                  onRemove={() => onRemoveStop(incidentId)}
                  onSetStatus={(status) => onSetStopStatus?.(incidentId, status)}
                  onOpenDetail={() => onOpenDetail(incidentId)}
                  onOpenMap={onOpenRoutenEditor}
                  readOnly={!canEdit || !onSetStopStatus}
                />
              ))}

              {/* Add-row: a full-width "+ Stop hinzufügen" row below the last stop
                  (table "add row") — opens the incident picker to attach a stop. */}
              {canEdit && <button
                type="button"
                onClick={onAddStop}
                className="flex min-h-10 w-full items-center gap-2 rounded-md border border-dashed border-border/60 px-1.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5 flex-shrink-0" />
                {t("addStop")}
              </button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Shared 6-swatch colour picker body (used by the header swatch + ⋮ menu). Kept
// as its own component so both entry points open the exact same palette.
function ColorPickerContent({ selected, onPick }: { selected: string | null; onPick: (color: string) => void }) {
  return (
    <PopoverContent
      align="start"
      className="w-auto p-2"
      onClick={(e) => e.stopPropagation()}
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-1.5">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => onPick(c)}
            className={cn(
              "h-6 w-6 rounded-full border transition-transform hover:scale-110",
              selected === c ? "ring-2 ring-offset-1 ring-offset-background ring-foreground/40 scale-110" : "",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </PopoverContent>
  )
}

interface StopRowProps {
  groupId: string
  incidentId: string
  index: number
  op: Operation | undefined
  onRemove: () => void
  /** Set the stop's status directly (mirror of the board columns). */
  onSetStatus: (status: MirrorStatus) => void
  onOpenDetail: () => void
  onOpenMap: (focusIncidentId?: string) => void
  readOnly?: boolean
}

function StopRow({ groupId, incidentId, index, op, onRemove, onSetStatus, onOpenDetail, onOpenMap, readOnly = false }: StopRowProps) {
  const t = useTranslations("kanban.auftraege")
  const tStatus = useTranslations("kanban.stopStatus")
  const { formatLocation } = useOperations()
  const mirror = toMirrorStatus(op)
  const ref = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)
  const [isDropOver, setIsDropOver] = useState(false)

  useEffect(() => {
    const el = ref.current
    const handle = handleRef.current
    if (!el || !handle || readOnly) return
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
  }, [groupId, incidentId, index, readOnly])

  return (
    <div className="relative">
      {closestEdge === "top" && <DropIndicator edge="top" gap="2px" />}
      {/* Right-click exposes the same per-stop actions as the ⋮ menu + row controls
          (status jump, Karte, Details, Stop entfernen). The trigger wraps a PLAIN
          div so the draggable ref + drag handle don't clobber the contextmenu
          listener — the forwarding-div pattern used for the Auftrag header and the
          canonical route-stop-list row. */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
      <div
        ref={ref}
        className={cn(
          // Column layout: [handle] [number] [status — fixed width] [address — flex].
          "flex items-center gap-2 rounded-md border-l-2 px-1.5 py-1.5 text-sm transition-colors hover:bg-muted/40",
          stopStatusBorderClass(mirror),
          isDropOver && "ring-2 ring-primary/50 bg-primary/[0.04]",
        )}
      >
        {!readOnly && <button ref={handleRef} className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0" aria-label={t("dragStop")}>
          <GripVertical className="h-3.5 w-3.5" />
        </button>}
        <span className="tabular-nums text-xs text-muted-foreground w-6 text-right flex-shrink-0">{index + 1}.</span>
        {/* Status control — mirrors the board columns; click advances, caret jumps. */}
        {readOnly ? (() => { const c = MIRROR_CONFIG[mirror]; const Icon = c.Icon; return <Icon className={cn("h-4 w-4 flex-shrink-0", c.cls)} /> })() : <StopStatusControl op={op} onSetStatus={onSetStatus} />}
        {/* Primary line = the address (home city stripped); the incident type is
            the muted secondary line; the Meldung shows in a tooltip on hover. */}
        {op?.notes ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="min-w-0 flex-1 cursor-default">
                <div className="truncate">{op.location ? formatLocation(op.location) : incidentId}</div>
                <div className="truncate text-xs text-muted-foreground">{getIncidentTypeLabel(op.incidentType)}</div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap">{op.notes}</TooltipContent>
          </Tooltip>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="truncate" title={op?.location ? formatLocation(op.location) : undefined}>{op?.location ? formatLocation(op.location) : incidentId}</div>
            {op && <div className="truncate text-xs text-muted-foreground">{getIncidentTypeLabel(op.incidentType)}</div>}
          </div>
        )}
        {/* Karte — opens the Routen-Editor centred on this stop. */}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 flex-shrink-0"
          onClick={() => onOpenMap(incidentId)}
          title={t("map")}
          aria-label={t("map")}
        >
          <MapIcon className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" collisionPadding={{ top: 8, bottom: 80, left: 8, right: 8 }}>
            <DropdownMenuItem onClick={onOpenDetail}>{t("openDetail")}</DropdownMenuItem>
            {!readOnly && <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
              {t("removeStop")}
            </DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="w-48 max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto"
          collisionPadding={{ top: 8, bottom: 80, left: 8, right: 8 }}
        >
          {/* Status jump — same four mirror columns the StopStatusControl caret offers. */}
          {!readOnly && (mirror === "complete" ? (["complete"] as MirrorStatus[]) : MIRROR_ORDER).map((s) => {
            const c = MIRROR_CONFIG[s]
            const SIcon = c.Icon
            return (
              <ContextMenuItem key={s} onClick={() => onSetStatus(s)}>
                <SIcon className={cn("mr-2 h-4 w-4", c.cls)} />
                {tStatus(c.labelKey)}
                {s === mirror && <Check className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
              </ContextMenuItem>
            )
          })}
          {!readOnly && <ContextMenuSeparator />}
          <ContextMenuItem onClick={() => onOpenMap(incidentId)}>
            <MapIcon className="mr-2 h-4 w-4" />
            {t("map")}
          </ContextMenuItem>
          <ContextMenuItem onClick={onOpenDetail}>
            <Info className="mr-2 h-4 w-4" />
            {t("openDetail")}
          </ContextMenuItem>
          {!readOnly && <ContextMenuSeparator />}
          {!readOnly && <ContextMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            {t("removeStop")}
          </ContextMenuItem>}
        </ContextMenuContent>
      </ContextMenu>
      {closestEdge === "bottom" && <DropIndicator edge="bottom" gap="2px" />}
    </div>
  )
}
