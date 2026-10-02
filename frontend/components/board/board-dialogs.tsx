"use client"

/**
 * Everything the board opens over itself: the incident detail, the new-incident
 * modal, the assignment dialog, the footer sheets, the Auftrag pickers and the
 * route editor, the ask-first confirmations, the status workflow's dialogs, the
 * Divera and transfer dialogs, and the mobile sheet and navigation.
 *
 * Wiring only — the board page owns every piece of state and every handler and
 * passes them in under the names it uses itself, so this JSX is the page's,
 * moved verbatim (2026-09-23), in the same order: dialogs that can be open at
 * the same time still mount in the sequence they always did.
 */

import type { Dispatch, SetStateAction } from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"
import { TransferIncidentDialog } from "@/components/incidents/transfer-incident-dialog"
import { DiveraMessageDialog } from "@/components/divera/divera-message-dialog"
import { DiveraSendDialog } from "@/components/divera/divera-send-dialog"
import { RekoPickerDialog } from "@/components/event-setup-checklist"
import { AttendanceModal } from "@/components/kanban/attendance-modal"
import { AuftraegeSheet } from "@/components/kanban/auftraege-sheet"
import { AuftragPickerDialog } from "@/components/kanban/auftrag-picker-dialog"
import { ClosedStopDialog } from "@/components/kanban/closed-stop-dialog"
import { IncidentStatusWorkflowDialogs, type useIncidentStatusWorkflow } from "@/components/kanban/incident-status-workflow"
import { LinksQrSheet } from "@/components/kanban/links-qr-sheet"
import { NewEmergencyModal } from "@/components/kanban/new-emergency-modal"
import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import { RapportBacklogSheet, type selectFiledRapports, type selectOpenRapports } from "@/components/kanban/rapport-backlog-sheet"
import { ResourceAssignmentDialog } from "@/components/kanban/resource-assignment-dialog"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { MobilePersonnelSheet } from "@/components/mobile/mobile-personnel-sheet"
import { PrintHubSheet, type ThermoPrintOptions } from "@/components/print/print-hub-sheet"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"
import { VehicleStatusSheet } from "@/components/vehicle-status-sheet"
import type { FooterSheet } from "@/components/board/board-footer"
import type { useEvent } from "@/lib/contexts/event-context"
import type { useGroups } from "@/lib/contexts/groups-context"
import type { Material, Operation, OperationStatus, Person, useOperations } from "@/lib/contexts/operations-context"
import type { usePersonnel } from "@/lib/contexts/personnel-context"
import type { useClosedStopGuard } from "@/lib/hooks/use-closed-stop-guard"
import type { useToggleDriverStay } from "@/lib/hooks/use-driver-stay"
import type { OperationDetailSection, OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import type { useOperationHandlers } from "@/lib/hooks/use-operation-handlers"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import type { Incident } from "@/lib/types/incidents"

/**
 * The two Auftrag dialogs that carry a map, loaded on their own chunk.
 *
 * Both are mounted (closed) for the whole life of the board, so a static import put
 * `maplibre-gl` — the single biggest dependency the app has — into the board's first-load
 * bundle, for two dialogs most shifts never open. `ssr: false` because a GL canvas needs a
 * browser; the chunk is fetched right after hydration, so the first open is not held up by it.
 */
const RoutenEditorModal = dynamic(
  () => import("@/components/kanban/routen-editor-modal").then((mod) => mod.RoutenEditorModal),
  { ssr: false },
)
const IncidentPickerDialog = dynamic(
  () => import("@/components/kanban/incident-picker-dialog").then((mod) => mod.IncidentPickerDialog),
  { ssr: false },
)

type Ops = ReturnType<typeof useOperations>
type Groups = ReturnType<typeof useGroups>
type StatusWorkflow = ReturnType<typeof useIncidentStatusWorkflow>
type OperationHandlers = ReturnType<typeof useOperationHandlers>

/** What the assignment dialog assigns. */
export type ResourceKind = 'crew' | 'vehicles' | 'materials'

/** The fleet as the board's number keys see it (`display_order` → key). */
export interface BoardVehicleType { key: string; name: string; id: string; type: string; status: string }

/** «Open the detail on THIS tab» — see the page's `openDetailOnTab`. */
export interface OpenDetailOnTab { tab: OperationDetailTab; nonce: number; section?: OperationDetailSection }

/** The ask-first for the two distribute moves without an undo. */
export interface DistributeConfirm {
  groupId: string
  incidentId: string
  incidentLabel: string
  fromName: string | null
  dispatched: boolean
}

/** Route-level resource assign: the assignment dialog scoped to an Auftrag. */
export interface RouteAssign { groupId: string; resourceType: ResourceKind }

export interface BoardDialogsProps {
  activeFooterSheet: FooterSheet | null
  assignGroupResource: Groups["assignResource"]
  assignMaterialToOperation: Ops["assignMaterialToOperation"]
  assignPersonToOperation: Ops["assignPersonToOperation"]
  assignVehicleToGroupWithConflict: (groupId: string, vehicleId: string) => void
  assignVehicleToIncidentWithConflict: (vehicleId: string, vehicleName: string, operationId: string) => void
  assignedResources: { assignedPersonnel: string[]; assignedVehicles: string[]; assignedMaterials: string[] }
  assignmentDialogOpen: boolean
  assignmentLabelForPerson: (person: { name: string }) => string | null
  assignmentOperationId: string | null
  assignmentResourceType: ResourceKind | null
  attendanceOpen: boolean
  auftraegeFocusGroupId: string | null
  auftraegeSheetOpen: boolean
  auftragPickerIncidentId: string | null
  closedStopGuard: ReturnType<typeof useClosedStopGuard>
  createGroup: Groups["createGroup"]
  createOperation: Ops["createOperation"]
  deleteDialogOpen: boolean
  deleteReleaseHint: string | null
  detailModalOpen: boolean
  distributeConfirm: DistributeConfirm | null
  diveraDialogOp: Operation | null
  diveraDialogOpLive: Operation | null
  diveraEnabled: boolean
  diveraMessageText: string | null
  filedRapports: ReturnType<typeof selectFiledRapports>
  formatLocation: Ops["formatLocation"]
  funkrufname: string
  groups: Groups["groups"]
  handleAssignRouteResource: (resourceType: ResourceKind, groupId: string) => void
  handleChooseAuftrag: (groupId: string) => void
  handleConfirmAddStops: (incidentIds: string[]) => void
  handleDeleteOperationConfirm: () => Promise<void>
  handleDistributeToAuftrag: (operationId: string) => void
  handleOpenAssignmentDialog: (resourceType: ResourceKind, operationId: string) => void
  handleOpenIncidentFromNotification: (incidentId: string) => void
  handleOpenRapport: (operationId: string) => void
  handleOperationDelete: OperationHandlers["handleOperationDelete"]
  handleOperationUpdate: OperationHandlers["handleOperationUpdate"]
  handlePrintBoard: (options?: ThermoPrintOptions) => Promise<void>
  handleRemoveFromAuftrag: () => Promise<void>
  handleToggleZuFuss: (operationId: string) => void
  handleTransfer: (targetIncidentId: string) => Promise<void>
  handleVehicleAssign: OperationHandlers["handleVehicleAssign"]
  handleVehicleRemove: OperationHandlers["handleVehicleRemove"]
  isEditor: boolean
  isPrintingBoard: boolean
  isTransferring: boolean
  linksSheetOpen: boolean
  materials: Material[]
  mobilePersonnelSheetOpen: boolean
  newEmergencyGroupId: string | null
  newEmergencyModalOpen: boolean
  occupiedMaterialIds: Set<string>
  occupiedPersonnelIds: Set<string>
  occupiedVehicleIds: Set<string>
  openAttendance: () => void
  openDetailOnTab: OpenDetailOnTab | null
  openIncidentDetail: (operationId: string, tab?: OperationDetailTab, section?: OperationDetailSection) => void
  openRapports: ReturnType<typeof selectOpenRapports>
  operationToDelete: Operation | null
  operations: Operation[]
  performDistribute: (groupId: string, incidentId: string) => void
  personnel: Person[]
  printSheetOpen: boolean
  printerEnabled: boolean
  rapportBacklogSheetOpen: boolean
  refreshOperations: Ops["refreshOperations"]
  refreshPersonnel: ReturnType<typeof usePersonnel>["refreshPersonnel"]
  rekoAssignDialogOpen: boolean
  rekoAssignOperationId: string | null
  rekoPersonnelNames: string[]
  rekoPickerOpen: boolean
  removeCrew: Ops["removeCrew"]
  removeMaterial: Ops["removeMaterial"]
  removeVehicle: Ops["removeVehicle"]
  requestCompletion: StatusWorkflow["requestCompletion"]
  requestStatusChange: StatusWorkflow["requestStatusChange"]
  routeAssign: RouteAssign | null
  routeGroupResources: ReturnType<Groups["getGroupResources"]> | null
  routenEditorFocusIncidentId: string | null
  routenEditorGroupId: string | null
  selectedEvent: ReturnType<typeof useEvent>["selectedEvent"]
  selectedOperation: Operation | null
  setActiveFooterSheet: Dispatch<SetStateAction<FooterSheet | null>>
  setAssignmentDialogOpen: Dispatch<SetStateAction<boolean>>
  setAttendanceOpen: Dispatch<SetStateAction<boolean>>
  setAuftragPickerIncidentId: Dispatch<SetStateAction<string | null>>
  setDeleteDialogOpen: Dispatch<SetStateAction<boolean>>
  setDetailModalOpen: Dispatch<SetStateAction<boolean>>
  setDistributeConfirm: Dispatch<SetStateAction<DistributeConfirm | null>>
  setDiveraDialogOp: Dispatch<SetStateAction<Operation | null>>
  setDiveraMessageText: Dispatch<SetStateAction<string | null>>
  setMobilePersonnelSheetOpen: Dispatch<SetStateAction<boolean>>
  setNewEmergencyGroupId: Dispatch<SetStateAction<string | null>>
  setNewEmergencyModalOpen: Dispatch<SetStateAction<boolean>>
  setRekoAssignDialogOpen: Dispatch<SetStateAction<boolean>>
  setRekoPickerOpen: Dispatch<SetStateAction<boolean>>
  setRouteAssign: Dispatch<SetStateAction<RouteAssign | null>>
  setRouteStopStatus: (operationId: string, newStatus: OperationStatus) => void
  setRoutenEditorFocusIncidentId: Dispatch<SetStateAction<string | null>>
  setRoutenEditorGroupId: Dispatch<SetStateAction<string | null>>
  setStopPickerGroupId: Dispatch<SetStateAction<string | null>>
  setTransferSourceOp: Dispatch<SetStateAction<Operation | null>>
  statusWorkflow: StatusWorkflow
  stopPickerGroupId: string | null
  toggleDriverStay: ReturnType<typeof useToggleDriverStay>
  transferAvailableIncidents: Incident[]
  transferSourceOp: Operation | null
  unassignGroupResource: Groups["unassignResource"]
  vehicleStatusSheetOpen: boolean
  vehicleTypes: BoardVehicleType[]
}

export function BoardDialogs({
  activeFooterSheet,
  assignGroupResource,
  assignMaterialToOperation,
  assignPersonToOperation,
  assignVehicleToGroupWithConflict,
  assignVehicleToIncidentWithConflict,
  assignedResources,
  assignmentDialogOpen,
  assignmentLabelForPerson,
  assignmentOperationId,
  assignmentResourceType,
  attendanceOpen,
  auftraegeFocusGroupId,
  auftraegeSheetOpen,
  auftragPickerIncidentId,
  closedStopGuard,
  createGroup,
  createOperation,
  deleteDialogOpen,
  deleteReleaseHint,
  detailModalOpen,
  distributeConfirm,
  diveraDialogOp,
  diveraDialogOpLive,
  diveraEnabled,
  diveraMessageText,
  filedRapports,
  formatLocation,
  funkrufname,
  groups,
  handleAssignRouteResource,
  handleChooseAuftrag,
  handleConfirmAddStops,
  handleDeleteOperationConfirm,
  handleDistributeToAuftrag,
  handleOpenAssignmentDialog,
  handleOpenIncidentFromNotification,
  handleOpenRapport,
  handleOperationDelete,
  handleOperationUpdate,
  handlePrintBoard,
  handleRemoveFromAuftrag,
  handleToggleZuFuss,
  handleTransfer,
  handleVehicleAssign,
  handleVehicleRemove,
  isEditor,
  isPrintingBoard,
  isTransferring,
  linksSheetOpen,
  materials,
  mobilePersonnelSheetOpen,
  newEmergencyGroupId,
  newEmergencyModalOpen,
  occupiedMaterialIds,
  occupiedPersonnelIds,
  occupiedVehicleIds,
  openAttendance,
  openDetailOnTab,
  openIncidentDetail,
  openRapports,
  operationToDelete,
  operations,
  performDistribute,
  personnel,
  printSheetOpen,
  printerEnabled,
  rapportBacklogSheetOpen,
  refreshOperations,
  refreshPersonnel,
  rekoAssignDialogOpen,
  rekoAssignOperationId,
  rekoPersonnelNames,
  rekoPickerOpen,
  removeCrew,
  removeMaterial,
  removeVehicle,
  requestCompletion,
  requestStatusChange,
  routeAssign,
  routeGroupResources,
  routenEditorFocusIncidentId,
  routenEditorGroupId,
  selectedEvent,
  selectedOperation,
  setActiveFooterSheet,
  setAssignmentDialogOpen,
  setAttendanceOpen,
  setAuftragPickerIncidentId,
  setDeleteDialogOpen,
  setDetailModalOpen,
  setDistributeConfirm,
  setDiveraDialogOp,
  setDiveraMessageText,
  setMobilePersonnelSheetOpen,
  setNewEmergencyGroupId,
  setNewEmergencyModalOpen,
  setRekoAssignDialogOpen,
  setRekoPickerOpen,
  setRouteAssign,
  setRouteStopStatus,
  setRoutenEditorFocusIncidentId,
  setRoutenEditorGroupId,
  setStopPickerGroupId,
  setTransferSourceOp,
  statusWorkflow,
  stopPickerGroupId,
  toggleDriverStay,
  transferAvailableIncidents,
  transferSourceOp,
  unassignGroupResource,
  vehicleStatusSheetOpen,
  vehicleTypes,
}: BoardDialogsProps) {
  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')
  return (
    <>
      <OperationDetailModal
        operation={selectedOperation}
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        openOnTab={openDetailOnTab ?? undefined}
        onUpdate={handleOperationUpdate}
        onDelete={isEditor ? handleOperationDelete : undefined}
        materials={materials}
        onAssignVehicle={isEditor ? handleVehicleAssign : undefined}
        onRemoveVehicle={isEditor ? handleVehicleRemove : undefined}
        onAssignResource={isEditor ? handleOpenAssignmentDialog : undefined}
        onRemoveCrew={isEditor ? removeCrew : undefined}
        onRemoveMaterial={isEditor ? removeMaterial : undefined}
        canEdit={isEditor}
        diveraEnabled={isEditor && diveraEnabled}
        onSendDivera={isEditor ? (op) => setDiveraDialogOp(op) : undefined}
        onChangeStatus={isEditor ? requestStatusChange : undefined}
        onRequestComplete={isEditor ? requestCompletion : undefined}
        onDistributeToAuftrag={isEditor ? handleDistributeToAuftrag : undefined}
      />

      <NewEmergencyModal
        open={newEmergencyModalOpen}
        onOpenChange={(open) => {
          setNewEmergencyModalOpen(open)
          if (!open) setNewEmergencyGroupId(null)
        }}
        onCreateOperation={createOperation}
        defaultGroupId={newEmergencyGroupId}
      />

      {/* Resource Assignment Dialog */}
      <ResourceAssignmentDialog
        open={assignmentDialogOpen}
        onOpenChange={(open) => {
          setAssignmentDialogOpen(open)
          if (!open) {
            // Route-scoped assign is over — drop back to per-incident mode.
            setRouteAssign(null)
            statusWorkflow.resumeGateAfterAssignment()
          }
        }}
        resourceType={assignmentResourceType}
        operationId={routeAssign ? routeAssign.groupId : assignmentOperationId}
        assignTarget={routeAssign ? 'route' : 'incident'}
        routeName={routeAssign ? groups.find((g) => g.id === routeAssign.groupId)?.name : undefined}
        personnel={personnel}
        // «Nicht einsatzbereit» no longer rides along here — the dialog reads
        // it from the operations context itself, for every caller.
        vehicles={vehicleTypes}
        materials={materials}
        assignedPersonnel={routeGroupResources ? routeGroupResources.personnel.map(p => p.name) : assignedResources.assignedPersonnel}
        assignedVehicles={routeGroupResources ? routeGroupResources.vehicles.map(v => v.name) : assignedResources.assignedVehicles}
        assignedMaterials={routeGroupResources ? routeGroupResources.materials.map(m => m.resourceId) : assignedResources.assignedMaterials}
        rekoPersonnelNames={routeAssign ? [] : rekoPersonnelNames}
        onAssignPerson={routeAssign
          ? (personId) => assignGroupResource(routeAssign.groupId, 'personnel', personId)
          : ((personId: string, personName: string, operationId: string) =>
              // force: the dialog has its own «Doppelbelegung? Trotzdem zuweisen»
              // confirm with the label of where the person already is. Asking
              // again through the shared prompt would be the same question twice.
              assignPersonToOperation(personId, personName, operationId, true))}
        onAssignVehicle={routeAssign
          ? (vehicleId) => assignVehicleToGroupWithConflict(routeAssign.groupId, vehicleId)
          : assignVehicleToIncidentWithConflict}
        onAssignMaterial={routeAssign
          ? (materialId) => assignGroupResource(routeAssign.groupId, 'material', materialId)
          : ((materialId: string, operationId: string) =>
              assignMaterialToOperation(materialId, operationId, true))}
        onRemovePerson={routeAssign
          ? (_op, personName) => {
              const item = routeGroupResources?.personnel.find(p => p.name === personName)
              if (item) unassignGroupResource(routeAssign.groupId, item.assignmentId)
            }
          : removeCrew}
        onRemoveVehicle={routeAssign
          ? (_op, vehicleName) => {
              const item = routeGroupResources?.vehicles.find(v => v.name === vehicleName)
              if (item) unassignGroupResource(routeAssign.groupId, item.assignmentId)
            }
          : removeVehicle}
        onRemoveMaterial={routeAssign
          ? (_op, materialId) => {
              const item = routeGroupResources?.materials.find(m => m.resourceId === materialId)
              if (item) unassignGroupResource(routeAssign.groupId, item.assignmentId)
            }
          : removeMaterial}
        zuFuss={!routeAssign && assignmentOperationId ? operations.find(op => op.id === assignmentOperationId)?.zuFuss ?? false : false}
        onToggleZuFuss={!routeAssign && assignmentOperationId ? () => handleToggleZuFuss(assignmentOperationId) : undefined}
        occupiedPersonnelIds={occupiedPersonnelIds}
        occupiedVehicleIds={occupiedVehicleIds}
        occupiedMaterialIds={occupiedMaterialIds}
        // Incident-scoped only: the flag lives on the incident's assignment, and
        // a route assignment has no endpoint to patch it through (see the Auftrag
        // case in RouteResourceSections, which has no toggle either).
        vehicleDriverStay={!routeAssign && assignmentOperationId
          ? operations.find(op => op.id === assignmentOperationId)?.vehicleDriverStay
          : undefined}
        onToggleDriverStay={!routeAssign && assignmentOperationId
          ? (vehicleName) => toggleDriverStay(assignmentOperationId, vehicleName)
          : undefined}
      />


      {/* The one link sheet the footer opens: Check-In (with the Appell row),
          Feld-Code + Feld link, Alarm, and the base /display share. */}
      <LinksQrSheet
        open={linksSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'links' && setActiveFooterSheet(null)}
        eventId={selectedEvent?.id ?? null}
        printerEnabled={printerEnabled}
        onOpenAttendance={openAttendance}
      />

      {/* The Appell itself */}
      {selectedEvent && (
        <AttendanceModal
          open={attendanceOpen}
          onOpenChange={setAttendanceOpen}
          eventId={selectedEvent.id}
          eventName={selectedEvent.name}
          assignmentLabelFor={assignmentLabelForPerson}
          onAttendanceChange={refreshPersonnel}
        />
      )}

      {/* The Checkliste's Reko picker — page-owned, see `rekoPickerOpen`. */}
      <RekoPickerDialog
        open={rekoPickerOpen}
        onOpenChange={setRekoPickerOpen}
        eventId={selectedEvent?.id ?? null}
      />

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
        onAddStop={(groupId) => setStopPickerGroupId(groupId)}
        onAssignRouteResource={handleAssignRouteResource}
        onOpenDetail={handleOpenIncidentFromNotification}
        onOpenRoutenEditor={(groupId, focusIncidentId) => {
          setRoutenEditorGroupId(groupId)
          setRoutenEditorFocusIncidentId(focusIncidentId ?? null)
        }}
        canEdit={isEditor}
        onSetStopStatus={isEditor ? setRouteStopStatus : undefined}
        funkrufname={funkrufname}
      />

      {/* Offene Schadenplatz-Rapporte — the rolling backlog, oldest first */}
      <RapportBacklogSheet
        open={rapportBacklogSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'rapporte' && setActiveFooterSheet(null)}
        rapports={openRapports}
        filed={filedRapports}
        onOpenRapport={handleOpenRapport}
      />

      {/* Routen-Editor (map-first multi-stop route editing for one Auftrag) */}
      <RoutenEditorModal
        open={routenEditorGroupId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRoutenEditorGroupId(null)
            setRoutenEditorFocusIncidentId(null)
          }
        }}
        groupId={routenEditorGroupId}
        focusIncidentId={routenEditorFocusIncidentId}
        canEdit={isEditor}
        onSetStopStatus={isEditor ? setRouteStopStatus : undefined}
      />

      {/* "+ Stop" — pick existing incidents to add as stops to a route */}
      {isEditor && <IncidentPickerDialog
        open={stopPickerGroupId !== null}
        onOpenChange={(open) => !open && setStopPickerGroupId(null)}
        operations={operations}
        groups={groups}
        targetGroupId={stopPickerGroupId}
        onConfirm={handleConfirmAddStops}
        onCreateNew={() => {
          setNewEmergencyGroupId(stopPickerGroupId)
          setNewEmergencyModalOpen(true)
        }}
      />}

      {/* "An Auftrag verteilen" — distribute one incident into a route */}
      <AuftragPickerDialog
        open={auftragPickerIncidentId !== null}
        onOpenChange={(open) => !open && setAuftragPickerIncidentId(null)}
        groups={groups}
        currentGroupId={
          auftragPickerIncidentId
            ? operations.find((op) => op.id === auftragPickerIncidentId)?.groupId ?? null
            : null
        }
        onChoose={handleChooseAuftrag}
        onCreate={(name) => createGroup({ name })}
        onRemoveFromCurrent={handleRemoveFromAuftrag}
      />

      {/* Ask-first for the two distribute moves without an undo — pulling a
          stop out of another Auftrag, folding a disponierter Einsatz into one. */}
      <ConfirmDialog
        open={distributeConfirm !== null}
        onOpenChange={(open) => !open && setDistributeConfirm(null)}
        title={tDash('distributeConfirmTitle')}
        description={
          distributeConfirm?.fromName
            ? tDash('distributeConfirmTransfer', {
                incident: distributeConfirm.incidentLabel,
                from: distributeConfirm.fromName,
              })
            : tDash('distributeConfirmDispatched', {
                incident: distributeConfirm?.incidentLabel ?? '',
              })
        }
        confirmText={tDash('distributeConfirmAction')}
        onConfirm={() => {
          if (distributeConfirm) performDistribute(distributeConfirm.groupId, distributeConfirm.incidentId)
          setDistributeConfirm(null)
        }}
      />

      {/* «Dieser Einsatz ist abgeschlossen. Trotzdem als Stop hinzufügen?» */}
      <ClosedStopDialog
        prompt={closedStopGuard.prompt}
        onProceed={closedStopGuard.proceed}
        onCancel={closedStopGuard.dismiss}
      />

      {/* Delete Operation Confirmation Dialog. The description names what the
          deletion also RELEASES — a card that was never an incident is usually
          one somebody had already put people and a vehicle on. */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={tCommon('deleteIncidentTitle')}
        description={[
          tCommon('deleteIncidentDescription', { name: operationToDelete ? (formatLocation(operationToDelete.location ?? '') || getIncidentTypeLabel(operationToDelete.incidentType)) : '' }),
          deleteReleaseHint,
        ].filter(Boolean).join(' ')}
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

      {/* Divera-Mitteilung from the Checkliste. Mounted here, not inside the
          checklist popover: opening it closes that popover, which would take a
          dialog rendered in there down with it (same reason as the driver
          prompt). Nothing is sent until it is confirmed, and its group picker
          starts empty — «alle» is a choice, never a default. */}
      <DiveraMessageDialog
        open={diveraMessageText !== null}
        onOpenChange={(open) => !open && setDiveraMessageText(null)}
        defaultText={diveraMessageText ?? ''}
      />

      {/* Thermal slip, A4 status print and per-event file export in one sheet */}
      <PrintHubSheet
        open={printSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'print' && setActiveFooterSheet(null)}
        onThermoPrint={handlePrintBoard}
        isThermoPrinting={isPrintingBoard}
        printerEnabled={printerEnabled}
      />

      <IncidentStatusWorkflowDialogs
        controller={statusWorkflow}
        printerEnabled={printerEnabled}
        funkrufname={funkrufname}
        diveraEnabled={diveraEnabled}
        onOpenAssignment={handleOpenAssignmentDialog}
        onOpenDetail={(operationId, tab, section) => {
          openIncidentDetail(operationId, tab, section)
        }}
        onSendDivera={setDiveraDialogOp}
        onRefresh={refreshOperations}
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
          resourceSummary={{
            crew: transferSourceOp.crew.length,
            vehicles: transferSourceOp.vehicles.length,
            materials: transferSourceOp.materials.length,
          }}
        />
      )}

      {/* Mobile Personnel Sheet */}
      <MobilePersonnelSheet
        open={mobilePersonnelSheetOpen}
        onOpenChange={setMobilePersonnelSheetOpen}
        personnel={personnel}
        operations={operations}
      />

      {/* Mobile Bottom Navigation. No separate Thermo entry any more: the one
          print sheet carries the thermal column itself, gated on the same
          `printerEnabled` it is still handed here. */}
      <MobileBottomNavigation
        currentPage="kanban"
        hasSelectedEvent={!!selectedEvent}
        onLinks={() => setActiveFooterSheet(linksSheetOpen ? null : 'links')}
        onPersonnel={() => setMobilePersonnelSheetOpen(true)}
        onVehicleStatus={() => setActiveFooterSheet('vehicles')}
        onPrint={() => setActiveFooterSheet(printSheetOpen ? null : 'print')}
        printerEnabled={printerEnabled}
      />
    </>
  )
}
