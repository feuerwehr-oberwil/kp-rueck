"use client"

/**
 * Everything the board opens over itself that the Lagekarte does not: the
 * incident detail modal, the new-incident modal, the footer sheets, the stop
 * picker and the route editor, the ask-first confirmations, and the mobile sheet
 * and navigation. The dialogs both pages share (assignment, Auftrag picker,
 * transfer, Divera, the status gates) are `<IncidentDialogs>`, mounted by the
 * page beside this.
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
import { DiveraMessageDialog } from "@/components/divera/divera-message-dialog"
import { RekoPickerDialog } from "@/components/event-setup-checklist"
import { AttendanceModal } from "@/components/kanban/attendance-modal"
import { AuftraegeSheet } from "@/components/kanban/auftraege-sheet"
import { toggleFigures } from "@/components/figures-dialog"
import { CrewDutySheet } from "@/components/kanban/crew-duty-sheet"
import { ClosedStopDialog } from "@/components/kanban/closed-stop-dialog"
import type { IncidentDialogsController } from "@/components/kanban/incident-dialogs"
import { LinksQrSheet } from "@/components/kanban/links-qr-sheet"
import { NewEmergencyModal } from "@/components/kanban/new-emergency-modal"
import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import { JournalSheet, type JournalComposeRequest } from "@/components/journal/journal-sheet"
import { RapportBacklogSheet, type selectFiledRapports, type selectOpenRapports } from "@/components/kanban/rapport-backlog-sheet"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { MobilePersonnelSheet } from "@/components/mobile/mobile-personnel-sheet"
import { PrintHubSheet, type ThermoPrintOptions } from "@/components/print/print-hub-sheet"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"
import { VehicleStatusSheet } from "@/components/vehicle-status-sheet"
import type { FooterSheet } from "@/components/board/board-footer"
import type { useEvent } from "@/lib/contexts/event-context"
import type { PersonEngagement } from "@/lib/hooks/use-person-engagements"
import type { useGroups } from "@/lib/contexts/groups-context"
import type { Material, Operation, OperationStatus, Person, useOperations } from "@/lib/contexts/operations-context"
import type { usePersonnel } from "@/lib/contexts/personnel-context"
import type { useClosedStopGuard } from "@/lib/hooks/use-closed-stop-guard"
import type { OperationDetailSection, OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import type { useOperationHandlers } from "@/lib/hooks/use-operation-handlers"
import type { useReleaseUndo } from "@/lib/hooks/use-release-undo"
import { getIncidentTypeLabel } from "@/lib/incident-types"

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
type OperationHandlers = ReturnType<typeof useOperationHandlers>

/** «Open the detail on THIS tab» — see the page's `openDetailOnTab`. */
export interface OpenDetailOnTab { tab: OperationDetailTab; nonce: number; section?: OperationDetailSection }

