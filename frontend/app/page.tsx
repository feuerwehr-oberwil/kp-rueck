"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, Plus, Clock, Package, QrCode, Copy, Check, Sparkles, ClipboardCheck, Truck, Printer, Eye } from 'lucide-react'
import { Kbd } from "@/components/ui/kbd"
import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet"
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
import { useAuth } from "@/lib/contexts/auth-context"
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
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { KanbanLoading } from "@/components/kanban/kanban-loading"
import { PersonnelSidebarLoading, MaterialSidebarLoading } from "@/components/kanban/sidebar-loading"
import { VehicleStatusSheet } from "@/components/vehicle-status-sheet"
import { EventSelectionEmptyState } from "@/components/empty-states/event-selection-empty-state"
import { SidePanel } from "@/components/kanban/side-panel"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { MobileIncidentListView } from "@/components/mobile/mobile-incident-list-view"
import { MobilePersonnelSheet } from "@/components/mobile/mobile-personnel-sheet"
import { PrintOptionsModal } from "@/components/print/print-options-modal"
import { ThermoOptionsSheet, type ThermoPrintOptions } from "@/components/print/thermo-options-sheet"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"
import { DisponierTransitionDialog } from "@/components/kanban/disponiert-transition-dialog"

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
    removeReko,
    updateOperation,
    createOperation,
    getNextOperationId,
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    deleteOperation,
    isLoading
  } = useOperations()

  const { selectedEvent, isEventLoaded } = useEvent()
  const { isEditor, isAuthenticated } = useAuth()
  const { toggleSidebar: toggleNotificationSidebar, registerNavigateHandler, closeSidebar: closeNotificationSidebar } = useNotifications()
  const { registerHandlers, clearHandlers } = useCommandPalette()
  const searchParams = useSearchParams()
  const router = useRouter()
  const highlightParam = searchParams.get("highlight")
  const isMobile = useIsMobile()

  // Ref for highlight timeout cleanup
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Scroll to and highlight a card by operation ID
  const scrollToCard = useCallback((operationId: string) => {
    // Clear any existing highlight timeout
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
    }

    // Set highlight immediately
    setHighlightedOperationId(operationId)

    // Clear highlight after 3 seconds
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedOperationId(null)
    }, 3000)

    // Scroll after short delay for DOM readiness
    setTimeout(() => {
      const card = document.querySelector(`[data-incident-id="${operationId}"]`) as HTMLElement
      if (!card) return

      const mainContainer = document.getElementById('kanban-main')
      const column = card.closest('[data-column]') as HTMLElement

      if (mainContainer && column) {
        const columnsContainer = mainContainer.querySelector('.flex.h-full') as HTMLElement
        if (columnsContainer) {
          // Calculate column position
          let columnLeft = 0
          const columns = columnsContainer.children
          for (let i = 0; i < columns.length; i++) {
            if (columns[i] === column) break
            columnLeft += (columns[i] as HTMLElement).offsetWidth + 12 // 12px = gap-3
          }

          const columnWidth = column.offsetWidth
          const containerWidth = mainContainer.clientWidth
          const scrollLeft = columnLeft - (containerWidth / 2) + (columnWidth / 2)

          mainContainer.scrollTo({
            left: Math.max(0, scrollLeft),
            behavior: 'smooth'
          })
        }
      }

      // Vertical scroll after horizontal completes
      setTimeout(() => {
        card.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        })
      }, 300)
    }, 100)
  }, [])

  // Enable reko notifications for all incidents with modal opening support
  const handleOpenIncidentFromNotification = useCallback((incidentId: string) => {
    const operation = operations.find(op => op.id === incidentId)
    if (operation) {
      setSelectedOperationId(operation.id)
      setDetailModalOpen(true)
    }
  }, [operations])

  // Register notification click → scroll to card + open detail
  useEffect(() => {
    registerNavigateHandler((incidentId: string) => {
      closeNotificationSidebar()
      scrollToCard(incidentId)
      // Open detail after scroll
      setTimeout(() => {
        const operation = operations.find(op => op.id === incidentId)
        if (operation) {
          setSelectedOperationId(incidentId)
          setPanelSelectedId(incidentId)
          setHoveredOperationId(incidentId)
          setDetailModalOpen(true)
        }
      }, 200)
    })
    return () => registerNavigateHandler(null)
  }, [registerNavigateHandler, closeNotificationSidebar, scrollToCard, operations])

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
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  // Derive current operation from operations array to get real-time updates
  const selectedOperation = useMemo(() => {
    if (!selectedOperationId) return null
    return operations.find(op => op.id === selectedOperationId) || null
  }, [selectedOperationId, operations])
  const [newEmergencyModalOpen, setNewEmergencyModalOpen] = useState(false)
  const [hoveredOperationId, setHoveredOperationId] = useState<string | null>(null)
  const [highlightedOperationId, setHighlightedOperationId] = useState<string | null>(null)
  const [draggingItem, setDraggingItem] = useState<Person | Material | Operation | null>(null)
  const [vehicleTypes, setVehicleTypes] = useState<Array<{ key: string; name: string; id: string; type: string }>>([])
  const [showLeftSidebar, setShowLeftSidebar] = useState(true)
  const [showRightSidebar, setShowRightSidebar] = useState(true)
  // Single state for footer sheets - only one can be open at a time
  const [activeFooterSheet, setActiveFooterSheet] = useState<'checkin' | 'reko' | 'viewer' | 'vehicles' | 'print' | 'thermo' | null>(null)
  const [checkInUrl, setCheckInUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [gPrefixActive, setGPrefixActive] = useState(false)
  const gPrefixTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [operationToDelete, setOperationToDelete] = useState<Operation | null>(null)
  const [showMeldung, setShowMeldung] = useState(false)
  const [rekoDashboardUrl, setRekoDashboardUrl] = useState<string | null>(null)
  const [rekoCopied, setRekoCopied] = useState(false)
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [viewerCopied, setViewerCopied] = useState(false)
  const [mobilePersonnelSheetOpen, setMobilePersonnelSheetOpen] = useState(false)
  const [disponiertDialogOp, setDisponiertDialogOp] = useState<Operation | null>(null)

  // Cross-window sync (bidirectional)
  const { broadcast } = useCrossWindowSync({
    onMessage: (msg) => {
      if (msg.type === "incident:selected" && msg.incidentId) {
        setSelectedOperationId(msg.incidentId)
        setHighlightedOperationId(msg.incidentId)
      }
    },
  })

  // Side panel state for ultrawide monitors
  const [panelSelectedId, setPanelSelectedId] = useState<string | null>(null)
  const [sidePanelMode, setSidePanelMode] = useState<'detail' | 'map' | 'collapsed'>('collapsed')
  // Derive selected operation for side panel
  const panelSelectedOperation = useMemo(() => {
    if (!panelSelectedId) return null
    return operations.find(op => op.id === panelSelectedId) || null
  }, [panelSelectedId, operations])

  // Resource assignment dialog state
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false)
  const [assignmentResourceType, setAssignmentResourceType] = useState<'crew' | 'vehicles' | 'materials' | null>(null)
  const [assignmentOperationId, setAssignmentOperationId] = useState<string | null>(null)
  const [rekoPersonnelNames, setRekoPersonnelNames] = useState<string[]>([])

  // Reko assignment dialog state (context menu)
  const [rekoAssignDialogOpen, setRekoAssignDialogOpen] = useState(false)
  const [rekoAssignOperationId, setRekoAssignOperationId] = useState<string | null>(null)

  // Thermal printer state
  const [printerEnabled, setPrinterEnabled] = useState(false)
  const [isPrintingBoard, setIsPrintingBoard] = useState(false)

  // Fetch Reko personnel names when the crew assignment dialog opens
  // These personnel should be excluded from regular crew assignment (they're Reko only)
  useEffect(() => {
    async function fetchRekoPersonnel() {
      if (!assignmentDialogOpen || assignmentResourceType !== 'crew' || !selectedEvent) {
        setRekoPersonnelNames([])
        return
      }

      try {
        const specialFunctions = await apiClient.getEventSpecialFunctions(selectedEvent.id)
        const rekoFunctions = specialFunctions.filter(f => f.function_type === 'reko')
        const names = rekoFunctions
          .map(f => {
            const person = personnel.find(p => p.id === f.personnel_id)
            return person?.name
          })
          .filter((name): name is string => name !== undefined)
        setRekoPersonnelNames(names)
      } catch (error) {
        console.error('Failed to fetch Reko personnel:', error)
        setRekoPersonnelNames([])
      }
    }

    fetchRekoPersonnel()
  }, [assignmentDialogOpen, assignmentResourceType, selectedEvent, personnel])

  // Fetch printer status once authenticated
  useEffect(() => {
    if (!isAuthenticated) return
    async function fetchPrinterStatus() {
      try {
        const status = await apiClient.getPrinterStatus()
        setPrinterEnabled(status.enabled)
      } catch {
        // Printer API might not be available (e.g., Railway deployment)
        setPrinterEnabled(false)
      }
    }
    fetchPrinterStatus()
  }, [isAuthenticated])

  // Handle thermal board print
  const handlePrintBoard = useCallback(async (options?: ThermoPrintOptions) => {
    if (!selectedEvent || isPrintingBoard) return
    setIsPrintingBoard(true)
    try {
      await apiClient.queueBoardPrint(selectedEvent.id, options ? {
        include_completed: options.includeCompleted,
        include_vehicles: options.includeVehicles,
        include_personnel: options.includePersonnel,
      } : undefined)
      toast.success('Board-Druckauftrag gesendet')
      setActiveFooterSheet(null)
    } catch {
      toast.error('Drucken fehlgeschlagen')
    } finally {
      setIsPrintingBoard(false)
    }
  }, [selectedEvent, isPrintingBoard])

  // Use ref to track drag state more reliably
  const isDraggingOperationRef = useRef(false)

  // Show disponiert transition dialog when moving to enroute
  const triggerDisponiertDialog = useCallback((operationId: string) => {
    const op = operations.find(o => o.id === operationId)
    if (op) setDisponiertDialogOp(op)
  }, [operations])

  const moveOperationRight = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex < columns.length - 1) {
      const nextColumn = columns[currentColumnIndex + 1]
      const newStatus = nextColumn.status[0] as OperationStatus
      updateOperation(operationId, { status: newStatus })
      if (newStatus === "enroute") triggerDisponiertDialog(operationId)
    }
  }, [operations, updateOperation, triggerDisponiertDialog])

  const moveOperationLeft = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex > 0) {
      const prevColumn = columns[currentColumnIndex - 1]
      const newStatus = prevColumn.status[0] as OperationStatus
      updateOperation(operationId, { status: newStatus })
      if (newStatus === "enroute") triggerDisponiertDialog(operationId)
    }
  }, [operations, updateOperation, triggerDisponiertDialog])

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
      onToggleVehicleStatus: () => setActiveFooterSheet(prev => prev === 'vehicles' ? null : 'vehicles'),
      onToggleNotifications: toggleNotificationSidebar,
      onSearchPersonnel: () => {
        setShowLeftSidebar(true)
        setTimeout(() => document.getElementById('personnel-search-input')?.focus(), 50)
      },
      onSearchMaterial: () => {
        setShowRightSidebar(true)
        setTimeout(() => document.getElementById('material-search-input')?.focus(), 50)
      },
      hasSelectedIncident: !!hoveredOperationId,
      onEditIncident: () => {
        if (hoveredOperationId) {
          const operation = operations.find(op => op.id === hoveredOperationId)
          if (operation) {
            setSelectedOperationId(operation.id)
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
      } catch {
        // Silently fail - vehicles will load when backend is ready
      }
    }
    loadVehicles()
  }, [])

  // Refresh operations immediately when Kanban page loads
  useEffect(() => {
    refreshOperations()
  }, [])


  // Scroll to and highlight operation when navigating with ?highlight= param
  useEffect(() => {
    if (highlightParam) {
      scrollToCard(highlightParam)
      // Clear the URL param to prevent re-scroll on refresh
      router.replace('/', { scroll: false })
    }
  }, [highlightParam, scrollToCard, router])

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

      // Ignore ALL shortcuts when any modal is open (let dialogs handle their own focus)
      if (detailModalOpen || newEmergencyModalOpen || assignmentDialogOpen || activeFooterSheet || deleteDialogOpen) {
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
      } else if (e.key === '/' || ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey)) {
        // S for Suche (Swiss-German keyboard friendly alternative to /)
        e.preventDefault()
        document.getElementById('search-input')?.focus()
      } else if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys (allows cmd+p/ctrl+p for print)
        e.preventDefault()
        setShowLeftSidebar(true)
        setTimeout(() => document.getElementById('personnel-search-input')?.focus(), 50)
      } else if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys (allows cmd+m for minimize on Mac)
        e.preventDefault()
        setShowRightSidebar(true)
        setTimeout(() => document.getElementById('material-search-input')?.focus(), 50)
      } else if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) {
        // Toggle vehicle status sheet
        e.preventDefault()
        setActiveFooterSheet(prev => prev === 'vehicles' ? null : 'vehicles')
      } else if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys (allows cmd+n/ctrl+n for new window)
        e.preventDefault()
        setNewEmergencyModalOpen(true)
      } else if (e.key === '[' || e.key === 'q' || e.key === 'Q') {
        // Q as Swiss-German keyboard friendly alternative to [
        e.preventDefault()
        setShowLeftSidebar(prev => !prev)
      } else if (e.key === ']' || e.key === 'w' || e.key === 'W') {
        // W as Swiss-German keyboard friendly alternative to ]
        e.preventDefault()
        setShowRightSidebar(prev => !prev)
      } else if (e.key === '\\' || e.key === 'i' || e.key === 'I') {
        // I for Info panel - Swiss-German keyboard friendly alternative to \
        e.preventDefault()
        setSidePanelMode(prev => prev === 'collapsed' ? 'detail' : 'collapsed')
      } else if ((e.key === 'd' || e.key === 'D') && !e.metaKey && !e.ctrlKey && sidePanelMode !== 'collapsed') {
        // Switch side panel to Detail view (only when panel is open)
        e.preventDefault()
        setSidePanelMode('detail')
      } else if ((e.key === 'k' || e.key === 'K') && !e.metaKey && !e.ctrlKey && sidePanelMode !== 'collapsed') {
        // Switch side panel to Karte (map) view (only when panel is open)
        e.preventDefault()
        setSidePanelMode('map')
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
            setSelectedOperationId(operation.id)
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
      // Clean up timeouts on unmount
      if (gPrefixTimeoutRef.current) {
        clearTimeout(gPrefixTimeoutRef.current)
      }
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [hoveredOperationId, moveOperationLeft, moveOperationRight, operations, vehicleTypes, removeVehicle, assignVehicleToOperation, updateOperation, refreshOperations, gPrefixActive, router, deleteOperation, detailModalOpen, newEmergencyModalOpen, assignmentDialogOpen, activeFooterSheet, deleteDialogOpen, sidePanelMode])

  // Use shared drag-and-drop hook
  useKanbanDragDrop({
    isMounted,
    operations,
    setOperations,
    updateOperation,
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    setDraggingItem,
    onOperationDrop: (operationId) => {
      // Auto-select dropped card in side panel
      setPanelSelectedId(operationId)
      setHoveredOperationId(operationId)
    },
    onStatusChange: (operationId, newStatus) => {
      if (newStatus === "enroute") triggerDisponiertDialog(operationId)
    },
  })

  // Use shared resource filtering hook — sidebar search takes priority, top search also filters
  const effectivePersonnelQuery = personnelSearchQuery || searchQuery
  const effectiveMaterialQuery = materialSearchQuery || searchQuery
  const { filteredPersonnel, filteredMaterials, groupedPersonnel, groupedMaterials } = useResourceFiltering(
    personnel,
    materials,
    effectivePersonnelQuery,
    effectiveMaterialQuery
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
        op.status.toLowerCase().includes(query) ||
        // Reko personnel
        (op.assignedReko && op.assignedReko.name.toLowerCase().includes(query)) ||
        // Reko status
        (op.hasCompletedReko && 'reko'.includes(query))
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
        scrollToCard(assignedOp.id)
      }
    }
  }

  const handleMaterialClick = (material: Material) => {
    if (material.status === "assigned") {
      // Find the operation this material is assigned to
      const assignedOp = operations.find(op => op.materials.includes(material.id))
      if (assignedOp) {
        scrollToCard(assignedOp.id)
      }
    }
  }

  // Use shared operation handlers hook
  const { handleOperationUpdate, handleVehicleRemove, handleVehicleAssign, handleOperationDelete } = useOperationHandlers({
    selectedOperation,
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
    setSelectedOperationId(operation.id)
    setHoveredOperationId(operation.id) // Set hovered ID so keyboard shortcuts work on this operation
    setDetailModalOpen(true)
    broadcast("incident:selected", operation.id)
  }

  const handleCardSelect = (operation: Operation) => {
    // Select operation for side panel view
    setPanelSelectedId(operation.id)
    setHoveredOperationId(operation.id) // Also update hovered for keyboard shortcuts
    // Auto-open side panel in detail mode if collapsed
    if (sidePanelMode === 'collapsed') {
      setSidePanelMode('detail')
    }
  }

  // Derived state for convenience
  const qrDialogOpen = activeFooterSheet === 'checkin'
  const rekoQrDialogOpen = activeFooterSheet === 'reko'
  const viewerQrDialogOpen = activeFooterSheet === 'viewer'
  const vehicleStatusSheetOpen = activeFooterSheet === 'vehicles'
  const printModalOpen = activeFooterSheet === 'print'
  const thermoSheetOpen = activeFooterSheet === 'thermo'

  const generateCheckInQR = async () => {
    // Toggle behavior: if already open, just close
    if (qrDialogOpen) {
      setActiveFooterSheet(null)
      return
    }

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
      setActiveFooterSheet('checkin')
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
      const { copyToClipboard } = await import('@/lib/utils')
      await copyToClipboard(checkInUrl)
      setCopied(true)
      toast.success('Link kopiert')
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      toast.error('Fehler beim Kopieren')
    }
  }

  const generateRekoDashboardQR = async () => {
    // Toggle behavior: if already open, just close
    if (rekoQrDialogOpen) {
      setActiveFooterSheet(null)
      return
    }

    if (!selectedEvent) {
      toast.error('Fehler', {
        description: 'Bitte wählen Sie zuerst ein Ereignis aus.',
      })
      return
    }

    try {
      const response = await apiClient.generateRekoDashboardLink(selectedEvent.id)
      // Build full URL for QR code
      const fullUrl = `${window.location.origin}${response.link}`
      setRekoDashboardUrl(fullUrl)
      setActiveFooterSheet('reko')
    } catch (error) {
      console.error('Failed to generate Reko Dashboard link:', error)
      toast.error('Fehler', {
        description: 'Reko-Link konnte nicht generiert werden. Bitte versuchen Sie es erneut.',
      })
    }
  }

  const copyRekoDashboardUrlToClipboard = async () => {
    if (!rekoDashboardUrl) return

    try {
      const { copyToClipboard } = await import('@/lib/utils')
      await copyToClipboard(rekoDashboardUrl)
      setRekoCopied(true)
      toast.success('Link kopiert')
      setTimeout(() => setRekoCopied(false), 2000)
    } catch (error) {
      toast.error('Fehler beim Kopieren')
    }
  }

  const generateViewerQR = async () => {
    // Toggle behavior: if already open, just close
    if (viewerQrDialogOpen) {
      setActiveFooterSheet(null)
      return
    }

    if (!selectedEvent) {
      toast.error('Fehler', {
        description: 'Bitte wählen Sie zuerst ein Ereignis aus.',
      })
      return
    }

    try {
      const response = await apiClient.generateViewerLink(selectedEvent.id)
      // Build full URL for QR code
      const fullUrl = `${window.location.origin}${response.link}`
      setViewerUrl(fullUrl)
      setActiveFooterSheet('viewer')
    } catch (error) {
      console.error('Failed to generate viewer link:', error)
      toast.error('Fehler', {
        description: 'Viewer-Link konnte nicht generiert werden. Bitte versuchen Sie es erneut.',
      })
    }
  }

  const copyViewerUrlToClipboard = async () => {
    if (!viewerUrl) return

    try {
      const { copyToClipboard } = await import('@/lib/utils')
      await copyToClipboard(viewerUrl)
      setViewerCopied(true)
      toast.success('Link kopiert')
      setTimeout(() => setViewerCopied(false), 2000)
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

  // Handle Reko assignment dialog (from context menu)
  const handleOpenRekoAssignDialog = (operationId: string) => {
    setRekoAssignOperationId(operationId)
    setRekoAssignDialogOpen(true)
  }

  // Handle toggling Nachbarhilfe status (from context menu)
  const handleToggleNachbarhilfe = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (operation) {
      updateOperation(operationId, { nachbarhilfe: !operation.nachbarhilfe })
    }
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
      <div className="flex h-full items-center justify-center bg-background text-foreground">
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
      <div className="flex h-full flex-col bg-background text-foreground">
        <header className="flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-4 md:px-6 py-2 min-h-14">
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
                <div className="absolute right-3 top-0 bottom-0 flex items-center pointer-events-none">
                  <Kbd>S</Kbd>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-base font-semibold tabular-nums">
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
            onCheckIn={generateCheckInQR}
            onVehicleStatus={() => setActiveFooterSheet('vehicles')}
            onUpdateOperation={updateOperation}
            isEditor={isEditor}
            isTraining={selectedEvent?.training_flag}
            isLoading={isLoading}
          />
        ) : (
          /* Desktop View */
          <>
        <div className="flex flex-1 overflow-hidden">
          {showLeftSidebar && (
            <aside className="w-64 border-r border-border bg-card/30 backdrop-blur-sm flex flex-col">
              {/* Search */}
              <div className="px-3 pt-3 pb-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="personnel-search-input"
                    placeholder="Personal suchen..."
                    value={personnelSearchQuery}
                    onChange={(e) => setPersonnelSearchQuery(e.target.value)}
                    className="h-8 pl-8 pr-8 text-sm"
                  />
                  {!isMobile && (
                    <div className="absolute right-2 top-0 bottom-0 flex items-center pointer-events-none">
                      <Kbd className="h-5 text-xs">P</Kbd>
                    </div>
                  )}
                </div>
              </div>
              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-4 pt-1 pb-3">
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
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground text-center">
                            Check-In QR-Code scannen
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={copyCheckInUrlToClipboard}
                            title="Link kopieren"
                          >
                            {copied ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
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
              {/* Fixed availability counter at bottom */}
              <div className="border-t border-border px-4 py-2 bg-card/50 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground text-center">
                  {personnel.filter((p) => p.status === "available").length}/{personnel.length} verfügbar
                </p>
              </div>
            </aside>
          )}

          {/* Main Kanban Board */}
          <main id="kanban-main" className="flex-1 overflow-x-auto p-4 bg-muted/30 dark:bg-zinc-950/20">
            {isLoading ? (
              <KanbanLoading />
            ) : (
              <div className="flex h-full gap-3">
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
                      onRemoveReko={removeReko}
                      onCardClick={handleCardClick}
                      onCardSelect={handleCardSelect}
                      onCardHover={setHoveredOperationId}
                      highlightedOperationId={highlightedOperationId}
                      selectedOperationId={panelSelectedId}
                      hoveredOperationId={hoveredOperationId}
                      isDraggingRef={isDraggingOperationRef}
                      materials={materials}
                      formatLocation={formatLocation}
                      onAssignResource={handleOpenAssignmentDialog}
                      onAssignReko={handleOpenRekoAssignDialog}
                      onToggleNachbarhilfe={handleToggleNachbarhilfe}
                      showMeldung={showMeldung}
                      printerEnabled={printerEnabled}
                    />
                  )
                })}
              </div>
            )}
          </main>

          {/* Side Panel for ultrawide monitors */}
          <SidePanel
            mode={sidePanelMode}
            onModeChange={setSidePanelMode}
            selectedOperation={panelSelectedOperation}
            operations={filteredOperations}
            materials={materials}
            formatLocation={formatLocation}
            onOpenModal={() => {
              if (panelSelectedOperation) {
                setSelectedOperationId(panelSelectedOperation.id)
                setDetailModalOpen(true)
              }
            }}
            onSelectOperation={(op) => {
              setPanelSelectedId(op.id)
              setHoveredOperationId(op.id)
            }}
            vehicleTypes={vehicleTypes}
            onUpdate={(updates) => {
              if (panelSelectedOperation) {
                updateOperation(panelSelectedOperation.id, updates)
              }
            }}
            onDelete={async (operationId) => {
              try {
                await deleteOperation(operationId)
                setPanelSelectedId(null)
                toast.success("Einsatz gelöscht")
              } catch (error) {
                console.error('Failed to delete operation:', error)
                toast.error("Fehler beim Löschen")
              }
            }}
            onAssignVehicle={assignVehicleToOperation}
            onRemoveVehicle={removeVehicle}
            onAssignResource={handleOpenAssignmentDialog}
            onRemoveCrew={removeCrew}
            onRemoveMaterial={removeMaterial}
          />

          {showRightSidebar && (
            <aside className="w-64 border-l border-border bg-card/30 backdrop-blur-sm flex flex-col">
              {/* Search */}
              <div className="px-3 pt-3 pb-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="material-search-input"
                    placeholder="Material suchen..."
                    value={materialSearchQuery}
                    onChange={(e) => setMaterialSearchQuery(e.target.value)}
                    className="h-8 pl-8 pr-8 text-sm"
                  />
                  {!isMobile && (
                    <div className="absolute right-2 top-0 bottom-0 flex items-center pointer-events-none">
                      <Kbd className="h-5 text-xs">M</Kbd>
                    </div>
                  )}
                </div>
              </div>
              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-4 pt-1 pb-3">
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
              {/* Fixed availability counter at bottom */}
              <div className="border-t border-border px-4 py-2 bg-card/50 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground text-center">
                  {materials.filter((m) => m.status === "available").length}/{materials.length} verfügbar
                </p>
              </div>
            </aside>
          )}
        </div>

        {/* Desktop Footer - z-index lowered when modals open so dialog overlay covers it */}
        <footer className={`relative bg-background/95 backdrop-blur-sm px-4 md:px-6 py-2 shadow-[0_-1px_3px_rgba(0,0,0,0.05)] border-t border-border ${detailModalOpen || newEmergencyModalOpen ? 'z-40' : 'z-[60]'}`}>
          <div className="flex items-center justify-between gap-4">
            {/* Left: Primary action */}
            <div className="flex items-center gap-3">
              <Button size="sm" className="gap-2 shadow-sm" onClick={() => setNewEmergencyModalOpen(true)}>
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
            </div>

            {/* Center: Secondary actions grouped */}
            <div className="flex items-center gap-1">
              {/* QR/Access group */}
              <div className="flex items-center">
                <Button
                  size="sm"
                  variant="ghost"
                  className={`gap-1.5 h-8 px-2.5 transition-colors ${
                    qrDialogOpen
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    generateCheckInQR()
                  }}
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span className="text-xs">Check-In</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={`gap-1.5 h-8 px-2.5 transition-colors ${
                    rekoQrDialogOpen
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    generateRekoDashboardQR()
                  }}
                >
                  <Search className="h-3.5 w-3.5" />
                  <span className="text-xs">Reko</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={`gap-1.5 h-8 px-2.5 transition-colors ${
                    viewerQrDialogOpen
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    generateViewerQR()
                  }}
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span className="text-xs">Viewer</span>
                </Button>
              </div>

              <div className="h-4 w-px bg-border mx-1" />

              {/* Status/Tools group */}
              <div className="flex items-center">
                <Button
                  size="sm"
                  variant="ghost"
                  className={`gap-1.5 h-8 px-2.5 transition-colors ${
                    vehicleStatusSheetOpen
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    if (!selectedEvent) return
                    setActiveFooterSheet(vehicleStatusSheetOpen ? null : 'vehicles')
                  }}
                  disabled={!selectedEvent}
                >
                  <Truck className="h-3.5 w-3.5" />
                  <span className="text-xs">Fahrzeuge</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={`gap-1.5 h-8 px-2.5 transition-colors ${
                    printModalOpen
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    if (!selectedEvent) return
                    setActiveFooterSheet(printModalOpen ? null : 'print')
                  }}
                  disabled={!selectedEvent}
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span className="text-xs">Drucken</span>
                </Button>
                {printerEnabled && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`gap-1.5 h-8 px-2.5 transition-colors ${
                      thermoSheetOpen
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      if (!selectedEvent) return
                      setActiveFooterSheet(thermoSheetOpen ? null : 'thermo')
                    }}
                    disabled={!selectedEvent}
                    title="Board auf Thermodrucker drucken"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span className="text-xs">Thermo</span>
                  </Button>
                )}
              </div>

              {selectedEvent?.training_flag && (
                <>
                  <div className="h-4 w-px bg-border mx-1" />
                  <Link href="/training">
                    <Button size="sm" variant="ghost" className="gap-1.5 h-8 px-2.5 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/30">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">Übungs-Steuerung</span>
                    </Button>
                  </Link>
                </>
              )}

              <div className="h-4 w-px bg-border mx-1" />

              {/* Toggle styled as a compact pill */}
              <button
                onClick={() => setShowMeldung(!showMeldung)}
                className={`flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs transition-colors ${
                  showMeldung
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                <div className={`h-1.5 w-1.5 rounded-full ${showMeldung ? 'bg-primary' : 'bg-muted-foreground/50'}`} />
                Meldung
              </button>
            </div>

            {/* Right: Help hint */}
            <button
              onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
            >
              <Kbd className="h-5 text-[10px] px-1.5">⌘K</Kbd>
              <span className="hidden lg:inline">Befehle</span>
            </button>
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
            <Card className="cursor-move border-2 border-primary p-4 shadow-2xl bg-card/90 backdrop-blur opacity-80">
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
        rekoPersonnelNames={rekoPersonnelNames}
        onAssignPerson={assignPersonToOperation}
        onAssignVehicle={assignVehicleToOperation}
        onAssignMaterial={assignMaterialToOperation}
        onRemovePerson={removeCrew}
        onRemoveVehicle={removeVehicle}
        onRemoveMaterial={removeMaterial}
      />


      {/* Check-In QR Code Sheet */}
      <Sheet modal={false} open={qrDialogOpen} onOpenChange={(open) => !open && activeFooterSheet === 'checkin' && setActiveFooterSheet(null)}>
        <SheetContent
          side="bottom"
          hideCloseButton
          overlayOffset="42px"
          nonModal
          className="max-w-3xl mx-auto px-6 py-4"
          onInteractOutside={(e) => {
            // Prevent closing when clicking on footer buttons
            const target = e.target as HTMLElement
            if (target.closest('footer')) {
              e.preventDefault()
            }
          }}
        >
          <div className="flex items-start gap-6">
            {/* QR Code */}
            {checkInUrl && (
              <div className="rounded-lg border p-3 bg-white flex-shrink-0">
                <QRCodeSVG
                  value={checkInUrl}
                  size={140}
                  level="M"
                  includeMargin={false}
                />
              </div>
            )}

            {/* Content */}
            <div className="flex-1 min-w-0">
              <SheetHeader className="p-0 mb-3">
                <SheetTitle>Personal Check-In</SheetTitle>
                <SheetDescription>
                  QR-Code scannen oder Link teilen für mobilen Zugriff
                </SheetDescription>
              </SheetHeader>

              {checkInUrl && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={checkInUrl}
                      readOnly
                      className="flex-1 rounded-md border px-3 py-1.5 text-xs bg-muted font-mono truncate"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyCheckInUrlToClipboard}
                      className="flex-shrink-0"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Personal kann diesen QR-Code scannen um sich einzuchecken. Funktioniert ohne Anmeldung.
                  </p>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Reko Dashboard QR Code Sheet */}
      <Sheet modal={false} open={rekoQrDialogOpen} onOpenChange={(open) => !open && activeFooterSheet === 'reko' && setActiveFooterSheet(null)}>
        <SheetContent
          side="bottom"
          hideCloseButton
          overlayOffset="42px"
          nonModal
          className="max-w-3xl mx-auto px-6 py-4"
          onInteractOutside={(e) => {
            // Prevent closing when clicking on footer buttons
            const target = e.target as HTMLElement
            if (target.closest('footer')) {
              e.preventDefault()
            }
          }}
        >
          <div className="flex items-start gap-6">
            {/* QR Code */}
            {rekoDashboardUrl && (
              <div className="rounded-lg border p-3 bg-white flex-shrink-0">
                <QRCodeSVG
                  value={rekoDashboardUrl}
                  size={140}
                  level="M"
                  includeMargin={false}
                />
              </div>
            )}

            {/* Content */}
            <div className="flex-1 min-w-0">
              <SheetHeader className="p-0 mb-3">
                <SheetTitle>Reko Dashboard</SheetTitle>
                <SheetDescription>
                  QR-Code scannen oder Link teilen für Reko-Personal
                </SheetDescription>
              </SheetHeader>

              {rekoDashboardUrl && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={rekoDashboardUrl}
                      readOnly
                      className="flex-1 rounded-md border px-3 py-1.5 text-xs bg-muted font-mono truncate"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyRekoDashboardUrlToClipboard}
                      className="flex-shrink-0"
                    >
                      {rekoCopied ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Reko-Personal kann Zuweisungen sehen und Formulare ausfüllen. Funktioniert ohne Anmeldung.
                  </p>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Viewer QR Code Sheet */}
      <Sheet modal={false} open={viewerQrDialogOpen} onOpenChange={(open) => !open && activeFooterSheet === 'viewer' && setActiveFooterSheet(null)}>
        <SheetContent
          side="bottom"
          hideCloseButton
          overlayOffset="42px"
          nonModal
          className="max-w-3xl mx-auto px-6 py-4"
          onInteractOutside={(e) => {
            // Prevent closing when clicking on footer buttons
            const target = e.target as HTMLElement
            if (target.closest('footer')) {
              e.preventDefault()
            }
          }}
        >
          <div className="flex items-start gap-6">
            {/* QR Code */}
            {viewerUrl && (
              <div className="rounded-lg border p-3 bg-white flex-shrink-0">
                <QRCodeSVG
                  value={viewerUrl}
                  size={140}
                  level="M"
                  includeMargin={false}
                />
              </div>
            )}

            {/* Content */}
            <div className="flex-1 min-w-0">
              <SheetHeader className="p-0 mb-3">
                <SheetTitle>Viewer-Link</SheetTitle>
                <SheetDescription>
                  QR-Code scannen oder Link teilen für Nur-Lesen-Ansicht
                </SheetDescription>
              </SheetHeader>

              {viewerUrl && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={viewerUrl}
                      readOnly
                      className="flex-1 rounded-md border px-3 py-1.5 text-xs bg-muted font-mono truncate"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyViewerUrlToClipboard}
                      className="flex-shrink-0"
                    >
                      {viewerCopied ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Jeder mit diesem Link kann die aktuelle Einsatzübersicht sehen. Funktioniert ohne Anmeldung, nur Lesen.
                  </p>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Vehicle Status Sheet */}
      <VehicleStatusSheet
        open={vehicleStatusSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'vehicles' && setActiveFooterSheet(null)}
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

      {/* Reko Assignment Dialog (from context menu) */}
      {rekoAssignOperationId && (
        <AssignRekoDialog
          open={rekoAssignDialogOpen}
          onOpenChange={setRekoAssignDialogOpen}
          incidentId={rekoAssignOperationId}
          incidentTitle={operations.find(op => op.id === rekoAssignOperationId)?.location || ''}
          onAssigned={() => {
            refreshOperations()
            setRekoAssignDialogOpen(false)
          }}
        />
      )}

      {/* Print Options Modal */}
      <PrintOptionsModal
        open={printModalOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'print' && setActiveFooterSheet(null)}
      />

      {/* Thermo Print Options Sheet */}
      <ThermoOptionsSheet
        open={thermoSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'thermo' && setActiveFooterSheet(null)}
        onPrint={handlePrintBoard}
        isPrinting={isPrintingBoard}
      />

      {/* Disponiert Transition Dialog */}
      <DisponierTransitionDialog
        open={!!disponiertDialogOp}
        onOpenChange={(open) => !open && setDisponiertDialogOp(null)}
        operation={disponiertDialogOp}
        materials={materials}
        printerEnabled={printerEnabled}
      />

      {/* Mobile Personnel Sheet */}
      <MobilePersonnelSheet
        open={mobilePersonnelSheetOpen}
        onOpenChange={setMobilePersonnelSheetOpen}
        personnel={personnel}
        operations={operations}
      />

      {/* Mobile Bottom Navigation */}
      <MobileBottomNavigation
        currentPage="kanban"
        hasSelectedEvent={!!selectedEvent}
        onCheckIn={generateCheckInQR}
        onPersonnel={() => setMobilePersonnelSheetOpen(true)}
        onVehicleStatus={() => setActiveFooterSheet('vehicles')}
        onPrint={() => setActiveFooterSheet(printModalOpen ? null : 'print')}
        onThermo={() => setActiveFooterSheet(thermoSheetOpen ? null : 'thermo')}
        printerEnabled={printerEnabled}
      />
    </ProtectedRoute>
  )
}
