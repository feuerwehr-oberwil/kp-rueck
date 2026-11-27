"use client"

import { useState, useEffect, useRef } from "react"
import { useEffectEvent } from "@/lib/hooks/use-effect-event"
import { useRouter } from "next/navigation"
import { SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { FooterSheet, SHEET_LAYER_ATTR } from "@/components/ui/footer-sheet"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LoadingStatus, ShellLoader } from "@/components/ui/shell-loader"
import { Truck, User, MapPin, Clock, Radio, RefreshCw, AlertTriangle, Plus, Waypoints, Ban, MoreHorizontal, ArrowUpRight, ArrowLeftRight } from "lucide-react"
import { apiClient, NetworkError, type ApiEventSpecialFunctionResponse, type ApiVehicleStatus } from "@/lib/api-client"
import { isIncidentStatus } from "@/lib/types/incidents"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { useOperations } from "@/lib/contexts/operations-context"
import { RESOURCE_STATE_BADGE_CLASSES } from "@/lib/resource-status"
import { ACCENT_BAR } from "@/lib/kanban-utils"
import { formatDuration } from "@/lib/duration"
import { useIsMobile } from "@/components/ui/use-mobile"
import { boardDetailHref } from "@/lib/incident-detail"
import { OVERVIEW_TARGET, RESOURCES_TARGET } from "@/lib/detail-target"
import { DriverAssignmentDialog } from "./driver-assignment-dialog"
import { shortDate } from "@/lib/board-sidebar"

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
  /** Editors get the row's ⋯ menu (driver, «Nicht einsatzbereit»). Omitted = read-only. */
  canEdit?: boolean
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

/** One place a vehicle serves, as a link in its row: an Auftrag or an Einsatz. */
type DeploymentTarget =
  | { kind: "auftrag"; key: string; incidentId: string | null; label: string; color: string | null }
  | { kind: "einsatz"; key: string; incidentId: string; label: string; status: string }

/**
 * Everything a vehicle serves, in the server's order (`GET /api/vehicles/status`: its
 * Aufträge, then every Einsatz it is assigned to directly, each oldest first).
 */
function deploymentTargets(
  vehicle: ApiVehicleStatus,
  auftragLabel: (name: string) => string,
): DeploymentTarget[] {
  const homeCity = getGlobalHomeCity()
  return vehicle.deployments.map((deployment): DeploymentTarget =>
    deployment.kind === "auftrag"
      ? {
          kind: "auftrag", key: deployment.group_id, incidentId: deployment.incident_id,
          label: auftragLabel(deployment.name), color: deployment.color,
        }
      : {
          kind: "einsatz", key: deployment.incident_id, incidentId: deployment.incident_id, status: deployment.status,
          // The server ships the label computed (`location_display`), so it is final on
          // first paint; the client formatter is only the fallback.
          label: deployment.location_display
            ?? (formatLocationForDisplay(deployment.location_address || '', homeCity)
              || formatLocationForDisplay(deployment.title, homeCity)),
        },
  )
}

/** «Auftrag «Sturm West»» with the route's colour as a dot — so a vehicle's
 *  route is identifiable at a glance. Neutral text, as on the board card: a
 *  route colour painted as text fell to 2.3:1 in light (sweep 2026-10). */
