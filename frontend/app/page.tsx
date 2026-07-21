"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams, useRouter } from "next/navigation"
import { topLoading } from "@/components/ui/top-loading-bar"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, Plus, Clock, Package, QrCode, Copy, Check, Sparkles, ClipboardCheck, Truck, Printer, MonitorDown, ExternalLink, Siren, Binoculars, ChevronDown, CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, Users, Footprints, Waypoints } from 'lucide-react'
import { Kbd } from "@/components/ui/kbd"
import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useOperations, type Person, type Operation, type Material, type PersonRole, type OperationStatus } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { AuftraegeSheet } from "@/components/kanban/auftraege-sheet"
import { useMaterials } from "@/lib/contexts/materials-context"
import { useEvent } from "@/lib/contexts/event-context"
import { apiClient } from "@/lib/api-client"
import { QRCodeSVG } from 'qrcode.react'
import { useRekoNotifications } from "@/lib/hooks/use-reko-notifications"
import { useNotifications } from "@/lib/contexts/notification-context"
import { useOperationHandlers } from "@/lib/hooks/use-operation-handlers"
import { useKanbanDragDrop } from "@/lib/hooks/use-kanban-drag-drop"
import { useResourceFiltering } from "@/lib/hooks/use-resource-filtering"
import { useDoubleBookedPersons } from "@/lib/hooks/use-double-booked-persons"
import { useCurrentTime } from "@/lib/hooks/use-current-time"
import { useGPrefixNavigation } from "@/lib/hooks/use-g-prefix-navigation"
import { useKanbanShortcuts } from "@/lib/hooks/use-kanban-shortcuts"
import { useCommandPaletteHint } from "@/lib/hooks/use-is-mac"
import { useAuth } from "@/lib/contexts/auth-context"
import { useCommandPalette } from "@/lib/contexts/command-palette-context"
import { columns } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { DraggablePerson } from "@/components/kanban/draggable-person"
import { DraggableMaterial } from "@/components/kanban/draggable-material"
import { MaterialGroupBlock } from "@/components/kanban/material-group-block"
import { DroppableColumn } from "@/components/kanban/droppable-column"
import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import { ResourceAssignmentDialog } from "@/components/kanban/resource-assignment-dialog"
import { NewEmergencyModal } from "@/components/kanban/new-emergency-modal"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"
import { useIsMobile } from "@/components/ui/use-mobile"
import { EventSetupChecklist } from "@/components/event-setup-checklist"
import { summarizeEventChecklist } from "@/lib/checklist-tasks"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { VehicleStatusSheet } from "@/components/vehicle-status-sheet"
import { EventSelectionEmptyState } from "@/components/empty-states/event-selection-empty-state"
import { SidePanel } from "@/components/kanban/side-panel"
import { MobileIncidentListView } from "@/components/mobile/mobile-incident-list-view"
import { MobilePersonnelSheet } from "@/components/mobile/mobile-personnel-sheet"
import { PrintOptionsModal } from "@/components/print/print-options-modal"
import { ThermoOptionsSheet, type ThermoPrintOptions } from "@/components/print/thermo-options-sheet"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"
import { TransferIncidentDialog } from "@/components/incidents/transfer-incident-dialog"
import type { Incident } from "@/lib/types/incidents"
import { DisponierTransitionDialog } from "@/components/kanban/disponiert-transition-dialog"
import { DiveraSendDialog } from "@/components/divera/divera-send-dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

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
    reorderColumn,
    setBoardDragging,
    createOperation,
    getNextOperationId,
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    deleteOperation,
    isLoading,
    isLoaded
  } = useOperations()
  const { groups, addStops: addStopsToGroup, copySquad: copyGroupSquad } = useGroups()

  // Keep the top progress bar visible for the whole pre-ready window — auth
  // check, event resolution and the first data load — so there's never a blank
  // gap without feedback and never a premature empty state before content lands.
  useEffect(() => {
    if (isLoaded) return
    topLoading.start()
    return () => topLoading.done()
  }, [isLoaded])

  const doubleBookedPersons = useDoubleBookedPersons(operations)

  const { materialGroups } = useMaterials()
  const { selectedEvent, isEventLoaded, events, setSelectedEvent } = useEvent()
  const { isEditor, isAuthenticated } = useAuth()
  const { toggleSidebar: toggleNotificationSidebar, registerNavigateHandler, closeSidebar: closeNotificationSidebar } = useNotifications()
  const { registerHandlers, clearHandlers } = useCommandPalette()
  const searchParams = useSearchParams()
  const router = useRouter()
  const highlightParam = searchParams.get("highlight")
  const isMobile = useIsMobile()

  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')
  const tRes = useTranslations('kanban.resources')
  const tMissing = useTranslations('kanban.missingResources')
  const tReturning = useTranslations('kanban.returningVehicle')
  const tReko = useTranslations('kanban.rekoMissing')
  const tRekoForm = useTranslations('kanban.rekoFormMissing')
  const tMat = useTranslations('kanban.materialDecision')

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

  // Update operation REKO summary when new report arrives
  const handleUpdateOperationReko = useCallback((incidentId: string, rekoSummary: {
    isRelevant: boolean
    hasDangers: boolean
    dangerTypes: string[]
    personnelCount: number | null
    estimatedDuration: number | null
  }) => {
    setOperations(prev => prev.map(op => {
      if (op.id !== incidentId) return op
      const updates: Partial<Operation> = { hasCompletedReko: true, rekoSummary }
      // Auto-transition reko → rekoDone when reko form is submitted
      if (op.status === "ready") {
        updates.status = "rekoDone"
        updates.statusChangedAt = new Date()
      }
      return { ...op, ...updates }
    }))
  }, [setOperations])

  useRekoNotifications(operations, handleOpenIncidentFromNotification, handleUpdateOperationReko)

  const { currentTime, isMounted } = useCurrentTime()
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
  const [activeFooterSheet, setActiveFooterSheet] = useState<'checkin' | 'reko' | 'display' | 'alarm' | 'vehicles' | 'print' | 'thermo' | 'auftraege' | null>(null)
  // When the Aufträge sheet is opened from a board chip, expand/scroll to this group.
  const [auftraegeFocusGroupId, setAuftraegeFocusGroupId] = useState<string | null>(null)
  // When "+ Stop" opens the New-Emergency modal, the created incident attaches here.
  const [newEmergencyGroupId, setNewEmergencyGroupId] = useState<string | null>(null)
  const [checkInUrl, setCheckInUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Auto-generate check-in QR code URL when no personnel are available
  useEffect(() => {
    if (!selectedEvent || checkInUrl || isLoading) return
    if (personnel.filter((p) => p.status === "available").length > 0) return
    apiClient.generateCheckInLink(selectedEvent.id).then((response) => {
      setCheckInUrl(`${window.location.origin}${response.link}`)
    }).catch(() => {})
  }, [selectedEvent, personnel, checkInUrl, isLoading])

  const gPrefix = useGPrefixNavigation(router)
  const cmdHint = useCommandPaletteHint()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [operationToDelete, setOperationToDelete] = useState<Operation | null>(null)
  const [showMeldung, setShowMeldung] = useState(() => {
    if (typeof window !== 'undefined') {
      // Migration: force showMeldung=true for existing users (v2 key)
      if (!localStorage.getItem('showMeldung_v2')) {
        localStorage.setItem('showMeldung_v2', '1')
        localStorage.setItem('showMeldung', 'true')
        return true
      }
      return localStorage.getItem('showMeldung') === 'true'
    }
    return true
  })
  const [rekoDashboardUrl, setRekoDashboardUrl] = useState<string | null>(null)
  const [rekoCopied, setRekoCopied] = useState(false)
  const [displayToken, setDisplayToken] = useState<string | null>(null)
  const [displayView, setDisplayView] = useState<'board' | 'map' | 'status'>('board')
  const [displayCopied, setDisplayCopied] = useState(false)
  const [alarmUrl, setAlarmUrl] = useState<string | null>(null)
  const [alarmCopied, setAlarmCopied] = useState(false)
  const [mobilePersonnelSheetOpen, setMobilePersonnelSheetOpen] = useState(false)
  const [disponiertDialogOp, setDisponiertDialogOp] = useState<Operation | null>(null)
  const [diveraDialogOp, setDiveraDialogOp] = useState<Operation | null>(null)
  // These dialogs hold a snapshot of the operation; derive the LIVE operation so a
  // resource assigned while the dialog is open (e.g. via the missing-resources
  // "Zuweisen" flow) shows up in the radio text and Divera recipients instead of
  // a stale "keine Person zugewiesen".
  const disponiertDialogOpLive = useMemo(
    () => (disponiertDialogOp ? operations.find(o => o.id === disponiertDialogOp.id) ?? disponiertDialogOp : null),
    [disponiertDialogOp, operations]
  )
  const diveraDialogOpLive = useMemo(
    () => (diveraDialogOp ? operations.find(o => o.id === diveraDialogOp.id) ?? diveraDialogOp : null),
    [diveraDialogOp, operations]
  )
  // When disponieren is triggered for an incident that's missing resources
  // (Personal, Fahrzeuge or Mittel), hold its id here to make the operator
  // acknowledge what's missing before dispatching. We store the id (not the op)
  // and derive the live op below, so the checklist reflects assignments made from
  // inside the gate the instant `operations` updates — no stale "still fehlt".
  const [missingResourcesAckOpId, setMissingResourcesAckOpId] = useState<string | null>(null)
  // Gate before einsatz → beendet/rückfahrt: if no vehicle is assigned the crew would
  // have to walk back, so make the operator acknowledge (or assign one first).
  const [returningVehicleAckOpId, setReturningVehicleAckOpId] = useState<string | null>(null)
  // When the operator picks a category from one of the resource gates, we close the gate,
  // open the assignment dialog, and remember here where to return once it closes: back to
  // the checklist ('missing') or the returning warning ('returning'). Only set on the gate
  // paths — normal per-category assignments are unaffected.
  const [assignReturnTo, setAssignReturnTo] = useState<{ kind: 'missing' | 'returning'; opId: string } | null>(null)
  // Live ops derived from the held ids, so both gates always render current state.
  const missingResourcesAckOp = useMemo(
    () => (missingResourcesAckOpId ? operations.find((o) => o.id === missingResourcesAckOpId) ?? null : null),
    [missingResourcesAckOpId, operations]
  )
  // The returning warning self-dismisses the moment a vehicle exists (or zu Fuss).
  const returningVehicleAckOp = useMemo(() => {
    if (!returningVehicleAckOpId) return null
    const op = operations.find((o) => o.id === returningVehicleAckOpId)
    if (!op || op.zuFuss || op.vehicles.length > 0) return null
    return op
  }, [returningVehicleAckOpId, operations])
  // Resource transfer ("Ressourcen übertragen") opened from the card context menu.
  const [transferSourceOp, setTransferSourceOp] = useState<Operation | null>(null)
  const [transferAvailableIncidents, setTransferAvailableIncidents] = useState<Incident[]>([])
  const [isTransferring, setIsTransferring] = useState(false)
  // Moving a card into REKO without a reko person assigned holds it here so the
  // operator can assign someone (who then receives the reko form) or proceed anyway.
  const [rekoMissingAckOp, setRekoMissingAckOp] = useState<Operation | null>(null)
  // Moving a card into REKO ABGESCHLOSSEN without a completed reko form holds it
  // here so the operator can open the reko details or acknowledge and proceed.
  const [rekoFormMissingAckOp, setRekoFormMissingAckOp] = useState<Operation | null>(null)
  // When an incident is completed while it still has materials assigned, hold it
  // here so the operator decides: release the materials ("Material zurück") or
  // leave them on site ("Vor Ort gelassen"). Completion itself has already
  // happened (status → complete, which keeps materials) — this only decides
  // whether to additionally release them. Cancel/dismiss keeps them (safe default).
  const [materialDecisionOp, setMaterialDecisionOp] = useState<Operation | null>(null)
  // Per-material choice in the completion dialog: 'magazin' (return) is the default,
  // 'vorort' (left on scene). Reset each time the dialog opens so choices don't leak
  // between incidents; unset entries fall back to 'magazin'.
  const [materialDecisions, setMaterialDecisions] = useState<Record<string, 'magazin' | 'vorort'>>({})
  useEffect(() => { setMaterialDecisions({}) }, [materialDecisionOp])

  // Persist showMeldung to localStorage
  useEffect(() => {
    localStorage.setItem('showMeldung', String(showMeldung))
  }, [showMeldung])

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
  // Bumped on every side-panel selection click so the map recenters even when
  // the same alarm is clicked again (e.g. after the user manually panned away)
  const [panToNonce, setPanToNonce] = useState(0)
  const [sidePanelMode, setSidePanelMode] = useState<'detail' | 'map' | 'collapsed'>('collapsed')
  // Derive selected operation for side panel
  const panelSelectedOperation = useMemo(() => {
    if (!panelSelectedId) return null
    return operations.find(op => op.id === panelSelectedId) || null
  }, [panelSelectedId, operations])

  // Register notification click → scroll to card + open detail
  // Small screens: open modal overlay. Large screens (≥1536px): select in side panel.
  useEffect(() => {
    registerNavigateHandler((incidentId: string) => {
      closeNotificationSidebar()
      scrollToCard(incidentId)
      // Open detail after scroll
      setTimeout(() => {
        const operation = operations.find(op => op.id === incidentId)
        if (operation) {
          const isLargeScreen = window.innerWidth >= 1536 // SIDEPANEL_BREAKPOINT
          if (isLargeScreen) {
            // Side panel selection (same as onCardSelect / handleCardSelect)
            setPanelSelectedId(incidentId)
            setHoveredOperationId(incidentId)
            setSidePanelMode(prev => prev === 'collapsed' ? 'detail' : prev)
          } else {
            // Modal overlay (same as onCardClick / handleCardClick)
            setSelectedOperationId(incidentId)
            setHoveredOperationId(incidentId)
            setDetailModalOpen(true)
          }
        }
      }, 200)
    })
    return () => registerNavigateHandler(null)
  }, [registerNavigateHandler, closeNotificationSidebar, scrollToCard, operations])

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
  const [diveraEnabled, setDiveraEnabled] = useState(false)
  const [isPrintingBoard, setIsPrintingBoard] = useState(false)
  const [isPrintingQR, setIsPrintingQR] = useState(false)
  const [funkrufname, setFunkrufname] = useState("Omega")

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


  // Fetch printer status and settings once authenticated
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
    async function fetchFunkrufname() {
      try {
        const settings = await apiClient.getAllSettings()
        if (settings.funkrufname) setFunkrufname(settings.funkrufname)
        // The send button needs both the setting AND a configured access key —
        // otherwise it would render and then 400 on send.
        if (settings['divera.alarm_enabled'] === 'true') {
          try {
            const status = await apiClient.getDiveraPollingStatus()
            setDiveraEnabled(status.configured === true)
          } catch {
            // Status endpoint unavailable — keep the old behavior (setting only)
            setDiveraEnabled(true)
          }
        } else {
          setDiveraEnabled(false)
        }
      } catch { /* ignore */ }
    }
    fetchPrinterStatus()
    fetchFunkrufname()
  }, [isAuthenticated])

  // Handle thermal board print
  const handlePrintBoard = useCallback(async (options?: ThermoPrintOptions) => {
    if (!selectedEvent || isPrintingBoard) return
    setIsPrintingBoard(true)
    try {
      await apiClient.queueBoardPrint(selectedEvent.id, options ? {
        include_incidents: options.includeIncidents,
        include_completed: options.includeCompleted,
        include_vehicles: options.includeVehicles,
        include_personnel: options.includePersonnel,
      } : undefined)
      toast.success(tDash('boardPrintSent'))
      setActiveFooterSheet(null)
    } catch {
      toast.error(tCommon('printFailed'))
    } finally {
      setIsPrintingBoard(false)
    }
  }, [selectedEvent, isPrintingBoard])

  // Handle thermal QR-code slip print (Check-In / Reko / Viewer / Walk-In links)
  const handlePrintQR = useCallback(async (qrContent: string, title: string, subtitle?: string) => {
    if (!printerEnabled || !qrContent || isPrintingQR) return
    setIsPrintingQR(true)
    try {
      await apiClient.queueQRCodePrint({
        qr_content: qrContent,
        title,
        subtitle,
        event_id: selectedEvent?.id,
      })
      toast.success(tDash('qrPrintSent'))
    } catch {
      toast.error(tCommon('printFailed'))
    } finally {
      setIsPrintingQR(false)
    }
  }, [printerEnabled, isPrintingQR, selectedEvent])

  // Use ref to track drag state more reliably
  const isDraggingOperationRef = useRef(false)

  // Returns the resource categories (Personal / Fahrzeuge / Mittel) an incident
  // is still missing. Vehicles are skipped for "zu Fuss" incidents, which by
  // definition rück without apparatus.
  const getMissingResources = useCallback((op: Operation): Array<'crew' | 'vehicles' | 'materials'> => {
    const missing: Array<'crew' | 'vehicles' | 'materials'> = []
    if (op.crew.length === 0) missing.push("crew")
    if (!op.zuFuss && op.vehicles.length === 0) missing.push("vehicles")
    if (op.materials.length === 0) missing.push("materials")
    return missing
  }, [])

  // Show disponiert transition dialog when moving to enroute. If the incident is
  // missing any resources (Personal, Fahrzeuge or Mittel), gate behind an
  // acknowledgment first so the operator doesn't silently dispatch it underequipped.
  const triggerDisponiertDialog = useCallback((operationId: string) => {
    const op = operations.find(o => o.id === operationId)
    if (!op) return
    if (getMissingResources(op).length > 0) {
      setMissingResourcesAckOpId(op.id)
    } else {
      setDisponiertDialogOp(op)
    }
  }, [operations, getMissingResources])

  // Gate before einsatz → beendet/rückfahrt: warn if the crew has no vehicle to drive
  // back (walking back with the gear is what we're trying to avoid). Skipped for zu-Fuss
  // incidents, where returning on foot is expected.
  const triggerReturningVehicleCheck = useCallback((operationId: string) => {
    const op = operations.find(o => o.id === operationId)
    if (!op) return
    if (!op.zuFuss && op.vehicles.length === 0) setReturningVehicleAckOpId(op.id)
  }, [operations])

  // When a card enters REKO without a reko person assigned, prompt the operator
  // to assign one (mirrors the missing-resources gate before disponieren).
  const triggerRekoCheck = useCallback((operationId: string) => {
    const op = operations.find(o => o.id === operationId)
    if (op && !op.assignedReko) setRekoMissingAckOp(op)
  }, [operations])

  // When a card is moved into REKO ABGESCHLOSSEN without a completed reko form,
  // inform the operator (mirrors the missing reko-person gate). The happy path —
  // a submitted form — auto-transitions and sets hasCompletedReko, so this only
  // fires on a manual move without a filled-out form.
  const triggerRekoFormCheck = useCallback((operationId: string) => {
    const op = operations.find(o => o.id === operationId)
    if (op && !op.hasCompletedReko) setRekoFormMissingAckOp(op)
  }, [operations])

  // After an incident is completed, prompt the operator to decide what to do with
  // any materials that are still assigned (completion keeps them by default). Called
  // from every completion path: drag-to-ABGESCHLOSSEN, move-right, and the card's
  // "Einsatz abschliessen" context-menu item.
  const promptMaterialDecision = useCallback((operationId: string) => {
    const op = operations.find(o => o.id === operationId)
    if (op && op.materials.length > 0) setMaterialDecisionOp(op)
  }, [operations])

  // Archive an incident immediately (status → complete). Mirrors dragging the card
  // to ABGESCHLOSSEN: updateOperation auto-releases personnel + vehicles and keeps
  // materials, then we prompt for the material decision.
  const requestCompletion = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation || operation.status === "complete") return
    updateOperation(operationId, { status: "complete" })
    // Completing from the Reko-Meldung "Einsatz abschliessen" button should also
    // dismiss the detail modal — the incident just moved to ABGESCHLOSSEN.
    setDetailModalOpen(false)
    promptMaterialDecision(operationId)
  }, [operations, updateOperation, promptMaterialDecision])

  // Open the "Ressourcen übertragen" dialog from the card context menu. Loads the
  // event's incidents as transfer targets (mirrors side-panel's handleOpenTransfer).
  const handleOpenTransfer = useCallback(async (operationId: string) => {
    const op = operations.find(o => o.id === operationId)
    if (!op || !selectedEvent) {
      toast.error(tCommon('error'), { description: tCommon('noEventSelected') })
      return
    }
    try {
      const apiIncidents = await apiClient.getIncidents(selectedEvent.id)
      const incidents: Incident[] = apiIncidents.map(inc => {
        const { location_lat, location_lng, created_at, updated_at, status_changed_at, completed_at, reko_arrived_at, assigned_vehicles, ...rest } = inc
        return {
          ...rest,
          location_lat: location_lat !== null ? parseFloat(location_lat) : null,
          location_lng: location_lng !== null ? parseFloat(location_lng) : null,
          created_at: new Date(created_at),
          updated_at: new Date(updated_at),
          status_changed_at: status_changed_at ? new Date(status_changed_at) : null,
          completed_at: completed_at ? new Date(completed_at) : null,
          reko_arrived_at: reko_arrived_at ? new Date(reko_arrived_at) : null,
          assigned_vehicles: assigned_vehicles.map(v => ({ ...v, assigned_at: new Date(v.assigned_at) })),
        }
      })
      setTransferAvailableIncidents(incidents)
      setTransferSourceOp(op)
    } catch (error) {
      console.error("Failed to load incidents:", error)
      toast.error(tCommon('loadFailed'))
    }
  }, [operations, selectedEvent])

  // Perform the transfer. The backend returns a specific German reason on failure.
  const handleTransfer = useCallback(async (targetIncidentId: string) => {
    if (!transferSourceOp) return
    try {
      setIsTransferring(true)
      await apiClient.transferAssignments(transferSourceOp.id, targetIncidentId)
      setTransferSourceOp(null)
      toast.success(tCommon('transferResources'))
    } catch (error: any) {
      toast.error(tCommon('transferFailed'), {
        description: error?.message || tCommon('transferFailedDescription'),
      })
    } finally {
      setIsTransferring(false)
    }
  }, [transferSourceOp])

  const moveOperationRight = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex < columns.length - 1) {
      const nextColumn = columns[currentColumnIndex + 1]
      const newStatus = nextColumn.status[0] as OperationStatus
      updateOperation(operationId, { status: newStatus })
      if (newStatus === "enroute") triggerDisponiertDialog(operationId)
      if (newStatus === "ready") triggerRekoCheck(operationId)
      if (newStatus === "rekoDone") triggerRekoFormCheck(operationId)
      if (newStatus === "returning") triggerReturningVehicleCheck(operationId)
      if (newStatus === "complete") promptMaterialDecision(operationId)
    }
  }, [operations, updateOperation, triggerDisponiertDialog, triggerRekoCheck, triggerRekoFormCheck, triggerReturningVehicleCheck, promptMaterialDecision])

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
      },
      onToggleLeftSidebar: () => setShowLeftSidebar(prev => !prev),
      onToggleRightSidebar: () => setShowRightSidebar(prev => !prev),
      onToggleVehicleStatus: () => setActiveFooterSheet(prev => prev === 'vehicles' ? null : 'vehicles'),
      onToggleNotifications: toggleNotificationSidebar,
      onToggleSidePanel: () =>
        setSidePanelMode(prev => (prev === 'collapsed' ? 'detail' : 'collapsed')),
      onSidePanelDetail: () => setSidePanelMode('detail'),
      onSidePanelMap: () => setSidePanelMode('map'),
      onToggleZuFuss: () => {
        if (hoveredOperationId) {
          const op = operations.find(o => o.id === hoveredOperationId)
          if (op) updateOperation(hoveredOperationId, { zuFuss: !op.zuFuss })
        }
      },
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

  // Checklist popover state and live readiness progress (persistent reference)
  const [checklistPopoverOpen, setChecklistPopoverOpen] = useState(false)
  const [checklistProgress, setChecklistProgress] = useState({ completed: 0, total: 0 })
  const autoOpenedEventRef = useRef<string | null>(null)

  // The setup checklist is an operational aid for real callouts (printer, real
  // check-in workflow, offline maps). It's noise in the public demo, so hide it
  // there entirely. Fetched once — demo mode never changes mid-session.
  const [isDemo, setIsDemo] = useState(false)
  useEffect(() => {
    apiClient.getDemoStatus().then((s) => setIsDemo(!!s?.demo)).catch(() => {})
  }, [])

  // Poll readiness progress so the persistent "Bereitschaft" badge stays live
  // even while the popover is closed. Rare users forget the steps, not the app —
  // keeping "what still needs doing" visible at a glance, every callout.
  useEffect(() => {
    if (!selectedEvent || !isMounted) return
    // Disabled in the demo — keep progress empty so the badge/popover never show.
    if (isDemo) {
      setChecklistProgress({ completed: 0, total: 0 })
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const summary = await summarizeEventChecklist(selectedEvent.id)
        if (!cancelled) setChecklistProgress(summary)
      } catch {
        // ignore — badge keeps its last-known value
      }
    }
    load()
    const interval = setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [selectedEvent, isMounted, isDemo])

  // Auto-open the checklist once per event whenever setup is still incomplete
  // (regardless of event age), then hand off to the persistent button so it
  // never re-nags after the user has dismissed it.
  useEffect(() => {
    if (!selectedEvent || !isMounted) return
    if (checklistProgress.total === 0) return
    if (checklistProgress.completed >= checklistProgress.total) return
    if (autoOpenedEventRef.current === selectedEvent.id) return
    autoOpenedEventRef.current = selectedEvent.id
    setChecklistPopoverOpen(true)
  }, [selectedEvent, isMounted, checklistProgress])

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

  useKanbanShortcuts(
    {
      modalOpen:
        detailModalOpen ||
        newEmergencyModalOpen ||
        assignmentDialogOpen ||
        // Vehicle footer is non-modal: keep F able to toggle it off.
        (!!activeFooterSheet && activeFooterSheet !== 'vehicles') ||
        deleteDialogOpen,
      sidePanelOpen: sidePanelMode !== 'collapsed',
      hoveredOperationId,
      operations,
      vehicleTypes,
      gPrefix,
    },
    {
      onToggleVehicle: (vehicle, opId, isAssigned) => {
        if (isAssigned) {
          removeVehicle(opId, vehicle.name)
        } else {
          assignVehicleToOperation(vehicle.id, vehicle.name, opId)
        }
      },
      onUpdateOperation: updateOperation,
      onMoveRight: moveOperationRight,
      onMoveLeft: moveOperationLeft,
      onToggleZuFuss: (opId) => {
        const op = operations.find((o) => o.id === opId)
        if (op) updateOperation(opId, { zuFuss: !op.zuFuss })
      },
      onRefresh: refreshOperations,
      onOpenDetail: (op) => {
        setSelectedOperationId(op.id)
        setDetailModalOpen(true)
      },
      onRequestDelete: (op) => {
        setOperationToDelete(op)
        setDeleteDialogOpen(true)
      },
      onOpenNewEmergency: () => setNewEmergencyModalOpen(true),
      onFocusSearch: () => document.getElementById('search-input')?.focus(),
      onFocusPersonnel: () => {
        setShowLeftSidebar(true)
        setTimeout(() => document.getElementById('personnel-search-input')?.focus(), 50)
      },
      onFocusMaterial: () => {
        setShowRightSidebar(true)
        setTimeout(() => document.getElementById('material-search-input')?.focus(), 50)
      },
      onToggleVehicleFooter: () =>
        setActiveFooterSheet((prev) => (prev === 'vehicles' ? null : 'vehicles')),
      onToggleLeftSidebar: () => setShowLeftSidebar((prev) => !prev),
      onToggleRightSidebar: () => setShowRightSidebar((prev) => !prev),
      onToggleSidePanel: () =>
        setSidePanelMode((prev) => (prev === 'collapsed' ? 'detail' : 'collapsed')),
      onSidePanelDetail: () => setSidePanelMode('detail'),
      onSidePanelMap: () => setSidePanelMode('map'),
      onToggleNotifications: toggleNotificationSidebar,
    },
  )

  // The highlight timer is cleaned up by its own scrollToCard effect; nothing else to do here.
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [])

  // Use shared drag-and-drop hook
  useKanbanDragDrop({
    isMounted,
    operations,
    setOperations,
    updateOperation,
    reorderColumn,
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    setDraggingItem,
    onOperationDrop: (operationId) => {
      // Auto-select dropped card in side panel
      setPanelSelectedId(operationId)
      setHoveredOperationId(operationId)
    },
    onStatusChange: (operationId, newStatus) => {
      if (newStatus === "enroute") triggerDisponiertDialog(operationId)
      if (newStatus === "ready") triggerRekoCheck(operationId)
      if (newStatus === "rekoDone") triggerRekoFormCheck(operationId)
      if (newStatus === "returning") triggerReturningVehicleCheck(operationId)
      // Drag-to-ABGESCHLOSSEN already ran updateOperation(complete) inside the hook
      // (which keeps materials). Just prompt the material decision here.
      if (newStatus === "complete") promptMaterialDecision(operationId)
    },
    // Aufträge (route) drop targets — see auftraege-sheet.tsx for the registered
    // drop-target data contract (`group-row` / `group-stop`).
    groups,
    addStopsToGroup,
    copyGroupSquad,
  })

  // Board Auftrag chips signal the page via a window event (no prop threading
  // through the column/side-panel trees) to open the Aufträge sheet on that route.
  useEffect(() => {
    const handler = (e: Event) => {
      const groupId = (e as CustomEvent<{ groupId: string }>).detail?.groupId ?? null
      setAuftraegeFocusGroupId(groupId)
      setActiveFooterSheet('auftraege')
    }
    window.addEventListener('kp:open-auftraege', handler)
    return () => window.removeEventListener('kp:open-auftraege', handler)
  }, [])

  // Use shared resource filtering hook — sidebar search takes priority, top search also filters
  const effectivePersonnelQuery = personnelSearchQuery || searchQuery
  const effectiveMaterialQuery = materialSearchQuery || searchQuery
  const { groupedPersonnel, groupedMaterials } = useResourceFiltering(
    personnel,
    materials,
    effectivePersonnelQuery,
    effectiveMaterialQuery,
    tRes('roleOther')
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
    setPanToNonce((n) => n + 1) // Recenter map even if the same alarm is re-clicked
    setHoveredOperationId(operation.id) // Also update hovered for keyboard shortcuts
    // Auto-open side panel in detail mode if collapsed
    if (sidePanelMode === 'collapsed') {
      setSidePanelMode('detail')
    }
  }

  // Derived state for convenience
  const qrDialogOpen = activeFooterSheet === 'checkin'
  const rekoQrDialogOpen = activeFooterSheet === 'reko'
  const displaySheetOpen = activeFooterSheet === 'display'
  // One share token, three targets — the sheet toggles which view the QR/URL point at.
  const displayUrl = displayToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/display/${displayView}?token=${displayToken}`
    : null
  const alarmQrDialogOpen = activeFooterSheet === 'alarm'
  const vehicleStatusSheetOpen = activeFooterSheet === 'vehicles'
  const printModalOpen = activeFooterSheet === 'print'
  const thermoSheetOpen = activeFooterSheet === 'thermo'
  const auftraegeSheetOpen = activeFooterSheet === 'auftraege'

  const generateCheckInQR = async () => {
    // Toggle behavior: if already open, just close
    if (qrDialogOpen) {
      setActiveFooterSheet(null)
      return
    }

    if (!selectedEvent) {
      toast.error(tCommon('error'), {
        description: tDash('selectEventFirst'),
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
      toast.error(tCommon('error'), {
        description: tDash('qrGenerateFailed'),
      })
    }
  }

  const copyCheckInUrlToClipboard = async () => {
    if (!checkInUrl) return

    try {
      const { copyToClipboard } = await import('@/lib/utils')
      await copyToClipboard(checkInUrl)
      setCopied(true)
      toast.success(tCommon('linkCopied'))
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      toast.error(tCommon('copyFailed'))
    }
  }

  const generateRekoDashboardQR = async () => {
    // Toggle behavior: if already open, just close
    if (rekoQrDialogOpen) {
      setActiveFooterSheet(null)
      return
    }

    if (!selectedEvent) {
      toast.error(tCommon('error'), {
        description: tDash('selectEventFirst'),
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
      toast.error(tCommon('error'), {
        description: tDash('rekoLinkFailed'),
      })
    }
  }

  const copyRekoDashboardUrlToClipboard = async () => {
    if (!rekoDashboardUrl) return

    try {
      const { copyToClipboard } = await import('@/lib/utils')
      await copyToClipboard(rekoDashboardUrl)
      setRekoCopied(true)
      toast.success(tCommon('linkCopied'))
      setTimeout(() => setRekoCopied(false), 2000)
    } catch (error) {
      toast.error(tCommon('copyFailed'))
    }
  }

  const generateDisplayShare = async () => {
    // Toggle behavior: if already open, just close
    if (displaySheetOpen) {
      setActiveFooterSheet(null)
      return
    }

    if (!selectedEvent) {
      toast.error(tCommon('error'), {
        description: tDash('selectEventFirst'),
      })
      return
    }

    try {
      // Reuse the read-only share token; point it at the display board so a
      // recipient sees the shared read-only board without logging in.
      const response = await apiClient.generateViewerLink(selectedEvent.id)
      setDisplayToken(response.token)
      setDisplayView('board')
      setActiveFooterSheet('display')
    } catch (error) {
      console.error('Failed to generate display share link:', error)
      toast.error(tCommon('error'), {
        description: tDash('displayLinkFailed'),
      })
    }
  }

  const copyDisplayUrlToClipboard = async () => {
    if (!displayUrl) return

    try {
      const { copyToClipboard } = await import('@/lib/utils')
      await copyToClipboard(displayUrl)
      setDisplayCopied(true)
      toast.success(tCommon('linkCopied'))
      setTimeout(() => setDisplayCopied(false), 2000)
    } catch (error) {
      toast.error(tCommon('copyFailed'))
    }
  }

  const generateAlarmQR = async () => {
    // Toggle behavior: if already open, just close
    if (alarmQrDialogOpen) {
      setActiveFooterSheet(null)
      return
    }

    if (!selectedEvent) {
      toast.error(tCommon('error'), {
        description: tDash('selectEventFirst'),
      })
      return
    }

    try {
      const response = await apiClient.generateAlarmLink(selectedEvent.id)
      const fullUrl = `${window.location.origin}${response.link}`
      setAlarmUrl(fullUrl)
      setActiveFooterSheet('alarm')
    } catch (error) {
      console.error('Failed to generate alarm link:', error)
      toast.error(tCommon('error'), {
        description: tDash('alarmLinkFailed'),
      })
    }
  }

  const copyAlarmUrlToClipboard = async () => {
    if (!alarmUrl) return

    try {
      const { copyToClipboard } = await import('@/lib/utils')
      await copyToClipboard(alarmUrl)
      setAlarmCopied(true)
      toast.success(tCommon('linkCopied'))
      setTimeout(() => setAlarmCopied(false), 2000)
    } catch (error) {
      toast.error(tCommon('copyFailed'))
    }
  }

  // Handle resource assignment dialog
  const handleOpenAssignmentDialog = (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string) => {
    setAssignmentResourceType(resourceType)
    setAssignmentOperationId(operationId)
    setAssignmentDialogOpen(true)
  }

  // Open the assignment dialog for one category from a resource gate, remembering to
  // return to that gate ('missing' checklist / 'returning' warning) once it closes.
  const openGateAssign = (category: 'crew' | 'vehicles' | 'materials', opId: string, kind: 'missing' | 'returning') => {
    setMissingResourcesAckOpId(null)
    setReturningVehicleAckOpId(null)
    setAssignReturnTo({ kind, opId })
    handleOpenAssignmentDialog(category, opId)
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

  // Handle toggling Am Warten status (from context menu)
  const handleToggleAmWarten = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (operation) {
      updateOperation(operationId, { amWarten: !operation.amWarten })
    }
  }

  // Handle toggling Zu Fuss status (from context menu or badge removal)
  const handleToggleZuFuss = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (operation) {
      updateOperation(operationId, { zuFuss: !operation.zuFuss })
    }
  }

  // Handle toggling driver stay on vehicle (vor Ort / zurück)
  const handleToggleDriverStay = (operationId: string, vehicleName: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return
    const assignmentId = operation.vehicleAssignments.get(vehicleName)
    if (!assignmentId) return
    const driverStay = operation.vehicleDriverStay?.get(vehicleName) || false
    const newValue = !driverStay
    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const newDriverStay = new Map(op.vehicleDriverStay)
          newDriverStay.set(vehicleName, newValue)
          return { ...op, vehicleDriverStay: newDriverStay }
        }
        return op
      })
    )
    apiClient.updateAssignment(operationId, assignmentId, { driver_stay: newValue }).catch(() => {
      toast.error(tCommon('updateFailed'))
      setOperations((ops) =>
        ops.map((op) => {
          if (op.id === operationId) {
            const revertDriverStay = new Map(op.vehicleDriverStay)
            revertDriverStay.set(vehicleName, driverStay)
            return { ...op, vehicleDriverStay: revertDriverStay }
          }
          return op
        })
      )
    })
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
    } catch (error) {
      console.error('Failed to delete operation:', error)
      toast.error(tCommon('deleteFailed'))
    } finally {
      setOperationToDelete(null)
    }
  }

  // Don't render drag and drop until client-side to avoid hydration errors
  if (!isMounted) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <div className="text-muted-foreground">{tDash('loading')}</div>
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
        {/* Top header is desktop-only — on mobile everything routes through the
            bottom navbar (event switching lives in its "Mehr" sheet). */}
        <header className="hidden md:flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-4 md:px-6 py-2 min-h-14">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Event title doubles as an event switcher: switch events or create a
                new one without first hunting through the user menu → Ereignisse. */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 min-w-0 -ml-2 rounded-lg px-2 py-1 hover:bg-secondary/60 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                <h1 className={`text-xl md:text-2xl font-bold tracking-tight truncate ${selectedEvent ? "" : "text-muted-foreground"}`}>
                  {selectedEvent ? selectedEvent.name : tDash('noEventSelected')}
                </h1>
                {selectedEvent?.training_flag && (
                  <Badge variant="secondary" className="hidden sm:inline-flex flex-shrink-0">{tDash('training')}</Badge>
                )}
                <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>{tDash('switchEvent')}</DropdownMenuLabel>
                {events
                  .filter((e) => !e.archived_at && e.id !== selectedEvent?.id)
                  .sort((a, b) => b.last_activity_at.getTime() - a.last_activity_at.getTime())
                  .slice(0, 6)
                  .map((event) => (
                    <DropdownMenuItem
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className="cursor-pointer"
                    >
                      <span className="truncate">{event.name}</span>
                      {event.training_flag && (
                        <Badge variant="secondary" className="ml-auto text-[10px]">{tDash('training')}</Badge>
                      )}
                    </DropdownMenuItem>
                  ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/events?action=create")} className="cursor-pointer">
                  <Plus className="mr-2 h-4 w-4" />
                  {tDash('newEvent')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/events")} className="cursor-pointer">
                  <CalendarDays className="mr-2 h-4 w-4" />
                  {tDash('allEvents')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Desktop Navigation */}
          {!isMobile && (
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search-input"
                  type="text"
                  placeholder={tCommon('search')}
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
                  {isMounted && currentTime ? currentTime.toLocaleTimeString("de-CH") : "--:--:--"}
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
        <div className="relative flex flex-1 overflow-hidden">
          {showLeftSidebar && (
            <aside className="relative w-64 border-r border-border bg-card/30 backdrop-blur-sm flex flex-col">
              {/* Collapse handle — small chevron centered on the sidebar's inner edge */}
              <button
                onClick={() => setShowLeftSidebar(false)}
                className="absolute right-0 top-1/2 z-20 flex h-12 w-5 -translate-y-1/2 cursor-pointer translate-x-1/2 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
                title={`${tDash('toggleLeftSidebar')} ([)`}
                aria-label={tDash('toggleLeftSidebar')}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {/* Search */}
              <div className="px-3 pt-3 pb-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="personnel-search-input"
                    placeholder={tDash('personnelSearch')}
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
                {!isLoaded ? null : personnel.filter((p) => p.status === "available").length === 0 ? (
                  /* Show QR code when no available personnel */
                  <div className="flex flex-col items-center gap-3 py-4 animate-in fade-in duration-300">
                    <p className="text-sm text-muted-foreground text-center">
                      {tDash('noPersonnelAvailable')}
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
                            {tDash('scanCheckInQr')}
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={copyCheckInUrlToClipboard}
                            title={tCommon('copyLink')}
                          >
                            {copied ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    {Object.keys(groupedPersonnel).map((role) => (
                      <div key={role}>
                        <h3 className="mb-2 text-xs font-semibold text-muted-foreground tracking-wide">{role}</h3>
                        <div className="space-y-2">
                          {groupedPersonnel[role as PersonRole]?.map((person) => (
                            <DraggablePerson
                              key={person.id}
                              person={person}
                              onClick={() => handlePersonClick(person)}
                              assignmentCount={doubleBookedPersons.counts.get(person.name)}
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
                  {tCommon('availableCounter', { available: personnel.filter((p) => p.status === "available").length, total: personnel.length })}
                </p>
              </div>
            </aside>
          )}

          {/* Left sidebar reopen tab (shown when collapsed; "[" also toggles) */}
          {!showLeftSidebar && (
            <button
              onClick={() => setShowLeftSidebar(true)}
              className="absolute left-0 top-1/2 z-10 flex h-12 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-r-md border border-l-0 border-border bg-card/90 text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
              title={`${tDash('toggleLeftSidebar')} ([)`}
              aria-label={tDash('toggleLeftSidebar')}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {/* Main Kanban Board */}
          <main id="kanban-main" className="flex-1 overflow-x-auto p-4 bg-muted/30 dark:bg-zinc-950/20">
            {!isLoaded ? null : (
              <div className="flex h-full gap-3 animate-in fade-in duration-300">
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
                      onToggleDriverStay={handleToggleDriverStay}
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
                      onToggleAmWarten={handleToggleAmWarten}
                      onToggleZuFuss={handleToggleZuFuss}
                      onRequestComplete={isEditor ? requestCompletion : undefined}
                      onTransfer={isEditor ? handleOpenTransfer : undefined}
                      showMeldung={showMeldung}
                      printerEnabled={printerEnabled}
                      doubleBookedCrewNames={doubleBookedPersons.names}
                      canDrag={isEditor}
                      onDragActiveChange={setBoardDragging}
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
            panToNonce={panToNonce}
            operations={filteredOperations}
            materials={materials}
            formatLocation={formatLocation}
            onSelectOperation={(op) => {
              setPanelSelectedId(op.id)
              setPanToNonce((n) => n + 1) // Recenter on every marker/list click too
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
              } catch (error) {
                console.error('Failed to delete operation:', error)
                toast.error(tCommon('deleteFailed'))
              }
            }}
            onAssignVehicle={assignVehicleToOperation}
            onRemoveVehicle={removeVehicle}
            onAssignResource={handleOpenAssignmentDialog}
            onRemoveCrew={removeCrew}
            onRemoveMaterial={removeMaterial}
            onRequestComplete={isEditor ? requestCompletion : undefined}
          />

          {showRightSidebar && (
            <aside className="relative w-64 border-l border-border bg-card/30 backdrop-blur-sm flex flex-col">
              {/* Collapse handle — small chevron centered on the sidebar's inner edge */}
              <button
                onClick={() => setShowRightSidebar(false)}
                className="absolute left-0 top-1/2 z-20 flex h-12 w-5 -translate-y-1/2 cursor-pointer -translate-x-1/2 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
                title={`${tDash('toggleRightSidebar')} (])`}
                aria-label={tDash('toggleRightSidebar')}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {/* Search */}
              <div className="px-3 pt-3 pb-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="material-search-input"
                    placeholder={tDash('materialSearch')}
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
                {!isLoaded ? null : (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    {Object.entries(groupedMaterials).map(([category, items]) => {
                      // Separate grouped vs ungrouped materials
                      const ungroupedItems = items.filter(m => !m.groupId)
                      const groupedItems = new Map<string, Material[]>()
                      for (const m of items.filter(m => m.groupId)) {
                        const group = materialGroups.find(g => g.id === m.groupId)
                        if (group) {
                          if (!groupedItems.has(group.id)) groupedItems.set(group.id, [])
                          groupedItems.get(group.id)!.push(m)
                        } else {
                          ungroupedItems.push(m)
                        }
                      }
                      return (
                        <div key={category}>
                          <h3 className="mb-2 text-xs font-semibold text-muted-foreground tracking-wide">{category}</h3>
                          <div className="space-y-2">
                            {/* Material groups/blocks */}
                            {Array.from(groupedItems.entries()).map(([groupId, groupMaterials]) => {
                              const group = materialGroups.find(g => g.id === groupId)!
                              const allAvailable = groupMaterials.every(m => m.status === 'available')
                              const someAssigned = groupMaterials.some(m => m.status === 'assigned')
                              const allAssigned = groupMaterials.every(m => m.status === 'assigned')
                              return (
                                <MaterialGroupBlock
                                  key={groupId}
                                  group={group}
                                  materials={groupMaterials}
                                  allAvailable={allAvailable}
                                  someAssigned={someAssigned}
                                  allAssigned={allAssigned}
                                  onMaterialClick={handleMaterialClick}
                                />
                              )
                            })}
                            {/* Ungrouped materials */}
                            {ungroupedItems.map((material) => (
                              <DraggableMaterial
                                key={material.id}
                                material={material}
                                onClick={() => handleMaterialClick(material)}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              {/* Fixed availability counter at bottom */}
              <div className="border-t border-border px-4 py-2 bg-card/50 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground text-center">
                  {tCommon('availableCounter', { available: materials.filter((m) => m.status === "available").length, total: materials.length })}
                </p>
              </div>
            </aside>
          )}

          {/* Right sidebar reopen tab (shown when collapsed; "]" also toggles) */}
          {!showRightSidebar && (
            <button
              onClick={() => setShowRightSidebar(true)}
              className="absolute right-0 top-1/2 z-10 flex h-12 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-l-md border border-r-0 border-border bg-card/90 text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
              title={`${tDash('toggleRightSidebar')} (])`}
              aria-label={tDash('toggleRightSidebar')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Desktop Footer - z-index lowered when modals open so dialog overlay covers it */}
        <footer className={`relative bg-background/95 backdrop-blur-sm px-4 md:px-6 py-2 shadow-[0_-1px_3px_rgba(0,0,0,0.05)] border-t border-border ${detailModalOpen || newEmergencyModalOpen || disponiertDialogOp ? 'z-40' : 'z-[60]'}`}>
          <div className="flex items-center justify-between gap-4">
            {/* Left: Primary action */}
            <div className="flex items-center gap-3">
              <Button size="sm" className="gap-2 shadow-sm" onClick={() => setNewEmergencyModalOpen(true)}>
                <Plus className="h-4 w-4" />
                {tCommon('newIncident')}
              </Button>

              {/* Event Setup Checklist — shown only while setup is incomplete; disappears once done */}
              {selectedEvent && checklistProgress.total > 0 && checklistProgress.completed < checklistProgress.total && (
                <Popover open={checklistPopoverOpen} onOpenChange={setChecklistPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-2">
                      <ClipboardCheck className="h-4 w-4" />
                      {tDash('readiness')}
                      <Badge variant="secondary" className="h-5 px-1.5 text-xs font-medium tabular-nums">
                        {checklistProgress.completed}/{checklistProgress.total}
                      </Badge>
                    </Button>
                  </PopoverTrigger>
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
                      onAllTasksComplete={() => setChecklistPopoverOpen(false)}
                    />
                  </PopoverContent>
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
                  <span className="text-xs">{tDash('checkIn')}</span>
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
                  <span className="text-xs">{tCommon('reko')}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={`gap-1.5 h-8 px-2.5 transition-colors ${
                    displaySheetOpen
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    generateDisplayShare()
                  }}
                >
                  <MonitorDown className="h-3.5 w-3.5" />
                  <span className="text-xs">{tDash('display')}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={`gap-1.5 h-8 px-2.5 transition-colors ${
                    alarmQrDialogOpen
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    generateAlarmQR()
                  }}
                >
                  <Siren className="h-3.5 w-3.5" />
                  <span className="text-xs">{tDash('alarm')}</span>
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
                  <span className="text-xs">{tDash('vehicles')}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={`gap-1.5 h-8 px-2.5 transition-colors ${
                    auftraegeSheetOpen
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    if (!selectedEvent) return
                    if (!auftraegeSheetOpen) setAuftraegeFocusGroupId(null)
                    setActiveFooterSheet(auftraegeSheetOpen ? null : 'auftraege')
                  }}
                  disabled={!selectedEvent}
                >
                  <Waypoints className="h-3.5 w-3.5" />
                  <span className="text-xs">{tDash('auftraege')}</span>
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
                  <span className="text-xs">{tDash('print')}</span>
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
                    title={tDash('thermoTitle')}
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span className="text-xs">{tDash('thermo')}</span>
                  </Button>
                )}
              </div>

              {selectedEvent?.training_flag && (
                <>
                  <div className="h-4 w-px bg-border mx-1" />
                  <Link href="/training">
                    <Button size="sm" variant="ghost" className="gap-1.5 h-8 px-2.5 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/30">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">{tDash('trainingControl')}</span>
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
                {tCommon('meldung')}
              </button>
            </div>

            {/* Right: Help hint */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
                className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
              >
                <Kbd className="h-5 text-[10px] px-1.5">{cmdHint}</Kbd>
                <span className="hidden lg:inline">{tDash('commands')}</span>
              </button>
            </div>
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
        onAssignVehicle={handleVehicleAssign}
        onRemoveVehicle={handleVehicleRemove}
        onAssignResource={handleOpenAssignmentDialog}
        onRemoveCrew={removeCrew}
        onRemoveMaterial={removeMaterial}
        diveraEnabled={diveraEnabled}
        onSendDivera={(op) => setDiveraDialogOp(op)}
        onRequestComplete={isEditor ? requestCompletion : undefined}
      />

      <NewEmergencyModal
        open={newEmergencyModalOpen}
        onOpenChange={(open) => {
          setNewEmergencyModalOpen(open)
          if (!open) setNewEmergencyGroupId(null)
        }}
        onCreateOperation={createOperation}
        nextOperationId={getNextOperationId()}
        defaultGroupId={newEmergencyGroupId}
      />

      {/* Resource Assignment Dialog */}
      <ResourceAssignmentDialog
        open={assignmentDialogOpen}
        onOpenChange={(open) => {
          setAssignmentDialogOpen(open)
          // If this dialog was opened from a resource gate, return to that gate on close
          // so the operator sees the updated state (checklist) or a resolved warning.
          if (!open && assignReturnTo) {
            const { kind, opId } = assignReturnTo
            setAssignReturnTo(null)
            // Reopen by id — both gates derive their op live, so the checklist reflects
            // the just-assigned resource as soon as `operations` updates, and the
            // returning warning self-dismisses once a vehicle is present.
            if (kind === 'missing') setMissingResourcesAckOpId(opId)
            else setReturningVehicleAckOpId(opId)
          }
        }}
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
        zuFuss={assignmentOperationId ? operations.find(op => op.id === assignmentOperationId)?.zuFuss ?? false : false}
        onToggleZuFuss={assignmentOperationId ? () => handleToggleZuFuss(assignmentOperationId) : undefined}
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
                <SheetTitle>{tDash('checkInSheetTitle')}</SheetTitle>
                <SheetDescription>
                  {tDash('checkInSheetDescription')}
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
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="flex-shrink-0 text-muted-foreground"
                      title={tCommon('openInNewTab')}
                    >
                      <a href={checkInUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    {printerEnabled && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePrintQR(checkInUrl, tDash('checkInSheetTitle'), tDash('checkInSheetHint'))}
                        disabled={isPrintingQR}
                        className="flex-shrink-0"
                        title={tCommon('printQrCode')}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tDash('checkInSheetHint')}
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
                <SheetTitle>{tDash('rekoSheetTitle')}</SheetTitle>
                <SheetDescription>
                  {tDash('rekoSheetDescription')}
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
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="flex-shrink-0 text-muted-foreground"
                      title={tCommon('openInNewTab')}
                    >
                      <a href={rekoDashboardUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    {printerEnabled && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePrintQR(rekoDashboardUrl, tDash('rekoSheetTitle'), tDash('rekoSheetHint'))}
                        disabled={isPrintingQR}
                        className="flex-shrink-0"
                        title={tCommon('printQrCode')}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tDash('rekoSheetHint')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Display share QR Code Sheet */}
      <Sheet modal={false} open={displaySheetOpen} onOpenChange={(open) => !open && activeFooterSheet === 'display' && setActiveFooterSheet(null)}>
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
            {displayUrl && (
              <div className="rounded-lg border p-3 bg-white flex-shrink-0">
                <QRCodeSVG
                  value={displayUrl}
                  size={140}
                  level="M"
                  includeMargin={false}
                />
              </div>
            )}

            {/* Content */}
            <div className="flex-1 min-w-0">
              <SheetHeader className="p-0 mb-3">
                <SheetTitle>{tDash('displaySheetTitle')}</SheetTitle>
                <SheetDescription>
                  {tDash('displaySheetDescription')}
                </SheetDescription>
              </SheetHeader>

              {/* View selector — one token, three display targets */}
              <div className="flex gap-1.5 mb-3">
                {(['board', 'map', 'status'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setDisplayView(v)}
                    className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                      displayView === v
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    {tDash(`displayView.${v}`)}
                  </button>
                ))}
              </div>

              {displayUrl && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={displayUrl}
                      readOnly
                      className="flex-1 rounded-md border px-3 py-1.5 text-xs bg-muted font-mono truncate"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyDisplayUrlToClipboard}
                      className="flex-shrink-0"
                    >
                      {displayCopied ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="flex-shrink-0 text-muted-foreground"
                      title={tCommon('openInNewTab')}
                    >
                      <a href={displayUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    {printerEnabled && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePrintQR(displayUrl, tDash('displaySheetTitle'), tDash('displaySheetHint'))}
                        disabled={isPrintingQR}
                        className="flex-shrink-0"
                        title={tCommon('printQrCode')}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tDash('displaySheetHint')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Alarm Intake Link Sheet */}
      <Sheet modal={false} open={alarmQrDialogOpen} onOpenChange={(open) => !open && activeFooterSheet === 'alarm' && setActiveFooterSheet(null)}>
        <SheetContent
          side="bottom"
          hideCloseButton
          overlayOffset="42px"
          nonModal
          className="max-w-3xl mx-auto px-6 py-4"
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement
            if (target.closest('footer')) {
              e.preventDefault()
            }
          }}
        >
          <div className="flex items-start gap-6">
            {/* QR Code */}
            {alarmUrl && (
              <div className="rounded-lg border p-3 bg-white flex-shrink-0">
                <QRCodeSVG
                  value={alarmUrl}
                  size={140}
                  level="M"
                  includeMargin={false}
                />
              </div>
            )}

            {/* Content */}
            <div className="flex-1 min-w-0">
              <SheetHeader className="p-0 mb-3">
                <SheetTitle>{tDash('alarmSheetTitle')}</SheetTitle>
                <SheetDescription>
                  {tDash('alarmSheetDescription')}
                </SheetDescription>
              </SheetHeader>

              {alarmUrl && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={alarmUrl}
                      readOnly
                      className="flex-1 rounded-md border px-3 py-1.5 text-xs bg-muted font-mono truncate"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyAlarmUrlToClipboard}
                      className="flex-shrink-0"
                    >
                      {alarmCopied ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="flex-shrink-0 text-muted-foreground"
                      title={tCommon('openInNewTab')}
                    >
                      <a href={alarmUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    {printerEnabled && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePrintQR(alarmUrl, tDash('alarmSheetTitle'), tDash('alarmSheetHint'))}
                        disabled={isPrintingQR}
                        className="flex-shrink-0"
                        title={tCommon('printQrCode')}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tDash('alarmSheetHint')}
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

      {/* Aufträge (multi-stop route) Sheet */}
      <AuftraegeSheet
        open={auftraegeSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'auftraege' && setActiveFooterSheet(null)}
        focusGroupId={auftraegeFocusGroupId}
        onAddStop={(groupId) => {
          setNewEmergencyGroupId(groupId)
          setNewEmergencyModalOpen(true)
        }}
        onAssignResource={handleOpenAssignmentDialog}
        onOpenDetail={handleOpenIncidentFromNotification}
        // TODO(routen-editor): open the RoutenEditorModal (next phase). No-op for now.
        onOpenRoutenEditor={() => {}}
      />

      {/* Delete Operation Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={tCommon('deleteIncidentTitle')}
        description={tCommon('deleteIncidentDescription', { name: operationToDelete ? (formatLocation(operationToDelete.location ?? '') || getIncidentTypeLabel(operationToDelete.incidentType)) : '' })}
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

      {/* Missing-resources checklist — gate before disponieren. Each still-missing
          category can be assigned inline; the operator returns here after each. */}
      <AlertDialog
        open={!!missingResourcesAckOp}
        onOpenChange={(open) => !open && setMissingResourcesAckOpId(null)}
      >
        <AlertDialogContent>
          {missingResourcesAckOp && (() => {
            const op = missingResourcesAckOp
            const allFilled = getMissingResources(op).length === 0
            const rows = [
              { key: 'crew' as const, icon: Users, filled: op.crew.length > 0, summary: tMissing('personalSummary', { count: op.crew.length }) },
              { key: 'vehicles' as const, icon: Truck, filled: op.zuFuss || op.vehicles.length > 0, summary: op.zuFuss ? tCommon('zuFuss') : op.vehicles.join(', ') },
              { key: 'materials' as const, icon: Package, filled: op.materials.length > 0, summary: tMissing('mittelSummary', { count: op.materials.length }) },
            ]
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    {allFilled
                      ? <CheckCircle2 className="h-5 w-5 text-success" />
                      : <Package className="h-5 w-5 text-primary" />}
                    {allFilled ? tMissing('readyTitle') : tMissing('title')}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {tMissing.rich(allFilled ? 'readyIntro' : 'checklistIntro', {
                      location: op.location,
                      hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="space-y-1.5 py-1">
                  {/* Whole row is clickable — open the category to add or remove, whether
                      it's still missing or already satisfied. */}
                  {rows.map(({ key, icon: Icon, filled, summary }) => (
                    <button
                      key={key}
                      onClick={() => openGateAssign(key, op.id, 'missing')}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40"
                    >
                      {filled
                        ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />
                        : <AlertCircle className="h-4 w-4 flex-shrink-0 text-warning" />}
                      <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{tRes(key)}</div>
                        {filled && summary && <div className="truncate text-xs text-muted-foreground">{summary}</div>}
                      </div>
                      {filled ? (
                        <span className="flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <Plus className="h-3.5 w-3.5" />
                          {tMissing('addMore')}
                        </span>
                      ) : (
                        <span className="flex-shrink-0 rounded-md bg-secondary px-2 py-1 text-xs font-medium">
                          {tCommon('assign')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <AlertDialogFooter className={allFilled ? undefined : 'sm:justify-between'}>
                  {!allFilled && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setDisponiertDialogOp(op)
                        setMissingResourcesAckOpId(null)
                      }}
                    >
                      {tMissing('dispatchAnyway')}
                    </Button>
                  )}
                  <Button
                    disabled={!allFilled}
                    onClick={() => {
                      setDisponiertDialogOp(op)
                      setMissingResourcesAckOpId(null)
                    }}
                  >
                    {tMissing('done')}
                  </Button>
                </AlertDialogFooter>
              </>
            )
          })()}
        </AlertDialogContent>
      </AlertDialog>

      {/* No-vehicle warning — gate before einsatz → beendet/rückfahrt */}
      <AlertDialog
        open={!!returningVehicleAckOp}
        onOpenChange={(open) => !open && setReturningVehicleAckOpId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Footprints className="h-5 w-5 text-warning" />
              {tReturning('title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {returningVehicleAckOp && tReturning.rich('description', {
                location: returningVehicleAckOp.location,
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={() => setReturningVehicleAckOpId(null)}>
              {tReturning('endAnyway')}
            </Button>
            <Button
              onClick={() => {
                const op = returningVehicleAckOp
                if (op) openGateAssign('vehicles', op.id, 'returning')
              }}
            >
              {tReturning('assignVehicle')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reko-person missing — gate when moving a card into the REKO column */}
      <AlertDialog
        open={!!rekoMissingAckOp}
        onOpenChange={(open) => !open && setRekoMissingAckOp(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Binoculars className="h-5 w-5 text-primary" />
              {tCommon('noRekoAssigned')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {rekoMissingAckOp && tReko.rich('description', {
                location: rekoMissingAckOp.location,
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={() => setRekoMissingAckOp(null)}>
              {tReko('proceedAnyway')}
            </Button>
            <Button
              onClick={() => {
                const op = rekoMissingAckOp
                setRekoMissingAckOp(null)
                if (op) handleOpenRekoAssignDialog(op.id)
              }}
            >
              {tReko('assignReko')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reko form not filled — gate when moving a card into REKO ABGESCHLOSSEN */}
      <AlertDialog
        open={!!rekoFormMissingAckOp}
        onOpenChange={(open) => !open && setRekoFormMissingAckOp(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              {tRekoForm('title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {rekoFormMissingAckOp && tRekoForm.rich('description', {
                location: rekoFormMissingAckOp.location,
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={() => setRekoFormMissingAckOp(null)}>
              {tRekoForm('proceedAnyway')}
            </Button>
            <Button
              onClick={() => {
                const op = rekoFormMissingAckOp
                setRekoFormMissingAckOp(null)
                if (op) {
                  setSelectedOperationId(op.id)
                  setDetailModalOpen(true)
                }
              }}
            >
              {tRekoForm('openReko')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Material decision on completion — release the materials or leave them on site.
          Completion already happened (materials kept by default); this only decides
          whether to additionally release them. Dismiss/cancel keeps them (safe default). */}
      <AlertDialog
        open={!!materialDecisionOp}
        onOpenChange={(open) => !open && setMaterialDecisionOp(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              {tMat('title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {materialDecisionOp && tMat.rich('description', {
                location: materialDecisionOp.location,
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {materialDecisionOp && (
            <div className="max-h-64 space-y-1.5 overflow-y-auto py-1">
              {materialDecisionOp.materials.map((materialId) => {
                const choice = materialDecisions[materialId] ?? 'magazin'
                const name = materials.find((m) => m.id === materialId)?.name ?? materialId
                return (
                  <div key={materialId} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                    <div className="flex flex-shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant={choice === 'magazin' ? 'default' : 'outline'}
                        className="h-7 px-2 text-xs"
                        onClick={() => setMaterialDecisions((prev) => ({ ...prev, [materialId]: 'magazin' }))}
                      >
                        {tMat('toMagazinShort')}
                      </Button>
                      <Button
                        size="sm"
                        variant={choice === 'vorort' ? 'default' : 'outline'}
                        className="h-7 px-2 text-xs"
                        onClick={() => setMaterialDecisions((prev) => ({ ...prev, [materialId]: 'vorort' }))}
                      >
                        {tMat('onSiteShort')}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <AlertDialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={() => setMaterialDecisionOp(null)}>
              {tMat('cancel')}
            </Button>
            <Button
              onClick={() => {
                const op = materialDecisionOp
                setMaterialDecisionOp(null)
                if (!op) return
                const nameOf = (id: string) => materials.find((m) => m.id === id)?.name ?? id
                const returned = op.materials.filter((id) => (materialDecisions[id] ?? 'magazin') === 'magazin')
                const kept = op.materials.filter((id) => (materialDecisions[id] ?? 'magazin') === 'vorort')
                for (const id of returned) removeMaterial(op.id, id)
                const description = [
                  returned.length ? `${tMat('toastToMagazin')}: ${returned.map(nameOf).join(', ')}` : null,
                  kept.length ? `${tMat('toastOnSite')}: ${kept.map(nameOf).join(', ')}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
                toast.success(returned.length ? tDash('materialReturned') : tMat('leftOnSite'), { description })
              }}
            >
              {tMat('confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Disponiert Transition Dialog */}
      <DisponierTransitionDialog
        open={!!disponiertDialogOp}
        onOpenChange={(open) => !open && setDisponiertDialogOp(null)}
        operation={disponiertDialogOpLive}
        materials={materials}
        printerEnabled={printerEnabled}
        funkrufname={funkrufname}
        diveraEnabled={diveraEnabled}
        onSendDivera={(op) => {
          setDisponiertDialogOp(null)
          setDiveraDialogOp(op)
        }}
      />

      <DiveraSendDialog
        open={!!diveraDialogOp}
        onOpenChange={(open) => !open && setDiveraDialogOp(null)}
        operation={diveraDialogOpLive}
        materials={materials}
      />

      {/* Resource transfer dialog — opened from the card context menu */}
      {transferSourceOp && (
        <TransferIncidentDialog
          open={!!transferSourceOp}
          onOpenChange={(open) => !open && setTransferSourceOp(null)}
          sourceIncident={transferSourceOp as unknown as Incident}
          sourceName={transferSourceOp?.location}
          availableIncidents={transferAvailableIncidents}
          onTransfer={handleTransfer}
          isTransferring={isTransferring}
        />
      )}

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
        onReko={generateRekoDashboardQR}
        onDisplay={generateDisplayShare}
        onPersonnel={() => setMobilePersonnelSheetOpen(true)}
        onVehicleStatus={() => setActiveFooterSheet('vehicles')}
        onPrint={() => setActiveFooterSheet(printModalOpen ? null : 'print')}
        onThermo={() => setActiveFooterSheet(thermoSheetOpen ? null : 'thermo')}
        printerEnabled={printerEnabled}
      />
    </ProtectedRoute>
  )
}
