"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Truck, User, MapPin, Clock, Radio, X, Search, ArrowUpDown, RefreshCw, AlertTriangle } from "lucide-react"
import { apiClient } from "@/lib/api-client"
import { STATUS_LABELS } from "@/lib/types/incidents"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

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
type FilterOption = "all" | "available" | "assigned" | "maintenance"

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
  if (minutes < 60) return "text-green-600 dark:text-green-400" // < 1 hour
  if (minutes < 120) return "text-yellow-600 dark:text-yellow-400" // < 2 hours
  return "text-red-600 dark:text-red-400" // >= 2 hours
}

function getVehicleStatusBadge(status: string): { variant: "default" | "secondary" | "destructive" | "outline"; label: string; color?: string } {
  switch (status) {
    case "available":
      return { variant: "outline", label: "Verfügbar", color: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800" }
    case "assigned":
      return { variant: "secondary", label: "Im Einsatz", color: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800" }
    case "maintenance":
      return { variant: "destructive", label: "Wartung", color: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800" }
    default:
      return { variant: "outline", label: status }
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
  const [vehicles, setVehicles] = useState<VehicleStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedVehicleIndex, setSelectedVehicleIndex] = useState<number>(-1)
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)

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
      // First get all vehicles
      const allVehicles = await apiClient.getVehicles()

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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex flex-col max-w-5xl mx-auto max-h-[70vh]">
        <SheetHeader className="pr-16">
          <div className="flex items-center justify-between gap-6">
            <div>
              <SheetTitle>Fahrzeugstatus</SheetTitle>
              <SheetDescription>
                Übersicht aller Fahrzeuge mit Fahrer und aktuellem Einsatz
              </SheetDescription>
            </div>

            <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={loading} className="flex-shrink-0">
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              Aktualisieren
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto mt-3 -mx-6 px-6">
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

                      {/* Driver */}
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className={cn("text-sm truncate", vehicle.driver_name ? "" : "text-muted-foreground")}>
                          {vehicle.driver_name || "Kein Fahrer"}
                        </span>
                      </div>

                      {/* Current Incident Location */}
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm truncate">
                          {vehicle.incident_location_address || vehicle.incident_title || (vehicle.status === "maintenance" ? "In Wartung" : "Bereit für Einsatz")}
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
                        {/* Show vehicle status badge ONLY if not assigned to any incident */}
                        {!vehicle.incident_id && vehicle.status === "available" && (
                          <Badge className={cn("text-xs", "bg-green-500/10 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800")}>
                            Verfügbar
                          </Badge>
                        )}

                        {/* Show maintenance badge if in maintenance */}
                        {vehicle.status === "maintenance" && (
                          <Badge className={cn("text-xs", "bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800")}>
                            Wartung
                          </Badge>
                        )}

                        {/* Show incident status badge ONLY if assigned to an incident */}
                        {vehicle.incident_id && vehicle.incident_status && (
                          <Badge variant={getIncidentStatusBadgeVariant(vehicle.incident_status)} className="text-xs">
                            {STATUS_LABELS[vehicle.incident_status as keyof typeof STATUS_LABELS] || vehicle.incident_status}
                          </Badge>
                        )}

                        {/* Duration warning for long assignments */}
                        {showDurationWarning && (
                          <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-700 dark:text-yellow-300">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Lange
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <SheetFooter className="mt-3 pt-3 border-t px-6">
          <div className="flex items-center w-full gap-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4 mr-2" />
              Schliessen
            </Button>
            <div className="text-xs text-muted-foreground">
              Aktualisiert alle 10 Sekunden • Klicken um zu Einsatz zu navigieren
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
