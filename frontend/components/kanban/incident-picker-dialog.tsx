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

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Route as RouteIcon, Plus, List, MapPin } from "lucide-react"
import type { Map as MlMap } from "maplibre-gl"
import { Marker, NavigationControl, useMap } from "react-map-gl/maplibre"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { columns } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { BaseMap } from "@/components/map/base-map"
import { MapTooltip, type MapTooltipSide } from "@/components/map/map-tooltip"
import { isLocated, type LocatedOperation } from "@/lib/utils/route-geo"
import { DEFAULT_CENTER_LATLNG, fitTo, type LatLngPoint } from "@/lib/map-view"
import type { Operation } from "@/lib/contexts/operations-context"
import { useGroups, type IncidentGroup } from "@/lib/contexts/groups-context"

/**
 * How this dialog frames its candidates.
 *
 * Generous padding on purpose: a marker hard against the frame has nowhere to put its label, and
 * the dialog's map clips at its border. A lone candidate gets a fixed scale rather than a
 * zero-size box.
 */
const FIT_OPTIONS = {
  padding: { top: 80, bottom: 80, left: 64, right: 64 },
  maxZoom: 15,
  duration: 0,
  singleZoom: 14,
} as const

/**
 * One selectable candidate pin, with the label Leaflet's `direction="auto"` drew.
 *
 * MapLibre has no auto-flipping tooltip, so this reproduces Leaflet's rule exactly:
 * a marker in the left half of the container labels to the RIGHT, one in the right
 * half labels to the LEFT — always towards the middle of the map, because the
 * container clips and an outward label was simply cut off. The side is resolved on
 * hover, when the projection is current and the label is about to be shown.
 */
