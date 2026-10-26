"use client"

/**
 * The dialogs an Einsatz opens over the board AND over the Lagekarte – one state,
 * one mount, both pages.
 *
 *   const dialogs = useIncidentDialogs()
 *   …dialogs.openAssignment('crew', id) / openAuftragPicker(id) / openTransfer(id) / openDivera(op)
 *   <OperationDetailModal {...dialogs.detailActions} … />
 *   <IncidentDialogs dialogs={dialogs} onOpenDetail={…} … />
 *
 * Owned here: the assignment dialog (incident- or Auftrag-scoped – a stop's
 * resources belong to its Auftrag, so asking for a stop opens the route), «An
 * Auftrag verteilen» with its ask-first and closed-stop confirms, «Ressourcen
 * übertragen», the Divera send dialog, and the status workflow with its gates
 * (`dialogs.statusWorkflow` – the page's drag and shortcut paths call its
 * triggers).
 *
 * Not owned: WHERE the Einsatz detail opens. The board picks side panel, modal or
 * phone sheet, the map only ever a modal, so that stays with the page; the
 * detail reaches this layer through `detailActions`.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { TransferIncidentDialog } from "@/components/incidents/transfer-incident-dialog"
import { DiveraSendDialog } from "@/components/divera/divera-send-dialog"
import { AuftragPickerDialog } from "@/components/kanban/auftrag-picker-dialog"
import { ClosedStopDialog } from "@/components/kanban/closed-stop-dialog"
import { IncidentStatusWorkflowDialogs, useIncidentStatusWorkflow } from "@/components/kanban/incident-status-workflow"
import { ResourceAssignmentDialog } from "@/components/kanban/resource-assignment-dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { apiClient } from "@/lib/api-client"
import { useAuth } from "@/lib/contexts/auth-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { useAssignmentConflicts } from "@/lib/hooks/use-assignment-conflicts"
import { useAuftragRoster } from "@/lib/hooks/use-auftrag-roster"
import { useClosedStopGuard } from "@/lib/hooks/use-closed-stop-guard"
import { useToggleDriverStay } from "@/lib/hooks/use-driver-stay"
import type { OperationDetailSection, OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { useReleaseUndo } from "@/lib/hooks/use-release-undo"
import { getIncidentRefLabel, getIncidentTypeLabel } from "@/lib/incident-types"
import { findAuftragForStop } from "@/lib/kanban-utils"
import type { Incident } from "@/lib/types/incidents"

/** What the assignment dialog assigns. */
export type ResourceKind = "crew" | "vehicles" | "materials"

/** The assignment dialog's subject: an incident, or (`routeGroupId`) an Auftrag. */
interface AssignmentRequest {
  resourceType: ResourceKind
  operationId: string | null
  routeGroupId: string | null
  /** Pre-filled search when a field request opened the dialog («Tauchpumpe Gr.»). */
  search?: string
}

/** The ask-first for the two distribute moves without an undo. */
interface DistributeConfirm {
  groupId: string
  incidentId: string
  incidentLabel: string
  fromName: string | null
}

/** «Ressourcen übertragen»: the source, and the event's incidents it may go to. */
interface TransferRequest {
  sourceId: string
  targets: Incident[]
}

/** The ApiIncident → Incident conversion the transfer dialog's list needs. */
async function loadTransferTargets(eventId: string): Promise<Incident[]> {
  const apiIncidents = await apiClient.getIncidents(eventId)
  return apiIncidents.map((inc) => {
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
      assigned_vehicles: assigned_vehicles.map((v) => ({ ...v, assigned_at: new Date(v.assigned_at) })),
    }
  })
}

/**
 * Which incident dialog is open, for what – plus the status workflow. Call once
 * per page and hand the result to `<IncidentDialogs>`; see the file comment.
 */
