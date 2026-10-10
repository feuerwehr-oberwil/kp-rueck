"use client"

import { useEffect } from "react"
import { type Person, type Operation, type Material } from "@/lib/contexts/operations-context"
import type { DispatchCommand } from "@/lib/hooks/use-command-dispatch"
import type { DispatchResource, DispatchVocabulary } from "@/lib/command-dispatch"
import { type OperationDetailSection, type OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { type FooterSheet } from "@/components/board/board-footer"
import { toggleFigures } from "@/components/figures-dialog"
import type { Dispatch, SetStateAction, RefObject } from "react"
import type { ApiVehicle } from "@/lib/api-client"
import type { CommandPaletteHandlers } from "@/lib/contexts/command-palette-context"
import type { useRouter } from "next/navigation"
import type { SidePanelMode } from "@/lib/hooks/use-board-layout-prefs"

export interface UseBoardCommandHandlersInput {
  fleet: ApiVehicle[]
  operations: Operation[]
  materials: Material[]
  refreshOperations: () => Promise<void>
  outOfServiceVehicleIds: Set<string>
  dispatchRef: RefObject<{ vocabulary: () => DispatchVocabulary; run: (command: DispatchCommand) => void; jump: (target: DispatchResource) => void; }>
  personnel: Person[]
  isEditor: boolean
  toggleNotificationSidebar: () => void
  clearHandlers: () => void
  registerHandlers: (handlers: CommandPaletteHandlers) => void
  router: ReturnType<typeof useRouter>
  scrollToCard: (operationId: string) => void
  selectedOperationId: string | null
  setNewEmergencyModalOpen: Dispatch<SetStateAction<boolean>>
  setShowRightSidebar: Dispatch<SetStateAction<boolean>>
  setSidePanelMode: Dispatch<SetStateAction<SidePanelMode>>
  setShowLeftSidebar: Dispatch<SetStateAction<boolean>>
  openIncidentDetail: (operationId: string, tab?: OperationDetailTab, section?: OperationDetailSection, options?: { allowModal?: boolean; }) => void
  vehicleTypes: { key: string; name: string; id: string; type: string; status: string; }[]
  setActiveFooterSheet: Dispatch<SetStateAction<FooterSheet | null>>
  setAuftraegeFocusGroupId: Dispatch<SetStateAction<string | null>>
  moveOperationRight: (operationId: string) => void
  moveOperationLeft: (operationId: string) => void
  toggleVehicleAssignment: (op: Operation, vehicle: { id: string; name: string; }) => void
  setOperationPriority: (operationId: string, priority: Operation["priority"]) => void
  toggleZuFuss: (operationId: string) => void
  handleRequestDelete: (operationId: string) => void
  /** Journal open, caret in its line, linked to this card (⇧J). */
  writeJournal: (incidentId: string | null) => void
}

/**
 * Registers the board's command-palette handlers (sheets, sidebars, the selected
 * card's actions, ⌘K dispatch) for as long as the board is mounted. Moved
 * verbatim out of app/page.tsx.
 */
export function useBoardCommandHandlers(input: UseBoardCommandHandlersInput) {
  const {
    fleet,
    operations,
    materials,
    refreshOperations,
    outOfServiceVehicleIds,
    dispatchRef,
    personnel,
    isEditor,
    toggleNotificationSidebar,
    clearHandlers,
    registerHandlers,
    router,
    scrollToCard,
    selectedOperationId,
    setNewEmergencyModalOpen,
    setShowRightSidebar,
    setSidePanelMode,
    setShowLeftSidebar,
    openIncidentDetail,
    vehicleTypes,
    setActiveFooterSheet,
    setAuftraegeFocusGroupId,
    moveOperationRight,
    moveOperationLeft,
    toggleVehicleAssignment,
    setOperationPriority,
    toggleZuFuss,
    handleRequestDelete,
    writeJournal,
  } = input

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
    setActiveFooterSheet,
    setAuftraegeFocusGroupId,
    setNewEmergencyModalOpen,
    writeJournal,
  ])

  return {
  }
}