function CandidatePin({
  op,
  fill,
  selected,
  dashed,
  title,
  subtitle,
  notes,
  onToggle,
}: {
  op: LocatedOperation
  fill: string
  selected: boolean
  dashed: boolean
  title: string
  subtitle?: string
  notes?: string
  onToggle: () => void
}) {
  const { current: map } = useMap()
  const [side, setSide] = useState<MapTooltipSide>("right")
  const [hovered, setHovered] = useState(false)
  const [lat, lng] = op.coordinates
  const size = selected ? 26 : 20

  const show = () => {
    if (map) setSide(map.project([lng, lat]).x < map.getContainer().clientWidth / 2 ? "right" : "left")
    setHovered(true)
  }

  return (
    <Marker
      longitude={lng}
      latitude={lat}
      // The selected pin is the bigger one; keep it (and whatever is hovered) on top.
      style={{ zIndex: hovered ? 300 : selected ? 200 : 100 }}
      onClick={(event) => {
        // Without this the click reaches the map itself as well.
        event.originalEvent.stopPropagation()
        onToggle()
      }}
    >
      <div style={{ position: "relative" }} onMouseEnter={show} onMouseLeave={() => setHovered(false)}>
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: fill,
            border: `2px ${dashed ? "dashed" : "solid"} white`,
            boxShadow: selected
              ? "0 0 0 3px rgba(239, 68, 68, 0.35), 0 2px 5px rgba(0, 0, 0, 0.35)"
              : "0 1px 4px rgba(0, 0, 0, 0.3)",
            cursor: "pointer",
          }}
        />
        {hovered && (
          <MapTooltip side={side}>
            <div className="text-xs leading-tight">
              {/* Match the stop-row hover: address primary, type secondary,
                  Meldung below. Type falls back to primary when no address. */}
              <div className="font-medium">{title}</div>
              {subtitle && <div className="text-muted-foreground">{subtitle}</div>}
              {notes && <div className="mt-0.5 max-w-[220px] whitespace-pre-wrap">{notes}</div>}
            </div>
          </MapTooltip>
        )}
      </div>
    </Marker>
  )
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
  const [mapKey, setMapKey] = useState(0)
  // The LIVE map instance, or null whenever the map is not on screen. Clearing it is what
  // makes a reopen (or a trip through the Liste view) frame anything at all: the dialog body
  // is unmounted by Radix, so the previous instance is already removed. Left in state, the fit
  // effect below would run against that dead instance, latch `fittedRef`, and the fresh
  // instance arriving a moment later would never be fitted.
  const [map, setMap] = useState<MlMap | null>(null)
  // The initial fit runs once per map instance, and only once there is something to
  // frame — the candidates can still be filtering down when the map reports ready.
  const fittedRef = useRef(false)
  const { removeStop } = useGroups()

  // Remount the map (re-fit) each time the map view is (re-)opened.
  useEffect(() => {
    if (!open || view !== "map") {
      setMap(null)
      return
    }
    setMapKey((k) => k + 1)
    fittedRef.current = false
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

  /**
   * What the list shows, hides, and labels.
   *
   * Every incident of the event is visible from the start — including those that
   * already belong to another Auftrag. Labelled beats hidden: those rows carry
   * their route's coloured name badge, so "this one is already taken" is stated
   * on the row instead of implied by absence. Picking one still MOVES it (the
   * backend `addStops` reassigns `group_id`), which is occasionally what you
   * want and, with the badge in view, never what you do by accident.
   *
   * Only COMPLETED incidents are hidden by default — they are history, not
   * candidates. They stay one tap away, and the count of what is hidden is on
   * screen, because a list that silently drops rows is a list an operator stops
   * trusting.
   *
   * Members of the TARGET route ignore the filter: they render pre-checked, and
   * hiding one would turn "uncheck to detach" into an impossible move.
   */
  const [showCompleted, setShowCompleted] = useState(false)

  const isDone = useCallback((op: Operation) => op.status === "complete", [])

  const hiddenCount = useMemo(
    () =>
      showCompleted
        ? 0
        : operations.filter((op) => !memberIds.has(op.id) && isDone(op)).length,
    [operations, memberIds, showCompleted, isDone],
  )

  // Candidates: every event incident (members included, so they show pre-checked).
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return operations.filter((op) => {
      if (!memberIds.has(op.id) && !showCompleted && isDone(op)) return false
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
  }, [operations, query, memberIds, showCompleted, isDone])

  // Map markers: all located candidates (selectable — members render pre-checked).
  const locatedCandidates = useMemo(() => candidates.filter(isLocated), [candidates])
  const allMapPositions = useMemo<LatLngPoint[]>(
    () => locatedCandidates.map((op) => op.coordinates),
    [locatedCandidates],
  )
  const mapCenter = useMemo<LatLngPoint>(() => {
    if (allMapPositions.length === 0) return DEFAULT_CENTER_LATLNG
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

  // useCallback, not a plain function: the list rows and every map pin take it as a
  // handler, and the updater form reads the previous Set — so the only dependency is
  // the (stable) state setter, [], and a keystroke in the search box changes nothing.
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

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

  // Frame the candidates once the map is up and there are markers to frame.
  useEffect(() => {
    if (!map || fittedRef.current || allMapPositions.length === 0) return
    fittedRef.current = true
    fitTo(map, allMapPositions, FIT_OPTIONS)
  }, [map, allMapPositions])

  // The map: located candidates as selectable pins. Clicking one toggles its
  // selection (the same set the list checkboxes drive). `mapKey` remounts the map
  // per open, so `mapCenter` is captured then while the pins track live state.
  const mapNode = (
    <BaseMap
      key={mapKey}
      initialViewState={{ longitude: mapCenter[1], latitude: mapCenter[0], zoom: 13 }}
      onLoad={setMap}
    >
      <NavigationControl position="top-left" showCompass={false} />
      {/* Selectable candidates — members of the target route render pre-checked. */}
      {locatedCandidates.map((op) => {
        const otherGroup = op.groupId && op.groupId !== targetGroupId ? groupById.get(op.groupId) : undefined
        const isChecked = selected.has(op.id)
        const location = op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())
        return (
          <CandidatePin
            key={op.id}
            op={op}
            fill={isChecked ? "#ef4444" : otherGroup?.color ?? "#64748b"}
            selected={isChecked}
            dashed={!!otherGroup && !isChecked}
            title={`${location || getIncidentTypeLabel(op.incidentType)}${otherGroup ? ` · ${otherGroup.name}` : ""}`}
            subtitle={location ? getIncidentTypeLabel(op.incidentType) : undefined}
            notes={op.notes || undefined}
            onToggle={() => toggle(op.id)}
          />
        )
      })}
    </BaseMap>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Top-anchored + fixed-height body so toggling Liste ⇄ Karte never moves
          or resizes the dialog (both modes share the same h-[440px] body). */}
      <DialogContent className="top-[8vh] flex modal-h-tall max-w-xl translate-y-0 flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <SearchInput
            autoFocus
            size="sm"
            containerClassName="flex-1"
            value={query}
            onValueChange={setQuery}
            placeholder={t("searchPlaceholder")}
            className="h-9"
          />
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

        {/* What the list is not showing (completed only), and the way to see it.
            Nothing is dropped silently: the count is the point of the row. */}
        {(hiddenCount > 0 || showCompleted) && (
          <div className="-mt-1 flex flex-wrap items-center gap-2 text-xs">
            {hiddenCount > 0 && (
              <span className="text-muted-foreground">{t("hiddenCount", { count: hiddenCount })}</span>
            )}
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              aria-pressed={showCompleted}
              className={cn(
                "rounded-full border px-2.5 py-0.5 font-medium transition-colors",
                showCompleted
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {t("showCompleted")}
            </button>
          </div>
        )}

        {view === "map" ? (
          // Same 440px body as the list view, split between map and legend, so
          // toggling Liste ⇄ Karte still never resizes the dialog. The map keeps
          // a definite height (flex-1 inside a fixed-height parent), which is
          // what the map canvas needs to lay out at all.
          <div className="flex h-[440px] flex-col gap-2">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border">
              {locatedCandidates.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <MapPin className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">{t("mapEmpty")}</p>
                </div>
              ) : (
                mapNode
              )}
            </div>
            {/* What the pin colours mean. Without it the map is a guessing game:
                red and a route colour both say "belongs somewhere", grey says
                "belongs nowhere", and nothing on screen said which was which. */}
            {locatedCandidates.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-2xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full border border-white" style={{ backgroundColor: "#ef4444" }} />
                  {t("legendSelected")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full border border-dashed border-white" style={{ backgroundColor: "#10b981" }} />
                  {t("legendOtherRoute")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full border border-white" style={{ backgroundColor: "#64748b" }} />
                  {t("legendUnassigned")}
                </span>
              </div>
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
              const label = (op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())) || getIncidentTypeLabel(op.incidentType)
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
                      <span className="truncate text-sm font-medium" title={label}>
                        {label}
                      </span>
                      {otherGroup && (
                        <span
                          className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-2xs font-medium text-muted-foreground"
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
              onClick={() => {
                handleOpenChange(false)
                onCreateNew()
              }}
            >
              <Plus className="size-3.5" />
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
