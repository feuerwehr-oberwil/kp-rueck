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
 * click-to-add and marker highlight; this panel owns the transient optimize
 * preview + inline-create UI.
 */

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Plus, Route as RouteIcon, MousePointerClick, Wand2, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { RouteStopList } from "./route-stop-list"

// Same six-swatch palette as the Aufträge sheet so routes read apart at a glance.
const SWATCHES = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"] as const

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

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState<string>(SWATCHES[0])
  const [startMode, setStartMode] = useState<RouteStartMode>("magazin")
  const [preview, setPreview] = useState<string[] | null>(null)

  const stopIds = group?.stopIds ?? []
  const displayOrder = preview ?? stopIds

  const changedPositions = useMemo(() => {
    if (!preview) return new Set<string>()
    const changed = new Set<string>()
    preview.forEach((id, i) => {
      if (stopIds[i] !== id) changed.add(id)
    })
    return changed
  }, [preview, stopIds])

  const startOptions: { value: RouteStartMode; label: string; disabled?: boolean }[] = [
    { value: "magazin", label: t("startMagazin"), disabled: !magazinCoords },
    { value: "vehicle", label: t("startVehicle"), disabled: !vehicleStart },
    { value: "first", label: t("startFirst") },
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

  const runOptimize = () => {
    const proposed = optimize(startMode)
    if (proposed.length === 0) return
    const unchanged = proposed.every((id, i) => id === stopIds[i])
    if (unchanged) {
      toast.info(t("previewUnchanged"))
      setPreview(null)
      return
    }
    setPreview(proposed)
  }

  const applyPreview = async () => {
    if (!preview) return
    await reorder(preview)
    setPreview(null)
    toast.success(t("applied"))
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
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
      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-2">
          <Select value={groupId ?? undefined} onValueChange={(v) => onGroupIdChange(v)}>
            <SelectTrigger className="h-9 flex-1">
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
          <Button size="sm" variant="outline" className="h-9 gap-1.5 flex-shrink-0" onClick={startCreate}>
            <Plus className="h-4 w-4" />
            {t("newAuftrag")}
          </Button>
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
        <p className="py-6 text-sm text-muted-foreground">{t("noGroupSelected")}</p>
      ) : (
        <>
          {/* Add-stop toggle + hint */}
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{t("order")}</span>
            <Button
              size="sm"
              variant={addMode ? "default" : "outline"}
              className="h-8 gap-1.5"
              onClick={() => onAddModeChange(!addMode)}
            >
              {isAddingStop ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MousePointerClick className="h-3.5 w-3.5" />}
              {t("addStopToggle")}
            </Button>
          </div>
          {addMode && (
            <p className="mb-2 text-xs text-muted-foreground">
              {isAddingStop ? t("addingStop") : t("addStopHint")}
            </p>
          )}
          <p className="mb-2 text-xs text-muted-foreground">{t("addStopMarkerHint")}</p>

          {/* Ordered stop list */}
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
            {displayOrder.length === 0 && <p className="py-4 text-sm text-muted-foreground">{t("noStops")}</p>}
            <RouteStopList
              groupId={group.id}
              stopIds={stopIds}
              displayOrder={displayOrder}
              operationsById={operationsById}
              changedPositions={changedPositions}
              reorderDisabled={preview !== null}
              onReorder={(ids) => void reorder(ids)}
              focusStopId={focusStopId}
              onSelectStop={onFocusStopChange}
            />
          </div>

          {/* Optimize controls */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
            {preview ? (
              <>
                <span className="text-xs text-muted-foreground">
                  {t("previewNotice", { count: changedPositions.size })}
                </span>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                    {t("discardPreview")}
                  </Button>
                  <Button size="sm" onClick={applyPreview}>
                    {t("applyPreview")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">{t("startFrom")}</span>
                <Select value={startMode} onValueChange={(v) => setStartMode(v as RouteStartMode)}>
                  <SelectTrigger className="h-8 w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {startOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={runOptimize}
                  disabled={displayOrder.length < 2}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  {t("optimize")}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
