"use client"

import { useState, useEffect, useMemo } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { useIncidents, useOperations, type Operation } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { apiClient, type ApiIncident, type ApiViewerData } from "@/lib/api-client"
import type { Incident } from "@/lib/types/incidents"
import type { AssignedVehicle, StatusGroup, IncidentStatus } from "@/lib/types/incidents"
import { STATUS_TO_GROUP } from "@/lib/types/incidents"
import type { IncidentGroup } from "@/lib/types/groups"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { Loader2, Check, Layers, ChevronDown } from "lucide-react"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { colorGroupFor, COLOR_BY_STORAGE_KEY, COLOR_NONE, type ColorByDimension, type ColorGroup } from "@/lib/kanban-utils"
import { buildSituationData, viewerGroupsToIncidentGroups } from "@/lib/viewer-data"
import { IncidentDetailModal } from "@/components/display/incident-detail-modal"
import { DisplayStaleBanner } from "@/components/display/display-stale-banner"

const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-muted rounded-lg">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
})

/** All map display options in one bag so both auth and token variants share them. */
interface MapViewOptions {
  statusFilters: Record<StatusGroup, boolean>
  showLabels: boolean
  showAssignmentLines: boolean
  showDistances: boolean
  showGroupRoutes: boolean
  colorBy: ColorByDimension
}

const DEFAULT_VIEW_OPTIONS: MapViewOptions = {
  statusFilters: { open: true, active: true, completed: false },
  showLabels: true,
  showAssignmentLines: true,
  // Routes stay on by default here — the display is a passive monitor, so
  // Auftrag context should be visible without anyone touching the screen.
  showGroupRoutes: true,
  showDistances: false,
  colorBy: 'priority',
}

/**
 * /display/map — Full-bleed map display for command post monitors.
 *
 * Supports two auth modes:
 * - Editor auth (uses existing contexts)
 * - Viewer token (?token=xxx) (polls independently)
 */
export default function DisplayMapPage() {
  const t = useTranslations('display')
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const { isAuthenticated } = useAuth()

  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [detailIncidentId, setDetailIncidentId] = useState<string | null>(null)
  const [panTrigger, setPanTrigger] = useState(0)

  // View options — mirrors the filters on the normal map view. "Färben nach"
  // shares the persisted setting with the board/map; the storage listener keeps
  // the display in sync when the mode is switched from another window.
  const [options, setOptions] = useState<MapViewOptions>(DEFAULT_VIEW_OPTIONS)
  // Reported by the map: no GPS, no Linien/Distanz options (see DisplayMapControls).
  const [gpsAvailable, setGpsAvailable] = useState(false)
  useEffect(() => {
    const read = (value: string | null) => {
      if (value === 'reko' || value === 'vehicle' || value === 'type' || value === 'priority' || value === 'auftrag') {
        setOptions((prev) => ({ ...prev, colorBy: value }))
      }
    }
    read(localStorage.getItem(COLOR_BY_STORAGE_KEY))
    const onStorage = (e: StorageEvent) => {
      if (e.key === COLOR_BY_STORAGE_KEY) read(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setColorBy = (value: ColorByDimension) => {
    setOptions((prev) => ({ ...prev, colorBy: value }))
    if (typeof window !== 'undefined') localStorage.setItem(COLOR_BY_STORAGE_KEY, value)
  }
  const toggleOption = (key: 'showLabels' | 'showAssignmentLines' | 'showDistances' | 'showGroupRoutes') => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }))
  }
  const toggleStatusFilter = (group: StatusGroup) => {
    setOptions((prev) => ({
      ...prev,
      statusFilters: { ...prev.statusFilters, [group]: !prev.statusFilters[group] },
    }))
  }

  // Cross-window sync
  const { broadcast } = useCrossWindowSync({
    onMessage: (msg) => {
      if (msg.type === "incident:selected") {
        setSelectedIncidentId(msg.incidentId)
        setPanTrigger((p) => p + 1)
      }
    },
  })

  // A marker tap selects (and broadcasts, so a board next to this monitor
  // highlights the card) AND opens the read-only incident detail dialog.
  const handleMarkerClick = (incidentId: string) => {
    if (incidentId === selectedIncidentId) {
      setPanTrigger((p) => p + 1)
    } else {
      setSelectedIncidentId(incidentId)
      broadcast("incident:selected", incidentId)
    }
    setDetailIncidentId(incidentId)
  }

  const sharedProps = {
    selectedIncidentId,
    onMarkerClick: handleMarkerClick,
    panTrigger,
    options,
    onToggleStatusFilter: toggleStatusFilter,
    onToggleOption: toggleOption,
    onSetColorBy: setColorBy,
    detailIncidentId,
    onCloseDetail: () => setDetailIncidentId(null),
    gpsAvailable,
    onGpsAvailabilityChange: setGpsAvailable,
  }

  // If authenticated (editor mode), use contexts directly
  if (isAuthenticated && !token) {
    return <AuthenticatedDisplayMap {...sharedProps} />
  }

  // Token mode — poll viewer data
  if (token) {
    return <TokenDisplayMap token={token} {...sharedProps} />
  }

  // No auth, no token
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      {t('map.authRequired')}
    </div>
  )
}

