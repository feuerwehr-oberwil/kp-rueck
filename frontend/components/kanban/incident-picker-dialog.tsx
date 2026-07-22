"use client"

/**
 * IncidentPickerDialog — pick EXISTING incidents to add as stops to an Auftrag.
 *
 * A searchable, multi-select list of the current event's incidents. Picking an
 * incident that already belongs to another Auftrag MOVES it into the target
 * route (the backend `addStops` reassigns `group_id`), so those rows show a small
 * badge of their current route. Incidents already in the target route are shown
 * pre-selected; unchecking one detaches it from the route on confirm.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Search, Route as RouteIcon, Plus, List, MapPin } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { columns } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { useMapMode } from "@/lib/hooks/use-map-mode"
import { isLocated } from "@/lib/utils/route-geo"
import type { Operation } from "@/lib/contexts/operations-context"
import { useGroups, type IncidentGroup } from "@/lib/contexts/groups-context"

// Basel-Landschaft fallback centre (matches map-picker / routen-editor modals).
const DEFAULT_CENTER: [number, number] = [47.51637699933488, 7.561800450458299]

// Fit the map to all rendered markers once per remount (client-only; mirrors the
// routen-editor-modal helper — leaflet stays behind an isClient guard).
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
      map.setView(positions[0], 14)
      return
    }
    map.fitBounds(L.latLngBounds(positions), { padding: [40, 40], maxZoom: 15 })
  }, [map, positions])
  return null
}

// A map mounted inside a Radix Dialog measures 0×0 until the open transition
// settles, so Leaflet lays out blank/narrow. Force a re-measure on mount and on
// container resize (this is what made the "+ Stop" Karte view render blank).
function InvalidateSize() {
  if (typeof window === "undefined") return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMap } = require("react-leaflet")
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const map = useMap()
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const fix = () => map.invalidateSize()
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

interface IncidentPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** All incidents of the current event (already event-scoped by the context). */
  operations: Operation[]
  groups: IncidentGroup[]
  /** The target route — its own stops are hidden (they're already members). */
  targetGroupId: string | null
  onConfirm: (incidentIds: string[]) => void
  /** Optional "Neuer Einsatz" affordance (opens the New-Emergency modal). */
  onCreateNew?: () => void
}

function statusLabel(op: Operation): string {
  const col = columns.find((c) => c.status.includes(op.status))
  return col?.title ?? op.status
}

