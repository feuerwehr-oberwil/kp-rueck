"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { MobileNavigation } from "@/components/mobile-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import { apiClient } from "@/lib/api-client"
import { toast } from "sonner"
import { useIsMobile } from "@/components/ui/use-mobile"
import { LayoutGrid, Map as MapIcon } from "lucide-react"

// Dynamically import map to avoid SSR issues with Leaflet
const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-zinc-900 rounded-lg">
      <div className="text-muted-foreground">Karte wird geladen...</div>
    </div>
  ),
})

// Dynamically import kanban to avoid SSR drag-drop issues
const KanbanBoard = dynamic(() => import("@/components/combined-kanban-board"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-background">
      <div className="text-muted-foreground">Kanban wird geladen...</div>
    </div>
  ),
})

export default function CombinedViewPage() {
  const {
    operations,
    materials,
    refreshOperations,
    updateOperation,
    removeVehicle,
    assignVehicleToOperation,
    deleteOperation
  } = useOperations()
  const { selectedEvent, isEventLoaded } = useEvent()
  const router = useRouter()
  const isMobile = useIsMobile()

  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)
  const [hoveredOperationId, setHoveredOperationId] = useState<string | null>(null)
  const [operationForModal, setOperationForModal] = useState<Operation | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [vehicleTypes, setVehicleTypes] = useState<Array<{ key: string; name: string; id: string }>>([])
  const [isMounted, setIsMounted] = useState(false)
  const [mapResetTrigger, setMapResetTrigger] = useState(0)
  const [activeTab, setActiveTab] = useState<string>("kanban")

  // Set mounted state
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Redirect to events page if no event is selected (only after event is loaded from localStorage)
  useEffect(() => {
    if (isMounted && isEventLoaded && !selectedEvent) {
      router.push('/events')
    }
  }, [isMounted, isEventLoaded, selectedEvent, router])

  // Load vehicles from API
  useEffect(() => {
    const loadVehicles = async () => {
      try {
        const vehicles = await apiClient.getVehicles()
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
    loadVehicles()
  }, [])

  // Refresh operations on mount
  useEffect(() => {
    refreshOperations()
  }, [])

  // Active operations (excluding completed)
  const activeOperations = operations.filter((op) => op.status !== "complete")

  const handleDetailsClick = (operation: Operation) => {
    setOperationForModal(operation)
    setModalOpen(true)
  }

  const handleMapMarkerClick = (operationId: string) => {
    setSelectedOperationId(operationId)
    // Switch to kanban tab on mobile when marker is clicked
    if (isMobile) {
      setActiveTab("kanban")
    }
    // Trigger pulse animation on kanban card for 3 seconds
    setTimeout(() => setSelectedOperationId(null), 3000)
  }

  const handleKanbanCardHover = (operationId: string | null) => {
    setHoveredOperationId(operationId)
  }

  const handleOperationUpdate = (updates: Partial<Operation>) => {
    if (!operationForModal) return
    updateOperation(operationForModal.id, updates)
    setOperationForModal({ ...operationForModal, ...updates })
  }

  const handleVehicleRemove = (operationId: string, vehicleName: string) => {
    if (!operationForModal) return
    removeVehicle(operationId, vehicleName)
    setOperationForModal({
      ...operationForModal,
      vehicles: operationForModal.vehicles.filter(v => v !== vehicleName)
    })
  }

  const handleVehicleAssign = (vehicleId: string, vehicleName: string, operationId: string) => {
    if (!operationForModal) return
    assignVehicleToOperation(vehicleId, vehicleName, operationId)
    setOperationForModal({
      ...operationForModal,
      vehicles: [...operationForModal.vehicles, vehicleName]
    })
  }

  const handleOperationDelete = async (operationId: string) => {
    try {
      await deleteOperation(operationId)
      toast.success("Einsatz gelöscht", {
        description: "Der Einsatz wurde erfolgreich aus der Datenbank entfernt.",
      })
    } catch (error) {
      console.error('Failed to delete operation:', error)
      toast.error("Fehler beim Löschen", {
        description: "Der Einsatz konnte nicht gelöscht werden. Bitte versuchen Sie es erneut.",
      })
    }
  }

  // Don't render until mounted to avoid hydration issues
  if (!isMounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    )
  }

  return (
    <ProtectedRoute>
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-6 py-4 min-h-20">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-orange-600 text-2xl shadow-lg">
              🚒
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Kombinierte Ansicht</h1>
            <Badge variant="secondary" className="ml-2">
              {activeOperations.length} Aktiv
            </Badge>
          </div>

          <div className="flex items-center gap-4">
            {/* Desktop Navigation */}
            {!isMobile && (
              <PageNavigation currentPage="combined" hasSelectedEvent={!!selectedEvent} />
            )}

            {/* Mobile Navigation */}
            {isMobile && (
              <MobileNavigation hasSelectedEvent={!!selectedEvent} />
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden p-4">
          {/* Mobile: Tabs Layout */}
          {isMobile ? (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
              <TabsList className="w-full grid grid-cols-2 mb-4">
                <TabsTrigger value="kanban" className="flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4" />
                  <span>Kanban</span>
                </TabsTrigger>
                <TabsTrigger value="map" className="flex items-center gap-2">
                  <MapIcon className="h-4 w-4" />
                  <span>Karte</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="kanban" className="flex-1 m-0 overflow-hidden">
                <div className="h-full rounded-lg border border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
                  <KanbanBoard
                    onCardHover={handleKanbanCardHover}
                    onCardClick={handleDetailsClick}
                    highlightedOperationId={selectedOperationId}
                  />
                </div>
              </TabsContent>

              <TabsContent value="map" className="flex-1 m-0 overflow-hidden">
                <div className="h-full rounded-lg border border-border/50 overflow-hidden">
                  <MapView
                    selectedIncidentId={hoveredOperationId}
                    onMarkerClick={handleMapMarkerClick}
                    onDetailsClick={(incident) => {
                      const operation = operations.find(op => op.id === incident.id)
                      if (operation) {
                        handleDetailsClick(operation)
                      }
                    }}
                    resetZoomTrigger={mapResetTrigger}
                  />
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            /* Desktop: Resizable Split View */
            <ResizablePanelGroup
              direction="horizontal"
              className="h-full gap-4"
              onLayout={() => {
                // Trigger map resize when panel layout changes
                setMapResetTrigger(prev => prev + 1)
              }}
            >
              {/* Kanban Board Panel - 60% default */}
              <ResizablePanel defaultSize={60} minSize={30}>
                <div className="h-full rounded-lg border border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
                  <KanbanBoard
                    onCardHover={handleKanbanCardHover}
                    onCardClick={handleDetailsClick}
                    highlightedOperationId={selectedOperationId}
                  />
                </div>
              </ResizablePanel>

              {/* Resize Handle */}
              <ResizableHandle withHandle />

              {/* Map Panel - 40% default */}
              <ResizablePanel
                defaultSize={40}
                minSize={25}
                onResize={() => {
                  // Trigger map resize when this specific panel is resized
                  setMapResetTrigger(prev => prev + 1)
                }}
              >
                <div className="h-full rounded-lg border border-border/50 overflow-hidden">
                  <MapView
                    selectedIncidentId={hoveredOperationId}
                    onMarkerClick={handleMapMarkerClick}
                    onDetailsClick={(incident) => {
                      const operation = operations.find(op => op.id === incident.id)
                      if (operation) {
                        handleDetailsClick(operation)
                      }
                    }}
                    resetZoomTrigger={mapResetTrigger}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </main>

        {/* Operation Detail Modal */}
        <OperationDetailModal
          operation={operationForModal}
          open={modalOpen}
          onOpenChange={setModalOpen}
          onUpdate={handleOperationUpdate}
          onDelete={handleOperationDelete}
          materials={materials}
          vehicleTypes={vehicleTypes}
          onAssignVehicle={handleVehicleAssign}
          onRemoveVehicle={handleVehicleRemove}
        />
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNavigation currentPage="combined" hasSelectedEvent={!!selectedEvent} />

    </ProtectedRoute>
  )
}
