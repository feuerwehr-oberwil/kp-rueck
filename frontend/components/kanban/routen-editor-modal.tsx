"use client"

/**
 * RoutenEditorModal — map-first editor for a single Auftrag (incident group).
 *
 * A Dialog with an embedded MapLibre map (numbered markers + route line via the
 * shared `group-routes.tsx`) beside an ordered, drag-reorderable stop list. Lets the
 * operator:
 *  - toggle "Stop hinzufügen" and click the map to append a reverse-geocoded stop,
 *  - drag list rows to reorder (persists via reorderGroupStops),
 *  - pick a start anchor and run client-side nearest-neighbour optimize that
 *    persists immediately (with an undo toast),
 *  - drop board/sheet resources onto stop rows to assign them (the page-level
 *    `useKanbanDragDrop` monitor handles the `group-stop` drop contract).
 *
 * Besides the route's own numbered stops, the map shows every OTHER located,
 * non-completed incident of the event as a small context pin — labelled, not
 * hidden: grey = «Offen» (click adds it as a stop), route-coloured + muted =
 * already on another Auftrag (passive, the tooltip names the route).
 *
 * The map is the shared `<BaseMap>`, which owns the basemap, the offline fallback
 * and the dialog-resize handling — so nothing here re-measures the container.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { MapPin, MousePointerClick, MapPinned } from "lucide-react"
import type { Map as MlMap } from "maplibre-gl"
import { Marker, NavigationControl, type MapLayerMouseEvent } from "react-map-gl/maplibre"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { BaseMap } from "@/components/map/base-map"
import { MapTooltip } from "@/components/map/map-tooltip"
import { GroupRoutes } from "@/components/map/group-routes"
import { useRoutePlanning, type RouteStartMode } from "@/lib/hooks/use-route-planning"
import { useGroups } from "@/lib/contexts/groups-context"
import type { IncidentGroup } from "@/lib/types/groups"
import { colorAccent } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { isLocated, type LocatedOperation } from "@/lib/utils/route-geo"
import { DEFAULT_CENTER_LATLNG, fitTo, type LatLngPoint } from "@/lib/map-view"
import { useDialogDragGuard } from "@/lib/hooks/use-dialog-drag-guard"
import { RouteStopList, RouteOptimizeMenu } from "../map/route-stop-list"

// Stable empty set — optimize now persists immediately, so no stop is ever in a
// pending "changed" preview state.
const EMPTY_CHANGED: Set<string> = new Set()

// --- Map helpers -------------------------------------------------------------

/** How this dialog frames its stops — a lone stop gets a fixed scale instead of a zero-size box. */
const FIT_OPTIONS = { padding: 48, maxZoom: 16, duration: 0, singleZoom: 15 } as const

/**
 * One context pin: an incident of the event that is NOT a stop of this route.
 *
 * Its own component because it owns its hover state — hovering one pin must not
 * re-render the other few dozen. Small dot, deliberately unlike the 26px numbered
 * sequence markers: solid grey = «Offen» (nobody's yet), dashed + muted route
 * colour = already on another Auftrag (mirrors the incident picker's pin language).
 */
function ContextPin({
  op,
  fill,
  dashed = false,
  dimmed = false,
  clickable,
  title,
  subtitle,
  hint,
  onSelect,
}: {
  op: LocatedOperation
  fill: string
  dashed?: boolean
  dimmed?: boolean
  clickable: boolean
  title: string
  subtitle: string
  hint?: string
  onSelect: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [lat, lng] = op.coordinates

  return (
    <Marker
      longitude={lng}
      latitude={lat}
      // Below the numbered stops (100/300), so a route's own pins always win.
      style={{ zIndex: hovered ? 90 : 50 }}
      // The click would otherwise bubble on to the map and add a second, geocoded
      // stop at the same spot while "Stop hinzufügen" is armed.
      onClick={(event) => {
        event.originalEvent.stopPropagation()
        if (clickable) onSelect()
      }}
    >
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: fill,
            border: `2px ${dashed ? "dashed" : "solid"} white`,
            boxShadow: "0 1px 4px rgba(0, 0, 0, 0.3)",
            opacity: dimmed ? 0.45 : 0.9,
            cursor: "pointer",
          }}
        />
        {hovered && (
          <MapTooltip side="top" gap={16}>
            <div className="text-xs leading-tight">
              <div className="font-medium">{title}</div>
              <div className="text-muted-foreground">{subtitle}</div>
              {hint && <div className="text-muted-foreground">{hint}</div>}
            </div>
          </MapTooltip>
        )}
      </div>
    </Marker>
  )
}

