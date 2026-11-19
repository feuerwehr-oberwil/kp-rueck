"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { useEffectEvent } from "@/lib/hooks/use-effect-event"
import { useRouter } from "next/navigation"
import { SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { FooterSheet } from "@/components/ui/footer-sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LoadingStatus, ShellLoader } from "@/components/ui/shell-loader"
import { Truck, User, MapPin, Clock, Radio, RefreshCw, AlertTriangle, Plus, Waypoints } from "lucide-react"
import { apiClient, type ApiEventSpecialFunctionResponse, type ApiVehicleStatus } from "@/lib/api-client"
import { isIncidentStatus } from "@/lib/types/incidents"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { useOperations } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { remainingRouteStops } from "@/lib/kanban-utils"
import { RESOURCE_STATE_BADGE_CLASSES } from "@/lib/resource-status"
import { formatDuration } from "@/lib/duration"
import { useIsMobile } from "@/components/ui/use-mobile"
import { DriverAssignmentDialog } from "./driver-assignment-dialog"

/** What the sheet shows for one Ereignis: the fleet and the event's special functions
 *  (the driver dialog needs those). */
interface FleetSnapshot {
  eventId: string
  vehicles: ApiVehicleStatus[]
  specialFunctions: ApiEventSpecialFunctionResponse[]
}

/** The last snapshot per Ereignis, kept across openings AND remounts of the sheet: it
 *  opens on what it showed last and refreshes underneath. The loading line is only for
 *  the very first load of an Ereignis on this page. */
const lastSnapshot = new Map<string, FleetSnapshot>()

interface VehicleStatusSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string | null
}

/** The board's own notation (lib/duration.ts): «38'», «1h 8'», «1d 10h». */
function formatMinutes(minutes: number | null): string {
  return minutes === null ? "-" : formatDuration(minutes * 60_000)
}

function getDurationColor(minutes: number | null): string {
  if (minutes === null) return ""
  if (minutes < 60) return "text-muted-foreground" // < 1 hour
  if (minutes < 120) return "text-muted-foreground" // < 2 hours
  return "text-muted-foreground font-medium" // >= 2 hours
}

/** An Auftrag (route) a vehicle is out on — name plus the route's OWN colour,
 *  the same colour the board and the map identify that route by. `targetId` is
 *  the stop a click opens: the next one with work ahead, else the first. */
interface VehicleAuftrag {
  id: string
  name: string
  color: string | null
  stopIds: readonly string[]
  targetId: string | null
}

/** One place a vehicle serves, as a link in its row: an Auftrag or an Einsatz. */
type DeploymentTarget =
  | { kind: "auftrag"; key: string; incidentId: string | null; label: string; auftrag: VehicleAuftrag }
  | { kind: "einsatz"; key: string; incidentId: string; label: string; status: string }

/**
 * Everything a vehicle serves, Aufträge first (board order), then its Einsätze
 * oldest first. An Einsatz that is a stop of one of the vehicle's own Aufträge is
 * left out – the Auftrag already stands for it.
 */
function deploymentTargets(
  vehicle: ApiVehicleStatus,
  auftraege: readonly VehicleAuftrag[],
  auftragLabel: (name: string) => string,
): DeploymentTarget[] {
  const homeCity = getGlobalHomeCity()
  const routeStops = new Set(auftraege.flatMap((auftrag) => auftrag.stopIds))
  return [
    ...auftraege.map((auftrag): DeploymentTarget => ({
      kind: "auftrag", key: auftrag.id, incidentId: auftrag.targetId,
      label: auftragLabel(auftrag.name), auftrag,
    })),
    ...vehicle.deployments
      .filter((deployment) => !routeStops.has(deployment.incident_id))
      .map((deployment): DeploymentTarget => ({
        kind: "einsatz", key: deployment.incident_id, incidentId: deployment.incident_id, status: deployment.status,
        // The server ships the label computed (`location_display`), so it is final on
        // first paint; the client formatter is only the fallback.
        label: deployment.location_display
          ?? (formatLocationForDisplay(deployment.location_address || '', homeCity)
            || formatLocationForDisplay(deployment.title, homeCity)),
      })),
  ]
}

/** «Auftrag «Sturm West»» with the route's colour as a dot — so a vehicle's
 *  route is identifiable at a glance. Neutral text, as on the board card: a
 *  route colour painted as text fell to 2.3:1 in light (sweep 2026-10). */
