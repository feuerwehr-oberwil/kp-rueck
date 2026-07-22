"use client"

/**
 * RoutenplanungPanel — editor-only route-building panel for the `/map` page.
 *
 * The full-screen counterpart to the Routen-Editor modal: it drives the same
 * `useRoutePlanning` hook and reuses the shared `RouteStopList`, but leaves the
 * map itself to the page (which mounts `<GroupRoutes>` via map-view and forwards
 * map clicks / marker clicks here through page state).
 *
 * The page owns `groupId`, `addMode` and `focusStopId` so it can wire the map's
 * click-to-add and marker highlight; this panel owns the inline-create UI and the
 * optimize action (which persists immediately, with an undo toast).
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Plus, Route as RouteIcon, MousePointerClick, X, Loader2, MapPinned } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { IncidentGroup } from "@/lib/types/groups"
import type { RouteStartMode, useRoutePlanning } from "@/lib/hooks/use-route-planning"
import { useOperations } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { RouteStopList, RouteOptimizeMenu } from "./route-stop-list"

// Same six-swatch palette as the Aufträge sheet so routes read apart at a glance.
const SWATCHES = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"] as const

// Optimize now persists immediately, so the shared list never shows a pending
// "changed" preview state.
const EMPTY_CHANGED: Set<string> = new Set()

interface RoutenplanungPanelProps {
  groups: IncidentGroup[]
  groupId: string | null
  onGroupIdChange: (id: string | null) => void
  /** Create a new Auftrag and select it (page wraps useGroups().createGroup). */
  onCreateGroup: (name: string, color: string) => Promise<void>
  /** Map click-to-add toggle — page reads this to wire the map onClick. */
  addMode: boolean
  onAddModeChange: (v: boolean) => void
  focusStopId: string | null
  onFocusStopChange: (id: string | null) => void
  /** Shared routing hook, instantiated by the page for the selected group. */
  planning: ReturnType<typeof useRoutePlanning>
  onExit: () => void
}

export function RoutenplanungPanel({
  groups,
  groupId,
  onGroupIdChange,
  onCreateGroup,
  addMode,
  onAddModeChange,
  focusStopId,
  onFocusStopChange,
  planning,
  onExit,
}: RoutenplanungPanelProps) {
  const t = useTranslations("map.planning")
  const { group, operationsById, isAddingStop, reorder, optimize, magazinCoords, vehicleStart } = planning
  const { updateOperation } = useOperations()
  const { removeStop } = useGroups()

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState<string>(SWATCHES[0])

  const stopIds = group?.stopIds ?? []
  const displayOrder = stopIds

  const startOptions = [
    { value: "magazin" as const, label: t("startMagazin"), disabled: !magazinCoords },
    { value: "vehicle" as const, label: t("startVehicle"), disabled: !vehicleStart },
    { value: "first" as const, label: t("startFirst") },
  ]

  const startCreate = () => {
    setNewName(t("defaultName", { n: groups.length + 1 }))
    setNewColor(SWATCHES[groups.length % SWATCHES.length])
    setCreating(true)
  }

  const confirmCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(false)
    await onCreateGroup(name, newColor)
  }

  // Optimize applies immediately (no preview / Übernehmen step) with an undo toast.
  const runOptimize = async (startMode: RouteStartMode) => {
    const previous = stopIds
    const proposed = optimize(startMode)
    if (proposed.length === 0) return
    const unchanged = proposed.every((id, i) => id === previous[i])
    if (unchanged) {
      toast.info(t("previewUnchanged"))
      return
    }
    await reorder(proposed)
    toast.success(t("optimized"), {
      action: { label: t("undo"), onClick: () => void reorder(previous) },
    })
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-2 border-b pb-3">
        <div className="flex items-center gap-2">
          <RouteIcon className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-bold">{t("title")}</h2>
        </div>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={onExit}>
          <X className="h-4 w-4" />
          {t("exit")}
        </Button>
      </div>

      {/* Group picker + inline create */}
      <div className="mb-4 space-y-2">
        {/* Picker + create: wrap so the "Neuer Auftrag" button drops to its own
            line in a narrow panel instead of overflowing the width. */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={groupId ?? undefined} onValueChange={(v) => onGroupIdChange(v)}>
            <SelectTrigger className="h-9 min-w-[7rem] flex-1">
              <SelectValue placeholder={t("selectGroupPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: g.color ?? "var(--muted-foreground)" }}
                    />
                    {g.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="outline"
                className="shrink-0"
                onClick={startCreate}
                aria-label={t("newAuftrag")}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("newAuftrag")}</TooltipContent>
          </Tooltip>
        </div>

        {creating && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.03] px-3 py-2.5">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmCreate()
                if (e.key === "Escape") setCreating(false)
              }}
              className="h-8 min-w-[8rem] flex-1"
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
      </div>

      {!group ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center">
          <MapPinned className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t("noGroupSelected")}</p>
        </div>
      ) : (
        <>
          {/* Reihenfolge heading + optimize wand (a single button whose menu picks
              the start anchor and runs optimize immediately). */}
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{t("order")}</span>
            <RouteOptimizeMenu
              options={startOptions}
              menuLabel={t("optimizeStartHint")}
              optimizeLabel={t("optimize")}
              disabled={displayOrder.length < 2}
              onOptimize={(start) => void runOptimize(start)}
            />
          </div>

          {/* Ordered stop list */}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/20 p-2">
            <div className="space-y-0.5">
              {displayOrder.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                  <MapPinned className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">{t("noStops")}</p>
                </div>
              ) : (
                <RouteStopList
                  groupId={group.id}
                  stopIds={stopIds}
                  displayOrder={displayOrder}
                  operationsById={operationsById}
                  changedPositions={EMPTY_CHANGED}
                  reorderDisabled={false}
                  onReorder={(ids) => void reorder(ids)}
                  focusStopId={focusStopId}
                  onSelectStop={onFocusStopChange}
                  onSetStopStatus={(incidentId, status) => updateOperation(incidentId, { status })}
                  onRemoveStop={(incidentId) => void removeStop(group.id, incidentId)}
                  showStatusControl={false}
                />
              )}

              {/* Add-row: a full-width "+ Stop hinzufügen" toggle below the last
                  stop (table "add row"), toggling map click-to-add. Matches a stop
                  row's height/padding; the "click the map to place a stop" hint now
                  lives on hover instead of as a separate line. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onAddModeChange(!addMode)}
                    className={cn(
                      "flex min-h-10 w-full items-center gap-2 rounded-md border border-dashed px-1.5 py-1.5 text-sm transition-colors",
                      addMode
                        ? "border-primary/50 bg-primary/[0.06] text-foreground"
                        : "border-border/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    {isAddingStop ? <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" /> : <MousePointerClick className="h-3.5 w-3.5 flex-shrink-0" />}
                    {t("addStopToggle")}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{isAddingStop ? t("addingStop") : t("addStopHint")}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