// -----------------------------------------------------------------------------

interface RoutenEditorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string | null
  /** Centre + highlight this stop when opening (from a stop's [Karte] button). */
  focusIncidentId?: string | null
  canEdit: boolean
  onSetStopStatus?: (incidentId: string, status: import("@/lib/contexts/operations-context").OperationStatus) => void
}

export function RoutenEditorModal({ open, onOpenChange, groupId, focusIncidentId, canEdit, onSetStopStatus }: RoutenEditorModalProps) {
  const t = useTranslations("kanban.routenEditorModal")
  const {
    group,
    orderedStops,
    operationsById,
    addStopAtLatLng,
    isAddingStop,
    reorder,
    optimize,
    magazinCoords,
    vehicleStart,
  } = useRoutePlanning(groupId)

  // All routes + the add-by-incident-id path (the same `addStops` the "+ Stop"
  // picker persists through) — used for the map's context pins below.
  const { groups, addStops } = useGroups()

  // Keep the modal open while a drag-reorder happens inside it — a native drag
  // churns focus/pointer state that Radix would otherwise read as an outside
  // interaction and close the dialog on.
  const { dragGuardProps } = useDialogDragGuard(open)

  const [mapKey, setMapKey] = useState(0)
  const [addMode, setAddMode] = useState(false)
  const [focusStopId, setFocusStopId] = useState<string | null>(focusIncidentId ?? null)
  // The LIVE map instance, or null while the dialog is closed. Clearing it on close is what
  // makes a reopen frame anything at all: Radix unmounts the dialog body, so the instance from
  // the last open is already removed. Left in state, the fit effect below — which re-runs
  // whenever the stop list changes, i.e. on every poll — would run against that dead instance,
  // latch the fit marker, and the fresh instance arriving a moment later would never be fitted.
  const [map, setMap] = useState<MlMap | null>(null)
  // The initial fit happens once per map instance, and only once there is something
  // to frame — the stops can still be loading when the map reports itself ready.
  const fittedMapRef = useRef<MlMap | null>(null)

  // Remount the map (re-fit + re-centre) on each open; reset transient UI state.
  useEffect(() => {
    if (!open) {
      setMap(null)
      return
    }
    setMapKey((k) => k + 1)
    fittedMapRef.current = null
    setAddMode(false)
    setFocusStopId(focusIncidentId ?? null)
  }, [open, focusIncidentId])

  const locatedPositions = useMemo<LatLngPoint[]>(
    () => orderedStops.map((s) => s.op).filter(isLocated).map((op) => op.coordinates),
    [orderedStops],
  )

  // Centre: the focused stop when given, else the located-stop centroid, else default.
  const center = useMemo<LatLngPoint>(() => {
    const focused = focusStopId ? operationsById.get(focusStopId) : undefined
    if (isLocated(focused)) return focused.coordinates
    if (locatedPositions.length > 0) {
      const lat = locatedPositions.reduce((s, p) => s + p[0], 0) / locatedPositions.length
      const lng = locatedPositions.reduce((s, p) => s + p[1], 0) / locatedPositions.length
      return [lat, lng]
    }
    return DEFAULT_CENTER_LATLNG
  }, [focusStopId, operationsById, locatedPositions])

  // Frame the located stops once the map is up and the stops are in.
  useEffect(() => {
    if (!map || fittedMapRef.current === map || locatedPositions.length === 0) return
    fittedMapRef.current = map
    fitTo(map, locatedPositions, FIT_OPTIONS)
  }, [map, locatedPositions])

  const handleMapClick = useCallback(
    (event: MapLayerMouseEvent) => {
      if (!canEdit || !addMode) return
      void addStopAtLatLng(event.lngLat.lat, event.lngLat.lng)
    },
    [canEdit, addMode, addStopAtLatLng],
  )

  /**
   * Context pins: every OTHER located incident of the event — everything that is
   * not a stop of THIS route and not completed. Membership comes from the
   * groups' `stopIds` (not `op.groupId`) so the pins track the optimistic group
   * state: adding one via its pin turns it into a numbered stop immediately.
   */
  const contextPins = useMemo(() => {
    if (!group) return []
    const memberIds = new Set(group.stopIds)
    const routeByStopId = new Map<string, IncidentGroup>()
    for (const g of groups) {
      if (g.id === group.id) continue
      for (const id of g.stopIds) routeByStopId.set(id, g)
    }
    const pins: { op: LocatedOperation; otherRoute: IncidentGroup | undefined }[] = []
    for (const op of operationsById.values()) {
      if (memberIds.has(op.id) || op.status === "complete" || !isLocated(op)) continue
      pins.push({ op, otherRoute: routeByStopId.get(op.id) })
    }
    return pins
  }, [group, groups, operationsById])

  // Clicking an OPEN context pin adds that incident as a stop (same `addStops`
  // path the "+ Stop" picker persists through). Dispatched pins stay passive.
  const handleOpenPinClick = useCallback(
    async (incidentId: string) => {
      if (!canEdit || !group) return
      const ok = await addStops(group.id, [incidentId])
      if (ok) toast.success(t("contextStopAdded"))
    },
    [canEdit, group, addStops, t],
  )

  // Optimize applies immediately (no preview / Übernehmen step): compute the
  // nearest-neighbour order from the chosen start anchor and persist it right away,
  // with an undo toast.
  const runOptimize = async (startMode: RouteStartMode) => {
    if (!group) return
    const previous = group.stopIds
    const proposed = optimize(startMode)
    if (proposed.length === 0) return
    const unchanged = proposed.every((id, i) => id === previous[i])
    if (unchanged) {
      toast.info(t("previewUnchanged"))
      return
    }
    const persisted = await reorder(proposed)
    if (!persisted) return
    toast.success(t("optimized"), {
      action: { label: t("undo"), onClick: () => void reorder(previous) },
    })
  }

  // The order shown in the list + on the map (now always the persisted order).
  const displayOrder = group?.stopIds ?? []

  // Group the map draws — mirrors the live persisted stop order.
  const displayGroup: IncidentGroup | undefined = group
  const displayedGroups = useMemo(() => displayGroup ? [displayGroup] : [], [displayGroup])

  // The map. `mapKey` remounts it per open so it re-centres and re-fits; `center` is
  // therefore captured at that moment, while markers keep tracking live data.
  const mapNode = !displayGroup ? (
    <div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">
      {t("mapLoading")}
    </div>
  ) : (
    <BaseMap
      key={mapKey}
      initialViewState={{ longitude: center[1], latitude: center[0], zoom: 14 }}
      onClick={handleMapClick}
      onLoad={setMap}
    >
      <NavigationControl position="top-left" showCompass={false} />
      {/* Context pins carry a lower z-index than the numbered stops, so a route's
          own stops always sit on top. */}
      {contextPins.map(({ op, otherRoute }) => {
        const location = op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())
        const clickable = !otherRoute && canEdit
        return (
          <ContextPin
            key={op.id}
            op={op}
            fill={otherRoute ? colorAccent(otherRoute.id, "auftrag", groups) : "#64748b"}
            dashed={!!otherRoute}
            dimmed={!!otherRoute}
            clickable={clickable}
            title={location || getIncidentTypeLabel(op.incidentType)}
            subtitle={otherRoute ? t("contextInRoute", { name: otherRoute.name }) : t("contextOpen")}
            hint={clickable ? t("contextClickToAdd") : undefined}
            onSelect={() => void handleOpenPinClick(op.id)}
          />
        )
      })}
      <GroupRoutes
        groups={displayedGroups}
        operationsById={operationsById}
        onMarkerClick={setFocusStopId}
        highlightIncidentId={focusStopId}
      />
    </BaseMap>
  )

  const startOptions = [
    { value: "magazin" as const, label: t("startMagazin"), disabled: !magazinCoords },
    { value: "vehicle" as const, label: t("startVehicle"), disabled: !vehicleStart },
    { value: "first" as const, label: t("startFirst") },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex modal-h-tall w-full flex-col gap-4 overflow-hidden sm:max-w-6xl"
        {...dragGuardProps}
      >
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            {t("title")}
            {group && <span className="text-muted-foreground">· {group.name}</span>}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {/* Body — a flex row (robust vs. a fragile minmax grid): the ordered list
            keeps a fixed, always-usable width while the map fills the remaining
            width as a wide landscape rectangle. Both columns stretch to the same
            height so the list scrolls inside the map's height. */}
        <div className="flex h-[520px] modal-h-compact gap-5 overflow-hidden">
          {/* Map column — FIXED width. A flexible (flex-1) map track kept collapsing
              to near-zero, so the map is the fixed column now and the
              list flexes/truncates instead. The map can never be squeezed. The
              parent DialogContent uses sm:max-w-[1080px] (overriding the base
              sm:max-w-lg) so this 600px map + the list always fit inside. */}
          <div className="flex w-[600px] shrink-0 flex-col">
            <div className="mb-2 flex h-8 items-center">
              <span className="text-sm font-semibold">{t("mapHeading")}</span>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border">
              {mapNode}
              {addMode && (
                <div className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-md">
                  {isAddingStop ? t("addingStop") : t("addStopHint")}
                </div>
              )}
            </div>
          </div>

          {/* Ordered list column — fills the remaining width, truncates long rows. */}
          <div className="flex min-w-0 flex-1 flex-col min-h-0">
            {/* Reihenfolge heading — with the stop count beside it, so the head
                states what already gilt (the list head carries a number, like the
                assignment dialogs') — + the optimize wand (a single button whose
                menu picks the start anchor and runs optimize immediately). */}
            <div className="mb-2 flex h-8 items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {t("order")}
                {displayOrder.length > 0 && (
                  <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                    {displayOrder.length}
                  </span>
                )}
              </span>
              {canEdit && <RouteOptimizeMenu
                options={startOptions}
                menuLabel={t("optimizeStartHint")}
                optimizeLabel={t("optimize")}
                disabled={displayOrder.length < 2}
                onOptimize={(start) => void runOptimize(start)}
              />}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/20 p-2">
              <div className="space-y-0.5">
                {displayOrder.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                    <MapPinned className="h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">{t("emptyState")}</p>
                  </div>
                ) : (
                  <RouteStopList
                    groupId={group?.id ?? ""}
                    stopIds={group?.stopIds ?? []}
                    displayOrder={displayOrder}
                    operationsById={operationsById}
                    changedPositions={EMPTY_CHANGED}
                    reorderDisabled={!canEdit}
                    onReorder={(ids) => void reorder(ids)}
                    focusStopId={focusStopId}
                    onSelectStop={setFocusStopId}
                    enabled={open && !!group}
                    onSetStopStatus={onSetStopStatus}
                    readOnly={!canEdit}
                  />
                )}

                {/* Add-row: a full-width "+ Stop hinzufügen" toggle that sits below
                    the last stop (table "add row"), toggling map click-to-add. */}
                {canEdit && <button
                  type="button"
                  onClick={() => setAddMode((v) => !v)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-sm transition-colors",
                    addMode
                      ? "border-primary/50 bg-primary/[0.06] text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  <MousePointerClick className="h-3.5 w-3.5 flex-shrink-0" />
                  {t("addStopToggle")}
                </button>}
              </div>
            </div>
          </div>
        </div>

        {/* Footer — optimize controls now live above the stop list (out of the
            bottom-right toast zone); only the close action remains here. */}
        <div className="flex flex-shrink-0 items-center border-t pt-3">
          <Button size="sm" className="ml-auto" onClick={() => onOpenChange(false)}>
            {t("done")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