function AuftragChip({ auftrag, label }: { auftrag: VehicleAuftrag; label: string }) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 rounded-sm border border-border bg-muted/60 px-1.5 py-0.5 text-sm font-medium text-foreground"
      title={label}
    >
      <Waypoints className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: auftrag.color ?? "var(--muted-foreground)" }}
      />
      <span className="truncate">{label}</span>
    </span>
  )
}

/**
 * The places a vehicle serves, each its own link that opens it on the board; one
 * line with the idle word when it serves none. They wrap rather than truncate
 * one another away – a vehicle on two Einsätze shows both.
 */
function DeploymentLinks({ targets, idleLabel, statusLabel, onOpen }: {
  targets: readonly DeploymentTarget[]
  idleLabel: string
  statusLabel: (status: string) => string
  onOpen: (incidentId: string) => void
}) {
  if (targets.length === 0) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        <span className="truncate">{idleLabel}</span>
      </span>
    )
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {targets.map((target) => {
        const title = target.kind === "einsatz" ? `${target.label} · ${statusLabel(target.status)}` : target.label
        const incidentId = target.incidentId
        return (
          <button
            key={target.key}
            type="button"
            disabled={!incidentId}
            title={title}
            aria-label={title}
            onClick={(e) => {
              e.stopPropagation()
              if (incidentId) onOpen(incidentId)
            }}
            className="flex min-w-0 max-w-full items-center gap-1.5 rounded-sm text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:no-underline"
          >
            {target.kind === "auftrag" ? (
              <AuftragChip auftrag={target.auftrag} label={target.label} />
            ) : (
              <>
                <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <span className="truncate">{target.label}</span>
              </>
            )}
          </button>
        )
      })}
    </span>
  )
}

function getStatusBorderColor(status: string, hasIncident: boolean): string {
  // Refactoring UI: Use subtle visual cues, not heavy color blocks
  // Only highlight assigned vehicles, available is the default state
  if (hasIncident) {
    return "border-l-foreground/40" // gebunden: ink, not amber (VISUAL-03)
  }
  switch (status) {
    case "available":
      return "border-l-transparent" // No border for default state
    case "unavailable":
      return "border-l-muted-foreground/30"
    default:
      return "border-l-transparent"
  }
}

