"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { FileText, Clock, Users, Package, Truck, Search, Siren } from "lucide-react"
import { useIncidents, useOperations, type Operation, type Material } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import type { Incident } from "@/lib/types/incidents"
import { STATUS_LABELS, INCIDENT_TYPE_LABELS, STATUS_TO_GROUP, STATUS_GROUP_LABELS, type StatusGroup, type IncidentStatus } from "@/lib/types/incidents"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { apiClient } from "@/lib/api-client"
import { toast } from "sonner"
import { useIsMobile } from "@/components/ui/use-mobile"
import { useOperationHandlers } from "@/lib/hooks/use-operation-handlers"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"

// Dynamically import map to avoid SSR issues with Leaflet
const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-muted rounded-lg">
      <div className="text-muted-foreground">Karte wird geladen...</div>
    </div>
  ),
})

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getTimeSince(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 1000 / 60)
  if (minutes < 60) return `${minutes}'`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}'`
}

export default function MapPage() {
  const { incidents, formatLocation, refreshIncidents } = useIncidents()
  const {
    operations,
    materials,
    updateOperation,
    removeVehicle: removeVehicleFromOperation,
    assignVehicleToOperation,
    deleteOperation
  } = useOperations()
  const { selectedEvent, isEventLoaded } = useEvent()
  const { isAuthenticated } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const highlightParam = searchParams.get("highlight")
  const isMobile = useIsMobile()
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    highlightParam
  )
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  // Derive current operation from operations array to get real-time updates
  const selectedOperation = useMemo(() => {
    if (!selectedOperationId) return null
    return operations.find(op => op.id === selectedOperationId) || null
  }, [selectedOperationId, operations])
  const [resetZoomTrigger, setResetZoomTrigger] = useState(0)
  const [panTrigger, setPanTrigger] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilters, setStatusFilters] = useState<Record<StatusGroup, boolean>>({
    open: true,
    active: true,
    completed: false, // Hidden by default (matches current behavior)
  })
  const [vehicleTypes, setVehicleTypes] = useState<Array<{ key: string; name: string; id: string }>>([])
  const [showAssignmentLines, setShowAssignmentLines] = useState(true)
  const [gPrefixActive, setGPrefixActive] = useState(false)
  const gPrefixTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const mapRef = useRef<any>(null)
  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [isMounted, setIsMounted] = useState(false)

  const selectedIncident = useMemo(
    () => incidents.find((inc) => inc.id === selectedIncidentId),
    [incidents, selectedIncidentId]
  )

  // Cross-window sync (bidirectional)
  const { broadcast } = useCrossWindowSync({
    onMessage: (msg) => {
      if (msg.type === "incident:selected") {
        setSelectedIncidentId(msg.incidentId)
      }
    },
  })

  const handleIncidentClick = (incidentId: string) => {
    if (incidentId === selectedIncidentId) {
      // Re-clicking same incident - trigger pan
      setPanTrigger(prev => prev + 1)
    } else {
      // Different incident - update selection
      setSelectedIncidentId(incidentId)
      broadcast("incident:selected", incidentId)
    }
  }

  const handleDetailsClick = (incident: Incident) => {
    // Find the corresponding operation
    const operation = operations.find(op => op.id === incident.id)
    if (operation) {
      setSelectedOperationId(operation.id)
      setDetailModalOpen(true)
    }
  }

  // Use shared operation handlers hook
  const { handleOperationUpdate, handleVehicleRemove, handleVehicleAssign, handleOperationDelete } = useOperationHandlers({
    selectedOperation,
    updateOperation,
    removeVehicle: removeVehicleFromOperation,
    assignVehicleToOperation,
    deleteOperation,
  })

  // Count incidents by status group (before filtering)
  const statusGroupCounts = useMemo(() => {
    const counts: Record<StatusGroup, number> = { open: 0, active: 0, completed: 0 }
    incidents.forEach((inc) => {
      const group = STATUS_TO_GROUP[inc.status as IncidentStatus]
      if (group) counts[group]++
    })
    return counts
  }, [incidents])

  // Filter incidents based on status group filters and search query
  const activeIncidents = useMemo(
    () => {
      // Filter by status group
      const filtered = incidents.filter((inc) => {
        const group = STATUS_TO_GROUP[inc.status as IncidentStatus]
        return group && statusFilters[group]
      })

      // Filter by search query
      if (!searchQuery) return filtered

      const lowerQuery = searchQuery.toLowerCase()
      return filtered.filter((inc) =>
        (inc.location_address && inc.location_address.toLowerCase().includes(lowerQuery)) ||
        (inc.title && inc.title.toLowerCase().includes(lowerQuery)) ||
        (INCIDENT_TYPE_LABELS[inc.type as keyof typeof INCIDENT_TYPE_LABELS]?.toLowerCase().includes(lowerQuery)) ||
        (STATUS_LABELS[inc.status as keyof typeof STATUS_LABELS]?.toLowerCase().includes(lowerQuery))
      )
    },
    [incidents, searchQuery, statusFilters]
  )

  // Toggle status filter
  const toggleStatusFilter = (group: StatusGroup) => {
    setStatusFilters(prev => ({ ...prev, [group]: !prev[group] }))
  }

  // Load vehicles and settings from API once authenticated
  useEffect(() => {
    if (!isAuthenticated) return
    const loadVehicles = async () => {
      try {
        const vehicles = await apiClient.getVehicles()
        // Create vehicle types array with keyboard shortcuts (1-5), including IDs
        const typesWithKeys = vehicles.slice(0, 5).map((vehicle, index) => ({
          key: String(index + 1),
          name: vehicle.name,
          id: vehicle.id
        }))
        setVehicleTypes(typesWithKeys)
      } catch (error) {
        console.error('Failed to load vehicles:', error)
      }
    }
    const loadSettings = async () => {
      try {
        const settings = await apiClient.getAllSettings()
        if (settings.show_assignment_lines !== undefined) {
          setShowAssignmentLines(settings.show_assignment_lines !== 'false')
        }
      } catch (error) {
        console.debug('Failed to load assignment line setting:', error)
      }
    }
    loadVehicles()
    loadSettings()
  }, [isAuthenticated])

  // Refresh incidents immediately when map page loads
  useEffect(() => {
    refreshIncidents()
  }, [])

  // Clock update
  useEffect(() => {
    setIsMounted(true)
    setCurrentTime(new Date())
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (highlightParam) {
      setSelectedIncidentId(highlightParam)
    }
  }, [highlightParam])

  // Redirect to events page if no event is selected (only after event is loaded from localStorage)
  useEffect(() => {
    if (isEventLoaded && !selectedEvent) {
      router.push('/events')
    }
  }, [isEventLoaded, selectedEvent, router])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Esc to blur input or cancel g-prefix mode
      if (e.key === 'Escape') {
        if (gPrefixActive) {
          setGPrefixActive(false)
          if (gPrefixTimeoutRef.current) {
            clearTimeout(gPrefixTimeoutRef.current)
            gPrefixTimeoutRef.current = null
          }
          return
        }
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          (e.target as HTMLElement).blur()
          return
        }
      }

      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Handle g-prefix navigation
      if (gPrefixActive) {
        e.preventDefault()
        setGPrefixActive(false)
        if (gPrefixTimeoutRef.current) {
          clearTimeout(gPrefixTimeoutRef.current)
          gPrefixTimeoutRef.current = null
        }

        if (e.key === 'k' || e.key === 'K') {
          router.push('/')
          return
        } else if (e.key === 'm' || e.key === 'M') {
          // Already on Map, do nothing
          return
        } else if (e.key === 'e' || e.key === 'E') {
          router.push('/events')
          return
        } else if (e.key === 's' || e.key === 'S') {
          router.push('/settings')
          return
        } else if (e.key === 'h' || e.key === 'H') {
          router.push('/help')
          return
        }
        return
      }

      // Activate g-prefix mode
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault()
        setGPrefixActive(true)
        // Reset g-prefix mode after 1.5 seconds
        if (gPrefixTimeoutRef.current) {
          clearTimeout(gPrefixTimeoutRef.current)
        }
        gPrefixTimeoutRef.current = setTimeout(() => {
          setGPrefixActive(false)
          gPrefixTimeoutRef.current = null
        }, 1500)
        return
      }

      // '/' or 'S' key to focus search (S for Suche - Swiss-German keyboard friendly)
      if (e.key === '/' || ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        document.getElementById('map-search-input')?.focus()
      }
      // 'z' key to reset zoom
      else if ((e.key === 'z' || e.key === 'Z') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys (allows cmd+z/ctrl+z for undo)
        e.preventDefault()
        setResetZoomTrigger((prev) => prev + 1)
        setSelectedIncidentId(null)
      }
      // 'e' or 'Enter' key to open details for selected incident
      else if ((((e.key === 'e' || e.key === 'E') && !e.metaKey && !e.ctrlKey) || e.key === 'Enter') && selectedIncidentId) {
        // Only use 'e' if no modifier keys (Enter always works)
        e.preventDefault()
        const incident = incidents.find(inc => inc.id === selectedIncidentId)
        if (incident) {
          handleDetailsClick(incident)
        }
      }
      // 'r' or 'F5' key to refresh data
      else if ((e.key === 'r' || e.key === 'R' || e.key === 'F5') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys are pressed
        // This allows cmd+r / ctrl+r to work normally for browser refresh
        e.preventDefault()
        refreshIncidents()
      }
      // Arrow keys to pan map (placeholder - would need to integrate with Leaflet map)
      // Note: Actual map panning would require access to the Leaflet map instance
      // For now, this is documented but not fully implemented
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
      // Clean up timeout on unmount
      if (gPrefixTimeoutRef.current) {
        clearTimeout(gPrefixTimeoutRef.current)
      }
    }
  }, [gPrefixActive, selectedIncidentId, incidents, refreshIncidents, router, handleDetailsClick])

  return (
    <ProtectedRoute>
      <div className="flex h-full flex-col bg-background text-foreground">
        <header className="flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-4 md:px-6 py-2 min-h-14">
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">Lagekarte</h1>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {activeIncidents.length} Aktiv
            </Badge>
          </div>

          {/* Desktop Navigation */}
          {!isMobile && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-base font-semibold tabular-nums">
                  {isMounted && currentTime ? currentTime.toLocaleTimeString("de-DE") : "--:--:--"}
                </span>
              </div>
              <PageNavigation currentPage="map" hasSelectedEvent={!!selectedEvent} />
            </div>
          )}

        </header>

        <div className={`flex flex-1 overflow-hidden ${isMobile ? 'flex-col' : 'flex-row'}`}>
          {/* Map - full height on desktop, half height on mobile */}
          <main className={`p-4 ${isMobile ? 'h-[60vh]' : 'flex-1'}`}>
            <MapView
              selectedIncidentId={selectedIncidentId}
              onMarkerClick={handleIncidentClick}
              onDetailsClick={handleDetailsClick}
              resetZoomTrigger={resetZoomTrigger}
              panTrigger={panTrigger}
              statusFilters={statusFilters}
              showAssignmentLines={showAssignmentLines}
            />
          </main>

          {/* Active Emergencies - sidebar on desktop, bottom section on mobile */}
          <aside className={`bg-card/30 backdrop-blur-sm overflow-y-auto ${
            isMobile
              ? 'flex-1 border-t border-border'
              : 'w-80 border-l border-border flex-shrink-0'
          }`}>
            <div className="p-4">
              <h2 className="text-lg font-bold mb-3">
                Einsätze ({activeIncidents.length})
              </h2>

              {/* Status filter toggles */}
              <div className="flex flex-wrap gap-2 mb-4">
                {(['open', 'active', 'completed'] as StatusGroup[]).map((group) => (
                  <button
                    key={group}
                    onClick={() => toggleStatusFilter(group)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      statusFilters[group]
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    {STATUS_GROUP_LABELS[group]} ({statusGroupCounts[group]})
                  </button>
                ))}
              </div>

              {/* Search bar */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="map-search-input"
                  type="text"
                  placeholder="Suchen..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-8"
                />
                {!isMobile && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <Kbd className="text-xs">S</Kbd>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {activeIncidents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Keine aktiven Einsätze
                  </p>
                ) : (
                  activeIncidents.map((incident) => {
                    const isExpanded = selectedIncidentId === incident.id
                    return (
                      <Card
                        key={incident.id}
                        className={`p-4 cursor-pointer transition-all hover:border-border ${
                          isExpanded
                            ? "border-primary ring-2 ring-primary/20 scale-[1.02]"
                            : ""
                        }`}
                        onClick={() => handleIncidentClick(incident.id)}
                      >
                        <div className="space-y-3">
                          {/* Location and Details button */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0 flex-1">
                              <div
                                className={`h-2.5 w-2.5 rounded-full flex-shrink-0 mt-1 ${
                                  incident.priority === "high" ? "bg-red-500" : incident.priority === "medium" ? "bg-yellow-500" : "bg-green-500"
                                }`}
                                title={incident.priority === "high" ? "Hohe Priorität" : incident.priority === "medium" ? "Mittlere Priorität" : "Niedrige Priorität"}
                              />
                              <div className="min-w-0 flex-1">
                                <h3 className="font-bold text-base leading-tight">
                                  {incident.location_address ? formatLocation(incident.location_address) : incident.title}
                                </h3>
                                {incident.title && incident.title !== incident.location_address && (
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {incident.title}
                                  </p>
                                )}
                              </div>
                            </div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDetailsClick(incident)
                                  }}
                                  className="p-1.5 rounded-md hover:bg-muted transition-colors flex-shrink-0"
                                >
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Details anzeigen</TooltipContent>
                            </Tooltip>
                          </div>

                          {/* Incident Type */}
                          <div className="flex items-center gap-2">
                            <Siren className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm text-muted-foreground">{INCIDENT_TYPE_LABELS[incident.type as keyof typeof INCIDENT_TYPE_LABELS]}</span>
                          </div>

                          {/* Time and Status */}
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <span className="text-sm text-muted-foreground font-mono">
                                {formatTime(incident.created_at)}
                              </span>
                            </div>
                            {isExpanded && (
                              <span className="text-xs text-muted-foreground font-mono">
                                {getTimeSince(incident.created_at)}
                              </span>
                            )}
                            <Badge variant="outline" className="text-xs">
                              {STATUS_LABELS[incident.status as keyof typeof STATUS_LABELS]}
                            </Badge>
                          </div>

                          {/* Description (only when expanded) */}
                          {isExpanded && incident.description && (
                            <p className="text-sm text-muted-foreground">
                              {incident.description}
                            </p>
                          )}

                          {/* Assigned Vehicles (only when expanded) */}
                          {isExpanded && incident.assigned_vehicles && incident.assigned_vehicles.length > 0 && (
                            <div className="flex items-start gap-2">
                              <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                              <div className="flex flex-wrap gap-1.5 flex-1">
                                {incident.assigned_vehicles.map((vehicle, idx) => (
                                  <Badge
                                    key={idx}
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    {vehicle.name}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Assigned Crew (only when expanded) */}
                          {isExpanded && incident.assigned_personnel && incident.assigned_personnel.length > 0 && (
                            <div className="flex items-start gap-2">
                              <Users className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                              <div className="flex flex-wrap gap-1.5 flex-1">
                                {incident.assigned_personnel.map((person, idx) => (
                                  <Badge
                                    key={idx}
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    {person.name.split(" ")[0][0]}.{person.name.split(" ")[1]?.[0] || ""}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Assigned Materials (only when expanded) */}
                          {isExpanded && incident.assigned_materials && incident.assigned_materials.length > 0 && (
                            <div className="flex items-start gap-2">
                              <Package className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                              <div className="flex flex-wrap gap-1.5 flex-1">
                                {incident.assigned_materials.map((material, idx) => (
                                  <Badge
                                    key={idx}
                                    variant="outline"
                                    className="text-xs"
                                  >
                                    {material.name.substring(0, 15)}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </Card>
                    )
                  })
                )}
              </div>
            </div>
          </aside>
        </div>

        {/* Operation Detail Modal */}
        <OperationDetailModal
          operation={selectedOperation}
          open={detailModalOpen}
          onOpenChange={setDetailModalOpen}
          onUpdate={handleOperationUpdate}
          onDelete={handleOperationDelete}
          materials={materials}
          vehicleTypes={vehicleTypes}
          onAssignVehicle={handleVehicleAssign}
          onRemoveVehicle={handleVehicleRemove}
        />
      </div>

      {/* Mobile Bottom Navigation */}

      <MobileBottomNavigation currentPage="map" hasSelectedEvent={!!selectedEvent} />

    </ProtectedRoute>
  )
}
