"use client"

/**
 * IncidentPickerDialog — pick EXISTING incidents to add as stops to an Auftrag.
 *
 * A searchable, multi-select list of the current event's incidents. Picking an
 * incident that already belongs to another Auftrag MOVES it into the target
 * route (the backend `addStops` reassigns `group_id`), so those rows show a small
 * badge of their current route. Incidents already in the target route are shown
 * pre-selected; unchecking one detaches it from the route on confirm.
 *
 * The Karte view works like the Routen-Editor's map (the shared rule in
 * `components/map/route-stop-pick.tsx`): the route's stops are numbered with the
 * route line, a grey (free) pin clicked becomes the next number, another Auftrag's
 * pin asks before it moves here, and a picked pin clicked again drops out.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEffectEvent } from "@/lib/hooks/use-effect-event"
import { useTranslations } from "next-intl"
import { Route as RouteIcon, Plus, List, MapPin } from "lucide-react"
import type { Map as MlMap } from "maplibre-gl"
import { NavigationControl } from "react-map-gl/maplibre"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { SearchInput } from "@/components/ui/search-input"
import { SurfaceStep, useOpenSurface } from "@/components/ui/surface-step"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { BaseMap } from "@/components/map/base-map"
import { GroupRoutes } from "@/components/map/group-routes"
import { RouteContextPin, stopSequence } from "@/components/map/route-stop-pick"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { isLocated } from "@/lib/utils/route-geo"
import { DEFAULT_CENTER_LATLNG, fitTo, type LatLngPoint } from "@/lib/map-view"
import { MAP_NONE } from "@/lib/map-colors"
import { colorAccent } from "@/lib/kanban-utils"
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

interface IncidentPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** All incidents of the current event (already event-scoped by the context). */
  operations: Operation[]
  groups: IncidentGroup[]
  /** The target route — its own stops show pre-selected (numbered on the map). */
  targetGroupId: string | null
  onConfirm: (incidentIds: string[]) => void
  /** Optional "Neuer Einsatz" affordance (opens the New-Emergency modal). */
  onCreateNew?: () => void
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
  const tDash = useTranslations("kanban.dashboard")
  // The pin texts are the Routen-Editor's: both maps say the same thing.
  const tPin = useTranslations("kanban.routenEditorModal")
  const surface = useOpenSurface()
  const tColumn = useTranslations("kanban.columns")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Karte is the default view — located incidents are easier to pick spatially.
  const [view, setView] = useState<"list" | "map">("map")
  const [mapKey, setMapKey] = useState(0)
  // The LIVE map instance, or null whenever the map is not on screen. Clearing it is what
  // makes a reopen (or a trip through the Liste view) frame anything at all: the dialog body
  // is unmounted by Radix, so the previous instance is already removed. Left in state, the fit
  // effect below would run against that dead instance, latch the fit marker, and the fresh
  // instance arriving a moment later would never be fitted.
  const [map, setMap] = useState<MlMap | null>(null)
  // The initial fit runs once per map instance, and only once there is something to
  // frame — the candidates can still be filtering down when the map reports ready.
  // Track the instance itself: filtering to zero candidates also unmounts the map.
  const fittedMapRef = useRef<MlMap | null>(null)
  const { removeStop } = useGroups()

  // Remount the map (re-fit) each time the map view is (re-)opened.
  useEffect(() => {
    if (!open || view !== "map") {
      setMap(null)
      return
    }
    setMapKey((k) => k + 1)
    fittedMapRef.current = null
  }, [open, view])

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g] as const)), [groups])

  // The target route's current members — shown pre-selected; unchecking one
  // detaches it from the route on confirm.
  const memberIds = useMemo(
    () => new Set(targetGroupId ? operations.filter((op) => op.groupId === targetGroupId).map((op) => op.id) : []),
    [operations, targetGroupId],
  )

  // Pre-select the route's current members whenever the dialog (re-)opens – the board as it
  // is then; a board update while it is open must not undo the operator's ticks.
  // `openedMembers` keeps that snapshot: «Übernehmen» applies only what the operator changed
  // against it, so a stop another operator adds meanwhile is not read as «unticked».
  const [openedMembers, setOpenedMembers] = useState<ReadonlySet<string>>(new Set())
  const preselectMembers = useEffectEvent(() => {
    const members = new Set(operations.filter((op) => op.groupId === targetGroupId).map((op) => op.id))
    setOpenedMembers(members)
    setSelected(new Set(members))
  })
  useEffect(() => {
    if (open) preselectMembers()
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

  const operationsById = useMemo(() => new Map(operations.map((op) => [op.id, op] as const)), [operations])
  const targetGroup = targetGroupId ? groupById.get(targetGroupId) : undefined

  /** The other Auftrag an incident is on, if any (the target route is not «other»). */
  const otherRouteOf = useCallback(
    (incidentId: string) => {
      const groupId = operationsById.get(incidentId)?.groupId
      return groupId && groupId !== targetGroupId ? groupById.get(groupId) : undefined
    },
    [operationsById, targetGroupId, groupById],
  )

  // The map: the route as it will be after «Übernehmen» – its kept stops in order, then the
  // picks in click order – drawn by the shared `<GroupRoutes>`. Not filtered by the search, so
  // the numbers and the line never break while the operator types.
  const sequence = useMemo(() => stopSequence(targetGroup?.stopIds ?? [], selected), [targetGroup, selected])
  const sequenceIds = useMemo(() => new Set(sequence), [sequence])
  const routeGroups = useMemo(
    () => (targetGroup ? [{ ...targetGroup, stopIds: sequence }] : []),
    [targetGroup, sequence],
  )
  const pendingIds = useMemo(() => new Set([...selected].filter((id) => !memberIds.has(id))), [selected, memberIds])
  // Everything else located is a context pin: free, on another Auftrag, or a member unticked.
  const contextCandidates = useMemo(
    () => candidates.filter(isLocated).filter((op) => !sequenceIds.has(op.id)),
    [candidates, sequenceIds],
  )
  const locatedStops = useMemo(() => sequence.map((id) => operationsById.get(id)).filter(isLocated), [sequence, operationsById])
  const targetColor = targetGroup ? colorAccent(targetGroup.id, "auftrag", groups) : undefined
  // The colours of the OTHER routes on the map, for the legend – the swatch it shows is one
  // the map really draws.
  const otherRouteColors = useMemo(() => {
    const colors = new Set<string>()
    for (const op of contextCandidates) {
      const other = otherRouteOf(op.id)
      if (other) colors.add(colorAccent(other.id, "auftrag", groups))
    }
    return [...colors].slice(0, 4)
  }, [contextCandidates, otherRouteOf, groups])
  const allMapPositions = useMemo<LatLngPoint[]>(
    () => [...locatedStops, ...contextCandidates].map((op) => op.coordinates),
    [locatedStops, contextCandidates],
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
  // While «Übernehmen» writes, the picks are frozen: an edit then would be dropped when the
  // dialog closes on the earlier selection.
  const applyingRef = useRef(false)
  const toggle = useCallback((id: string) => {
    if (applyingRef.current) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // A click on the map picks like a list checkbox: free and other-Auftrag pins join the
  // sequence, a picked pin leaves it. Nothing is saved until «Übernehmen», so the question
  // about stops from another Auftrag comes once, there (`confirm`), not per click – the
  // Routen-Editor asks per click because it saves at once.
  const pickOnMap = toggle

  // Diff the selection against the members as the dialog opened: newly-checked ids are added
  // (via onConfirm → addStops) unless they joined meanwhile; unchecked ones are detached
  // (removeStop) if they are still members.
  const toAdd = useMemo(
    () => [...selected].filter((id) => !openedMembers.has(id) && !memberIds.has(id)),
    [selected, openedMembers, memberIds],
  )
  const toRemove = useMemo(
    () => [...openedMembers].filter((id) => !selected.has(id) && memberIds.has(id)),
    [selected, openedMembers, memberIds],
  )
  const changeCount = toAdd.length + toRemove.length
  // The picks that leave another Auftrag – named in the one question before «Übernehmen».
  const moving = useMemo(() => toAdd.filter((id) => otherRouteOf(id)), [toAdd, otherRouteOf])
  const [askMove, setAskMove] = useState(false)

  // One apply at a time: a second click while the detaches run would send them again.
  const [applying, setApplying] = useState(false)
  const apply = async () => {
    if (applyingRef.current) return
    applyingRef.current = true
    setApplying(true)
    try {
      await applyChanges()
    } finally {
      applyingRef.current = false
      setApplying(false)
    }
  }
  const applyChanges = async () => {
    if (toRemove.length > 0 && targetGroupId) {
      // A failed detach (removeStop shows its own error) keeps the dialog open with the
      // picks, so the operator sees that the route is not what the preview shows.
      const detached = await Promise.all(toRemove.map((id) => removeStop(targetGroupId, id)))
      if (detached.includes(false)) return
    }
    if (toAdd.length > 0) onConfirm(toAdd)
    handleOpenChange(false)
  }

  const confirm = async () => {
    if (changeCount === 0) {
      handleOpenChange(false)
      return
    }
    if (moving.length > 0) {
      setAskMove(true)
      return
    }
    await apply()
  }

  const movingNames = moving
    .map((id) => {
      const op = operationsById.get(id)
      const place = op
        ? (op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())) || getIncidentTypeLabel(op.incidentType)
        : ""
      return `«${place}» (${otherRouteOf(id)?.name ?? ""})`
    })
    .join(", ")
  const moveDialog = (
    <ConfirmDialog
      open={askMove}
      onOpenChange={setAskMove}
      title={tDash("distributeConfirmTitle")}
      description={t("moveConfirm", { count: moving.length, names: movingNames, to: targetGroup?.name ?? "" })}
      confirmText={tDash("distributeConfirmAction")}
      // A move out of another Auftrag: Enter keeps to Abbrechen.
      initialFocus="cancel"
      onConfirm={apply}
    />
  )

  // Frame the candidates once the map is up and there are markers to frame.
  useEffect(() => {
    if (!map || fittedMapRef.current === map || allMapPositions.length === 0) return
    fittedMapRef.current = map
    fitTo(map, allMapPositions, FIT_OPTIONS)
  }, [map, allMapPositions])

  // The map: the route's numbered stops plus the other located candidates as context pins.
  // Every click goes through `pickOnMap` (the same set the list checkboxes drive). `mapKey`
  // remounts the map per open, so `mapCenter` is captured then while the pins track live state.
  const mapNode = (
    <BaseMap
      key={mapKey}
      initialViewState={{ longitude: mapCenter[1], latitude: mapCenter[0], zoom: 13 }}
      onLoad={setMap}
    >
      <NavigationControl position="top-left" showCompass={false} />
      {/* Context pins sit below the numbered stops (lower z-index). */}
      {contextCandidates.map((op) => {
        const otherRoute = otherRouteOf(op.id)
        const location = op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())
        return (
          <RouteContextPin
            key={op.id}
            op={op}
            fill={otherRoute ? colorAccent(otherRoute.id, "auftrag", groups) : MAP_NONE}
            otherRoute={!!otherRoute}
            clickable
            title={location || getIncidentTypeLabel(op.incidentType)}
            subtitle={otherRoute ? tPin("contextInRoute", { name: otherRoute.name }) : tPin("contextOpen")}
            hint={otherRoute ? tPin("contextClickToMove") : tPin("contextClickToAdd")}
            onSelect={() => pickOnMap(op.id)}
          />
        )
      })}
      <GroupRoutes
        groups={routeGroups}
        operationsById={operationsById}
        pendingIds={pendingIds}
        onMarkerClick={pickOnMap}
      />
    </BaseMap>
  )

  // In a step the body fills the surface; in its own window both views share one fixed
  // height, so toggling Liste ⇄ Karte never resizes it.
  const bodyHeight = surface ? "min-h-0 flex-1" : "h-[440px]"
  const content = (
    <>
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
            "flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-medium transition-colors",
            view === "list" ? "sel-choice" : "text-muted-foreground hover:bg-muted",
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
            "flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-medium transition-colors",
            view === "map" ? "sel-choice" : "text-muted-foreground hover:bg-muted",
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
              ? "border-sel-edge bg-sel-wash text-sel-foreground"
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
      <div className={cn("flex flex-col gap-2", bodyHeight)}>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border">
          {allMapPositions.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <MapPin className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t("mapEmpty")}</p>
            </div>
          ) : (
            mapNode
          )}
        </div>
        {/* What the pins mean. Without it the map is a guessing game: the numbers are this
            Auftrag's stops in order, the ring marks the ones «Übernehmen» adds, a route
            colour says "on another Auftrag", grey says "on none". */}
        {allMapPositions.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-2xs text-muted-foreground">
            {targetColor && (
              <span className="flex items-center gap-1.5">
                <span className="flex size-4 items-center justify-center rounded-full text-2xs font-bold leading-none text-white" style={{ backgroundColor: targetColor }}>1</span>
                {t("legendStops")}
              </span>
            )}
            {targetColor && (
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-full ring-2 ring-sel-line" style={{ backgroundColor: targetColor }} />
                {t("legendPending")}
              </span>
            )}
            {/* The swatches the map really draws: the other routes' own colours. */}
            {otherRouteColors.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="flex items-center gap-0.5">
                  {otherRouteColors.map((color) => (
                    <span key={color} className="h-2.5 w-2.5 rounded-full border border-dashed border-white opacity-50" style={{ backgroundColor: color }} />
                  ))}
                </span>
                {t("legendOtherRoute")}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border border-white" style={{ backgroundColor: MAP_NONE }} />
              {t("legendUnassigned")}
            </span>
          </div>
        )}
      </div>
    ) : (
    <div className={cn("-mx-1 space-y-0.5 overflow-y-auto px-1", bodyHeight)}>
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
                isChecked && "bg-sel-wash",
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
                  {getIncidentTypeLabel(op.incidentType)} · {tColumn(op.status)}
                </p>
              </div>
            </label>
          )
        })
      )}
    </div>
    )}

    {/* A picker's footer, not a question's: the escape hatch goes left on its
        own (`sm:mr-auto`), Abbrechen stays in the right-hand group beside the
        primary button. (A confirmation's third answer is a line of its own –
        `ConfirmDialog`'s `extraAction`.) `justify-between` plus a `<span />`
        spacer did the same thing, but only as long as something stood in the
        left slot. */}
    <DialogFooter className={cn("flex-shrink-0", surface && "border-t px-5 py-3")}>
      {onCreateNew && (
        <Button
          variant="ghost"
          size="sm"
          className="sm:mr-auto"
          disabled={applying}
          onClick={() => {
            handleOpenChange(false)
            onCreateNew()
          }}
        >
          <Plus className="size-3.5" />
          {t("createNew")}
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={applying}>
        {t("cancel")}
      </Button>
      <Button size="sm" onClick={confirm} disabled={changeCount === 0 || applying}>
        {t("apply")}
      </Button>
    </DialogFooter>
    {moveDialog}
    </>
  )

  // Opened from the Aufträge sheet («+ Stopp»): a step inside it (owner pick 5A).
  if (surface) {
    if (!open) return null
    return (
      <SurfaceStep host={surface} title={t("title")} description={t("description")} onBack={() => !applyingRef.current && handleOpenChange(false)}>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pt-1">{content}</div>
      </SurfaceStep>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next || !applyingRef.current) && handleOpenChange(next)}>
      <DialogContent className="flex modal-h-tall flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}
