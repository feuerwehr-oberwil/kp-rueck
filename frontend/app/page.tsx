"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, Plus, Clock, Package, QrCode, Copy, Check, Sparkles, ClipboardCheck, Truck } from 'lucide-react'
import { Kbd } from "@/components/ui/kbd"
import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useOperations, type Person, type Operation, type Material, type PersonRole, type OperationStatus } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { apiClient } from "@/lib/api-client"
import { QRCodeSVG } from 'qrcode.react'
import { useRekoNotifications } from "@/lib/hooks/use-reko-notifications"
import { useNotifications } from "@/lib/contexts/notification-context"
import { useOperationHandlers } from "@/lib/hooks/use-operation-handlers"
import { useKanbanDragDrop } from "@/lib/hooks/use-kanban-drag-drop"
import { useResourceFiltering } from "@/lib/hooks/use-resource-filtering"
import { useCommandPalette } from "@/lib/contexts/command-palette-context"
import { columns } from "@/lib/kanban-utils"
import { incidentTypeKeys, getIncidentTypeLabel } from "@/lib/incident-types"
import { DraggablePerson } from "@/components/kanban/draggable-person"
import { DraggableMaterial } from "@/components/kanban/draggable-material"
import { DroppableColumn } from "@/components/kanban/droppable-column"
import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import { ResourceAssignmentDialog } from "@/components/kanban/resource-assignment-dialog"
import { NewEmergencyModal } from "@/components/kanban/new-emergency-modal"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"
import { useIsMobile } from "@/components/ui/use-mobile"
import { EventSetupChecklist } from "@/components/event-setup-checklist"
import { KanbanLoading } from "@/components/kanban/kanban-loading"
import { PersonnelSidebarLoading, MaterialSidebarLoading } from "@/components/kanban/sidebar-loading"
import { VehicleStatusSheet } from "@/components/vehicle-status-sheet"
import { EventSelectionEmptyState } from "@/components/empty-states/event-selection-empty-state"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { MobileIncidentListView } from "@/components/mobile/mobile-incident-list-view"