export interface BoardDialogsProps {
  activeFooterSheet: FooterSheet | null
  assignmentLabelForPerson: (person: { name: string }) => string | null
  attendanceOpen: boolean
  auftraegeFocusGroupId: string | null
  auftraegeSheetOpen: boolean
  closedStopGuard: ReturnType<typeof useClosedStopGuard>
  createOperation: Ops["createOperation"]
  mergeOperationInto: Ops["mergeOperationInto"]
  deleteDialogOpen: boolean
  deleteReleaseHint: string | null
  detailModalOpen: boolean
  /** The Einsatz dialogs shared with the Lagekarte (incident-dialogs.tsx): the
   *  detail's actions and the Aufträge sheet's route assign open through it. */
  dialogs: IncidentDialogsController
  diveraEnabled: boolean
  diveraMessageText: string | null
  filedRapports: ReturnType<typeof selectFiledRapports>
  formatLocation: Ops["formatLocation"]
  funkrufname: string
  groups: Groups["groups"]
  handleConfirmAddStops: (incidentIds: string[]) => void
  handleDeleteOperationConfirm: () => Promise<void>
  handleOpenIncidentFromNotification: (incidentId: string) => void
  journalCompose: JournalComposeRequest | null
  handleOpenRapport: (operationId: string) => void
  handleOperationDelete: OperationHandlers["handleOperationDelete"]
  handleOperationUpdate: OperationHandlers["handleOperationUpdate"]
  handlePrintBoard: (options?: ThermoPrintOptions) => Promise<void>
  handleVehicleAssign: OperationHandlers["handleVehicleAssign"]
  handleVehicleRemove: OperationHandlers["handleVehicleRemove"]
  isEditor: boolean
  isPrintingBoard: boolean
  linksSheetOpen: boolean
  materials: Material[]
  mobilePersonnelSheetOpen: boolean
  newEmergencyGroupId: string | null
  newEmergencyModalOpen: boolean
  openAttendance: () => void
  openDetailOnTab: OpenDetailOnTab | null
  openIncidentDetail: (operationId: string, tab?: OperationDetailTab, section?: OperationDetailSection) => void
  openRapports: ReturnType<typeof selectOpenRapports>
  operationToDelete: Operation | null
  operations: Operation[]
  personnel: Person[]
  /** The Dienstzeiten overview (footer sheet `'crew'`). */
  crewDutySheetOpen: boolean
  fatigueHours: number
  personEngagements: Map<string, PersonEngagement>
  printSheetOpen: boolean
  printerEnabled: boolean
  rapportBacklogSheetOpen: boolean
  refreshOperations: Ops["refreshOperations"]
  refreshPersonnel: ReturnType<typeof usePersonnel>["refreshPersonnel"]
  rekoAssignDialogOpen: boolean
  rekoAssignOperationId: string | null
  rekoPickerOpen: boolean
  /** The operator's own releases from the detail modal: with «Rückgängig». */
  release: ReturnType<typeof useReleaseUndo>
  routenEditorFocusIncidentId: string | null
  routenEditorGroupId: string | null
  selectedEvent: ReturnType<typeof useEvent>["selectedEvent"]
  selectedOperation: Operation | null
  setActiveFooterSheet: Dispatch<SetStateAction<FooterSheet | null>>
  setAttendanceOpen: Dispatch<SetStateAction<boolean>>
  setDeleteDialogOpen: Dispatch<SetStateAction<boolean>>
  setDetailModalOpen: Dispatch<SetStateAction<boolean>>
  setDiveraMessageText: Dispatch<SetStateAction<string | null>>
  setMobilePersonnelSheetOpen: Dispatch<SetStateAction<boolean>>
  setNewEmergencyGroupId: Dispatch<SetStateAction<string | null>>
  setNewEmergencyModalOpen: Dispatch<SetStateAction<boolean>>
  setRekoAssignDialogOpen: Dispatch<SetStateAction<boolean>>
  setRekoPickerOpen: Dispatch<SetStateAction<boolean>>
  setRouteStopStatus: (operationId: string, newStatus: OperationStatus) => void
  setRoutenEditorFocusIncidentId: Dispatch<SetStateAction<string | null>>
  setRoutenEditorGroupId: Dispatch<SetStateAction<string | null>>
  setStopPickerGroupId: Dispatch<SetStateAction<string | null>>
  stopPickerGroupId: string | null
  vehicleStatusSheetOpen: boolean
}

