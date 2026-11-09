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
 *
 * The order reads as a timeline: the start point with its provenance on top, the
 * stops numbered like their pins on the map, «Stopp hinzufügen» as the last node.
 * The list is only as tall as its rows. The page hosts it in a rail whose width
 * the operator drags (`useResizableWidth`), so rows are built to wrap, not to cut.
 */

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, House, MapPin, Plus, Route as RouteIcon, Truck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
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
import { colorAccent } from "@/lib/kanban-utils"
import type { IncidentGroup } from "@/lib/types/groups"
import type { useRoutePlanning } from "@/lib/hooks/use-route-planning"
import { useOperations } from "@/lib/contexts/operations-context"
import { useReleaseUndo } from "@/lib/hooks/use-release-undo"
import { useIntlLocale } from "@/lib/date-locale"
import { describeRouteStart, describeStartOption } from "@/lib/route-start"
import { RouteStopList, RouteTimelineItem, TIMELINE_ROW, TimelineNode } from "./route-stop-list"
import { RouteOptimizeButton, RouteOptimizeNote, useRouteOptimizeAction } from "./route-optimize"
import { ShellLoader } from "@/components/ui/shell-loader"
import { AUFTRAG_SWATCHES, MAP_COLORS } from "@/lib/map-colors"

// Optimize now persists immediately, so the shared list never shows a pending
// "changed" preview state.
const EMPTY_CHANGED: Set<string> = new Set()

/** From which rail width the exit button shows its word beside the ✕: the header's icon,
 *  title, gaps and «✕ Beenden» side by side, measured per language (the French title is
 *  half as long again). Static class names, so Tailwind sees them. */
