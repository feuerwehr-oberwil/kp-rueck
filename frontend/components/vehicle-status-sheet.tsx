"use client"

import { useState, useEffect, useMemo, useRef, type CSSProperties } from "react"
import { useRouter } from "next/navigation"
import { SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { FooterSheet } from "@/components/ui/footer-sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Truck, User, MapPin, Clock, Radio, RefreshCw, AlertTriangle, Plus, Route } from "lucide-react"
import { apiClient, type ApiEventSpecialFunctionResponse } from "@/lib/api-client"
import { STATUS_LABELS } from "@/lib/types/incidents"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { useOperations } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { RESOURCE_STATE_BADGE_CLASSES } from "@/lib/resource-status"
import { useIsMobile } from "@/components/ui/use-mobile"
import { DriverAssignmentDialog } from "./driver-assignment-dialog"

interface VehicleStatus {
  id: string
  name: string
  type: string
  status: string
  radio_call_sign: string
  driver_id: string | null
  driver_name: string | null
  driver_assigned_at: string | null
  incident_id: string | null
  incident_title: string | null
  incident_location_address: string | null
  /** Server-computed deployment label (home city stripped). Null when idle. */
  incident_location_display?: string | null
  incident_status: string | null
  incident_assigned_at: string | null
  assignment_duration_minutes: number | null
}

interface VehicleStatusSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string | null
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "-"

  if (minutes < 60) {
    return translateOutsideReact('incidents.vehicleStatus.durationMinutes', { minutes })
  }

  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0
    ? translateOutsideReact('incidents.vehicleStatus.durationHoursMinutes', { hours, mins })
    : translateOutsideReact('incidents.vehicleStatus.durationHours', { hours })
}

function getDurationColor(minutes: number | null): string {
  if (minutes === null) return ""
  if (minutes < 60) return "text-muted-foreground" // < 1 hour
  if (minutes < 120) return "text-muted-foreground" // < 2 hours
  return "text-muted-foreground font-medium" // >= 2 hours
}

/** The Auftrag (route) a vehicle is out on — name plus the route's OWN colour,
 *  the same colour the board and the map identify that route by. */
interface VehicleAuftrag {
  name: string
  color: string | null
}

/** Tints an Auftrag chip in the route's colour. Returns undefined for a route
 *  without a colour, which then falls back to the neutral chip classes. */
function auftragChipStyle(color: string | null): CSSProperties | undefined {
  if (!color) return undefined
  return {
    color,
    borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
  }
}

/** «Auftrag «Sturm West»» in the route's colour — so a vehicle's route is
 *  identifiable at a glance instead of reading as one more grey field. */
function AuftragChip({ auftrag, label }: { auftrag: VehicleAuftrag; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-sm font-medium",
        !auftrag.color && "border-border bg-muted/60 text-foreground",
      )}
      style={auftragChipStyle(auftrag.color)}
      title={label}
    >
      <Route className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  )
}