export function VehicleStatusSheet({ open, onOpenChange, eventId }: VehicleStatusSheetProps) {
  const t = useTranslations('incidents')
  const tLoading = useTranslations('common.loadingWhat')
  const tColumns = useTranslations('kanban.columns')
  const router = useRouter()
  const isMobile = useIsMobile()
  const { personnel, operations, removeCrew } = useOperations()
  const { groups } = useGroups()
  // A vehicle can be deployed to a whole Auftrag (route) rather than a single
  // incident. Resolve vehicle-id → its Auftrag from the route assignments so the
  // deployment reads as the route name instead of one stop's address. The colour
  // travels with the name: it is what the board tints the route's cards with.
  // A vehicle can serve several Aufträge at once, so this is a list per vehicle.
  const auftraegeByVehicleId = useMemo(() => {
    const map = new Map<string, VehicleAuftrag[]>()
    for (const g of groups) {
      const targetId = remainingRouteStops(g, operations, "")[0]?.id ?? g.stopIds[0] ?? null
      for (const a of g.assignments) {
        if (a.resourceType !== "vehicle") continue
        const list = map.get(a.resourceId) ?? []
        list.push({ id: g.id, name: g.name, color: g.color, stopIds: g.stopIds, targetId })
        map.set(a.resourceId, list)
      }
    }
    return map
  }, [groups, operations])
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedVehicleIndex, setSelectedVehicleIndex] = useState<number>(-1)
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)
  // This Ereignis's data: what this sheet loaded, else what an earlier mount did.
  const shown = snapshot?.eventId === eventId ? snapshot : (eventId ? lastSnapshot.get(eventId) ?? null : null)
  // Sorted by the server (display order, then name) – the order used everywhere else.
  const vehicles = shown?.vehicles ?? []
  const specialFunctions = shown?.specialFunctions ?? []

  // Driver assignment state
  const [driverDialogOpen, setDriverDialogOpen] = useState(false)
  const [selectedVehicleForDriver, setSelectedVehicleForDriver] = useState<ApiVehicleStatus | null>(null)

  // Closed: load once in the background, so even the first opening rises at its final
  // height instead of growing from the loading line (#14). Open: load – quietly when
  // this Ereignis has been shown before – then every 10 seconds. `loadVehicleStatuses`
  // is a plain function re-created every render, reached through an effect event.
  const loadStatuses = useEffectEvent((silent: boolean) => void loadVehicleStatuses(silent))
  useEffect(() => {
    if (!open && eventId && !lastSnapshot.has(eventId)) loadStatuses(true)
    if (open && eventId) {
      loadStatuses(lastSnapshot.has(eventId))

      // Set up auto-refresh
      refreshIntervalRef.current = setInterval(() => {
        loadStatuses(true) // Silent refresh (no loading state)
      }, 10000)
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
        refreshIntervalRef.current = null
      }
    }
  }, [open, eventId])

  /** One request for the fleet (plus the special functions). `silent` = no loading
   *  line and no error toast: there is data on screen already. */
  const loadVehicleStatuses = async (silent = false) => {
    if (!eventId) return
    const forEvent = eventId

    if (!silent) {
      setRefreshing(true)
    }

    try {
      const [statuses, functions] = await Promise.all([
        apiClient.getVehicleStatuses(forEvent),
        apiClient.getEventSpecialFunctions(forEvent),
      ])
      const next: FleetSnapshot = { eventId: forEvent, vehicles: statuses, specialFunctions: functions }
      lastSnapshot.set(forEvent, next)
      setSnapshot(next)
    } catch (error) {
      console.error("Error loading vehicle statuses:", error)
      if (!silent) {
        toast.error(t('vehicleStatus.loadError'))
      }
    } finally {
      if (!silent) {
        setRefreshing(false)
      }
    }
  }

  const handleOpenDriverDialog = (vehicle: ApiVehicleStatus, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedVehicleForDriver(vehicle)
    setDriverDialogOpen(true)
  }

  const handleDriverAssigned = () => {
    // Reload vehicle statuses after driver assignment
    loadVehicleStatuses(true)
    // Notify sidebar (same-tab instant feedback)
    window.dispatchEvent(new Event('driver-assignment-changed'))
  }

  const displayedVehicles = vehicles
  const targetsOf = (vehicle: ApiVehicleStatus) => deploymentTargets(
    vehicle,
    auftraegeByVehicleId.get(vehicle.id) ?? [],
    (name) => t('vehicleStatus.auftragLabel', { name }),
  )

  // Handle keyboard navigation. An effect event: one listener for the mount, and a key
  // always sees the current list, selection and handlers.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (!open) return

    // Ignore if typing in input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedVehicleIndex(prev =>
        prev < displayedVehicles.length - 1 ? prev + 1 : 0
      )
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedVehicleIndex(prev =>
        prev > 0 ? prev - 1 : displayedVehicles.length - 1
      )
    } else if (e.key === "Enter" && selectedVehicleIndex >= 0) {
      e.preventDefault()
      const vehicle = displayedVehicles[selectedVehicleIndex]
      // Several places: Enter opens the first one; the others are their own links.
      const first = vehicle ? targetsOf(vehicle)[0] : undefined
      if (first?.incidentId) openIncident(first.incidentId)
    }
  })
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => onKeyDown(e)
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const openIncident = (incidentId: string) => {
    // Navigate to Kanban with highlighted incident – on a phone also opened (its Einsatz
    // sheet, `&detail=1`): a ring on a list card is not what «Tippen öffnet den Einsatz» says.
    router.push(`/?highlight=${encodeURIComponent(incidentId)}${isMobile ? '&detail=1' : ''}`)
    onOpenChange(false)
  }

  const handleManualRefresh = () => {
    loadVehicleStatuses()
  }

  if (!eventId) {
    return null
  }

  return (
    <>
    <FooterSheet
      open={open}
      onOpenChange={onOpenChange}
      // phone: a modal sheet over the nav — only the safe area at its foot
      className={cn("flex flex-col max-w-5xl mx-auto px-6 py-4 modal-h-tall", isMobile && "pb-sheet-safe")}
      // both roles: a Radix AlertDialog is role="alertdialog", and the vehicle-conflict prompt
      // that can appear from here is one — see the note in auftraege-sheet.tsx
      shouldPreventClose={(target) => !!target.closest('[role="dialog"], [role="alertdialog"]') || driverDialogOpen}
      // The Fahrer picker of a row opens inside the sheet as a step (owner pick 5A).
      surface={t('vehicleStatus.title')}
    >
        <SheetHeader className="p-0">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <SheetTitle>{t('vehicleStatus.title')}</SheetTitle>
              {/* The phone: one line in its own words, and no «Aktualisieren» – the list refreshes
                  every 10 s by itself, and beside the button the line wrapped three times. */}
              <SheetDescription>
                {t(isMobile ? 'vehicleStatus.descriptionPhone' : 'vehicleStatus.description')}
              </SheetDescription>
            </div>

            {!isMobile && (
              <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={refreshing} className="flex-shrink-0">
                {refreshing ? <ShellLoader className="size-3.5" /> : <RefreshCw className="size-3.5" />}
                {t('vehicleStatus.refresh')}
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto mt-3 pb-10">
          {!shown && refreshing ? (
            <LoadingStatus size="surface" className="flex w-full py-8 text-sm">{tLoading("vehicles")}</LoadingStatus>
          ) : displayedVehicles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <Truck className="h-12 w-12 text-muted-foreground/50 mb-2" />
              <p className="text-muted-foreground">{t('vehicleStatus.noVehicles')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedVehicles.map((vehicle, index) => {
                const isSelected = index === selectedVehicleIndex
                const targets = targetsOf(vehicle)
                const einsaetze = targets.filter((target) => target.kind === "einsatz")
                // One place: the whole row opens it. Several: each is its own link.
                const rowTarget = targets.length === 1 ? targets[0].incidentId : null
                const isClickable = !!rowTarget
                // Out on an Einsatz OR on an Auftrag: either way not «Verfügbar».
                const isBound = targets.length > 0
                // The clock and «Lange» follow the oldest Einsatz.
                const durationMinutes = vehicle.deployments[0]?.duration_minutes ?? null
                const showDurationWarning = durationMinutes !== null && durationMinutes >= 120
                // A single Einsatz names its column; anything more is «Gebunden».
                const singleStatus = targets.length === 1 && einsaetze.length === 1 ? einsaetze[0].status : null
                const idleLabel = vehicle.status === "unavailable" ? t('vehicleStatus.unavailable') : t('vehicleStatus.readyForOperation')
                const deploymentLinks = (
                  <DeploymentLinks
                    targets={targets}
                    idleLabel={idleLabel}
                    statusLabel={(status) => isIncidentStatus(status) ? tColumns(status) : status}
                    onOpen={openIncident}
                  />
                )
                const statusBadges = (
                  <>
                    {!isBound && vehicle.status === "available" && (
                      <Badge variant="outline" className={cn("text-xs", RESOURCE_STATE_BADGE_CLASSES.available)}>
                        {t('vehicleStatus.available')}
                      </Badge>
                    )}
                    {vehicle.status === "unavailable" && (
                      <Badge className="text-xs bg-muted text-muted-foreground border-border">
                        {t('vehicleStatus.unavailable')}
                      </Badge>
                    )}
                    {isBound && !singleStatus && vehicle.status !== "unavailable" && (
                      <Badge variant="outline" className={cn("text-xs", RESOURCE_STATE_BADGE_CLASSES.assigned)}>
                        {t('vehicleStatus.bound')}
                      </Badge>
                    )}
                    {singleStatus && (
                      <Badge variant="outline" className={cn("text-xs max-w-full", RESOURCE_STATE_BADGE_CLASSES.assigned)}>
                        {isIncidentStatus(singleStatus) ? tColumns(singleStatus) : singleStatus}
                      </Badge>
                    )}
                    {showDurationWarning && (
                      <Badge className="text-xs bg-warning/10 text-warning-foreground border-warning/30">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        {t('vehicleStatus.longDuration')}
                      </Badge>
                    )}
                  </>
                )

                return (
                  <div
                    key={vehicle.id}
                    onClick={() => rowTarget && openIncident(rowTarget)}
                    className={cn(
                      "border rounded-lg px-3 py-2.5 bg-card transition-all",
                      "border-l-4",
                      getStatusBorderColor(vehicle.status, isBound),
                      isClickable && "cursor-pointer hover:bg-muted/50 hover:border-border",
                      isSelected && "ring-2 ring-sel-line ring-offset-2 ring-offset-background",
                      !isBound && "opacity-75"
                    )}
                    tabIndex={isClickable ? 0 : -1}
                    onKeyDown={(e) => {
                      if (rowTarget && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault()
                        openIncident(rowTarget)
                      }
                    }}
                  >
                    {isMobile ? (
                      /* Mobile: Card-based vertical layout. The name and the status chips share a
                         line only while they fit; otherwise the chips wrap under the name. At
                         360px «Disponiert / Anfahrt» + «Lange» ran over «Trawa» and 2px past the
                         card (WebKit scan, 14.11.2026). */
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="min-w-0 break-words font-bold text-sm">{vehicle.name}</span>
                          </div>
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            {statusBadges}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-sm">
                          <div className="flex items-center gap-1.5">
                            <Radio className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="text-muted-foreground truncate">{vehicle.radio_call_sign}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className={cn("truncate", vehicle.driver_name ? "" : "text-muted-foreground")}>
                              {vehicle.driver_name || t('vehicleStatus.noDriver')}
                            </span>
                          </div>
                          <div className="min-w-0 col-span-2">
                            {deploymentLinks}
                          </div>
                          {durationMinutes !== null && (
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-3 w-3 flex-shrink-0" />
                              <span className={cn("text-xs font-medium", getDurationColor(durationMinutes))}>
                                {formatMinutes(durationMinutes)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* Desktop: one row, one grid — and every track BEFORE the
                         flexible one is a fixed width.

                         Each row is its own grid, so any track that sizes from
                         content or from leftover space lands somewhere different
                         on every row. First this was a flex (each column sized
                         against that row's free width); then a grid whose two
                         `fr` tracks still shrank to make room for a trailing
                         `auto` badge column — so the one vehicle carrying a clock
                         AND two badges kept pulling its Einsatz cell left of the
                         four rows below it. Fixed px up to the Einsatz column
                         pins every left edge; only that column stretches, and the
                         badges stay flush right because the rows are equal width. */
                      <div className="grid grid-cols-[140px_104px_168px_minmax(0,1fr)_74px_auto] items-center gap-3">
                        {/* Vehicle Icon and Name */}
                        <div className="flex items-center gap-2 min-w-0">
                          <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="font-bold text-sm">{vehicle.name}</span>
                        </div>

                        {/* Radio Call Sign */}
                        <div className="flex items-center gap-2 min-w-0">
                          <Radio className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-muted-foreground text-sm truncate">
                            {vehicle.radio_call_sign}
                          </span>
                        </div>

                        {/* Driver - Clickable to assign. This is the field an operator
                            reads to know who to call, so it gets a share of the free
                            width (basis-0 flex-1) rather than a fixed 120px that cut
                            off anything longer than a short first name. */}
                        <button
                          onClick={(e) => handleOpenDriverDialog(vehicle, e)}
                          className={cn(
                            "flex min-w-0 items-center gap-2 rounded px-1.5 py-0.5 -mx-1.5 transition-colors",
                            "hover:bg-muted/80 cursor-pointer group"
                          )}
                          title={vehicle.driver_name ? t('vehicleStatus.changeDriver') : t('vehicleStatus.assignDriver')}
                        >
                          <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className={cn("text-sm truncate", vehicle.driver_name ? "" : "text-muted-foreground")}>
                            {vehicle.driver_name || t('vehicleStatus.noDriver')}
                          </span>
                          {!vehicle.driver_name && (
                            <Plus className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                          )}
                        </button>

                        {/* Every Auftrag (in the route's own colour) and Einsatz the
                            vehicle serves – the one flexible track, so they wrap here. */}
                        <div className="min-w-0">
                          {deploymentLinks}
                        </div>

                        {/* Duration. The cell is always rendered, empty when a
                            vehicle carries no clock: a conditional cell would
                            collapse its track and pull the badges of that one row
                            left, which is the misalignment this grid exists for. */}
                        <div className="flex min-w-0 items-center gap-1.5">
                          {durationMinutes !== null && (
                            <>
                              <Clock className="h-3 w-3 flex-shrink-0" />
                              <span className={cn("text-xs font-medium", getDurationColor(durationMinutes))}>
                                {formatMinutes(durationMinutes)}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Status Badges — right-aligned in their own track, so
                            «Verfügbar» sits under «Verfügbar» however many badges
                            the row above carries. */}
                        <div className="flex items-center justify-self-end gap-1.5">
                          {statusBadges}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

    </FooterSheet>

    {/* Driver Assignment Dialog – outside the sheet's tree (closing issues), but on a desk it
        opens INSIDE the sheet as a step: the sheet is the open surface (surface-step.tsx). */}
    {selectedVehicleForDriver && eventId && (
      <DriverAssignmentDialog
        open={driverDialogOpen}
        onOpenChange={setDriverDialogOpen}
        vehicleId={selectedVehicleForDriver.id}
        vehicleName={selectedVehicleForDriver.name}
        eventId={eventId}
        currentDriverId={selectedVehicleForDriver.driver_id}
        currentDriverName={selectedVehicleForDriver.driver_name}
        personnel={personnel}
        operations={operations}
        specialFunctions={specialFunctions}
        onDriverAssigned={handleDriverAssigned}
        removeCrew={removeCrew}
      />
    )}
    </>
  )
}
