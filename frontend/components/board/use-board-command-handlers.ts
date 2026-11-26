"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useOperations } from "@/lib/contexts/operations-context"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { useStandby } from "@/lib/contexts/standby-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useNotifications } from "@/lib/contexts/notification-context"
import { useVehicleShortcuts } from "@/lib/contexts/operations/use-vehicle-shortcuts"
import { incidentCommandsFor, useCommandPalette, type IncidentCommand } from "@/lib/contexts/command-palette-context"
import { useGPrefixNavigation } from "@/lib/hooks/use-g-prefix-navigation"
import { useKanbanShortcuts } from "@/lib/hooks/use-kanban-shortcuts"
import { usePrintAssignmentSlip } from "@/lib/hooks/use-print-assignment-slip"
import { toggleFigures } from "@/components/figures-dialog"
import type { IncidentDialogsController } from "@/components/kanban/incident-dialogs"
import type { BoardCardActions } from "./use-board-card-actions"
import type { BoardDialogActions } from "./use-board-dialog-actions"
import type { BoardDispatchRef } from "./use-board-dispatch"
import type { BoardLayout, BoardSelection } from "./use-board-selection"
import type { BoardSheets } from "./use-board-sheets"

interface UseBoardCommandHandlersInput {
  selection: Pick<
    BoardSelection,
    "selectedOperationId" | "hoveredOperationId" | "detailModalOpen" | "openIncidentDetail" | "scrollToCard" | "moveSelection"
  >
  layout: Pick<BoardLayout, "setShowLeftSidebar" | "setShowRightSidebar" | "setSidePanelMode">
  sheets: Pick<BoardSheets, "activeFooterSheet" | "setActiveFooterSheet" | "setAuftraegeFocusGroupId" | "writeJournal">
  cardActions: Pick<
    BoardCardActions,
    "moveOperationRight" | "moveOperationLeft" | "toggleVehicleAssignment" | "setOperationPriority" | "toggleZuFuss" | "handleRequestDelete"
  >
  dialogs: IncidentDialogsController
  dialogActions: Pick<BoardDialogActions, "handleOpenRekoAssignDialog" | "handleToggleAmWarten" | "handleToggleNachbarhilfe" | "openAttendance">
  dispatchRef: BoardDispatchRef
  /** Opens the Checkliste (`useBoardChecklist`). */
  openChecklist: () => void
  newEmergencyModalOpen: boolean
  setNewEmergencyModalOpen: (open: boolean) => void
  printerEnabled: boolean
}

/**
 * The board's commands, both ways in: the command palette (sheets, sidebars, the
 * selected card's actions, ⌘K dispatch) and the keyboard shortcuts. Registered for
 * as long as the board is mounted. Reads the board contexts itself; a new command
 * is an entry here (and in the palette's or the shortcut hook's list).
 */