function AuftragChip({ color, label }: { color: string | null; label: string }) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 rounded-sm border border-border bg-muted/60 px-1.5 py-0.5 text-sm font-medium text-foreground"
      title={label}
    >
      <Waypoints className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
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
  onOpen: (target: DeploymentTarget) => void
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
              if (incidentId) onOpen(target)
            }}
            className="flex min-w-0 max-w-full items-center gap-1.5 rounded-sm text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:no-underline"
          >
            {target.kind === "auftrag" ? (
              <AuftragChip color={target.color} label={target.label} />
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

/**
 * The ⋯ menu at the end of a desk row (owner pick 3B, 24.11.2026): «Einsatz öffnen»,
 * «Fahrer ändern …» (the row's driver dialog) and «Nicht einsatzbereit» as a checkbox – the
 * same `{ out_of_service }` field as the switch in Einstellungen, which stays. The row's own
 * click still opens the Einsatz.
 */
function FleetRowMenu({ vehicleName, outOfService, onOpenIncident, onChangeDriver, onSetOutOfService }: {
  vehicleName: string
  outOfService: boolean
  /** Undefined when the vehicle serves nothing with a card to open. */
  onOpenIncident: (() => void) | undefined
  onChangeDriver: () => void
  onSetOutOfService: (outOfService: boolean) => void
}) {
  const t = useTranslations('incidents.vehicleStatus')
  const tCommon = useTranslations('kanban.common')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          // 32px, hung into the row's padding so the row stays one badge-line tall.
          className="-my-[5px]"
          aria-label={t('rowMenu', { vehicle: vehicleName })}
          // The row opens its Einsatz on click and Enter; the ⋯ is its own target.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Portalled: a row's click travels the React tree – stop it at the menu. Tagged as the
        // sheet's own layer, so a click in it does not dismiss the sheet.
        {...{ [SHEET_LAYER_ATTR]: "" }}
        onClick={(e) => e.stopPropagation()}
      >
        {onOpenIncident && (
          <DropdownMenuItem onSelect={onOpenIncident}>
            <ArrowUpRight />
            {t('openIncident')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onChangeDriver}>
          <ArrowLeftRight />
          {t('changeDriverMenu')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={outOfService} onCheckedChange={(checked) => onSetOutOfService(checked === true)}>
          {tCommon('notReady')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Colour of the card's left bar (`ACCENT_BAR`). Refactoring UI: a subtle cue, not a
 *  heavy colour block – only bound and unavailable vehicles get one; available is the
 *  default state and draws none. */
function getStatusBarColor(status: string, hasIncident: boolean): string {
  if (hasIncident) {
    return "before:bg-foreground/40" // gebunden: ink, not amber (VISUAL-03)
  }
  return status === "unavailable" ? "before:bg-muted-foreground/30" : "before:bg-transparent"
}

export function VehicleStatusSheet({ open, onOpenChange, eventId, canEdit = false }: VehicleStatusSheetProps) {
  const t = useTranslations('incidents')
  const tCommon = useTranslations('kanban.common')
  const tLifecycle = useTranslations('settings.lifecycle')
  const tLoading = useTranslations('common.loadingWhat')
  const tColumns = useTranslations('kanban.columns')
  const router = useRouter()
  const isMobile = useIsMobile()
  const { personnel, operations, removeCrew, refreshOperations } = useOperations()
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
      // No answer at all is the outage's to say (one voice: lib/api/http.ts).
      if (!silent && !NetworkError.isNetworkError(error)) {
        toast.error(t('vehicleStatus.loadError'))
      }
    } finally {
      if (!silent) {
        setRefreshing(false)
      }
    }
  }

  const openDriverDialog = (vehicle: ApiVehicleStatus) => {
    setSelectedVehicleForDriver(vehicle)
    setDriverDialogOpen(true)
  }
  const handleOpenDriverDialog = (vehicle: ApiVehicleStatus, e: React.MouseEvent) => {
    e.stopPropagation()
    openDriverDialog(vehicle)
  }

  /** «Nicht einsatzbereit» from the row menu: the same `{ out_of_service }` PUT as the
   *  Einstellungen switch. The server broadcasts it to the board; the sheet reloads itself. */
  const setOutOfService = async (vehicle: ApiVehicleStatus, outOfService: boolean) => {
    try {
      await apiClient.updateVehicle(vehicle.id, { out_of_service: outOfService })
      await loadVehicleStatuses(true)
    } catch (error) {
      console.error("Failed to change vehicle readiness:", error)
      toast.error(tLifecycle('notReadyError'))
    }
  }

  const handleDriverAssigned = () => {
    // Reload vehicle statuses after driver assignment
    void loadVehicleStatuses(true)
    // The board's drivers (every «Fahrer» on this tab) come with its snapshot.
    void refreshOperations()
  }

  const displayedVehicles = vehicles
  const targetsOf = (vehicle: ApiVehicleStatus) => deploymentTargets(
    vehicle,
    (name) => t('vehicleStatus.auftragLabel', { name }),
  )

  // Handle keyboard navigation. An effect event: one listener for the mount, and a key
  // always sees the current list, selection and handlers.
  const fleetListRef = useRef<HTMLDivElement>(null)
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (!open) return

    // Ignore if typing in input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return
    }
    // The row keys belong to this sheet: not while a dialog in front of it (the driver
    // picker) has the focus. A focused control anywhere in the sheet – a deployment link,
    // the driver button, «Aktualisieren», the phone's ✕ – answers its own Enter, and so does
    // a row that opens its one place itself (its handler prevents the default). The arrows
    // move the focus onto the row they pick, so Enter after them lands there (Sol S12).
    const target = e.target instanceof Element ? e.target : null
    const sheet = fleetListRef.current?.closest('[role="dialog"]')
    if (target && target !== document.body && sheet && !sheet.contains(target)) return
    if (e.key === "Enter" && (e.defaultPrevented || target?.closest('button, a[href], [role="button"]'))) return

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const count = displayedVehicles.length
      if (count === 0) return
      const next = e.key === "ArrowDown"
        ? (selectedVehicleIndex < count - 1 ? selectedVehicleIndex + 1 : 0)
        : (selectedVehicleIndex > 0 ? selectedVehicleIndex - 1 : count - 1)
      setSelectedVehicleIndex(next)
      fleetListRef.current?.querySelector<HTMLElement>(`[data-fleet-row="${next}"]`)?.focus()
    } else if (e.key === "Enter" && selectedVehicleIndex >= 0) {
      e.preventDefault()
      const vehicle = displayedVehicles[selectedVehicleIndex]
      // Several places: Enter opens the first one that has a card to open (an Auftrag
      // without stops has none); the others are their own links.
      const first = vehicle ? targetsOf(vehicle).find((target) => target.incidentId) : undefined
      if (first) openIncident(first)
    }
  })
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => onKeyDown(e)
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  /** Open a place that has a card (`incidentId`); a stopless Auftrag has none and is never passed. */
  const openIncident = (target: DeploymentTarget) => {
    if (!target.incidentId) return
    // The board, with the Einsatz OPENED: a ring on a card is not what «Klick öffnet den
    // Einsatz» says. Desk: side panel or modal; phone: its Einsatz sheet. An Einsatz opens on its
    // Ressourcen, where the vehicle is listed. An Auftrag's stop opens at its top: the route holds
    // the vehicle, so the stop's own vehicle list can be empty (Sol review I).
    router.push(boardDetailHref(target.incidentId, target.kind === "einsatz" ? RESOURCES_TARGET : OVERVIEW_TARGET))
    onOpenChange(false)
  }

  const handleManualRefresh = () => {
    void loadVehicleStatuses()
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
            <div ref={fleetListRef} className="space-y-2">
              {displayedVehicles.map((vehicle, index) => {
                const isSelected = index === selectedVehicleIndex
                const targets = targetsOf(vehicle)
                const einsaetze = targets.filter((target) => target.kind === "einsatz")
                // One place: the whole row opens it. Several: each is its own link.
                const rowTarget = targets.length === 1 && targets[0].incidentId ? targets[0] : null
                const isClickable = !!rowTarget
                // Out on an Einsatz OR on an Auftrag: either way not «Verfügbar».
                const isBound = targets.length > 0
                // The clock and «Lange» follow the oldest Einsatz.
                const durationMinutes = vehicle.deployments.find((deployment) => deployment.kind === "einsatz")?.duration_minutes ?? null
                const showDurationWarning = durationMinutes !== null && durationMinutes >= 120
                // A single Einsatz names its column; anything more is «Gebunden».
                const singleStatus = targets.length === 1 && einsaetze.length === 1 ? einsaetze[0].status : null
                const singleStatusLabel = singleStatus && (isIncidentStatus(singleStatus) ? tColumns(singleStatus) : singleStatus)
                // Flagged «Nicht einsatzbereit» (Einstellungen or the row menu): said with its
                // date in the place column, like a flagged device in the material sidebar.
                const idleLabel = vehicle.out_of_service
                  ? [tCommon('notReady'), vehicle.out_of_service_since && tCommon('notReadySince', { date: shortDate(vehicle.out_of_service_since) })].filter(Boolean).join(' · ')
                  : vehicle.status === "unavailable" ? t('vehicleStatus.unavailable') : t('vehicleStatus.readyForOperation')
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
                    {vehicle.status === "unavailable" && !vehicle.out_of_service && (
                      <Badge className="text-xs bg-muted text-muted-foreground border-border">
                        {t('vehicleStatus.unavailable')}
                      </Badge>
                    )}
                    {isBound && !singleStatus && vehicle.status !== "unavailable" && (
                      <Badge variant="outline" className={cn("text-xs", RESOURCE_STATE_BADGE_CLASSES.assigned)}>
                        {t('vehicleStatus.bound')}
                      </Badge>
                    )}
                    {singleStatusLabel && (
                      <Badge
                        variant="outline"
                        className={cn("text-xs max-w-full", RESOURCE_STATE_BADGE_CLASSES.assigned)}
                        // A longer translation («Reconnaissance terminée») clips in the fixed track.
                        title={singleStatusLabel}
                      >
                        <span className="truncate">{singleStatusLabel}</span>
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
                    data-fleet-row={index}
                    onClick={() => rowTarget && openIncident(rowTarget)}
                    className={cn(
                      "border rounded-lg px-3 py-2.5 bg-card transition-all",
                      ACCENT_BAR,
                      "before:w-1",
                      getStatusBarColor(vehicle.status, isBound),
                      isClickable && "cursor-pointer hover:bg-muted/50 hover:border-border",
                      isSelected && "ring-2 ring-sel-line ring-offset-2 ring-offset-background",
                      !isBound && "opacity-75",
                      // Flagged: the dashed frame of a flagged device (sidebar-parts.tsx).
                      vehicle.out_of_service && "border-dashed opacity-70",
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
                         pins every left edge; only that column stretches. The tracks
                         after it are fixed too: an `auto` badge track took each row's
                         own badge width, so the clock and the badges sat at a
                         different x on every row (sign-off 24.11.). The badge track
                         fits «Disponiert / Anfahrt»; a second badge («Lange») wraps
                         under it, flush right.
                         Rows align at the TOP, every cell one badge-line tall: a
                         vehicle on two Einsätze lists both, and its name, driver and
                         badges stay on the first line (sign-off 19.11.). */
                      <div className={cn(
                        "grid items-start gap-3 [&>*]:min-h-[22px]",
                        canEdit
                          ? "grid-cols-[140px_104px_168px_minmax(0,1fr)_74px_144px_32px]"
                          : "grid-cols-[140px_104px_168px_minmax(0,1fr)_74px_144px]",
                      )}>
                        {/* Vehicle Icon and Name */}
                        <div className="flex items-center gap-2 min-w-0">
                          {vehicle.out_of_service
                            ? <Ban className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-label={tCommon('notReady')} />
                            : <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
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

                        {/* Status Badges — right-aligned in their own fixed track, so
                            «Verfügbar» sits under «Verfügbar» however many badges
                            the row above carries. */}
                        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                          {statusBadges}
                        </div>

                        {canEdit && (
                          <FleetRowMenu
                            vehicleName={vehicle.name}
                            outOfService={vehicle.out_of_service}
                            onOpenIncident={(() => {
                              // The row's Enter target: the first place with a card.
                              const first = targets.find((target) => target.incidentId)
                              return first ? () => openIncident(first) : undefined
                            })()}
                            onChangeDriver={() => openDriverDialog(vehicle)}
                            onSetOutOfService={(outOfService) => void setOutOfService(vehicle, outOfService)}
                          />
                        )}
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