export default function FireStationDashboard() {
  const {
    personnel,
    materials,
    operations,
    setOperations,
    formatLocation,
    refreshOperations,
    removeCrew,
    removeMaterial,
    removeVehicle,
    updateOperation,
    createOperation,
    getNextOperationId,
    assignPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    deleteOperation,
    isLoading
  } = useOperations()

  const { selectedEvent, isEventLoaded } = useEvent()
  const { toggleSidebar: toggleNotificationSidebar } = useNotifications()
  const { registerHandlers, clearHandlers } = useCommandPalette()
  const searchParams = useSearchParams()
  const router = useRouter()
  const highlightParam = searchParams.get("highlight")
  const isMobile = useIsMobile()

  // Enable reko notifications for all incidents with modal opening support
  const handleOpenIncidentFromNotification = useCallback((incidentId: string) => {
    const operation = operations.find(op => op.id === incidentId)
    if (operation) {
      setSelectedOperation(operation)
      setDetailModalOpen(true)
    }
  }, [operations])

  // Update operation REKO summary when new report arrives
  const handleUpdateOperationReko = useCallback((incidentId: string, rekoSummary: {
    isRelevant: boolean
    hasDangers: boolean
    dangerTypes: string[]
    personnelCount: number | null
    estimatedDuration: number | null
  }) => {
    setOperations(prev => prev.map(op =>
      op.id === incidentId
        ? { ...op, hasCompletedReko: true, rekoSummary }
        : op
    ))
  }, [setOperations])

  useRekoNotifications(operations, handleOpenIncidentFromNotification, handleUpdateOperationReko)

  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState("")
  const [materialSearchQuery, setMaterialSearchQuery] = useState("")
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [newEmergencyModalOpen, setNewEmergencyModalOpen] = useState(false)
  const [hoveredOperationId, setHoveredOperationId] = useState<string | null>(null)
  const [highlightedOperationId, setHighlightedOperationId] = useState<string | null>(null)
  const [draggingItem, setDraggingItem] = useState<Person | Material | Operation | null>(null)
  const [vehicleTypes, setVehicleTypes] = useState<Array<{ key: string; name: string; id: string; type: string }>>([])
  const [showLeftSidebar, setShowLeftSidebar] = useState(true)
  const [showRightSidebar, setShowRightSidebar] = useState(true)
  const [qrDialogOpen, setQrDialogOpen] = useState(false)
  const [checkInUrl, setCheckInUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [gPrefixActive, setGPrefixActive] = useState(false)
  const gPrefixTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [vehicleStatusSheetOpen, setVehicleStatusSheetOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [operationToDelete, setOperationToDelete] = useState<Operation | null>(null)
  const [showMeldung, setShowMeldung] = useState(false)

  // Resource assignment dialog state
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false)
  const [assignmentResourceType, setAssignmentResourceType] = useState<'crew' | 'vehicles' | 'materials' | null>(null)
  const [assignmentOperationId, setAssignmentOperationId] = useState<string | null>(null)


  // Use ref to track drag state more reliably
  const isDraggingOperationRef = useRef(false)

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
      onToggleLeftSidebar: () => setShowLeftSidebar(prev => !prev),
      onToggleRightSidebar: () => setShowRightSidebar(prev => !prev),
      onToggleVehicleStatus: () => setVehicleStatusSheetOpen(prev => !prev),
      onToggleNotifications: toggleNotificationSidebar,
      onSearchPersonnel: () => {
        setShowLeftSidebar(true)
        // Focus after sidebar opens
        setTimeout(() => document.getElementById('personnel-search-input')?.focus(), 100)
      },
      onSearchMaterial: () => {
        setShowRightSidebar(true)
        // Focus after sidebar opens
        setTimeout(() => document.getElementById('material-search-input')?.focus(), 100)
      },
      hasSelectedIncident: !!hoveredOperationId,
      onEditIncident: () => {
        if (hoveredOperationId) {
          const operation = operations.find(op => op.id === hoveredOperationId)
          if (operation) {
            setSelectedOperation(operation)
            setDetailModalOpen(true)
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

  useEffect(() => {
    setIsMounted(true)
    setCurrentTime(new Date())
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Hide sidebars on mobile by default
  useEffect(() => {
    if (isMobile) {
      setShowLeftSidebar(false)
      setShowRightSidebar(false)
    }
  }, [isMobile])

  // Show empty state if no event is selected (removed automatic redirect)
  // useEffect(() => {
  //   if (isMounted && isEventLoaded && !selectedEvent) {
  //     router.push('/events')
  //   }
  // }, [isMounted, isEventLoaded, selectedEvent, router])

  // Checklist popover state and completion tracking
  const [checklistPopoverOpen, setChecklistPopoverOpen] = useState(false)
  const [allChecklistTasksComplete, setAllChecklistTasksComplete] = useState(false)
  const [checklistLoaded, setChecklistLoaded] = useState(false)

  // Auto-open checklist for events < 2 hours old (every time, no localStorage)
  useEffect(() => {
    if (!selectedEvent || !isMounted || allChecklistTasksComplete) return

    // Check if event is less than 2 hours old
    const eventCreatedAt = new Date(selectedEvent.created_at)
    const now = new Date()
    const ageInMinutes = (now.getTime() - eventCreatedAt.getTime()) / (1000 * 60)

    if (ageInMinutes < 120) {
      // Auto-open checklist for new events (< 2 hours)
      setChecklistPopoverOpen(true)
    }
  }, [selectedEvent, isMounted, allChecklistTasksComplete])

  // Load vehicles from API to populate vehicle types for shortcuts
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

  // Refresh operations immediately when Kanban page loads
  useEffect(() => {
    refreshOperations()
  }, [])


  // Just highlight the operation from the map, don't auto-open modal
  useEffect(() => {
    if (highlightParam) {
      setHighlightedOperationId(highlightParam)
      // Clear highlight after 3 seconds
      const timer = setTimeout(() => setHighlightedOperationId(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [highlightParam])

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
          // Already on Kanban, do nothing (or could show a toast)
          return
        } else if (e.key === 'm' || e.key === 'M') {
          router.push('/map')
          return
        } else if (e.key === 'e' || e.key === 'E') {
          router.push('/events')
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
      // Toggle vehicle assignment: assign if not assigned, unassign if assigned
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
        document.getElementById('search-input')?.focus()
      } else if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys (allows cmd+p/ctrl+p for print)
        e.preventDefault()
        setShowLeftSidebar(true)
        setTimeout(() => document.getElementById('personnel-search-input')?.focus(), 100)
      } else if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys (allows cmd+m for minimize on Mac)
        e.preventDefault()
        setShowRightSidebar(true)
        setTimeout(() => document.getElementById('material-search-input')?.focus(), 100)
      } else if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) {
        // Toggle vehicle status sheet
        e.preventDefault()
        setVehicleStatusSheetOpen(prev => !prev)
      } else if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys (allows cmd+n/ctrl+n for new window)
        e.preventDefault()
        setNewEmergencyModalOpen(true)
      } else if (e.key === '[') {
        e.preventDefault()
        setShowLeftSidebar(prev => !prev)
      } else if (e.key === ']') {
        e.preventDefault()
        setShowRightSidebar(prev => !prev)
      } else if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey) {
        // Toggle notification sidebar
        e.preventDefault()
        toggleNotificationSidebar()
      } else if (((e.key === 'e' || e.key === 'E') && !e.metaKey && !e.ctrlKey) || e.key === 'Enter') {
        // Open detail modal for hovered operation
        // Only use 'e' if no modifier keys (Enter always works)
        if (hoveredOperationId) {
          const operation = operations.find(op => op.id === hoveredOperationId)
          if (operation) {
            e.preventDefault()
            setSelectedOperation(operation)
            setDetailModalOpen(true)
          }
        }
      } else if ((e.key === 'r' || e.key === 'R' || e.key === 'F5') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys are pressed
        // This allows cmd+r / ctrl+r to work normally for browser refresh
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
  }, [hoveredOperationId, moveOperationLeft, moveOperationRight, operations, vehicleTypes, removeVehicle, assignVehicleToOperation, updateOperation, refreshOperations, gPrefixActive, router, deleteOperation])

  // Use shared drag-and-drop hook
  useKanbanDragDrop({
    isMounted,
    operations,
    setOperations,
    updateOperation,
    assignPersonToOperation,
    assignMaterialToOperation,
    setDraggingItem,
  })

  // Use shared resource filtering hook
  const { filteredPersonnel, filteredMaterials, groupedPersonnel, groupedMaterials } = useResourceFiltering(
    personnel,
    materials,
    personnelSearchQuery,
    materialSearchQuery
  )

  // Memoize filtered operations to avoid unnecessary recalculations on every render
  const filteredOperations = useMemo(() => {
    if (!searchQuery.trim()) {
      return operations
    }

    const query = searchQuery.toLowerCase()

    return operations.filter((op) => {
      // Search through all relevant fields
      return (
        // Location
        op.location.toLowerCase().includes(query) ||
        // Incident type
        op.incidentType.toLowerCase().includes(query) ||
        getIncidentTypeLabel(op.incidentType).toLowerCase().includes(query) ||
        // Priority
        op.priority.toLowerCase().includes(query) ||
        // Vehicles (legacy field and array)
        (op.vehicle && op.vehicle.toLowerCase().includes(query)) ||
        op.vehicles.some(v => v.toLowerCase().includes(query)) ||
        // Crew members
        op.crew.some(crew => crew.toLowerCase().includes(query)) ||
        // Materials
        op.materials.some(materialId => {
          const material = materials.find(m => m.id === materialId)
          return material && material.name.toLowerCase().includes(query)
        }) ||
        // Notes
        op.notes.toLowerCase().includes(query) ||
        // Contact
        op.contact.toLowerCase().includes(query) ||
        // Status
        op.status.toLowerCase().includes(query)
      )
    })
  }, [operations, searchQuery, materials])

  const handlePersonClick = async (person: Person) => {
    if (person.status === "assigned") {
      // First try to find operation where person is directly assigned to crew
      let assignedOp = operations.find(op => op.crew.includes(person.name))

      // If not found directly assigned, check if they're a driver for a vehicle
      if (!assignedOp && selectedEvent) {
        try {
          const specialFunctions = await apiClient.getPersonnelSpecialFunctions(selectedEvent.id, person.id)
          const driverFunction = specialFunctions.find(f => f.function_type === 'driver')

          if (driverFunction && driverFunction.vehicle_name) {
            // Find operation that has this vehicle assigned
            assignedOp = operations.find(op => op.vehicles.includes(driverFunction.vehicle_name!))
          }
        } catch (error) {
          console.error('Failed to load special functions for personnel:', error)
        }
      }

      if (assignedOp) {
        setHighlightedOperationId(assignedOp.id)
        setTimeout(() => setHighlightedOperationId(null), 3000)
      }
    }
  }

  const handleMaterialClick = (material: Material) => {
    if (material.status === "assigned") {
      // Find the operation this material is assigned to
      const assignedOp = operations.find(op => op.materials.includes(material.id))
      if (assignedOp) {
        setHighlightedOperationId(assignedOp.id)
        setTimeout(() => setHighlightedOperationId(null), 3000)
      }
    }
  }

  // Use shared operation handlers hook
  const { handleOperationUpdate, handleVehicleRemove, handleVehicleAssign, handleOperationDelete } = useOperationHandlers({
    selectedOperation,
    setSelectedOperation,
    updateOperation,
    removeVehicle,
    assignVehicleToOperation,
    deleteOperation,
  })

  const handleCardClick = (operation: Operation) => {
    // Don't open modal if we just finished dragging
    if (isDraggingOperationRef.current) {
      return
    }
    setSelectedOperation(operation)
    setHoveredOperationId(operation.id) // Set hovered ID so keyboard shortcuts work on this operation
    setDetailModalOpen(true)
  }

  const generateCheckInQR = async () => {
    if (!selectedEvent) {
      toast.error('Fehler', {
        description: 'Bitte wählen Sie zuerst ein Ereignis aus.',
      })
      return
    }

    try {
      const response = await apiClient.generateCheckInLink(selectedEvent.id)
      // Build full URL for QR code
      const fullUrl = `${window.location.origin}${response.link}`
      setCheckInUrl(fullUrl)
      setQrDialogOpen(true)
    } catch (error) {
      console.error('Failed to generate check-in link:', error)
      toast.error('Fehler', {
        description: 'QR-Code konnte nicht generiert werden. Bitte versuchen Sie es erneut.',
      })
    }
  }

  const copyCheckInUrlToClipboard = async () => {
    if (!checkInUrl) return

    try {
      await navigator.clipboard.writeText(checkInUrl)
      setCopied(true)
      toast.success('Link kopiert')
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      toast.error('Fehler beim Kopieren')
    }
  }

  // Handle resource assignment dialog
  const handleOpenAssignmentDialog = (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string) => {
    setAssignmentResourceType(resourceType)
    setAssignmentOperationId(operationId)
    setAssignmentDialogOpen(true)
  }

  // Get assigned resources for selected operation
  const getAssignedResourcesForOperation = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) {
      return {
        assignedPersonnel: [],
        assignedVehicles: [],
        assignedMaterials: []
      }
    }

    return {
      assignedPersonnel: operation.crew,
      assignedVehicles: operation.vehicles,
      assignedMaterials: operation.materials
    }
  }

  const assignedResources = assignmentOperationId
    ? getAssignedResourcesForOperation(assignmentOperationId)
    : { assignedPersonnel: [], assignedVehicles: [], assignedMaterials: [] }

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

  // Don't render drag and drop until client-side to avoid hydration errors
  if (!isMounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    )
  }

  // Show empty state if no event is selected (after loading)
  if (isMounted && isEventLoaded && !selectedEvent) {
    return (
      <ProtectedRoute>
        <EventSelectionEmptyState />
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-4 md:px-6 py-4 min-h-20">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {selectedEvent ? (
              <>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight truncate">{selectedEvent.name}</h1>
                {selectedEvent.training_flag && (
                  <Badge variant="secondary" className="hidden sm:inline-flex flex-shrink-0">Übung</Badge>
                )}
              </>
            ) : (
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-muted-foreground truncate">Kein Ereignis ausgewählt</h1>
            )}
          </div>

          {/* Desktop Navigation */}
          {!isMobile && (
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search-input"
                  type="text"
                  placeholder="Suchen..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-72 pl-9"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <Kbd>/</Kbd>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-4 py-2.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-lg font-semibold tabular-nums">
                  {isMounted && currentTime ? currentTime.toLocaleTimeString("de-DE") : "--:--:--"}
                </span>
              </div>

              <PageNavigation
                currentPage="kanban"
                vehicleTypes={vehicleTypes}
                hasSelectedEvent={!!selectedEvent}
              />
            </div>
          )}
        </header>

        {/* Mobile View */}
        {isMobile ? (
          <MobileIncidentListView
            operations={filteredOperations}
            materials={materials}
            formatLocation={formatLocation}
            onRefresh={refreshOperations}
            onNewEmergency={() => setNewEmergencyModalOpen(true)}
            onCheckIn={generateCheckInQR}
            onVehicleStatus={() => setVehicleStatusSheetOpen(true)}
            isTraining={selectedEvent?.training_flag}
            isLoading={isLoading}
          />
        ) : (
          /* Desktop View */
          <>
        <div className="flex flex-1 overflow-hidden">
          {showLeftSidebar && (
            <aside className="w-64 border-r border-border bg-card/30 backdrop-blur-sm flex flex-col">
              {/* Sticky header */}
              <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm p-4 pb-0">
                <div className="mb-4">
                  <h2 className="text-base font-bold text-foreground">Verfügbare Personen</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {personnel.filter((p) => p.status === "available").length} von {personnel.length} verfügbar
                  </p>
                </div>

                <div className="relative mb-4">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="personnel-search-input"
                    type="text"
                    placeholder="Suchen..."
                    value={personnelSearchQuery}
                    onChange={(e) => setPersonnelSearchQuery(e.target.value)}
                    className="h-8 pl-7 pr-8 text-xs"
                  />
                  {!isMobile && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                      <Kbd className="h-5 text-xs">P</Kbd>
                    </div>
                  )}
                </div>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-4 pt-0">
                {isLoading ? (
                  <PersonnelSidebarLoading />
                ) : personnel.filter((p) => p.status === "available").length === 0 ? (
                  /* Show QR code when no available personnel */
                  <div className="flex flex-col items-center gap-3 py-4">
                    <p className="text-sm text-muted-foreground text-center">
                      Keine Personen verfügbar
                    </p>
                    {checkInUrl ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="rounded-lg border p-2 bg-white">
                          <QRCodeSVG
                            value={checkInUrl}
                            size={120}
                            level="M"
                            includeMargin={false}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground text-center">
                          Check-In QR-Code scannen
                        </p>
                      </div>
                    ) : selectedEvent ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            const response = await apiClient.generateCheckInLink(selectedEvent.id)
                            const fullUrl = `${window.location.origin}${response.link}`
                            setCheckInUrl(fullUrl)
                          } catch (error) {
                            toast.error('Fehler', {
                              description: 'QR-Code konnte nicht generiert werden.',
                            })
                          }
                        }}
                      >
                        <QrCode className="h-4 w-4 mr-2" />
                        QR-Code anzeigen
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.keys(groupedPersonnel).map((role) => (
                      <div key={role}>
                        <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{role}</h3>
                        <div className="space-y-2">
                          {groupedPersonnel[role as PersonRole]?.map((person) => (
                            <DraggablePerson
                              key={person.id}
                              person={person}
                              onClick={() => handlePersonClick(person)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          )}

          {/* Main Kanban Board */}
          <main className="flex-1 overflow-x-auto p-4 bg-zinc-950/20">
            {isLoading ? (
              <KanbanLoading />
            ) : (
              <div className="flex h-full gap-4">
                {columns.map((column) => {
                  const columnOps = filteredOperations.filter((op) => column.status.includes(op.status))
                  return (
                    <DroppableColumn
                      key={column.id}
                      column={column}
                      operations={columnOps}
                      onRemoveCrew={removeCrew}
                      onRemoveMaterial={removeMaterial}
                      onRemoveVehicle={removeVehicle}
                      onCardClick={handleCardClick}
                      onCardHover={setHoveredOperationId}
                      highlightedOperationId={highlightedOperationId}
                      hoveredOperationId={hoveredOperationId}
                      isDraggingRef={isDraggingOperationRef}
                      materials={materials}
                      formatLocation={formatLocation}
                      onAssignResource={handleOpenAssignmentDialog}
                      showMeldung={showMeldung}
                    />
                  )
                })}
              </div>
            )}
          </main>

          {showRightSidebar && (
            <aside className="w-64 border-l border-border bg-card/30 backdrop-blur-sm flex flex-col">
              {/* Sticky header */}
              <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm p-4 pb-0">
                <div className="mb-4">
                  <h2 className="text-base font-bold text-foreground">Verfügbares Material</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {materials.filter((m) => m.status === "available").length} von {materials.length} verfügbar
                  </p>
                </div>

                <div className="relative mb-4">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="material-search-input"
                    type="text"
                    placeholder="Suchen..."
                    value={materialSearchQuery}
                    onChange={(e) => setMaterialSearchQuery(e.target.value)}
                    className="h-8 pl-7 pr-8 text-xs"
                  />
                  {!isMobile && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                      <Kbd className="h-5 text-xs">M</Kbd>
                    </div>
                  )}
                </div>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-4 pt-0">
                {isLoading ? (
                  <MaterialSidebarLoading />
                ) : (
                  <div className="space-y-4">
                    {Object.entries(groupedMaterials).map(([category, items]) => (
                      <div key={category}>
                        <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{category}</h3>
                        <div className="space-y-2">
                          {items.map((material) => (
                            <DraggableMaterial
                              key={material.id}
                              material={material}
                              onClick={() => handleMaterialClick(material)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>

        <footer className="border-t border-border bg-card/50 backdrop-blur-sm px-4 md:px-6 py-3 pb-20 md:pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" className="gap-2" onClick={() => setNewEmergencyModalOpen(true)}>
                <Plus className="h-4 w-4" />
                Neuer Einsatz
              </Button>

              {/* Event Setup Checklist Popover - only show if loaded and not all complete */}
              {checklistLoaded && !allChecklistTasksComplete && (
                <Popover open={checklistPopoverOpen} onOpenChange={setChecklistPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-2" disabled={!selectedEvent}>
                      <ClipboardCheck className="h-4 w-4" />
                      Bereitschaft
                    </Button>
                  </PopoverTrigger>
                  {selectedEvent && (
                    <PopoverContent
                      className="w-[600px] p-0"
                      align="start"
                      side="top"
                      sideOffset={10}
                    >
                      <EventSetupChecklist
                        eventId={selectedEvent.id}
                        eventName={selectedEvent.name}
                        onDismiss={() => setChecklistPopoverOpen(false)}
                        onAllTasksComplete={() => {
                          setAllChecklistTasksComplete(true)
                          setChecklistPopoverOpen(false)
                        }}
                        onChecklistLoaded={() => setChecklistLoaded(true)}
                      />
                    </PopoverContent>
                  )}
                </Popover>
              )}

              <Button size="sm" variant="outline" className="gap-2" onClick={generateCheckInQR}>
                <QrCode className="h-4 w-4" />
                Check-In
              </Button>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => setVehicleStatusSheetOpen(true)} disabled={!selectedEvent}>
                <Truck className="h-4 w-4" />
                Fahrzeugstatus
              </Button>
              {selectedEvent?.training_flag && (
                <Link href="/training">
                  <Button size="sm" variant="outline" className="gap-2">
                    <Sparkles className="h-4 w-4 text-orange-500" />
                    Übungs-Steuerung
                  </Button>
                </Link>
              )}
              <div className="flex items-center gap-2">
                <Switch
                  id="show-meldung"
                  checked={showMeldung}
                  onCheckedChange={setShowMeldung}
                />
                <Label htmlFor="show-meldung" className="text-sm cursor-pointer">
                  Meldung
                </Label>
              </div>
            </div>


            {!isMobile && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Kbd className="h-4 text-[10px]">⌘K</Kbd>
                <span>oder</span>
                <Kbd className="h-4 text-[10px]">?</Kbd>
                <span>Befehle & Hilfe</span>
              </div>
            )}
          </div>
        </footer>
          </>
        )}
      </div>

      {/* Drag Preview Overlay */}
      {draggingItem && (
        <div
          style={{
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: 9999,
            left: 0,
            top: 0,
          }}
        >
          {"role" in draggingItem ? (
            <Card className="cursor-move border border-primary bg-card p-3 shadow-2xl opacity-80">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-medium text-sm text-foreground">{draggingItem.name}</span>
              </div>
            </Card>
          ) : "category" in draggingItem ? (
            <Card className="cursor-move border border-primary bg-card p-3 shadow-2xl opacity-80">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm text-foreground">{draggingItem.name}</span>
              </div>
            </Card>
          ) : (
            <Card className="cursor-move border-2 border-primary p-4 shadow-2xl bg-zinc-800/90 backdrop-blur opacity-80">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">{draggingItem.location}</span>
              </div>
            </Card>
          )}
        </div>
      )}

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
        onAssignResource={handleOpenAssignmentDialog}
        onRemoveCrew={removeCrew}
        onRemoveMaterial={removeMaterial}
      />

      <NewEmergencyModal
        open={newEmergencyModalOpen}
        onOpenChange={setNewEmergencyModalOpen}
        onCreateOperation={createOperation}
        nextOperationId={getNextOperationId()}
      />

      {/* Resource Assignment Dialog */}
      <ResourceAssignmentDialog
        open={assignmentDialogOpen}
        onOpenChange={setAssignmentDialogOpen}
        resourceType={assignmentResourceType}
        operationId={assignmentOperationId}
        personnel={personnel}
        vehicles={vehicleTypes}
        materials={materials}
        assignedPersonnel={assignedResources.assignedPersonnel}
        assignedVehicles={assignedResources.assignedVehicles}
        assignedMaterials={assignedResources.assignedMaterials}
        onAssignPerson={assignPersonToOperation}
        onAssignVehicle={assignVehicleToOperation}
        onAssignMaterial={assignMaterialToOperation}
        onRemovePerson={removeCrew}
        onRemoveVehicle={removeVehicle}
        onRemoveMaterial={removeMaterial}
      />


      {/* QR Code Dialog */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Personal Check-In</DialogTitle>
            <DialogDescription>
              QR-Code scannen oder Link teilen für mobilen Zugriff
            </DialogDescription>
          </DialogHeader>
          {checkInUrl && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="rounded-lg border p-4 bg-white">
                <QRCodeSVG
                  value={checkInUrl}
                  size={200}
                  level="M"
                  includeMargin
                />
              </div>

              <div className="w-full">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={checkInUrl}
                    readOnly
                    className="flex-1 rounded-md border px-3 py-2 text-sm bg-muted"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={copyCheckInUrlToClipboard}
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Dieser Link ermöglicht den Zugriff auf das Check-In ohne Anmeldung
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Vehicle Status Sheet */}
      <VehicleStatusSheet
        open={vehicleStatusSheetOpen}
        onOpenChange={setVehicleStatusSheetOpen}
        eventId={selectedEvent?.id || null}
      />

      {/* Delete Operation Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Einsatz löschen"
        description={`Sind Sie sicher, dass Sie den Einsatz "${operationToDelete?.location}" löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`}
        onConfirm={handleDeleteOperationConfirm}
      />

      {/* Mobile Bottom Navigation */}
      <MobileBottomNavigation currentPage="kanban" hasSelectedEvent={!!selectedEvent} onCheckIn={generateCheckInQR} />
    </ProtectedRoute>
  )
}