function getStatusBorderColor(status: string, hasIncident: boolean): string {
  // Refactoring UI: Use subtle visual cues, not heavy color blocks
  // Only highlight assigned vehicles, available is the default state
  if (hasIncident) {
    return "border-l-amber-400 dark:border-l-amber-500"
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
  const router = useRouter()
  const isMobile = useIsMobile()
  const { personnel, operations, removeCrew } = useOperations()
  const { groups } = useGroups()
  // A vehicle can be deployed to a whole Auftrag (route) rather than a single
  // incident. Resolve vehicle-id → its Auftrag from the route assignments so the
  // deployment reads as the route name instead of one stop's address. The colour
  // travels with the name: it is what the board tints the route's cards with.
  const auftragByVehicleId = useMemo(() => {
    const map = new Map<string, VehicleAuftrag>()
    for (const g of groups) {
      for (const a of g.assignments) {
        if (a.resourceType === "vehicle") map.set(a.resourceId, { name: g.name, color: g.color })
      }
    }
    return map
  }, [groups])
  const [vehicles, setVehicles] = useState<VehicleStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedVehicleIndex, setSelectedVehicleIndex] = useState<number>(-1)
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Driver assignment state
  const [driverDialogOpen, setDriverDialogOpen] = useState(false)
  const [selectedVehicleForDriver, setSelectedVehicleForDriver] = useState<VehicleStatus | null>(null)
  const [specialFunctions, setSpecialFunctions] = useState<ApiEventSpecialFunctionResponse[]>([])

  // Auto-refresh every 10 seconds while sheet is open
  useEffect(() => {
    if (open && eventId) {
      loadVehicleStatuses()

      // Set up auto-refresh
      refreshIntervalRef.current = setInterval(() => {
        loadVehicleStatuses(true) // Silent refresh (no loading state)
      }, 10000)
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
        refreshIntervalRef.current = null
      }
    }
  }, [open, eventId])

  const loadVehicleStatuses = async (silent = false) => {
    if (!eventId) return

    if (!silent) {
      setLoading(true)
    }

    try {
      // Load vehicles and special functions in parallel
      const [allVehicles, functions] = await Promise.all([
        apiClient.getVehicles(),
        apiClient.getEventSpecialFunctions(eventId),
      ])

      setSpecialFunctions(functions)

      // Then get status for each vehicle
      const statusPromises = allVehicles.map(async (vehicle) => {
        try {
          return await apiClient.getVehicleStatus(vehicle.id, eventId)
        } catch (error) {
          console.error(`Error loading status for vehicle ${vehicle.name}:`, error)
          // Return basic vehicle info if status fetch fails
          return {
            id: vehicle.id,
            name: vehicle.name,
            type: vehicle.type,
            status: vehicle.status,
            radio_call_sign: vehicle.radio_call_sign,
            driver_id: null,
            driver_name: null,
            driver_assigned_at: null,
            incident_id: null,
            incident_title: null,
            incident_location_address: null,
            incident_location_display: null,
            incident_status: null,
            incident_assigned_at: null,
            assignment_duration_minutes: null,
          }
        }
      })

      const statuses = await Promise.all(statusPromises)
      // Sort by display order (same as they appear elsewhere)
      const sortedStatuses = statuses.sort((a, b) => {
        const vehicleA = allVehicles.find(v => v.id === a.id)
        const vehicleB = allVehicles.find(v => v.id === b.id)
        return (vehicleA?.display_order || 0) - (vehicleB?.display_order || 0)
      })

      setVehicles(sortedStatuses)
    } catch (error) {
      console.error("Error loading vehicle statuses:", error)
      if (!silent) {
        toast.error(t('vehicleStatus.loadError'))
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }

  const handleOpenDriverDialog = (vehicle: VehicleStatus, e: React.MouseEvent) => {
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

  // Vehicles are already sorted by display_order in loadVehicleStatuses
  const displayedVehicles = vehicles

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
        if (vehicle?.incident_id) {
          handleVehicleClick(vehicle)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, displayedVehicles, selectedVehicleIndex])

  const handleVehicleClick = (vehicle: VehicleStatus) => {
    if (vehicle.incident_id) {
      // Navigate to Kanban with highlighted incident
      router.push(`/?highlight=${vehicle.incident_id}`)
      onOpenChange(false)
    }
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
      className={cn("flex flex-col max-w-5xl mx-auto px-6 py-4 modal-h-tall")}
      style={isMobile ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" } : undefined}
      // both roles: a Radix AlertDialog is role="alertdialog", and the vehicle-conflict prompt
      // that can appear from here is one — see the note in auftraege-sheet.tsx
      shouldPreventClose={(target) => !!target.closest('[role="dialog"], [role="alertdialog"]') || driverDialogOpen}
    >
        <SheetHeader className="p-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <SheetTitle>{t('vehicleStatus.title')}</SheetTitle>
              <SheetDescription>
                {t('vehicleStatus.description')}
              </SheetDescription>
            </div>

            <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={loading} className="flex-shrink-0">
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              {t('vehicleStatus.refresh')}
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto mt-3 pb-10">
          {loading ? (
            <div className="space-y-1.5">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="border rounded-lg px-3 py-2.5 bg-card">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 flex-1" />
                    <Skeleton className="h-6 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : displayedVehicles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <Truck className="h-12 w-12 text-muted-foreground/50 mb-2" />
              <p className="text-muted-foreground">{t('vehicleStatus.noVehicles')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedVehicles.map((vehicle, index) => {
                const isSelected = index === selectedVehicleIndex
                const isClickable = !!vehicle.incident_id
                const auftrag = auftragByVehicleId.get(vehicle.id)
                const auftragName = auftrag?.name
                const showDurationWarning = vehicle.assignment_duration_minutes && vehicle.assignment_duration_minutes >= 120
                // Where the vehicle is: Auftrag name, else home-town-free incident
                // address. The server ships that label already computed
                // (`incident_location_display`, address or title) so it is final
                // on first paint; the client formatter is only the fallback.
                const deploymentLabel = auftragName
                  ? t('vehicleStatus.auftragLabel', { name: auftragName })
                  : (vehicle.incident_location_display
                    ?? (formatLocationForDisplay(vehicle.incident_location_address || '', getGlobalHomeCity())
                      || formatLocationForDisplay(vehicle.incident_title || '', getGlobalHomeCity())))
                    || (vehicle.status === "unavailable" ? t('vehicleStatus.unavailable') : t('vehicleStatus.readyForOperation'))

                return (
                  <div
                    key={vehicle.id}
                    onClick={() => isClickable && handleVehicleClick(vehicle)}
                    className={cn(
                      "border rounded-lg px-3 py-2.5 bg-card transition-all",
                      "border-l-4",
                      getStatusBorderColor(vehicle.status, !!vehicle.incident_id || !!auftragName),
                      isClickable && "cursor-pointer hover:bg-muted/50 hover:border-border",
                      isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                      !isClickable && "opacity-75"
                    )}
                    tabIndex={isClickable ? 0 : -1}
                    onKeyDown={(e) => {
                      if (isClickable && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault()
                        handleVehicleClick(vehicle)
                      }
                    }}
                  >
                    {isMobile ? (
                      /* Mobile: Card-based vertical layout */
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Truck className="h-4 w-4 text-primary flex-shrink-0" />
                            <span className="font-bold text-sm">{vehicle.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {!vehicle.incident_id && vehicle.status === "available" && (
                              <Badge variant="outline" className={cn("text-xs", RESOURCE_STATE_BADGE_CLASSES.available)}>
                                {t('vehicleStatus.available')}
                              </Badge>
                            )}
                            {vehicle.status === "unavailable" && (
                              <Badge className="text-xs bg-muted text-muted-foreground border-border">
                                {t('vehicleStatus.unavailable')}
                              </Badge>
                            )}
                            {vehicle.incident_id && vehicle.incident_status && (
                              <Badge variant="outline" className={cn("text-xs max-w-full", RESOURCE_STATE_BADGE_CLASSES.assigned)}>
                                {vehicle.incident_status in STATUS_LABELS ? t(`status.${vehicle.incident_status}`) : vehicle.incident_status}
                              </Badge>
                            )}
                            {showDurationWarning && (
                              <Badge className="text-xs bg-warning/10 text-warning-foreground border-warning/30">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                {t('vehicleStatus.longDuration')}
                              </Badge>
                            )}
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
                          <div className="flex min-w-0 items-center gap-1.5 col-span-2">
                            {auftrag ? (
                              <AuftragChip auftrag={auftrag} label={deploymentLabel} />
                            ) : (
                              <>
                                <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                <span className="truncate" title={deploymentLabel}>
                                  {deploymentLabel}
                                </span>
                              </>
                            )}
                          </div>
                          {vehicle.assignment_duration_minutes !== null && (
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-3 w-3 flex-shrink-0" />
                              <span className={cn("text-xs font-medium", getDurationColor(vehicle.assignment_duration_minutes))}>
                                {formatDuration(vehicle.assignment_duration_minutes)}
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
                          <Truck className="h-4 w-4 text-primary flex-shrink-0" />
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

                        {/* Current deployment — the Auftrag (route) in the route's own
                            colour when the vehicle is route-assigned, else the incident
                            location. Twice the driver's share of the free width: an
                            address is the longer of the two. */}
                        <div className="flex min-w-0 items-center gap-2">
                          {auftrag ? (
                            <AuftragChip auftrag={auftrag} label={deploymentLabel} />
                          ) : (
                            <>
                              <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                              <span className="text-sm truncate" title={deploymentLabel}>
                                {deploymentLabel}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Duration. The cell is always rendered, empty when a
                            vehicle carries no clock: a conditional cell would
                            collapse its track and pull the badges of that one row
                            left, which is the misalignment this grid exists for. */}
                        <div className="flex min-w-0 items-center gap-1.5">
                          {vehicle.assignment_duration_minutes !== null && (
                            <>
                              <Clock className="h-3 w-3 flex-shrink-0" />
                              <span className={cn("text-xs font-medium", getDurationColor(vehicle.assignment_duration_minutes))}>
                                {formatDuration(vehicle.assignment_duration_minutes)}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Status Badges — right-aligned in their own track, so
                            «Verfügbar» sits under «Verfügbar» however many badges
                            the row above carries. */}
                        <div className="flex items-center justify-self-end gap-1.5">
                          {!vehicle.incident_id && vehicle.status === "available" && (
                            <Badge variant="outline" className={cn("text-xs", RESOURCE_STATE_BADGE_CLASSES.available)}>
                              {t('vehicleStatus.available')}
                            </Badge>
                          )}
                          {vehicle.status === "unavailable" && (
                            <Badge className="text-xs bg-muted text-muted-foreground border-border">
                              {t('vehicleStatus.unavailable')}
                            </Badge>
                          )}
                          {vehicle.incident_id && vehicle.incident_status && (
                            <Badge variant="outline" className={cn("text-xs", RESOURCE_STATE_BADGE_CLASSES.assigned)}>
                              {vehicle.incident_status in STATUS_LABELS ? t(`status.${vehicle.incident_status}`) : vehicle.incident_status}
                            </Badge>
                          )}
                          {showDurationWarning && (
                            <Badge className="text-xs bg-warning/10 text-warning-foreground border-warning/30">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              {t('vehicleStatus.longDuration')}
                            </Badge>
                          )}
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

    {/* Driver Assignment Dialog - Outside Sheet to prevent closing issues */}
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