export function useIncidentDialogs() {
  const t = useTranslations("kanban")
  const { operations, materials, changeStatusToTop, removeMaterial, refreshOperations } = useOperations()
  const { groups, getGroupResources, unassignResource } = useGroups()
  const { selectedEvent } = useEvent()
  const { isEditor } = useAuth()

  const statusWorkflow = useIncidentStatusWorkflow({
    operations,
    materials,
    groups,
    changeStatusToTop,
    getGroupResources,
    removeMaterial,
    unassignGroupResource: unassignResource,
  })

  // `assignment` outlives `assignmentOpen` so the dialog keeps its content while
  // it animates out.
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [assignment, setAssignment] = useState<AssignmentRequest | null>(null)
  const [auftragPickerIncidentId, setAuftragPickerIncidentId] = useState<string | null>(null)
  const [distributeConfirm, setDistributeConfirm] = useState<DistributeConfirm | null>(null)
  const [diveraOperation, setDiveraOperation] = useState<Operation | null>(null)
  const [transfer, setTransfer] = useState<TransferRequest | null>(null)
  const [isTransferring, setIsTransferring] = useState(false)

  /** Route-level assign: the dialog scoped to an Auftrag. Assign/remove hit the
   *  group directly, so it works even with zero stops. */
  const openRouteAssignment = useCallback((resourceType: ResourceKind, groupId: string) => {
    setAssignment({ resourceType, operationId: null, routeGroupId: groupId })
    setAssignmentOpen(true)
  }, [])

  /** The assignment dialog for an incident. A stop's resources belong to its
   *  Auftrag, never to the stop – including when a gate sent us here – so a stop
   *  opens the route; resolved via the routes, because a just-added stop has no
   *  groupId of its own yet. */
  const openAssignment = useCallback((resourceType: ResourceKind, operationId: string, search?: string) => {
    const auftrag = findAuftragForStop(groups, operations.find((o) => o.id === operationId))
    if (auftrag) {
      openRouteAssignment(resourceType, auftrag.id)
      return
    }
    setAssignment({ resourceType, operationId, routeGroupId: null, search })
    setAssignmentOpen(true)
  }, [groups, openRouteAssignment, operations])

  const closeAssignment = useCallback(() => {
    setAssignmentOpen(false)
    // Route-scoped assign is over – drop back to per-incident mode.
    setAssignment((current) => (current?.routeGroupId ? { ...current, routeGroupId: null } : current))
    statusWorkflow.resumeGateAfterAssignment()
  }, [statusWorkflow])

  /** «Ressourcen übertragen»: load the event's incidents as targets, then open. */
  const openTransfer = useCallback(async (operationId: string) => {
    if (!operations.some((o) => o.id === operationId) || !selectedEvent) {
      toast.error(t("common.error"), { description: t("common.noEventSelected") })
      return
    }
    try {
      setTransfer({ sourceId: operationId, targets: await loadTransferTargets(selectedEvent.id) })
    } catch (error) {
      console.error("Failed to load incidents:", error)
      toast.error(t("common.loadFailed"), { description: t("detail.incidentsLoadFailedDescription") })
    }
  }, [operations, selectedEvent, t])

  /** Run the transfer. The backend returns a specific German reason on failure. */
  const runTransfer = useCallback(async (targetIncidentId: string) => {
    if (!transfer) return
    try {
      setIsTransferring(true)
      await apiClient.transferAssignments(transfer.sourceId, targetIncidentId)
      await refreshOperations()
      setTransfer(null)
      toast.success(t("common.transferResources"))
    } catch (error) {
      toast.error(t("common.transferFailed"), {
        description: (error instanceof Error && error.message) || t("common.transferFailedDescription"),
      })
    } finally {
      setIsTransferring(false)
    }
  }, [refreshOperations, t, transfer])

  /** What the Einsatz detail (modal or side panel) needs from this layer –
   *  spread onto it. Editor-only, like everything the layer opens. */
  const detailActions = useMemo(() => (isEditor
    ? {
        onAssignResource: openAssignment,
        onSendDivera: setDiveraOperation,
        onChangeStatus: statusWorkflow.requestStatusChange,
        onRequestComplete: statusWorkflow.requestCompletion,
        onDistributeToAuftrag: setAuftragPickerIncidentId,
        onTransferResources: (operationId: string) => void openTransfer(operationId),
      }
    : {}), [isEditor, openAssignment, openTransfer, statusWorkflow.requestCompletion, statusWorkflow.requestStatusChange])

  return {
    statusWorkflow,
    openAssignment,
    openRouteAssignment,
    /** «An Auftrag verteilen» for one incident. */
    openAuftragPicker: setAuftragPickerIncidentId,
    /** The Divera send dialog for one incident. */
    openDivera: setDiveraOperation,
    openTransfer,
    detailActions,
    /** The board's shortcuts stand down while the assignment dialog is open. */
    assignmentOpen,
    // Read by <IncidentDialogs> only.
    view: {
      assignment,
      closeAssignment,
      auftragPickerIncidentId,
      closeAuftragPicker: () => setAuftragPickerIncidentId(null),
      distributeConfirm,
      setDistributeConfirm,
      diveraOperation,
      closeDivera: () => setDiveraOperation(null),
      transfer,
      closeTransfer: () => setTransfer(null),
      runTransfer,
      isTransferring,
    },
  }
}

