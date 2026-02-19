"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Truck, User, MapPin, Clock, Radio, RefreshCw, AlertTriangle, Plus } from "lucide-react"
import { apiClient, type ApiEventSpecialFunctionResponse } from "@/lib/api-client"
import { STATUS_LABELS } from "@/lib/types/incidents"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useOperations } from "@/lib/contexts/operations-context"
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
  incident_status: string | null
  incident_assigned_at: string | null
  assignment_duration_minutes: number | null
}

interface VehicleStatusSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string | null
}

type SortOption = "name" | "status" | "duration"
type FilterOption = "all" | "available" | "assigned" | "unavailable"

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "-"

  if (minutes < 60) {
    return `${minutes} Min`
  }

  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function getDurationColor(minutes: number | null): string {
  if (minutes === null) return ""
  if (minutes < 60) return "text-muted-foreground" // < 1 hour
  if (minutes < 120) return "text-muted-foreground" // < 2 hours
  return "text-muted-foreground font-medium" // >= 2 hours
}

function getVehicleStatusBadge(status: string): { variant: "default" | "secondary" | "destructive" | "outline"; label: string; color?: string } {
  switch (status) {
    case "available":
      // Subtle, desaturated green - Refactoring UI: don't use bright colors for passive states
      return { variant: "outline", label: "Verfügbar", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/50" }
    case "unavailable":
      return { variant: "secondary", label: "Nicht verfügbar", color: "bg-muted text-muted-foreground border-border" }
    default:
      return { variant: "outline", label: status }
  }
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

function getIncidentStatusBadgeVariant(incidentStatus: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (!incidentStatus) return "outline"
  if (incidentStatus === "einsatz") return "destructive"
  if (incidentStatus === "disponiert") return "secondary"
  return "default"
}

export function VehicleStatusSheet({ open, onOpenChange, eventId }: VehicleStatusSheetProps) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const { personnel } = useOperations()
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
        toast.error("Fehler beim Laden der Fahrzeugstatus")
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
    toast.success("Aktualisiert")
  }

  if (!eventId) {
    return null
  }

  return (
    <>
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        overlayOffset="42px"
        nonModal
        className={cn("flex flex-col max-w-5xl mx-auto px-6 py-4", isMobile ? "max-h-[70vh]" : "max-h-[45vh]")}
        onInteractOutside={(e) => {
          // Prevent closing when clicking on footer buttons or dialogs
          const target = e.target as HTMLElement
          if (target.closest('footer') || target.closest('[role="dialog"]') || driverDialogOpen) {
            e.preventDefault()
          }
        }}
      >
        <SheetHeader className="p-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <SheetTitle>Fahrzeugstatus</SheetTitle>
              <SheetDescription>
                Klicken um zu Einsatz zu navigieren • Aktualisiert alle 10 Sekunden
              </SheetDescription>
            </div>

            <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={loading} className="flex-shrink-0">
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              Aktualisieren
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto mt-3 pb-10">
          {loading ? (
            <div className="space-y-1.5">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="border rounded-lg px-3 py-2.5 bg-card animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-24 bg-muted rounded" />
                    <div className="h-3 w-20 bg-muted rounded" />
                    <div className="h-3 w-28 bg-muted rounded" />
                    <div className="h-3 flex-1 bg-muted rounded" />
                    <div className="h-6 w-20 bg-muted rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : displayedVehicles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <Truck className="h-12 w-12 text-muted-foreground/50 mb-2" />
              <p className="text-muted-foreground">Keine Fahrzeuge verfügbar</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedVehicles.map((vehicle, index) => {
                const vehicleStatusBadge = getVehicleStatusBadge(vehicle.status)
                const isSelected = index === selectedVehicleIndex
                const isClickable = !!vehicle.incident_id
                const showDurationWarning = vehicle.assignment_duration_minutes && vehicle.assignment_duration_minutes >= 120

                return (
                  <div
                    key={vehicle.id}
                    onClick={() => isClickable && handleVehicleClick(vehicle)}
                    className={cn(
                      "border rounded-lg px-3 py-2.5 bg-card transition-all",
                      "border-l-4",
                      getStatusBorderColor(vehicle.status, !!vehicle.incident_id),
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
                              <Badge className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/50">
                                Verfügbar
                              </Badge>
                            )}
                            {vehicle.status === "unavailable" && (
                              <Badge className="text-xs bg-muted text-muted-foreground border-border">
                                Nicht verfügbar
                              </Badge>
                            )}
                            {vehicle.incident_id && vehicle.incident_status && (
                              <Badge className="text-xs bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/50">
                                {STATUS_LABELS[vehicle.incident_status as keyof typeof STATUS_LABELS] || vehicle.incident_status}
                              </Badge>
                            )}
                            {showDurationWarning && (
                              <Badge className="text-xs bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800/50">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                Lange
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
                              {vehicle.driver_name || "Kein Fahrer"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 col-span-2">
                            <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="truncate">
                              {vehicle.incident_location_address || vehicle.incident_title || (vehicle.status === "unavailable" ? "Nicht verfügbar" : "Bereit für Einsatz")}
                            </span>
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
                      /* Desktop: Horizontal row layout */
                      <div className="flex items-center gap-3">
                        {/* Vehicle Icon and Name */}
                        <div className="flex items-center gap-2 min-w-[140px]">
                          <Truck className="h-4 w-4 text-primary flex-shrink-0" />
                          <span className="font-bold text-sm">{vehicle.name}</span>
                        </div>

                        {/* Radio Call Sign */}
                        <div className="flex items-center gap-2 min-w-[100px]">
                          <Radio className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-muted-foreground text-sm truncate">
                            {vehicle.radio_call_sign}
                          </span>
                        </div>

                        {/* Driver - Clickable to assign */}
                        <button
                          onClick={(e) => handleOpenDriverDialog(vehicle, e)}
                          className={cn(
                            "flex items-center gap-2 min-w-[120px] rounded px-1.5 py-0.5 -mx-1.5 transition-colors",
                            "hover:bg-muted/80 cursor-pointer group"
                          )}
                          title={vehicle.driver_name ? "Fahrer ändern" : "Fahrer zuweisen"}
                        >
                          <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className={cn("text-sm truncate", vehicle.driver_name ? "" : "text-muted-foreground")}>
                            {vehicle.driver_name || "Kein Fahrer"}
                          </span>
                          {!vehicle.driver_name && (
                            <Plus className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                          )}
                        </button>

                        {/* Current Incident Location */}
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-sm truncate">
                            {vehicle.incident_location_address || vehicle.incident_title || (vehicle.status === "unavailable" ? "Nicht verfügbar" : "Bereit für Einsatz")}
                          </span>
                        </div>

                        {/* Duration */}
                        {vehicle.assignment_duration_minutes !== null && (
                          <div className="flex items-center gap-2 min-w-[70px]">
                            <Clock className="h-3 w-3 flex-shrink-0" />
                            <span className={cn("text-xs font-medium", getDurationColor(vehicle.assignment_duration_minutes))}>
                              {formatDuration(vehicle.assignment_duration_minutes)}
                            </span>
                          </div>
                        )}

                        {/* Status Badges */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {!vehicle.incident_id && vehicle.status === "available" && (
                            <Badge className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/50">
                              Verfügbar
                            </Badge>
                          )}
                          {vehicle.status === "unavailable" && (
                            <Badge className="text-xs bg-muted text-muted-foreground border-border">
                              Nicht verfügbar
                            </Badge>
                          )}
                          {vehicle.incident_id && vehicle.incident_status && (
                            <Badge className="text-xs bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/50">
                              {STATUS_LABELS[vehicle.incident_status as keyof typeof STATUS_LABELS] || vehicle.incident_status}
                            </Badge>
                          )}
                          {showDurationWarning && (
                            <Badge className="text-xs bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800/50">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Lange
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

      </SheetContent>
    </Sheet>

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
        specialFunctions={specialFunctions}
        onDriverAssigned={handleDriverAssigned}
      />
    )}
    </>
  )
}