export function useBoardCommandHandlers({
  selection,
  layout,
  sheets,
  cardActions,
  dialogs,
  dialogActions,
  dispatchRef,
  openChecklist,
  newEmergencyModalOpen,
  setNewEmergencyModalOpen,
  printerEnabled,
}: UseBoardCommandHandlersInput) {
  const { operations, vehicles: fleet, outOfServiceVehicleIds, refreshOperations, updateOperation } = useOperations()
  const { personnel } = usePersonnel()
  const { materials } = useMaterials()
  const { selectedEvent } = useEvent()
  const { isEditor, isViewer } = useAuth()
  const { canAddNew } = useStandby()
  const canAdd = isEditor || canAddNew
  const { toggleSidebar: toggleNotificationSidebar } = useNotifications()
  const { registerHandlers, clearHandlers } = useCommandPalette()
  const router = useRouter()
  const gPrefix = useGPrefixNavigation(router, '/')
  const vehicleTypes = useVehicleShortcuts()
  const { selectedOperationId, hoveredOperationId, detailModalOpen, openIncidentDetail, scrollToCard, moveSelection } = selection
  const { setShowLeftSidebar, setShowRightSidebar, setSidePanelMode } = layout
  const { activeFooterSheet, setActiveFooterSheet, setAuftraegeFocusGroupId, writeJournal } = sheets
  const { moveOperationRight, moveOperationLeft, toggleVehicleAssignment, setOperationPriority, toggleZuFuss, handleRequestDelete } = cardActions
  const { requestCompletion } = dialogs.statusWorkflow

  // What the commands run on the selected card: each entry is the handler its
  // right-click row calls, so both ways stay one behaviour. Read through a ref by
  // the registration below, which must not re-run on every render.
  const { print: printAssignmentSlip } = usePrintAssignmentSlip()
  const boardCommands = {
    incident: (command: IncidentCommand, operationId: string) => {
      const run: Record<IncidentCommand, () => void> = {
        assignCrew: () => dialogs.openAssignment('crew', operationId),
        assignVehicle: () => dialogs.openAssignment('vehicles', operationId),
        assignMaterial: () => dialogs.openAssignment('materials', operationId),
        assignReko: () => dialogActions.handleOpenRekoAssignDialog(operationId),
        transfer: () => void dialogs.openTransfer(operationId),
        distribute: () => dialogs.openAuftragPicker(operationId),
        toggleAmWarten: () => dialogActions.handleToggleAmWarten(operationId),
        toggleNachbarhilfe: () => dialogActions.handleToggleNachbarhilfe(operationId),
        complete: () => requestCompletion(operationId),
        print: () => void printAssignmentSlip(operationId),
      }
      run[command]()
    },
    openAttendance: dialogActions.openAttendance,
    openChecklist,
  }
  const boardCommandsRef = useRef(boardCommands)
  boardCommandsRef.current = boardCommands

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
      onTogglePrint: () => setActiveFooterSheet(prev => prev === 'print' ? null : 'print'),
      onToggleLinks: () => setActiveFooterSheet(prev => prev === 'links' ? null : 'links'),
      onToggleRapporte: () => setActiveFooterSheet(prev => prev === 'rapporte' ? null : 'rapporte'),
      onToggleJournal: () => setActiveFooterSheet(prev => prev === 'journal' ? null : 'journal'),
      onWriteJournal: isEditor ? () => writeJournal(selectedOperationId) : undefined,
      onToggleFigures: toggleFigures,
      onToggleCrewDuty: () => setActiveFooterSheet(prev => prev === 'crew' ? null : 'crew'),
      onToggleAuftraege: () => setActiveFooterSheet(prev => {
        if (prev === 'auftraege') return null
        setAuftraegeFocusGroupId(null)
        return 'auftraege'
      }),
      onOpenAuftrag: (groupId: string) => {
        setAuftraegeFocusGroupId(groupId)
        setActiveFooterSheet('auftraege')
      },
      onToggleNotifications: toggleNotificationSidebar,
      onToggleSidePanel: () =>
        setSidePanelMode(prev => (prev === 'collapsed' ? 'detail' : 'collapsed')),
      onSidePanelDetail: () => setSidePanelMode('detail'),
      onSidePanelMap: () => router.push(selectedOperationId ? `/map?highlight=${selectedOperationId}` : '/map'),
      // Everything below acts on the SELECTED card, never on the hovered one:
      // while the palette is open the pointer is over the palette, and a
      // command that mutates has to name the card the operator chose.
      onToggleZuFuss: () => {
        if (selectedOperationId) toggleZuFuss(selectedOperationId)
      },
      onSearchPersonnel: () => {
        setShowLeftSidebar(true)
        setTimeout(() => document.getElementById('personnel-search-input')?.focus(), 50)
      },
      onSearchMaterial: () => {
        setShowRightSidebar(true)
        setTimeout(() => document.getElementById('material-search-input')?.focus(), 50)
      },
      hasSelectedIncident: !!selectedOperationId,
      // Everything but the print is a write; the slip needs a printer.
      incidentCommands: incidentCommandsFor(operations.find((op) => op.id === selectedOperationId), { isEditor, printerEnabled }),
      onIncidentCommand: (command) => {
        if (selectedOperationId) boardCommandsRef.current.incident(command, selectedOperationId)
      },
      onOpenAttendance: () => boardCommandsRef.current.openAttendance(),
      onOpenChecklist: () => boardCommandsRef.current.openChecklist(),
      onEditIncident: () => {
        if (selectedOperationId) {
          const operation = operations.find(op => op.id === selectedOperationId)
          if (operation) {
            openIncidentDetail(operation.id)
          }
        }
      },
      onDeleteIncident: () => {
        if (selectedOperationId) handleRequestDelete(selectedOperationId)
      },
      onMoveStatusForward: () => {
        if (selectedOperationId) {
          moveOperationRight(selectedOperationId)
        }
      },
      onMoveStatusBackward: () => {
        if (selectedOperationId) {
          moveOperationLeft(selectedOperationId)
        }
      },
      onSetPriority: (priority) => {
        if (selectedOperationId) setOperationPriority(selectedOperationId, priority)
      },
      onAssignVehicle: (vehicleNumber) => {
        if (selectedOperationId) {
          const vehicleType = vehicleTypes[vehicleNumber - 1]
          if (vehicleType) {
            const operation = operations.find(op => op.id === selectedOperationId)
            if (operation) toggleVehicleAssignment(operation, vehicleType)
          }
        }
      },
      // Type-to-dispatch: a fresh getter per registration, so the palette's
      // vocabulary follows the board while it is open.
      getDispatchVocabulary: () => dispatchRef.current.vocabulary(),
      onDispatch: isEditor ? (command) => dispatchRef.current.run(command) : undefined,
      onDispatchJump: (target) => dispatchRef.current.jump(target),
      onOpenIncident: (incidentId) => {
        scrollToCard(incidentId)
        openIncidentDetail(incidentId)
      },
    })
    return () => clearHandlers()
  }, [
    isEditor,
    scrollToCard,
    // The palette's vocabulary is read through `getDispatchVocabulary`; a new
    // registration whenever what it lists changes keeps an open palette current.
    personnel,
    fleet,
    materials,
    outOfServiceVehicleIds,
    registerHandlers,
    clearHandlers,
    refreshOperations,
    toggleNotificationSidebar,
    selectedOperationId,
    operations,
    vehicleTypes,
    moveOperationRight,
    moveOperationLeft,
    setOperationPriority,
    toggleZuFuss,
    handleRequestDelete,
    toggleVehicleAssignment,
    openIncidentDetail,
    dispatchRef,
    boardCommandsRef,
    printerEnabled,
    setActiveFooterSheet,
    setAuftraegeFocusGroupId,
    setNewEmergencyModalOpen,
    writeJournal,
    // Stable (state setters, the App Router's router); listed so the rule can check the rest.
    router,
    setShowLeftSidebar,
    setShowRightSidebar,
    setSidePanelMode,
  ])

  useKanbanShortcuts(
    {
      readOnly: isViewer,
      modalOpen:
        detailModalOpen ||
        newEmergencyModalOpen ||
        dialogs.assignmentOpen ||
        // Vehicle, Aufträge, Drucken, Links, Rapporte and Verlauf footers are non-modal
        // on desktop: keep their toggle keys (F / A / D / T / O / J) able to close
        // them again. Every other shortcut still stops at an open sheet — it is
        // only the key that opened this one that stays live.
        (!!activeFooterSheet &&
          activeFooterSheet !== 'vehicles' &&
          activeFooterSheet !== 'auftraege' &&
          activeFooterSheet !== 'print' &&
          activeFooterSheet !== 'links' &&
          activeFooterSheet !== 'rapporte' &&
          activeFooterSheet !== 'journal'),
      hoveredOperationId,
      selectedOperationId,
      operations,
      vehicleTypes,
      gPrefix,
    },
    {
      onToggleVehicle: (vehicle, opId) => {
        // Recompute the target (route vs incident) from the operation — the
        // hook's `isAssigned` reflects only incident-level vehicles, which are
        // always empty on a grouped card.
        const operation = operations.find((op) => op.id === opId)
        if (operation) toggleVehicleAssignment(operation, vehicle)
      },
      // The only update a shortcut applies is the priority, and it toasts —
      // see `setOperationPriority`.
      onUpdateOperation: (opId, updates) => {
        if (updates.priority) setOperationPriority(opId, updates.priority)
        else updateOperation(opId, updates)
      },
      onMoveRight: moveOperationRight,
      onMoveLeft: moveOperationLeft,
      onMoveSelection: moveSelection,
      onToggleZuFuss: toggleZuFuss,
      onRefresh: refreshOperations,
      onOpenDetail: (op) => {
        openIncidentDetail(op.id)
      },
      onRequestDelete: (op) => handleRequestDelete(op.id),
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
      onToggleAuftraege: () =>
        setActiveFooterSheet((prev) => {
          if (prev === 'auftraege') return null
          setAuftraegeFocusGroupId(null)
          return 'auftraege'
        }),
      onToggleLeftSidebar: () => setShowLeftSidebar((prev) => !prev),
      onToggleRightSidebar: () => setShowRightSidebar((prev) => !prev),
      onToggleSidePanel: () =>
        setSidePanelMode((prev) => (prev === 'collapsed' ? 'detail' : 'collapsed')),
      onSidePanelDetail: () => setSidePanelMode('detail'),
      onSidePanelMap: () => router.push(selectedOperationId ? `/map?highlight=${selectedOperationId}` : '/map'),
      onTogglePrint: () => setActiveFooterSheet((prev) => (prev === 'print' ? null : 'print')),
      onToggleLinks: () => setActiveFooterSheet((prev) => (prev === 'links' ? null : 'links')),
      onToggleRapporte: () => setActiveFooterSheet((prev) => (prev === 'rapporte' ? null : 'rapporte')),
      onToggleJournal: () => setActiveFooterSheet((prev) => (prev === 'journal' ? null : 'journal')),
      onWriteJournal: canAdd && selectedEvent ? () => writeJournal(selectedOperationId ?? null) : undefined,
      onToggleFigures: toggleFigures,
      onToggleNotifications: toggleNotificationSidebar,
    },
  )
}
