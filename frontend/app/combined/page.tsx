"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Badge } from "@/components/ui/badge"
import { Clock } from "lucide-react"
import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { useOperations, type Operation, type OperationStatus } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useNotifications } from "@/lib/contexts/notification-context"
import { useCommandPalette } from "@/lib/contexts/command-palette-context"
import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import { NewEmergencyModal } from "@/components/kanban/new-emergency-modal"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"
import { columns } from "@/lib/kanban-utils"
import { apiClient } from "@/lib/api-client"
import { toast } from "sonner"
import { useIsMobile } from "@/components/ui/use-mobile"

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
    removeCrew,
    removeMaterial,
    refreshOperations,
    updateOperation,
    removeVehicle,
    assignVehicleToOperation,
    deleteOperation,
    createOperation,
    getNextOperationId
  } = useOperations()
  const { selectedEvent, isEventLoaded } = useEvent()
  const { toggleSidebar: toggleNotificationSidebar } = useNotifications()
  const { registerHandlers, clearHandlers } = useCommandPalette()
  const router = useRouter()
  const isMobile = useIsMobile()

  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)
  const [hoveredOperationId, setHoveredOperationId] = useState<string | null>(null)
  const [operationForModal, setOperationForModal] = useState<Operation | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [newEmergencyModalOpen, setNewEmergencyModalOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [operationToDelete, setOperationToDelete] = useState<Operation | null>(null)
  const [vehicleTypes, setVehicleTypes] = useState<Array<{ key: string; name: string; id: string; type: string }>>([])
  const [isMounted, setIsMounted] = useState(false)
  const [mapResetTrigger, setMapResetTrigger] = useState(0)
  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [gPrefixActive, setGPrefixActive] = useState(false)
  const gPrefixTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const mapResizeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Debounced map resize trigger to prevent jitter during rapid resize events
  const triggerMapResize = useCallback(() => {
    if (mapResizeTimeoutRef.current) {
      clearTimeout(mapResizeTimeoutRef.current)
    }
    mapResizeTimeoutRef.current = setTimeout(() => {
      setMapResetTrigger(prev => prev + 1)
    }, 150) // Debounce for 150ms
  }, [])

  // Set mounted state and start clock
  useEffect(() => {
    setIsMounted(true)
    setCurrentTime(new Date())
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => {
      clearInterval(timer)
      // Clean up resize timeout on unmount
      if (mapResizeTimeoutRef.current) {
        clearTimeout(mapResizeTimeoutRef.current)
      }
    }
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
        // Sort vehicles by display_order and create vehicle types array with keyboard shortcuts
        const sortedVehicles = vehicles.sort((a, b) => a.display_order - b.display_order)
        const typesWithKeys = sortedVehicles.map((vehicle) => ({
          key: String(vehicle.display_order),
          name: vehicle.name,
          id: vehicle.id,
          type: vehicle.type
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

  // Move operation to next status column
  const moveOperationRight = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex < columns.length - 1) {
      const nextColumn = columns[currentColumnIndex + 1]
      const newStatus = nextColumn.status[0] as OperationStatus
      updateOperation(operationId, { status: newStatus })
    }
  }, [operations, updateOperation])

  // Move operation to previous status column
  const moveOperationLeft = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex > 0) {
      const prevColumn = columns[currentColumnIndex - 1]
      const newStatus = prevColumn.status[0] as OperationStatus
      updateOperation(operationId, { status: newStatus })
    }
  }, [operations, updateOperation])

  // Register command palette handlers
  useEffect(() => {
    registerHandlers({
      onNewOperation: () => setNewEmergencyModalOpen(true),
      onRefresh: () => {
        refreshOperations()
        toast.success("Daten aktualisiert")
      },
      onToggleNotifications: toggleNotificationSidebar,
      hasSelectedIncident: !!hoveredOperationId,
      onEditIncident: () => {
        if (hoveredOperationId) {
          const operation = operations.find(op => op.id === hoveredOperationId)
          if (operation) {
            setOperationForModal(operation)
            setModalOpen(true)
          }
        }
      },
      onDeleteIncident: () => {
        if (hoveredOperationId) {
          const operation = operations.find(op => op.id === hoveredOperationId)
          if (operation) {
            setOperationToDelete(operation)
            setDeleteDialogOpen(true)
          }
        }
      },
      onMoveStatusForward: () => {
        if (hoveredOperationId) {
          moveOperationRight(hoveredOperationId)
        }
      },
      onMoveStatusBackward: () => {
        if (hoveredOperationId) {
          moveOperationLeft(hoveredOperationId)
        }
      },
      onSetPriority: (priority) => {
        if (hoveredOperationId) {
          updateOperation(hoveredOperationId, { priority })
        }
      },
      onAssignVehicle: (vehicleNumber) => {
        if (hoveredOperationId) {
          const vehicleType = vehicleTypes[vehicleNumber - 1]
          if (vehicleType) {
            const operation = operations.find(op => op.id === hoveredOperationId)
            if (operation) {
              const isAssigned = operation.vehicles.includes(vehicleType.name)
              if (isAssigned) {
                removeVehicle(hoveredOperationId, vehicleType.name)
              } else {
                assignVehicleToOperation(vehicleType.id, vehicleType.name, hoveredOperationId)
              }
            }
          }
        }
      },
    })
    return () => clearHandlers()
  }, [
    registerHandlers,
    clearHandlers,
    refreshOperations,
    toggleNotificationSidebar,
    hoveredOperationId,
    operations,
    vehicleTypes,
    moveOperationRight,
    moveOperationLeft,
    updateOperation,
    removeVehicle,
    assignVehicleToOperation,
  ])

  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Esc to blur search input or cancel g-prefix mode
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

      // Ignore other shortcuts if typing in input/textarea
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
          router.push('/map')
          return
        } else if (e.key === 'e' || e.key === 'E') {
          router.push('/events')
          return
        } else if (e.key === 'c' || e.key === 'C') {
          // Already on combined, do nothing
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

      // Arrow key navigation between operations
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const allOps = operations
        if (allOps.length === 0) return

        if (!hoveredOperationId) {
          // No operation selected, select first
          setHoveredOperationId(allOps[0].id)
          return
        }

        const currentIndex = allOps.findIndex(op => op.id === hoveredOperationId)
        if (currentIndex === -1) {
          setHoveredOperationId(allOps[0].id)
          return
        }

        if (e.key === 'ArrowUp') {
          // Move to previous operation
          const newIndex = currentIndex > 0 ? currentIndex - 1 : allOps.length - 1
          setHoveredOperationId(allOps[newIndex].id)
        } else {
          // Move to next operation
          const newIndex = currentIndex < allOps.length - 1 ? currentIndex + 1 : 0
          setHoveredOperationId(allOps[newIndex].id)
        }
        return
      }

      // Tab navigation - cycle through all operations
      if (e.key === 'Tab') {
        e.preventDefault()
        const allOps = operations
        if (allOps.length === 0) return

        if (!hoveredOperationId) {
          setHoveredOperationId(allOps[0].id)
          return
        }

        const currentIndex = allOps.findIndex(op => op.id === hoveredOperationId)
        const newIndex = (currentIndex + 1) % allOps.length
        setHoveredOperationId(allOps[newIndex].id)
        return
      }

      // Vehicle assignment shortcuts (1-5) - works on hovered operation
      const vehicleShortcut = vehicleTypes.find(vt => vt.key === e.key)
      if (vehicleShortcut && hoveredOperationId) {
        const operation = operations.find(op => op.id === hoveredOperationId)
        if (operation) {
          // Check if vehicle is already assigned
          const isAssigned = operation.vehicles.includes(vehicleShortcut.name)
          if (isAssigned) {
            // Unassign the vehicle
            removeVehicle(hoveredOperationId, vehicleShortcut.name)
          } else {
            // Assign the vehicle
            assignVehicleToOperation(vehicleShortcut.id, vehicleShortcut.name, hoveredOperationId)
          }
        }
        return
      }

      // Priority assignment shortcuts (Shift+1-3) - works on hovered operation
      if (e.shiftKey && hoveredOperationId) {
        if (e.key === '1' || e.key === '!') {
          e.preventDefault()
          updateOperation(hoveredOperationId, { priority: 'low' })
          return
        } else if (e.key === '2' || e.key === '@') {
          e.preventDefault()
          updateOperation(hoveredOperationId, { priority: 'medium' })
          return
        } else if (e.key === '3' || e.key === '#') {
          e.preventDefault()
          updateOperation(hoveredOperationId, { priority: 'high' })
          return
        }
      }

      // Navigation shortcuts - works on hovered operation
      if (e.key === '>' || e.key === '.') {
        e.preventDefault()
        if (hoveredOperationId) {
          moveOperationRight(hoveredOperationId)
        }
      } else if (e.key === '<' || e.key === ',') {
        e.preventDefault()
        if (hoveredOperationId) {
          moveOperationLeft(hoveredOperationId)
        }
      } else if (e.key === '/') {
        e.preventDefault()
        document.getElementById('personnel-search-input')?.focus()
      } else if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        document.getElementById('personnel-search-input')?.focus()
      } else if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        document.getElementById('material-search-input')?.focus()
      } else if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setNewEmergencyModalOpen(true)
      } else if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey) {
        // Toggle notification sidebar
        e.preventDefault()
        toggleNotificationSidebar()
      } else if (((e.key === 'e' || e.key === 'E') && !e.metaKey && !e.ctrlKey) || e.key === 'Enter') {
        // Open detail modal for hovered operation
        if (hoveredOperationId) {
          const operation = operations.find(op => op.id === hoveredOperationId)
          if (operation) {
            e.preventDefault()
            setOperationForModal(operation)
            setModalOpen(true)
          }
        }
      } else if ((e.key === 'r' || e.key === 'R' || e.key === 'F5') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        refreshOperations()
        toast.success("Daten aktualisiert")
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete hovered operation with confirmation dialog
        if (hoveredOperationId) {
          const operation = operations.find(op => op.id === hoveredOperationId)
          if (operation) {
            e.preventDefault()
            setOperationToDelete(operation)
            setDeleteDialogOpen(true)
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
      // Clean up timeout on unmount
      if (gPrefixTimeoutRef.current) {
        clearTimeout(gPrefixTimeoutRef.current)
      }
    }
  }, [hoveredOperationId, moveOperationLeft, moveOperationRight, operations, vehicleTypes, removeVehicle, assignVehicleToOperation, updateOperation, refreshOperations, gPrefixActive, router, toggleNotificationSidebar])

  // Active operations (excluding completed)
  const activeOperations = operations.filter((op) => op.status !== "complete")

  const handleDetailsClick = (operation: Operation) => {
    setOperationForModal(operation)
    setModalOpen(true)
  }

  const handleMapMarkerClick = (operationId: string) => {
    setSelectedOperationId(operationId)
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

  // Handle operation deletion from keyboard shortcut
  const handleDeleteOperationConfirm = async () => {
    if (!operationToDelete) return
    try {
      await deleteOperation(operationToDelete.id)
      toast.success("Einsatz gelöscht")
    } catch (error) {
      console.error('Failed to delete operation:', error)
      toast.error("Fehler beim Löschen")
    } finally {
      setOperationToDelete(null)
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
        <header className="flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-6 py-4 min-h-20">
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
            {/* Clock */}
            {!isMobile && (
              <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-4 py-2.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-lg font-semibold tabular-nums">
                  {isMounted && currentTime ? currentTime.toLocaleTimeString("de-DE") : "--:--:--"}
                </span>
              </div>
            )}
            {/* Desktop Navigation */}
            {!isMobile && (
              <PageNavigation currentPage="combined" hasSelectedEvent={!!selectedEvent} />
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden p-4">
          <ResizablePanelGroup
            direction="horizontal"
            className="h-full gap-4"
            onLayout={triggerMapResize}
          >
            {/* Kanban Board Panel - 60% default */}
            <ResizablePanel defaultSize={60} minSize={30}>
              <div className="h-full rounded-lg border border-border bg-card/30 backdrop-blur-sm overflow-hidden">
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
              onResize={triggerMapResize}
            >
              <div className="h-full rounded-lg border border-border overflow-hidden">
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
          onRemoveCrew={removeCrew}
          onRemoveMaterial={removeMaterial}
        />

        {/* New Emergency Modal */}
        <NewEmergencyModal
          open={newEmergencyModalOpen}
          onOpenChange={setNewEmergencyModalOpen}
          onCreateOperation={createOperation}
          nextOperationId={getNextOperationId()}
        />

        {/* Delete Operation Confirmation Dialog */}
        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          title="Einsatz löschen"
          description={`Sind Sie sicher, dass Sie den Einsatz "${operationToDelete?.location}" löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`}
          onConfirm={handleDeleteOperationConfirm}
        />
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNavigation currentPage="combined" hasSelectedEvent={!!selectedEvent} />

    </ProtectedRoute>
  )
}