export function IncidentPickerDialog({
  open,
  onOpenChange,
  operations,
  groups,
  targetGroupId,
  onConfirm,
  onCreateNew,
}: IncidentPickerDialogProps) {
  const t = useTranslations("kanban.incidentPicker")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Karte is the default view — located incidents are easier to pick spatially.
  const [view, setView] = useState<"list" | "map">("map")
  const [isClient, setIsClient] = useState(false)
  const [mapKey, setMapKey] = useState(0)
  const { getTileUrl, getAttribution, handleTileError } = useMapMode()
  const { removeStop } = useGroups()

  useEffect(() => setIsClient(true), [])
  // Remount the map (re-fit) each time the map view is (re-)opened.
  useEffect(() => {
    if (open && view === "map") setMapKey((k) => k + 1)
  }, [open, view])

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g] as const)), [groups])

  // The target route's current members — shown pre-selected; unchecking one
  // detaches it from the route on confirm.
  const memberIds = useMemo(
    () => new Set(targetGroupId ? operations.filter((op) => op.groupId === targetGroupId).map((op) => op.id) : []),
    [operations, targetGroupId],
  )

  // Pre-select the route's current members whenever the dialog (re-)opens.
  useEffect(() => {
    if (!open) return
    setSelected(new Set(operations.filter((op) => op.groupId === targetGroupId).map((op) => op.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetGroupId])

  // Candidates: every event incident (members included, so they show pre-checked).
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return operations.filter((op) => {
      if (!q) return true
      // Match address/title, incident-type (label + raw key) and the
      // Meldung/description, not just the address.
      return (
        op.location.toLowerCase().includes(q) ||
        getIncidentTypeLabel(op.incidentType).toLowerCase().includes(q) ||
        op.incidentType.toLowerCase().includes(q) ||
        op.notes.toLowerCase().includes(q)
      )
    })
  }, [operations, query])

  // Map markers: all located candidates (selectable — members render pre-checked).
  const locatedCandidates = useMemo(() => candidates.filter(isLocated), [candidates])
  const allMapPositions = useMemo<[number, number][]>(
    () => locatedCandidates.map((op) => op.coordinates),
    [locatedCandidates],
  )
  const mapCenter = useMemo<[number, number]>(() => {
    if (allMapPositions.length === 0) return DEFAULT_CENTER
    const lat = allMapPositions.reduce((s, p) => s + p[0], 0) / allMapPositions.length
    const lng = allMapPositions.reduce((s, p) => s + p[1], 0) / allMapPositions.length
    return [lat, lng]
  }, [allMapPositions])

  // Reset transient state whenever the dialog transitions closed.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQuery("")
      setSelected(new Set())
      setView("map")
    }
    onOpenChange(next)
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Diff the current selection against the route's members: newly-checked ids are
  // added (via onConfirm → addStops), unchecked members are detached (removeStop).
  const toAdd = useMemo(() => [...selected].filter((id) => !memberIds.has(id)), [selected, memberIds])
  const toRemove = useMemo(() => [...memberIds].filter((id) => !selected.has(id)), [selected, memberIds])
  const changeCount = toAdd.length + toRemove.length

  const confirm = async () => {
    if (changeCount === 0) {
      handleOpenChange(false)
      return
    }
    if (toRemove.length > 0 && targetGroupId) {
      await Promise.all(toRemove.map((id) => removeStop(targetGroupId, id)))
    }
    if (toAdd.length > 0) onConfirm(toAdd)
    handleOpenChange(false)
  }

  // Client-only leaflet map: located candidates as selectable pins + the target
  // route's own stops as distinct dimmed context pins. Clicking a candidate pin
  // toggles its selection (same set the list checkboxes drive).
  const mapNode = useMemo(() => {
    if (!isClient) {
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

    const pinIcon = (fill: string, opts: { selected?: boolean; dimmed?: boolean; dashed?: boolean } = {}) => {
      const size = opts.selected ? 26 : 20
      const ring = opts.selected
        ? "box-shadow: 0 0 0 3px rgba(239,68,68,0.35), 0 2px 5px rgba(0,0,0,0.35);"
        : "box-shadow: 0 1px 4px rgba(0,0,0,0.3);"
      const border = opts.dashed ? "border: 2px dashed white;" : "border: 2px solid white;"
      return L.divIcon({
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${fill};${border}${ring}opacity:${opts.dimmed ? 0.45 : 1};"></div>`,
        className: "incident-picker-marker",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      })
    }

    return (
      <MapContainer key={mapKey} center={mapCenter} zoom={13} className="h-full w-full" zoomControl>
        <TileLayer attribution={getAttribution()} url={getTileUrl()} eventHandlers={{ tileerror: handleTileError }} />
        <InvalidateSize />
        <FitBounds positions={allMapPositions} />
        {/* Selectable candidates — members of the target route render pre-checked. */}
        {locatedCandidates.map((op) => {
          const otherGroup = op.groupId && op.groupId !== targetGroupId ? groupById.get(op.groupId) : undefined
          const isChecked = selected.has(op.id)
          const fill = isChecked ? "#ef4444" : otherGroup?.color ?? "#64748b"
          return (
            <Marker
              key={op.id}
              position={op.coordinates}
              icon={pinIcon(fill, { selected: isChecked, dashed: !!otherGroup && !isChecked })}
              eventHandlers={{ click: () => toggle(op.id) }}
            >
              <Tooltip direction="top" offset={[0, -10]}>
                <span className="text-xs font-medium">
                  {op.location || getIncidentTypeLabel(op.incidentType)}
                  {otherGroup ? ` · ${otherGroup.name}` : ""}
                </span>
              </Tooltip>
            </Marker>
          )
        })}
      </MapContainer>
    )
  }, [
    isClient,
    mapKey,
    mapCenter,
    allMapPositions,
    locatedCandidates,
    selected,
    groupById,
    targetGroupId,
    getTileUrl,
    getAttribution,
    handleTileError,
    toggle,
    t,
  ])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Top-anchored + fixed-height body so toggling Liste ⇄ Karte never moves
          or resizes the dialog (both modes share the same h-[440px] body). */}
      <DialogContent className="top-[8vh] flex max-h-[84vh] max-w-xl translate-y-0 flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-9 pl-8"
            />
          </div>
          {/* List ⇄ Karte view toggle */}
          <div className="flex flex-shrink-0 rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              title={t("viewList")}
              className={cn(
                "flex h-7 items-center gap-1 rounded px-2 text-xs font-medium transition-colors",
                view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <List className="h-3.5 w-3.5" />
              {t("viewList")}
            </button>
            <button
              type="button"
              onClick={() => setView("map")}
              aria-pressed={view === "map"}
              title={t("viewMap")}
              className={cn(
                "flex h-7 items-center gap-1 rounded px-2 text-xs font-medium transition-colors",
                view === "map" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <MapPin className="h-3.5 w-3.5" />
              {t("viewMap")}
            </button>
          </div>
        </div>

        {view === "map" ? (
          // Explicit height (not flex-1/min-h): a Leaflet map needs a definite
          // parent height or its `h-full` container collapses to 0 and renders
          // blank. InvalidateSize re-measures after the dialog's open transition.
          <div className="relative h-[440px] overflow-hidden rounded-lg border">
            {locatedCandidates.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <MapPin className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">{t("mapEmpty")}</p>
              </div>
            ) : (
              mapNode
            )}
          </div>
        ) : (
        <div className="-mx-1 h-[440px] space-y-0.5 overflow-y-auto px-1">
          {candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <RouteIcon className="mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            </div>
          ) : (
            candidates.map((op) => {
              const otherGroup = op.groupId && op.groupId !== targetGroupId ? groupById.get(op.groupId) : undefined
              const isChecked = selected.has(op.id)
              return (
                <label
                  key={op.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50",
                    isChecked && "bg-primary/[0.06]",
                  )}
                >
                  <Checkbox checked={isChecked} onCheckedChange={() => toggle(op.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {op.location || getIncidentTypeLabel(op.incidentType)}
                      </span>
                      {otherGroup && (
                        <span
                          className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                          title={t("inRoute", { name: otherGroup.name })}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: otherGroup.color ?? "var(--muted-foreground)" }}
                          />
                          {otherGroup.name}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {getIncidentTypeLabel(op.incidentType)} · {statusLabel(op)}
                    </p>
                  </div>
                </label>
              )
            })
          )}
        </div>
        )}

        <DialogFooter className="flex-shrink-0 sm:justify-between">
          {onCreateNew ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                handleOpenChange(false)
                onCreateNew()
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("createNew")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button size="sm" onClick={confirm} disabled={changeCount === 0}>
              {t("apply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