export function BoardDialogs({
  activeFooterSheet,
  assignmentLabelForPerson,
  attendanceOpen,
  auftraegeFocusGroupId,
  auftraegeSheetOpen,
  closedStopGuard,
  createOperation,
  mergeOperationInto,
  deleteDialogOpen,
  deleteReleaseHint,
  detailModalOpen,
  dialogs,
  diveraEnabled,
  diveraMessageText,
  filedRapports,
  formatLocation,
  funkrufname,
  groups,
  handleConfirmAddStops,
  handleDeleteOperationConfirm,
  handleOpenIncidentFromNotification,
  journalCompose,
  handleOpenRapport,
  handleOperationDelete,
  handleOperationUpdate,
  handlePrintBoard,
  handleVehicleAssign,
  handleVehicleRemove,
  isEditor,
  isPrintingBoard,
  linksSheetOpen,
  materials,
  mobilePersonnelSheetOpen,
  newEmergencyGroupId,
  newEmergencyModalOpen,
  openAttendance,
  openDetailOnTab,
  openIncidentDetail,
  openRapports,
  operationToDelete,
  operations,
  personnel,
  crewDutySheetOpen,
  fatigueHours,
  personEngagements,
  printSheetOpen,
  printerEnabled,
  rapportBacklogSheetOpen,
  refreshOperations,
  refreshPersonnel,
  rekoAssignDialogOpen,
  rekoAssignOperationId,
  rekoPickerOpen,
  release,
  routenEditorFocusIncidentId,
  routenEditorGroupId,
  selectedEvent,
  selectedOperation,
  setActiveFooterSheet,
  setAttendanceOpen,
  setDeleteDialogOpen,
  setDetailModalOpen,
  setDiveraMessageText,
  setMobilePersonnelSheetOpen,
  setNewEmergencyGroupId,
  setNewEmergencyModalOpen,
  setRekoAssignDialogOpen,
  setRekoPickerOpen,
  setRouteStopStatus,
  setRoutenEditorFocusIncidentId,
  setRoutenEditorGroupId,
  setStopPickerGroupId,
  stopPickerGroupId,
  vehicleStatusSheetOpen,
}: BoardDialogsProps) {
  const tCommon = useTranslations('kanban.common')
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
        onRemoveCrew={isEditor ? release.releaseCrew : undefined}
        onRemoveMaterial={isEditor ? release.releaseMaterial : undefined}
        canEdit={isEditor}
        diveraEnabled={isEditor && diveraEnabled}
        {...dialogs.detailActions}
      />

      <NewEmergencyModal
        open={newEmergencyModalOpen}
        onOpenChange={(open) => {
          setNewEmergencyModalOpen(open)
          if (!open) setNewEmergencyGroupId(null)
        }}
        onCreateOperation={createOperation}
        defaultGroupId={newEmergencyGroupId}
        eventId={selectedEvent?.id ?? null}
        onMergeInto={isEditor ? mergeOperationInto : undefined}
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
          canCheckIn={isEditor}
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
        onAssignRouteResource={dialogs.openRouteAssignment}
        onOpenDetail={handleOpenIncidentFromNotification}
        onOpenRoutenEditor={(groupId, focusIncidentId) => {
          setRoutenEditorGroupId(groupId)
          setRoutenEditorFocusIncidentId(focusIncidentId ?? null)
        }}
        canEdit={isEditor}
        onSetStopStatus={isEditor ? setRouteStopStatus : undefined}
        funkrufname={funkrufname}
      />

      {/* Dienstzeiten — who is here, since when, how long, how many Einsätze */}
      <CrewDutySheet
        open={crewDutySheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'crew' && setActiveFooterSheet(null)}
        eventId={selectedEvent?.id ?? null}
        personnel={personnel}
        personEngagements={personEngagements}
        fatigueHours={fatigueHours}
      />

      {/* Offene Schadenplatz-Rapporte — the rolling backlog, oldest first */}
      <RapportBacklogSheet
        open={rapportBacklogSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'rapporte' && setActiveFooterSheet(null)}
        rapports={openRapports}
        filed={filedRapports}
        onOpenRapport={handleOpenRapport}
      />

      {/* Einsatztagebuch — `J`, the footer pill, the palette, the phone's «Mehr» */}
      <JournalSheet
        open={activeFooterSheet === 'journal'}
        onOpenChange={(open) => !open && activeFooterSheet === 'journal' && setActiveFooterSheet(null)}
        eventId={selectedEvent?.id ?? null}
        operations={operations}
        isEditor={isEditor}
        composeRequest={journalCompose}
        onOpenIncident={(id) => {
          setActiveFooterSheet(null)
          openIncidentDetail(id)
        }}
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

      {/* Mobile Personnel Sheet */}
      <MobilePersonnelSheet
        open={mobilePersonnelSheetOpen}
        onOpenChange={setMobilePersonnelSheetOpen}
        personnel={personnel}
        operations={operations}
        onOpenCrewDuty={() => {
          // One layer at a time on the phone: the overview replaces the list.
          setMobilePersonnelSheetOpen(false)
          setActiveFooterSheet('crew')
        }}
      />

      {/* Mobile Bottom Navigation. No separate Thermo entry any more: the one
          print sheet carries the thermal column itself, gated on the same
          `printerEnabled` it is still handed here. */}
      <MobileBottomNavigation
        currentPage="kanban"
        hasSelectedEvent={!!selectedEvent}
        onLinks={() => setActiveFooterSheet(linksSheetOpen ? null : 'links')}
        onJournal={selectedEvent ? () => setActiveFooterSheet('journal') : undefined}
        onFigures={selectedEvent ? toggleFigures : undefined}
        onPersonnel={() => setMobilePersonnelSheetOpen(true)}
        onVehicleStatus={() => setActiveFooterSheet('vehicles')}
        onPrint={() => setActiveFooterSheet(printSheetOpen ? null : 'print')}
        printerEnabled={printerEnabled}
      />
    </>
  )
}