export type IncidentDialogsController = ReturnType<typeof useIncidentDialogs>

interface IncidentDialogsProps {
  dialogs: IncidentDialogsController
  /** The fleet the assignment dialog offers (and the conflict check reads). */
  vehicles: Array<{ key: string; name: string; id: string; type: string }>
  printerEnabled: boolean
  funkrufname: string
  diveraEnabled: boolean
  /** A gate's «… öffnen»: show this incident's detail, on that tab/section. */
  onOpenDetail: (operationId: string, tab?: OperationDetailTab, section?: OperationDetailSection) => void
  /** Nobody checked in: the empty crew list offers the check-in link. Omitted
   *  where the page has no Links sheet. */
  onShowCheckIn?: () => void
}

/** Mounts every dialog `useIncidentDialogs` can open. Once per page. */
export function IncidentDialogs({
  dialogs,
  vehicles,
  printerEnabled,
  funkrufname,
  diveraEnabled,
  onOpenDetail,
  onShowCheckIn,
}: IncidentDialogsProps) {
  const tDash = useTranslations("kanban.dashboard")
  const {
    operations,
    materials,
    formatLocation,
    refreshOperations,
    updateOperation,
    assignPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    removeCrew,
    removeMaterial,
    removeVehicle,
    requestResourceConflict,
  } = useOperations()
  const {
    groups,
    createGroup,
    addStops,
    assignResource: assignGroupResource,
    unassignResource: unassignGroupResource,
    getGroupResources,
    occupiedResourceIds,
  } = useGroups()
  const { selectedEvent } = useEvent()
  const personnel = useAuftragRoster()
  const release = useReleaseUndo()
  const toggleDriverStay = useToggleDriverStay()
  // Attaching an already-closed incident as a stop is allowed, but never silent.
  const closedStopGuard = useClosedStopGuard(operations)
  // Doppelbelegung across Aufträge and Einsätze – see use-assignment-conflicts.
  const { assignVehicleToGroupWithConflict, assignVehicleToIncidentWithConflict } = useAssignmentConflicts({
    vehicleTypes: vehicles,
    groups,
    operations,
    requestResourceConflict,
    assignGroupResource,
    unassignGroupResource,
    removeVehicle,
    assignVehicleToOperation,
  })
  const { view, statusWorkflow } = dialogs

  // ── Assignment dialog ────────────────────────────────────────────────────
  const assignment = view.assignment
  const routeGroupId = assignment?.routeGroupId ?? null
  const assignmentOperation = !routeGroupId && assignment?.operationId
    ? operations.find((op) => op.id === assignment.operationId) ?? null
    : null
  // When the dialog is scoped to a ROUTE, its assigned lists + assign/remove
  // callbacks target the Auftrag's resources instead of a stop.
  const routeResources = routeGroupId ? getGroupResources(routeGroupId) : null
  const routeOwnIds = routeGroupId
    ? new Set(groups.find((group) => group.id === routeGroupId)?.assignments.map((a) => `${a.resourceType}:${a.resourceId}`) ?? [])
    : new Set<string>()
  const occupiedPersonnelIds = new Set([...occupiedResourceIds.personnel].filter((id) => !routeOwnIds.has(`personnel:${id}`)))
  const occupiedVehicleIds = new Set([...occupiedResourceIds.vehicle].filter((id) => !routeOwnIds.has(`vehicle:${id}`)))
  const occupiedMaterialIds = new Set([...occupiedResourceIds.material].filter((id) => !routeOwnIds.has(`material:${id}`)))

  // Reko personnel for this Ereignis, fetched when the crew dialog opens: they
  // are excluded from regular crew assignment (they're Reko only).
  const [rekoPersonnelIds, setRekoPersonnelIds] = useState<string[]>([])
  const crewDialogOpen = dialogs.assignmentOpen && assignment?.resourceType === "crew"
  useEffect(() => {
    if (!crewDialogOpen || !selectedEvent) {
      setRekoPersonnelIds([])
      return
    }
    let cancelled = false
    apiClient.getEventSpecialFunctions(selectedEvent.id)
      .then((functions) => {
        if (cancelled) return
        setRekoPersonnelIds(functions
          .filter((item) => item.function_type === "reko")
          .map((item) => item.personnel_id))
      })
      .catch((error) => {
        console.error("Failed to fetch Reko personnel:", error)
        if (!cancelled) setRekoPersonnelIds([])
      })
    return () => {
      cancelled = true
    }
  }, [crewDialogOpen, selectedEvent])

  const removeFromRoute = (kind: "personnel" | "vehicles" | "materials", resourceId: string) => {
    const item = routeResources?.[kind].find((entry) => entry.resourceId === resourceId)
    if (routeGroupId && item) void unassignGroupResource(routeGroupId, item.assignmentId)
  }

  // ── «An Auftrag verteilen» ───────────────────────────────────────────────
  const pickerIncidentId = view.auftragPickerIncidentId
  const performDistribute = (groupId: string, incidentId: string) => {
    closedStopGuard.guard([incidentId], async () => {
      const ok = await addStops(groupId, [incidentId])
      if (ok) {
        const group = groups.find((g) => g.id === groupId)
        toast.success(tDash("distributedToast", { name: group?.name ?? "" }))
      }
    })
  }
  const chooseAuftrag = (groupId: string) => {
    if (!pickerIncidentId) return
    // Two moves that cannot be taken back ask first (there is no undo yet):
    // pulling a stop OUT of another Auftrag, and folding an already
    // disponierter Einsatz into a route.
    const op = operations.find((candidate) => candidate.id === pickerIncidentId)
    const otherGroup = op?.groupId && op.groupId !== groupId ? groups.find((g) => g.id === op.groupId) : undefined
    const dispatched = !!op && ["enroute", "active", "returning"].includes(op.status)
    if (otherGroup || dispatched) {
      view.setDistributeConfirm({
        groupId,
        incidentId: pickerIncidentId,
        incidentLabel: op ? getIncidentRefLabel(op, 40) : "",
        fromName: otherGroup?.name ?? null,
      })
      return
    }
    performDistribute(groupId, pickerIncidentId)
  }
  // «Aus Auftrag entfernen» – detach the incident from its route (it stays on
  // the board, ungrouped). The release toast («… freigegeben · Rückgängig») says it.
  const removeFromAuftrag = async () => {
    const op = operations.find((o) => o.id === pickerIncidentId)
    if (!op?.groupId) return
    await release.releaseStop(op.groupId, op.id)
  }
  const distributeConfirm = view.distributeConfirm

  // ── Divera, transfer ─────────────────────────────────────────────────────
  // The Divera dialog was handed a snapshot; derive the LIVE operation so a
  // resource assigned while it is open (e.g. via the missing-resources
  // «Zuweisen» flow) shows up in the radio text and the Divera recipients
  // instead of a stale «keine Person zugewiesen».
  const diveraOperationLive = view.diveraOperation
    ? operations.find((op) => op.id === view.diveraOperation?.id) ?? view.diveraOperation
    : null
  const transferSource = view.transfer ? operations.find((op) => op.id === view.transfer?.sourceId) ?? null : null

  return (
    <>
      <ResourceAssignmentDialog
        open={dialogs.assignmentOpen}
        onOpenChange={(open) => !open && view.closeAssignment()}
        resourceType={assignment?.resourceType ?? null}
        initialSearch={routeGroupId ? undefined : assignment?.search}
        operationId={routeGroupId ?? assignment?.operationId ?? null}
        assignTarget={routeGroupId ? "route" : "incident"}
        routeName={routeGroupId ? groups.find((g) => g.id === routeGroupId)?.name : undefined}
        personnel={personnel}
        // «Nicht einsatzbereit» no longer rides along here – the dialog reads
        // it from the operations context itself, for every caller.
        vehicles={vehicles}
        materials={materials}
        assignedPersonnelIds={routeResources
          ? routeResources.personnel.map((p) => p.resourceId)
          : assignmentOperation?.crew.map((m) => m.personnelId) ?? []}
        assignedVehicleIds={routeResources
          ? routeResources.vehicles.map((v) => v.resourceId)
          : assignmentOperation?.vehicles.map((v) => v.vehicleId) ?? []}
        assignedMaterials={routeResources ? routeResources.materials.map((m) => m.resourceId) : assignmentOperation?.materials ?? []}
        rekoPersonnelIds={routeGroupId ? [] : rekoPersonnelIds}
        onAssignPerson={routeGroupId
          ? (personId) => void assignGroupResource(routeGroupId, "personnel", personId)
          : ((personId: string, personName: string, operationId: string) =>
              // force: the dialog has its own «Doppelbelegung? Trotzdem zuweisen»
              // confirm with the label of where the person already is. Asking
              // again through the shared prompt would be the same question twice.
              assignPersonToOperation(personId, personName, operationId, true))}
        onAssignVehicle={routeGroupId
          ? (vehicleId) => assignVehicleToGroupWithConflict(routeGroupId, vehicleId)
          : assignVehicleToIncidentWithConflict}
        onAssignMaterial={routeGroupId
          ? (materialId) => void assignGroupResource(routeGroupId, "material", materialId)
          : ((materialId: string, operationId: string) => assignMaterialToOperation(materialId, operationId, true))}
        onRemovePerson={routeGroupId
          ? (_op, personnelId) => removeFromRoute("personnel", personnelId)
          : removeCrew}
        onRemoveVehicle={routeGroupId
          ? (_op, vehicleId) => removeFromRoute("vehicles", vehicleId)
          : removeVehicle}
        onRemoveMaterial={routeGroupId
          ? (_op, materialId) => removeFromRoute("materials", materialId)
          : removeMaterial}
        zuFuss={assignmentOperation?.zuFuss ?? false}
        onToggleZuFuss={assignmentOperation
          ? () => updateOperation(assignmentOperation.id, { zuFuss: !assignmentOperation.zuFuss })
          : undefined}
        occupiedPersonnelIds={occupiedPersonnelIds}
        occupiedVehicleIds={occupiedVehicleIds}
        occupiedMaterialIds={occupiedMaterialIds}
        // Incident-scoped only: the flag lives on the incident's assignment, and
        // a route assignment has no endpoint to patch it through (see the Auftrag
        // case in RouteResourceSections, which has no toggle either).
        vehicleDriverStay={assignmentOperation
          ? new Map(assignmentOperation.vehicles.map((v) => [v.vehicleId, v.driverStay ?? false]))
          : undefined}
        onToggleDriverStay={assignmentOperation
          ? (vehicleId) => toggleDriverStay(assignmentOperation.id, vehicleId)
          : undefined}
        onShowCheckIn={onShowCheckIn}
      />

      <AuftragPickerDialog
        open={pickerIncidentId !== null}
        onOpenChange={(open) => !open && view.closeAuftragPicker()}
        groups={groups}
        currentGroupId={pickerIncidentId ? operations.find((op) => op.id === pickerIncidentId)?.groupId ?? null : null}
        onChoose={chooseAuftrag}
        onCreate={(name) => createGroup({ name })}
        onRemoveFromCurrent={removeFromAuftrag}
      />

      {/* Ask-first for the two distribute moves without an undo – pulling a
          stop out of another Auftrag, folding a disponierter Einsatz into one. */}
      <ConfirmDialog
        open={distributeConfirm !== null}
        onOpenChange={(open) => !open && view.setDistributeConfirm(null)}
        title={tDash("distributeConfirmTitle")}
        description={
          distributeConfirm?.fromName
            ? tDash("distributeConfirmTransfer", { incident: distributeConfirm.incidentLabel, from: distributeConfirm.fromName })
            : tDash("distributeConfirmDispatched", { incident: distributeConfirm?.incidentLabel ?? "" })
        }
        confirmText={tDash("distributeConfirmAction")}
        onConfirm={() => {
          if (distributeConfirm) performDistribute(distributeConfirm.groupId, distributeConfirm.incidentId)
          view.setDistributeConfirm(null)
        }}
      />

      {/* «Dieser Einsatz ist abgeschlossen. Trotzdem als Stop hinzufügen?» */}
      <ClosedStopDialog
        prompt={closedStopGuard.prompt}
        onProceed={closedStopGuard.proceed}
        onCancel={closedStopGuard.dismiss}
      />

      <IncidentStatusWorkflowDialogs
        controller={statusWorkflow}
        printerEnabled={printerEnabled}
        funkrufname={funkrufname}
        diveraEnabled={diveraEnabled}
        onOpenAssignment={dialogs.openAssignment}
        onToggleZuFuss={(operation) => updateOperation(operation.id, { zuFuss: !operation.zuFuss })}
        onOpenDetail={onOpenDetail}
        onSendDivera={dialogs.openDivera}
        onRefresh={refreshOperations}
      />

      <DiveraSendDialog
        open={!!view.diveraOperation}
        onOpenChange={(open) => !open && view.closeDivera()}
        operation={diveraOperationLive}
        materials={materials}
      />

      {transferSource && (
        <TransferIncidentDialog
          open
          onOpenChange={(open) => !open && view.closeTransfer()}
          sourceIncident={transferSource}
          sourceName={formatLocation(transferSource.location ?? "") || getIncidentTypeLabel(transferSource.incidentType)}
          availableIncidents={view.transfer?.targets ?? []}
          onTransfer={view.runTransfer}
          isTransferring={view.isTransferring}
          resourceSummary={{
            crew: transferSource.crew.length,
            vehicles: transferSource.vehicles.length,
            materials: transferSource.materials.length,
          }}
        />
      )}
    </>
  )
}