interface DisplayMapVariantProps {
  selectedIncidentId: string | null
  onMarkerClick: (id: string) => void
  panTrigger: number
  options: MapViewOptions
  onToggleStatusFilter: (group: StatusGroup) => void
  onToggleOption: (key: 'showLabels' | 'showAssignmentLines' | 'showDistances' | 'showGroupRoutes') => void
  onSetColorBy: (value: ColorByDimension) => void
  detailIncidentId: string | null
  onCloseDetail: () => void
  gpsAvailable: boolean
  onGpsAvailabilityChange: (available: boolean) => void
}

/** Compact overlay with the same view filters as the normal map: status pills
 *  plus an "Ansicht" popover (labels, lines, distances, routes, Färben nach). */
function DisplayMapControls({
  options,
  statusCounts,
  onToggleStatusFilter,
  onToggleOption,
  onSetColorBy,
  colorLegend,
  gpsAvailable,
}: {
  options: MapViewOptions
  statusCounts: Record<StatusGroup, number>
  onToggleStatusFilter: (group: StatusGroup) => void
  onToggleOption: (key: 'showLabels' | 'showAssignmentLines' | 'showDistances' | 'showGroupRoutes') => void
  onSetColorBy: (value: ColorByDimension) => void
  colorLegend: ColorGroup[]
  /** Linien/Distanz need vehicle GPS; without it they are dead switches. */
  gpsAvailable: boolean
}) {
  const t = useTranslations('map')
  const optionsChanged =
    !options.showLabels || (gpsAvailable && (!options.showAssignmentLines || options.showDistances))
    || !options.showGroupRoutes || options.colorBy !== 'priority'

  return (
    <div className="absolute top-4 right-4 z-30 flex flex-wrap items-center justify-end gap-2">
      {/* Status filters — pills, matching the normal map view */}
      <div className="inline-flex rounded-lg border border-border overflow-hidden shadow-md backdrop-blur-sm">
        {(['open', 'active', 'completed'] as StatusGroup[]).map((group, index) => (
          <button
            key={group}
            onClick={() => onToggleStatusFilter(group)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${index > 0 ? 'border-l border-border' : ''} ${
              options.statusFilters[group]
                ? 'bg-primary text-primary-foreground'
                : 'bg-background/80 text-muted-foreground hover:bg-muted'
            }`}
          >
            {t(`statusGroups.${group}`)} ({statusCounts[group]})
          </button>
        ))}
      </div>

      {/* Ansicht — labels/lines/distances/routes + Färben nach + legend */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border shadow-md backdrop-blur-sm transition-colors flex items-center gap-1.5 ${
              optionsChanged
                ? 'border-primary/50 bg-secondary/80 text-foreground'
                : 'bg-background/80 text-muted-foreground border-border hover:bg-muted'
            }`}
            title={t('page.viewMenuLabel')}
          >
            <Layers className="h-3 w-3" />
            {t('page.view')}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>{t('page.viewMenuLabel')}</DropdownMenuLabel>
          {/* e.preventDefault keeps the menu open so several options can be
              flipped in one visit (and the legend updates live). */}
          <DropdownMenuCheckboxItem
            checked={options.showLabels}
            onSelect={(e) => { e.preventDefault(); onToggleOption('showLabels') }}
          >
            {t('page.labels')}
          </DropdownMenuCheckboxItem>
          {gpsAvailable && (
            <>
              <DropdownMenuCheckboxItem
                checked={options.showAssignmentLines}
                onSelect={(e) => { e.preventDefault(); onToggleOption('showAssignmentLines') }}
              >
                {t('page.lines')}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={options.showDistances}
                onSelect={(e) => { e.preventDefault(); onToggleOption('showDistances') }}
              >
                {t('page.distance')}
              </DropdownMenuCheckboxItem>
            </>
          )}
          <DropdownMenuCheckboxItem
            checked={options.showGroupRoutes}
            onSelect={(e) => { e.preventDefault(); onToggleOption('showGroupRoutes') }}
          >
            {t('page.groupRoutes')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('common.colorByMenuLabel')}</DropdownMenuLabel>
          {(['priority', 'reko', 'vehicle', 'type', 'auftrag'] as ColorByDimension[]).map((dim) => (
            <DropdownMenuItem
              key={dim}
              onSelect={(e) => { e.preventDefault(); onSetColorBy(dim) }}
              className="cursor-pointer justify-between"
            >
              {t(`colorBy.${dim}`)}
              {options.colorBy === dim && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
          ))}
          {colorLegend.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 space-y-1 max-h-48 overflow-y-auto">
                {colorLegend.map((g) => (
                  <div key={g.key} className="flex items-center gap-2 text-xs">
                    <span className="h-3 w-3 rounded-sm flex-shrink-0" style={{ backgroundColor: g.color }} />
                    <span className="truncate">{g.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** incidentId → accent colour + legend for the active "Färben nach" dimension. */
function useColorAccents(operations: Operation[], colorBy: ColorByDimension, groups: IncidentGroup[]) {
  const tMap = useTranslations('map')

  const markerAccents = useMemo(() => {
    // Priority uses the markers' built-in priority fill — no override.
    if (colorBy === 'priority') return undefined
    const m = new Map<string, string>()
    for (const op of operations) {
      const g = colorGroupFor(op, colorBy, groups)
      m.set(op.id, g ? g.color : COLOR_NONE)
    }
    return m
  }, [operations, colorBy, groups])

  const colorLegend = useMemo<ColorGroup[]>(() => {
    if (colorBy === 'priority') return []
    const map = new Map<string, ColorGroup>()
    let hasNone = false
    for (const op of operations) {
      const g = colorGroupFor(op, colorBy, groups)
      if (g) { if (!map.has(g.key)) map.set(g.key, g) }
      else hasNone = true
    }
    const arr = [...map.values()]
    if (hasNone) {
      const noneLabel = colorBy === 'auftrag' ? tMap('common.noAuftrag') : tMap('common.noAssignment')
      arr.push({ key: '__none__', label: noneLabel, color: COLOR_NONE })
    }
    return arr
  }, [operations, colorBy, groups, tMap])

  return { markerAccents, colorLegend }
}

function countByStatusGroup(statuses: string[]): Record<StatusGroup, number> {
  const counts: Record<StatusGroup, number> = { open: 0, active: 0, completed: 0 }
  for (const status of statuses) {
    const group = STATUS_TO_GROUP[status as IncidentStatus]
    if (group) counts[group]++
  }
  return counts
}

function AuthenticatedDisplayMap({
  selectedIncidentId,
  onMarkerClick,
  panTrigger,
  options,
  onToggleStatusFilter,
  onToggleOption,
  onSetColorBy,
  detailIncidentId,
  onCloseDetail,
  gpsAvailable,
  onGpsAvailabilityChange,
}: DisplayMapVariantProps) {
  const { incidents, refreshIncidents } = useIncidents()
  const { operations } = useOperations()
  const { groups } = useGroups()

  useEffect(() => {
    refreshIncidents()
  }, [])

  // id → Operation lookup for the read-only Auftrag route overlay (stops are
  // real incidents). Matches how /map renders GroupRoutes.
  const operationsById = useMemo(
    () => new Map(operations.map((op) => [op.id, op] as const)),
    [operations],
  )

  const { markerAccents, colorLegend } = useColorAccents(operations, options.colorBy, groups)
  const statusCounts = useMemo(
    () => countByStatusGroup(incidents.map((inc) => inc.status)),
    [incidents],
  )
  const detailOperation = detailIncidentId
    ? operations.find((op) => op.id === detailIncidentId) ?? null
    : null

  return (
    <div className="relative w-full h-full">
      <MapView
        selectedIncidentId={selectedIncidentId}
        onMarkerClick={onMarkerClick}
        panTrigger={panTrigger}
        statusFilters={options.statusFilters}
        showAssignmentLines={options.showAssignmentLines}
        showDistances={options.showDistances}
        showLabels={options.showLabels}
        markerAccents={markerAccents}
        colorBy={options.colorBy}
        colorGroups={colorLegend}
        showGroupRoutes={options.showGroupRoutes}
        groups={groups}
        operationsById={operationsById}
        onGroupStopMarkerClick={onMarkerClick}
        onGpsAvailabilityChange={onGpsAvailabilityChange}
      />

      <DisplayMapControls
        options={options}
        statusCounts={statusCounts}
        onToggleStatusFilter={onToggleStatusFilter}
        onToggleOption={onToggleOption}
        onSetColorBy={onSetColorBy}
        colorLegend={colorLegend}
        gpsAvailable={gpsAvailable}
      />

      <IncidentDetailModal
        operation={detailOperation}
        open={!!detailOperation}
        onOpenChange={(open) => { if (!open) onCloseDetail() }}
      />
    </div>
  )
}

/** Map the token payload's API incident onto the domain Incident MapView wants. */
function apiIncidentToIncident(a: ApiIncident): Incident {
  return {
    id: a.id,
    event_id: a.event_id,
    title: a.title,
    type: a.type,
    priority: a.priority,
    location_address: a.location_address,
    location_display: a.location_display ?? null,
    location_lat: a.location_lat != null ? parseFloat(a.location_lat) : null,
    location_lng: a.location_lng != null ? parseFloat(a.location_lng) : null,
    status: a.status,
    description: a.description,
    source: a.source,
    nachbarhilfe: a.nachbarhilfe ?? false,
    am_warten: a.am_warten ?? false,
    zu_fuss: a.zu_fuss ?? false,
    created_at: new Date(a.created_at),
    updated_at: new Date(a.updated_at),
    created_by: a.created_by ?? null,
    completed_at: a.completed_at ? new Date(a.completed_at) : null,
    status_changed_at: a.status_changed_at ? new Date(a.status_changed_at) : null,
    assigned_vehicles: (a.assigned_vehicles ?? []) as unknown as AssignedVehicle[],
    has_completed_reko: a.has_completed_reko,
    reko_arrived_at: a.reko_arrived_at ? new Date(a.reko_arrived_at) : null,
  }
}

function TokenDisplayMap({
  token,
  selectedIncidentId,
  onMarkerClick,
  panTrigger,
  options,
  onToggleStatusFilter,
  onToggleOption,
  onSetColorBy,
  detailIncidentId,
  onCloseDetail,
  gpsAvailable,
  onGpsAvailabilityChange,
}: DisplayMapVariantProps & { token: string }) {
  const [data, setData] = useState<ApiViewerData | null>(null)
  // Age of the last SUCCESSFUL poll. Holding the last-known data through a failed fetch is
  // correct; rendering it as if it were current is not. Frozen vehicle positions on a map
  // are read as fact by whoever glances at the wall.
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const d = await apiClient.getViewerData(token)
        if (!cancelled) {
          setData(d)
          setLastRefresh(new Date())
        }
      } catch {
        // Keep the last-known data — DisplayStaleBanner surfaces that it has gone stale.
      }
    }
    load()
    const id = window.setInterval(load, 5000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [token])

  const incidents = useMemo<Incident[]>(
    () => (data?.incidents ?? []).map(apiIncidentToIncident),
    [data]
  )
  // Full operation view-model (crew/materials/reko from the payload's
  // assignments) — feeds the route overlay, "Färben nach" and the detail dialog.
  const situation = useMemo(() => (data ? buildSituationData(data) : null), [data])
  const operations = useMemo(() => situation?.operations ?? [], [situation])
  const operationsById = useMemo(
    () => new Map(operations.map((op) => [op.id, op] as const)),
    [operations],
  )
  const groups = useMemo<IncidentGroup[]>(
    () => (data ? viewerGroupsToIncidentGroups(data) : []),
    [data],
  )

  const { markerAccents, colorLegend } = useColorAccents(operations, options.colorBy, groups)
  const statusCounts = useMemo(
    () => countByStatusGroup((data?.incidents ?? []).map((inc) => inc.status)),
    [data],
  )
  const detailOperation = detailIncidentId
    ? operations.find((op) => op.id === detailIncidentId) ?? null
    : null

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center bg-muted">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      {/* Overlaid rather than stacked in a flex column: the map is full-bleed and every
          control on it is absolutely positioned, so reflowing the container would move all
          of them. pointer-events-none keeps the banner from swallowing map drags. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40">
        <DisplayStaleBanner lastRefresh={lastRefresh} />
      </div>
      <MapView
        selectedIncidentId={selectedIncidentId}
        onMarkerClick={onMarkerClick}
        panTrigger={panTrigger}
        statusFilters={options.statusFilters}
        showAssignmentLines={options.showAssignmentLines}
        showDistances={options.showDistances}
        showLabels={options.showLabels}
        markerAccents={markerAccents}
        colorBy={options.colorBy}
        colorGroups={colorLegend}
        incidentsOverride={incidents}
        vehiclesOverride={data.vehicles}
        positionsOverride={data.vehicle_positions}
        showGroupRoutes={options.showGroupRoutes && groups.length > 0}
        groups={groups}
        operationsById={operationsById}
        onGroupStopMarkerClick={onMarkerClick}
        onGpsAvailabilityChange={onGpsAvailabilityChange}
      />

      <DisplayMapControls
        options={options}
        statusCounts={statusCounts}
        onToggleStatusFilter={onToggleStatusFilter}
        onToggleOption={onToggleOption}
        onSetColorBy={onSetColorBy}
        colorLegend={colorLegend}
        gpsAvailable={gpsAvailable}
      />

      <IncidentDetailModal
        operation={detailOperation}
        open={!!detailOperation}
        onOpenChange={(open) => { if (!open) onCloseDetail() }}
        personnelOverride={situation?.personnel ?? []}
        materialsOverride={situation?.materials ?? []}
        groupsOverride={groups}
      />
    </div>
  )
}
