"use client"

/**
 * RoutenEditorModal — map-first editor for a single Auftrag (incident group).
 *
 * A Dialog with an embedded Leaflet map (numbered markers + route polyline via the
 * shared `group-routes.tsx`) beside an ordered, drag-reorderable stop list. Lets the
 * operator:
 *  - toggle "Stop hinzufügen" and click the map to append a reverse-geocoded stop,
 *  - drag list rows to reorder (persists via reorderGroupStops),
 *  - pick a start anchor and run client-side nearest-neighbour optimize with a
 *    preview (Übernehmen / Verwerfen),
 *  - drop board/sheet resources onto stop rows to assign them (the page-level
 *    `useKanbanDragDrop` monitor handles the `group-stop` drop contract).
 *
 * SSR-safe: leaflet is only pulled in behind an `isClient` guard (the require()
 * pattern established by map-picker-modal.tsx), so nothing leaflet touches the
 * server render of the page that mounts this modal.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { MapPin, Wand2, MousePointerClick, MapPinned } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useMapMode } from "@/lib/hooks/use-map-mode"
import { useRoutePlanning, type RouteStartMode } from "@/lib/hooks/use-route-planning"
import type { IncidentGroup } from "@/lib/types/groups"
import { isLocated } from "@/lib/utils/route-geo"
import { useDialogDragGuard } from "@/lib/hooks/use-dialog-drag-guard"
import { RouteStopList } from "../map/route-stop-list"

// Basel-Landschaft fallback centre (matches map-picker-modal).
const DEFAULT_CENTER: [number, number] = [47.51637699933488, 7.561800450458299]

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
  }, [map, positions])
  return null
}

// -----------------------------------------------------------------------------

interface RoutenEditorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string | null
  /** Centre + highlight this stop when opening (from a stop's [Karte] button). */
  focusIncidentId?: string | null
}

export function RoutenEditorModal({ open, onOpenChange, groupId, focusIncidentId }: RoutenEditorModalProps) {
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

  // Keep the modal open while a drag-reorder happens inside it — a native drag
  // churns focus/pointer state that Radix would otherwise read as an outside
  // interaction and close the dialog on.
  const { dragGuardProps } = useDialogDragGuard(open)

  const [isClient, setIsClient] = useState(false)
  const [mapKey, setMapKey] = useState(0)
  const [addMode, setAddMode] = useState(false)
  const [startMode, setStartMode] = useState<RouteStartMode>("magazin")
  const [preview, setPreview] = useState<string[] | null>(null)
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
      setPreview(null)
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
      if (!addMode) return
      void addStopAtLatLng(lat, lng)
    },
    [addMode, addStopAtLatLng],
  )

  const runOptimize = () => {
    const proposed = optimize(startMode)
    if (proposed.length === 0) return
    const unchanged = group ? proposed.every((id, i) => id === group.stopIds[i]) : true
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

  // The order shown in the list + on the map (preview overrides while pending).
  const displayOrder = preview ?? group?.stopIds ?? []
  const changedPositions = useMemo(() => {
    if (!preview || !group) return new Set<string>()
    const changed = new Set<string>()
    preview.forEach((id, i) => {
      if (group.stopIds[i] !== id) changed.add(id)
    })
    return changed
  }, [preview, group])

  // Group the map draws — a synthetic clone carrying the display order so the
  // polyline + badges follow the preview without persisting it.
  const displayGroup: IncidentGroup | undefined = useMemo(
    () => (group ? { ...group, stopIds: displayOrder } : undefined),
    [group, displayOrder],
  )

  const mapNode = useMemo(() => {
    if (!isClient || !displayGroup) {
      return (
        <div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">
          {t("mapLoading")}
        </div>
      )
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MapContainer, TileLayer } = require("react-leaflet")
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("leaflet/dist/leaflet.css")
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GroupRoutes } = require("../map/group-routes")

    return (
      <MapContainer key={mapKey} center={center} zoom={14} className="h-full w-full" zoomControl>
        <TileLayer attribution={getAttribution()} url={getTileUrl()} eventHandlers={{ tileerror: handleTileError }} />
        <GroupRoutes
          groups={[displayGroup]}
          operationsById={operationsById}
          onMarkerClick={(id: string) => setFocusStopId(id)}
          highlightIncidentId={focusStopId}
        />
        <MapClickHandler onClick={handleMapClick} />
        <FitBounds positions={locatedPositions} />
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
    focusStopId,
    handleMapClick,
    getAttribution,
    getTileUrl,
    handleTileError,
    t,
  ])

  const startOptions: { value: RouteStartMode; label: string; disabled?: boolean }[] = [
    { value: "magazin", label: t("startMagazin"), disabled: !magazinCoords },
    { value: "vehicle", label: t("startVehicle"), disabled: !vehicleStart },
    { value: "first", label: t("startFirst") },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92vh] w-[calc(100%-2rem)] max-w-6xl flex-col gap-4"
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

        <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[2fr_1fr]">
          {/* Map column */}
          <div className="flex min-h-[520px] flex-col">
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

          {/* Ordered list column */}
          <div className="flex min-h-0 flex-col">
            <div className="mb-2 flex h-8 items-center justify-between gap-2">
              <span className="text-sm font-semibold">{t("order")}</span>
              <Button
                size="sm"
                variant={addMode ? "default" : "outline"}
                className="h-8 gap-1.5"
                onClick={() => setAddMode((v) => !v)}
              >
                <MousePointerClick className="h-3.5 w-3.5" />
                {t("addStopToggle")}
              </Button>
            </div>

            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded-lg border bg-muted/20 p-2">
              {displayOrder.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
                  <MapPinned className="mb-2 h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">{t("emptyState")}</p>
                </div>
              ) : (
                <RouteStopList
                  groupId={group?.id ?? ""}
                  stopIds={group?.stopIds ?? []}
                  displayOrder={displayOrder}
                  operationsById={operationsById}
                  changedPositions={changedPositions}
                  reorderDisabled={preview !== null}
                  onReorder={(ids) => void reorder(ids)}
                  focusStopId={focusStopId}
                  onSelectStop={setFocusStopId}
                  enabled={open && !!group}
                />
              )}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-t pt-3">
          {preview ? (
            <>
              <span className="text-sm text-muted-foreground">
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
              <span className="text-sm text-muted-foreground">{t("startFrom")}</span>
              <Select value={startMode} onValueChange={(v) => setStartMode(v as RouteStartMode)}>
                <SelectTrigger className="h-8 w-[160px]">
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
              <Button size="sm" variant="outline" className="gap-1.5" onClick={runOptimize} disabled={displayOrder.length < 2}>
                <Wand2 className="h-3.5 w-3.5" />
                {t("optimize")}
              </Button>
              <Button size="sm" className="ml-auto" onClick={() => onOpenChange(false)}>
                {t("done")}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