const EXIT_LABEL_ROOM: Record<string, string> = {
  de: "@min-[19.5rem]/rail:inline",
  fr: "@min-[24.5rem]/rail:inline",
}

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
  canEdit: boolean
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
  canEdit,
}: RoutenplanungPanelProps) {
  const t = useTranslations("map.planning")
  const locale = useLocale()
  const { group, operationsById, isAddingStop, reorder } = planning
  const optimizeAction = useRouteOptimizeAction(planning)
  const { updateOperation } = useOperations()
  // Taking a stop off the route offers «Rückgängig» (lib/release-undo.ts).
  const release = useReleaseUndo()

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState<string>(AUFTRAG_SWATCHES[0])

  const stopIds = group?.stopIds ?? []
  const displayOrder = stopIds
  // The same resolver as the map's polylines and pins, so node 3 here is pin 3 there.
  const routeColor = group ? colorAccent(group.id, "auftrag", groups) : undefined

  const startCreate = () => {
    setNewName(t("defaultName", { n: groups.length + 1 }))
    setNewColor(AUFTRAG_SWATCHES[groups.length % AUFTRAG_SWATCHES.length])
    setCreating(true)
  }

  const confirmCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(false)
    await onCreateGroup(name, newColor)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header – one line at every rail width. Where the rail (`@container/rail`, the map
          page) has the room the exit reads «✕ Beenden»; narrower it is the ✕ alone, named
          «Routenplanung beenden» with the same words as its tooltip. It used to wrap under the
          title in a narrow rail. The threshold is the room the label needs, per language. */}
      <div className="mb-4 flex items-center justify-between gap-2 border-b pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <RouteIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h2 className="min-w-0 break-words text-lg font-bold">{t("title")}</h2>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 gap-1.5 px-2 max-md:h-11 max-md:min-w-11"
              onClick={onExit}
              aria-label={t("exitLabel")}
            >
              <X className="size-3.5" />
              <span className={cn("hidden", EXIT_LABEL_ROOM[locale] ?? EXIT_LABEL_ROOM.de)}>{t("exit")}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("exitLabel")}</TooltipContent>
        </Tooltip>
      </div>

      {/* Group picker + inline create */}
      <div className="mb-4 space-y-2">
        {/* Picker + create: wrap so the "Neuer Auftrag" button drops to its own
            line in a narrow panel instead of overflowing the width. */}
        <div className="flex flex-wrap items-center gap-2">
          {groups.length === 0 ? (
            // No Aufträge yet: an empty picker is a dead end — offer creation
            // directly (editors) or say why there's nothing to pick (viewers).
            canEdit ? (
              <Button size="sm" variant="outline" className="flex-1" onClick={startCreate}>
                <Plus className="size-3.5" />
                {t("newAuftrag")}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground py-2">{t("noGroups")}</p>
            )
          ) : (
            <>
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
                          // Same resolver as the map's polylines and legend
                          // (`colorAccent`): a route without a stored colour
                          // hashes to the SAME hue everywhere, instead of grey
                          // here and blue on the map.
                          style={{ backgroundColor: colorAccent(g.id, "auftrag", groups) }}
                        />
                        {g.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canEdit && <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    className="shrink-0 max-md:size-11"
                    onClick={startCreate}
                    aria-label={t("newAuftrag")}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("newAuftrag")}</TooltipContent>
              </Tooltip>}
            </>
          )}
        </div>

        {creating && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
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
            {/* Wraps: at 768px the 44px touch rule makes six swatches wider than a squeezed rail. */}
            <div className="flex flex-wrap items-center gap-1">
              {AUFTRAG_SWATCHES.map((c) => (
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
        <EmptyState compact title={t("noGroupSelected")} />
      ) : (
        <>
          {/* Reihenfolge heading + count + optimize wand (a single button whose menu
              picks the start anchor and runs optimize immediately). */}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold">{t("order")}</span>
            <span className="text-xs text-muted-foreground">{t("stopCount", { count: displayOrder.length })}</span>
            {canEdit && (
              <RouteOptimizeButton action={optimizeAction} disabled={displayOrder.length < 2} className="ml-auto max-md:size-11" />
            )}
          </div>
          <RouteOptimizeNote action={optimizeAction} className="mb-2" />

          {/* The timeline: start → numbered stops → «Stopp hinzufügen». Only as tall
              as its rows; it scrolls once they outgrow the panel (on the phone past
              the bottom nav). `@container` lets a row show the Meldung when the
              panel is dragged wide. */}
          <div className="-mx-1 min-h-0 overflow-y-auto overscroll-contain px-1 max-md:pb-nav-reserve">
            {displayOrder.length === 0 && <p className="mb-2 text-sm text-muted-foreground">{t("noStops")}</p>}
            <ol className="@container">
              {displayOrder.length > 0 && <RouteStartItem planning={planning} lastRun={optimizeAction.lastRun} />}
              <RouteStopList
                groupId={group.id}
                stopIds={stopIds}
                displayOrder={displayOrder}
                operationsById={operationsById}
                changedPositions={EMPTY_CHANGED}
                reorderDisabled={!canEdit}
                onReorder={(ids) => void reorder(ids)}
                focusStopId={focusStopId}
                onSelectStop={onFocusStopChange}
                onSetStopStatus={(incidentId, status) => updateOperation(incidentId, { status })}
                onRemoveStop={(incidentId) => void release.releaseStop(group.id, incidentId)}
                showStatusControl={false}
                // The `/map` planner has no access to the dashboard completion
                // flow (material prompt + returning-vehicle check), so don't
                // offer "Abgeschlossen" here — completion stays on the board.
                allowComplete={false}
                readOnly={!canEdit}
                timelineColor={routeColor}
              />

              {/* The last node: toggles map click-to-add. Its second line says how
                  («Klick auf die Karte») instead of hiding that in a tooltip. */}
              {canEdit && (
                <RouteTimelineItem>
                  <button
                    type="button"
                    aria-pressed={addMode}
                    onClick={() => onAddModeChange(!addMode)}
                    className={cn(
                      TIMELINE_ROW,
                      "transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      addMode ? "bg-sel-wash ring-1 ring-sel-edge" : "hover:bg-muted/40",
                    )}
                  >
                    <TimelineNode className="border-dashed border-muted-foreground/70 bg-transparent text-muted-foreground shadow-none">
                      {isAddingStop ? <ShellLoader className="size-3.5" /> : <Plus className="size-3.5" />}
                    </TimelineNode>
                    <span className="min-w-0 flex-1 pt-1 leading-tight">
                      <span className="block text-sm font-medium">{t("addStopToggle")}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {isAddingStop ? t("addingStop") : addMode ? t("addStopHint") : t("addStopMapHint")}
                      </span>
                    </span>
                  </button>
                </RouteTimelineItem>
              )}
            </ol>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The timeline's first node: where the route starts, with the provenance
 * `lib/route-start.ts` gives it. After an optimisation – while its order still
 * stands – that is the start it actually used (Fahrzeug-GPS with its report age,
 * the fallback to the first stop); otherwise the Magazin, where a crew leaves from,
 * as the settings place it or flagged as «Ersatzstandort».
 */
function RouteStartItem({
  planning,
  lastRun,
}: {
  planning: ReturnType<typeof useRoutePlanning>
  lastRun: ReturnType<typeof useRouteOptimizeAction>["lastRun"]
}) {
  const t = useTranslations("map.planning")
  const tStart = useTranslations("map.routeOptimize")
  const locale = useIntlLocale()
  const text = lastRun
    ? describeRouteStart(lastRun.start, tStart, Date.now(), locale)
    : describeStartOption("magazin", planning.anchors, tStart, Date.now(), locale)
  const mode = lastRun?.start.mode ?? "magazin"
  const Icon = mode === "vehicle" ? Truck : mode === "first" ? MapPin : House
  return (
    <RouteTimelineItem>
      <div className={TIMELINE_ROW}>
        {/* The Magazin's ink on the map (MAP_COLORS.station), not an Auftrag colour. */}
        <TimelineNode style={{ backgroundColor: MAP_COLORS.station }}>
          <Icon className="size-3.5" />
        </TimelineNode>
        <div className="min-w-0 flex-1 pt-1 leading-tight">
          <div className="text-sm font-medium break-words">{t("startLabel", { start: text.label })}</div>
          <div
            className={cn(
              "mt-0.5 flex items-start gap-1 text-xs",
              text.caution ? "text-warning-foreground" : "text-muted-foreground",
            )}
          >
            {text.caution && <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />}
            <span className="min-w-0 break-words">{text.detail}</span>
          </div>
        </div>
      </div>
    </RouteTimelineItem>
  )
}
