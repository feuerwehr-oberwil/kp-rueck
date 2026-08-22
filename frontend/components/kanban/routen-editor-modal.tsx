"use client"

/**
 * RoutenEditorModal — map-first editor for a single Auftrag (incident group).
 *
 * A Dialog with an embedded Leaflet map (numbered markers + route polyline via the
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
 * SSR-safe: leaflet is only pulled in behind an `isClient` guard (the require()
 * pattern established by map-picker-modal.tsx), so nothing leaflet touches the
 * server render of the page that mounts this modal.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { MapPin, MousePointerClick, MapPinned } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { useMapMode } from "@/lib/hooks/use-map-mode"
import { useRoutePlanning, type RouteStartMode } from "@/lib/hooks/use-route-planning"
import { useGroups } from "@/lib/contexts/groups-context"
import type { IncidentGroup } from "@/lib/types/groups"
import { colorAccent } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { isLocated, type LocatedOperation } from "@/lib/utils/route-geo"
import { useDialogDragGuard } from "@/lib/hooks/use-dialog-drag-guard"
import { RouteStopList, RouteOptimizeMenu } from "../map/route-stop-list"

// Basel-Landschaft fallback centre (matches map-picker-modal).
const DEFAULT_CENTER: [number, number] = [47.51637699933488, 7.561800450458299]

// Stable empty set — optimize now persists immediately, so no stop is ever in a
// pending "changed" preview state.
const EMPTY_CHANGED: Set<string> = new Set()

// --- Leaflet child helpers (client-only; mirror map-picker-modal) -------------

function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  if (typeof window === "undefined") return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMapEvents } = require("react-leaflet")
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useMapEvents({
    click: (e: { latlng: { lat: number; lng: number } }) => onClick(e.latlng.lat, e.latlng.lng),
  })
  return null
}

function FitBounds({ positions }: { positions: [number, number][] }) {
  if (typeof window === "undefined") return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMap } = require("react-leaflet")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const L = require("leaflet")
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const map = useMap()
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const doneRef = useRef(false)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (doneRef.current || positions.length === 0) return
    doneRef.current = true
    if (positions.length === 1) {
      map.setView(positions[0], 15)
      return
    }
    map.fitBounds(L.latLngBounds(positions), { padding: [48, 48], maxZoom: 16 })
  }, [map, positions, L])
  return null
}

// A map mounted inside a Radix Dialog / CSS-grid track measures 0×0 before the
// dialog finishes its open transition, so Leaflet lays out narrow/tall. Force a
// re-measure on mount and whenever the container resizes.
function InvalidateSize() {
  if (typeof window === "undefined") return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMap } = require("react-leaflet")
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const map = useMap()
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const fix = () => map.invalidateSize()
    // A couple of deferred passes cover the dialog's mount + open animation.
    const t1 = window.setTimeout(fix, 60)
    const t2 = window.setTimeout(fix, 250)
    const container: HTMLElement = map.getContainer()
    const ro = new ResizeObserver(fix)
    ro.observe(container)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      ro.disconnect()
    }
  }, [map])
  return null
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

  const { getTileUrl, getAttribution, handleTileError } = useMapMode()

  // All routes + the add-by-incident-id path (the same `addStops` the "+ Stop"
  // picker persists through) — used for the map's context pins below.
  const { groups, addStops } = useGroups()

  // Keep the modal open while a drag-reorder happens inside it — a native drag
  // churns focus/pointer state that Radix would otherwise read as an outside
  // interaction and close the dialog on.
  const { dragGuardProps } = useDialogDragGuard(open)

  const [isClient, setIsClient] = useState(false)
  const [mapKey, setMapKey] = useState(0)
  const [addMode, setAddMode] = useState(false)
  const [focusStopId, setFocusStopId] = useState<string | null>(focusIncidentId ?? null)

  // Client-only leaflet setup (default icon fix), mirroring map-picker-modal.
  useEffect(() => {
    setIsClient(true)
    if (typeof window !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const L = require("leaflet")
      delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl
      L.Icon.Default.mergeOptions({
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        iconUrl: require("leaflet/dist/images/marker-icon.png").default.src,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png").default.src,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        shadowUrl: require("leaflet/dist/images/marker-shadow.png").default.src,
      })
    }
  }, [])

  // Remount the map (re-fit + re-centre) on each open; reset transient UI state.
  useEffect(() => {
    if (open) {
      setMapKey((k) => k + 1)
      setAddMode(false)
      setFocusStopId(focusIncidentId ?? null)
    }
  }, [open, focusIncidentId])

  const locatedPositions = useMemo<[number, number][]>(
    () => orderedStops.map((s) => s.op).filter(isLocated).map((op) => op.coordinates),
    [orderedStops],
  )

  // Centre: the focused stop when given, else the located-stop centroid, else default.
  const center = useMemo<[number, number]>(() => {
    const focused = focusStopId ? operationsById.get(focusStopId) : undefined
    if (isLocated(focused)) return focused.coordinates
    if (locatedPositions.length > 0) {
      const lat = locatedPositions.reduce((s, p) => s + p[0], 0) / locatedPositions.length
      const lng = locatedPositions.reduce((s, p) => s + p[1], 0) / locatedPositions.length
      return [lat, lng]
    }
    return DEFAULT_CENTER
  }, [focusStopId, operationsById, locatedPositions])

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!canEdit || !addMode) return
      void addStopAtLatLng(lat, lng)
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

  const mapNode = useMemo(() => {
    if (!isClient || !displayGroup) {
      return (
        <div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">
          {t("mapLoading")}
        </div>
      )
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MapContainer, TileLayer, Marker, Tooltip } = require("react-leaflet")
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("leaflet/dist/leaflet.css")
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const L = require("leaflet")
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GroupRoutes } = require("../map/group-routes")

    // Small dot, deliberately unlike the 26px numbered sequence markers: solid
    // grey = «Offen» (nobody's yet), dashed + muted route colour = already on
    // another Auftrag (mirrors the incident picker's pin language).
    const contextPinIcon = (fill: string, opts: { dashed?: boolean; dimmed?: boolean } = {}) =>
      L.divIcon({
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${fill};border:2px ${opts.dashed ? "dashed" : "solid"} white;box-shadow:0 1px 4px rgba(0,0,0,0.3);opacity:${opts.dimmed ? 0.45 : 0.9};"></div>`,
        className: "routen-editor-context-marker",
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      })

    return (
      <MapContainer key={mapKey} center={center} zoom={14} className="h-full w-full" zoomControl>
        <TileLayer attribution={getAttribution()} url={getTileUrl()} eventHandlers={{ tileerror: handleTileError }} />
        {/* Context pins first (default z), so numbered stops always sit on top. */}
        {contextPins.map(({ op, otherRoute }) => {
          const location = op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())
          const clickable = !otherRoute && canEdit
          return (
            <Marker
              key={op.id}
              position={op.coordinates}
              icon={
                otherRoute
                  ? contextPinIcon(colorAccent(otherRoute.id, "auftrag", groups), { dashed: true, dimmed: true })
                  : contextPinIcon("#64748b")
              }
              eventHandlers={clickable ? { click: () => void handleOpenPinClick(op.id) } : undefined}
            >
              <Tooltip direction="top" offset={[0, -10]}>
                <div className="text-xs leading-tight">
                  <div className="font-medium">{location || getIncidentTypeLabel(op.incidentType)}</div>
                  <div className="text-muted-foreground">
                    {otherRoute ? t("contextInRoute", { name: otherRoute.name }) : t("contextOpen")}
                  </div>
                  {clickable && <div className="text-muted-foreground">{t("contextClickToAdd")}</div>}
                </div>
              </Tooltip>
            </Marker>
          )
        })}
        <GroupRoutes
          groups={[displayGroup]}
          operationsById={operationsById}
          onMarkerClick={(id: string) => setFocusStopId(id)}
          highlightIncidentId={focusStopId}
        />
        <MapClickHandler onClick={handleMapClick} />
        <FitBounds positions={locatedPositions} />
        <InvalidateSize />
      </MapContainer>
    )
    // center/locatedPositions are captured per mapKey remount; excluded on purpose
    // so live data changes update markers without remounting the container.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isClient,
    mapKey,
    displayGroup,
    operationsById,
    contextPins,
    groups,
    canEdit,
    handleOpenPinClick,
    focusStopId,
    handleMapClick,
    getAttribution,
    getTileUrl,
    handleTileError,
    t,
  ])

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
          {/* Map column — FIXED width. Leaflet kept collapsing a flexible (flex-1)
              map track to near-zero, so the map is the fixed column now and the
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
