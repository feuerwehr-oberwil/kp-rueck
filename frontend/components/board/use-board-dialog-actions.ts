"use client"

import { useEffect, useCallback, useRef, useMemo } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { type Person, type Operation } from "@/lib/contexts/operations-context"
import { apiClient } from "@/lib/api-client"
import { type OperationDetailSection, type OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { findAuftragForStop } from "@/lib/kanban-utils"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { type FooterSheet } from "@/components/board/board-footer"
import type { Event } from "@/lib/types/incidents"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import type { Dispatch, SetStateAction } from "react"
import type { Released } from "@/lib/release-undo"
import type { ClosedStopPrompt } from "@/lib/hooks/use-closed-stop-guard"
import type { FieldRequestAssignHandler } from "@/lib/contexts/notification-context"
import type { useGroups } from "@/lib/contexts/groups-context"

export interface UseBoardDialogActionsInput {
  occupiedResourceIds: ReturnType<typeof useGroups>["occupiedResourceIds"]
  deleteOperation: (operationId: string) => Promise<void>
  operations: Operation[]
  updateOperation: (operationId: string, updates: Partial<Operation>) => void
  refreshPersonnel: (options?: { skipStateUpdate?: boolean; }) => Promise<Person[]>
  getGroupResources: (groupId: string) => GroupResources
  addStopsToGroup: (groupId: string, incidentIds: string[]) => Promise<boolean>
  groups: IncidentGroup[]
  release: { releaseCrew: (operationId: string, crewName: string) => Promise<boolean>; releaseMaterial: (operationId: string, materialId: string) => Promise<boolean>; releaseVehicle: (operationId: string, vehicleName: string) => Promise<boolean>; releaseStop: (groupId: string, incidentId: string) => Promise<boolean>; releaseRouteResource: (groupId: string, assignmentId: string) => Promise<boolean>; restore: (item: Released) => Promise<void>; }
  closedStopGuard: { guard: (incidentIds: string[], run: () => void) => void; prompt: ClosedStopPrompt | null; proceed: () => void; dismiss: () => void; }
  selectedEvent: Event | null
  isEditor: boolean
  registerAssignHandler: (handler: FieldRequestAssignHandler | null) => void
  openIncidentDetail: (operationId: string, tab?: OperationDetailTab, section?: OperationDetailSection, options?: { allowModal?: boolean; }) => void
  setActiveFooterSheet: Dispatch<SetStateAction<FooterSheet | null>>
  stopPickerGroupId: string | null
  setAuftragPickerIncidentId: Dispatch<SetStateAction<string | null>>
  auftragPickerIncidentId: string | null
  setDistributeConfirm: Dispatch<SetStateAction<{ groupId: string; incidentId: string; incidentLabel: string; fromName: string | null; dispatched: boolean; } | null>>
  routeAssign: { groupId: string; resourceType: "crew" | "vehicles" | "materials"; } | null
  setRouteAssign: Dispatch<SetStateAction<{ groupId: string; resourceType: "crew" | "vehicles" | "materials"; } | null>>
  checkInUrl: string | null
  setCopied: Dispatch<SetStateAction<boolean>>
  setAttendanceOpen: Dispatch<SetStateAction<boolean>>
  setOperationToDelete: Dispatch<SetStateAction<Operation | null>>
  operationToDelete: Operation | null
  setAssignmentDialogOpen: Dispatch<SetStateAction<boolean>>
  setAssignmentResourceType: Dispatch<SetStateAction<"vehicles" | "crew" | "materials" | null>>
  setAssignmentOperationId: Dispatch<SetStateAction<string | null>>
  assignmentOperationId: string | null
  setAssignmentInitialSearch: Dispatch<SetStateAction<string | undefined>>
  setRekoAssignDialogOpen: Dispatch<SetStateAction<boolean>>
  setRekoAssignOperationId: Dispatch<SetStateAction<string | null>>
}

/**
 * The board's dialog and sheet actions: open a Rapport, the attendance and
 * assignment dialogs, Aufträge (add stops, distribute, choose, remove), the card
 * toggles, the delete confirmation and what the assignment dialog is told is taken.
 * Moved verbatim out of app/page.tsx.
 */
export function useBoardDialogActions(input: UseBoardDialogActionsInput) {
  const {
    occupiedResourceIds,
    deleteOperation,
    operations,
    updateOperation,
    refreshPersonnel,
    getGroupResources,
    addStopsToGroup,
    groups,
    release,
    closedStopGuard,
    selectedEvent,
    isEditor,
    registerAssignHandler,
    openIncidentDetail,
    setActiveFooterSheet,
    stopPickerGroupId,
    setAuftragPickerIncidentId,
    auftragPickerIncidentId,
    setDistributeConfirm,
    routeAssign,
    setRouteAssign,
    checkInUrl,
    setCopied,
    setAttendanceOpen,
    setOperationToDelete,
    operationToDelete,
    setAssignmentDialogOpen,
    setAssignmentResourceType,
    setAssignmentOperationId,
    assignmentOperationId,
    setAssignmentInitialSearch,
    setRekoAssignDialogOpen,
    setRekoAssignOperationId,
  } = input
  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')

  // «Rapport erfassen» is a write, so the caret belongs in the Kurzbericht.
  // Everything that merely opens the same tab to read (a Feldmeldung in the
  // bell, the green icon on a card that already has one) passes no section.
  const handleOpenRapport = useCallback((operationId: string) => {
    setActiveFooterSheet(null)
    openIncidentDetail(operationId, 'rapport', 'kurzbericht')
  }, [openIncidentDetail, setActiveFooterSheet])

  /** Opening the Appell closes the sheet underneath it — two stacked layers for one job
   *  is one too many. */
  const openAttendance = () => {
    setActiveFooterSheet(null)
    setAttendanceOpen(true)
  }

  /** Where this person is still assigned, so a check-out can warn instead of surprising.
   *  Never used to block, and never to release the assignment. */
  const assignmentLabelForPerson = useCallback(
    (person: { name: string }) =>
      operations.find((op) => op.status !== 'complete' && op.crew.includes(person.name))?.location ?? null,
    [operations]
  )

  /** Sidebar «Anrückend» → present: the ordinary check-in, then the roster reloads and the
   *  person moves from that block into «Frei». Errors surface in the block's own toast. */
  const checkInFromDivera = useCallback(
    async (personnelId: string) => {
      if (!selectedEvent) return
      await apiClient.checkInPersonnelForEvent(personnelId, selectedEvent.id)
      await refreshPersonnel()
    },
    [selectedEvent, refreshPersonnel]
  )

  const copyCheckInUrlToClipboard = async () => {
    if (!checkInUrl) return

    try {
      const { copyToClipboard } = await import('@/lib/utils')
      await copyToClipboard(checkInUrl)
      setCopied(true)
      toast.success(tCommon('linkCopied'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(tCommon('copyFailed'))
    }
  }

  // The Reko trupp's link is the field link now — `/reko-dashboard` is gone
  // (plan 26, decision 24) and `/feld` absorbed everything it did.
  // Check-In and Anzeige links live in the Links & QR sheet too (it mints them
  // itself), so the page no longer generates either.

  // Handle resource assignment dialog. A grouped incident owns no resources of its
  // own — the Auftrag (route) does — so assigning from its card buttons or the
  // detail modal edits the route instead of the single stop.
  const handleOpenAssignmentDialog = (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string, search?: string) => {
    const op = operations.find((o) => o.id === operationId)
    // A stop's resources belong to the Auftrag, never to the stop — including
    // when the «es fehlt noch etwas» modal is what sent us here. Resolved via
    // the routes, because a just-added stop has no groupId of its own yet.
    const auftrag = findAuftragForStop(groups, op)
    if (auftrag) {
      handleAssignRouteResource(resourceType, auftrag.id)
      return
    }
    setAssignmentResourceType(resourceType)
    setAssignmentOperationId(operationId)
    setAssignmentInitialSearch(search)
    setAssignmentDialogOpen(true)
  }

  // «Material zuteilen» / «Personal zuteilen» on a field request in the
  // notification sidebar (R13) — the same dialog, searched for the item.
  // Through a ref so the registration does not churn on every render.
  const openAssignmentRef = useRef(handleOpenAssignmentDialog)
  openAssignmentRef.current = handleOpenAssignmentDialog
  useEffect(() => {
    if (!isEditor) return
    registerAssignHandler((incidentId, resourceType, search) =>
      openAssignmentRef.current(resourceType, incidentId, search),
    )
    return () => registerAssignHandler(null)
  }, [isEditor, registerAssignHandler])

  // "+ Stop" — pick EXISTING event incidents to add to a route as stops. Picking
  // an incident already in another route MOVES it (addStops reassigns group_id).
  const handleConfirmAddStops = (incidentIds: string[]) => {
    if (!stopPickerGroupId || incidentIds.length === 0) return
    const groupId = stopPickerGroupId
    closedStopGuard.guard(incidentIds, async () => {
      const ok = await addStopsToGroup(groupId, incidentIds)
      if (ok) toast.success(tDash('stopsAddedToast', { count: incidentIds.length }))
    })
  }

  // "An Auftrag verteilen" — open the route picker for a single incident.
  const handleDistributeToAuftrag = (operationId: string) => {
    setAuftragPickerIncidentId(operationId)
  }

  const performDistribute = (groupId: string, incidentId: string) => {
    closedStopGuard.guard([incidentId], async () => {
      const ok = await addStopsToGroup(groupId, [incidentId])
      if (ok) {
        const group = groups.find((g) => g.id === groupId)
        toast.success(tDash('distributedToast', { name: group?.name ?? '' }))
      }
    })
  }

  const handleChooseAuftrag = (groupId: string) => {
    if (!auftragPickerIncidentId) return
    const incidentId = auftragPickerIncidentId
    // Two moves that cannot be taken back ask first (there is no undo yet):
    // pulling a stop OUT of another Auftrag, and folding an already
    // disponierter Einsatz into a route.
    const op = operations.find((candidate) => candidate.id === incidentId)
    const otherGroup =
      op?.groupId && op.groupId !== groupId ? groups.find((g) => g.id === op.groupId) : undefined
    const dispatched = !!op && ['enroute', 'active', 'returning'].includes(op.status)
    if (otherGroup || dispatched) {
      setDistributeConfirm({
        groupId,
        incidentId,
        incidentLabel: op ? getIncidentRefLabel(op, 40) : '',
        fromName: otherGroup?.name ?? null,
        dispatched,
      })
      return
    }
    performDistribute(groupId, incidentId)
  }

  // "Aus Auftrag entfernen" — detach the incident from its current route (it
  // stays on the board, ungrouped). Only offered when it's already in a route.
  const handleRemoveFromAuftrag = async () => {
    if (!auftragPickerIncidentId) return
    const op = operations.find((o) => o.id === auftragPickerIncidentId)
    if (!op?.groupId) return
    // The release toast («… von <Auftrag> gelöst · Rückgängig») says it.
    await release.releaseStop(op.groupId, auftragPickerIncidentId)
  }

  // Route-level resource assign: open the standard assignment dialog scoped to the
  // ROUTE (Auftrag). Assign/remove hit the group directly, so it works even with
  // zero stops — the route owns the resources, not any single incident.
  const handleAssignRouteResource = (resourceType: 'crew' | 'vehicles' | 'materials', groupId: string) => {
    setRouteAssign({ groupId, resourceType })
    setAssignmentResourceType(resourceType)
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

  // When the assignment dialog is scoped to a ROUTE, its assigned lists +
  // assign/remove callbacks target the Auftrag's resources instead of a stop.
  const routeGroupResources = routeAssign ? getGroupResources(routeAssign.groupId) : null
  const routeOwnIds = routeAssign
    ? new Set(groups.find((group) => group.id === routeAssign.groupId)?.assignments.map((a) => `${a.resourceType}:${a.resourceId}`) ?? [])
    : new Set<string>()
  const occupiedPersonnelIds = new Set([...occupiedResourceIds.personnel].filter((id) => !routeOwnIds.has(`personnel:${id}`)))
  const occupiedVehicleIds = new Set([...occupiedResourceIds.vehicle].filter((id) => !routeOwnIds.has(`vehicle:${id}`)))
  const occupiedMaterialIds = new Set([...occupiedResourceIds.material].filter((id) => !routeOwnIds.has(`material:${id}`)))

  /** «Freigegeben werden: 2 Personen, MTW» — what a delete hands back, named in
   *  the confirmation. Null when the card carries nothing. */
  const deleteReleaseHint = useMemo(() => {
    if (!operationToDelete) return null
    const parts = [
      operationToDelete.crew.length ? tCommon('personCount', { count: operationToDelete.crew.length }) : null,
      operationToDelete.vehicles.length ? operationToDelete.vehicles.join(', ') : null,
    ].filter(Boolean)
    return parts.length ? tCommon('deleteIncidentReleases', { what: parts.join(', ') }) : null
  }, [operationToDelete, tCommon])

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

  return {
    handleOpenRapport,
    openAttendance,
    assignmentLabelForPerson,
    checkInFromDivera,
    copyCheckInUrlToClipboard,
    handleOpenAssignmentDialog,
    handleConfirmAddStops,
    handleDistributeToAuftrag,
    performDistribute,
    handleChooseAuftrag,
    handleRemoveFromAuftrag,
    handleAssignRouteResource,
    handleOpenRekoAssignDialog,
    handleToggleNachbarhilfe,
    handleToggleAmWarten,
    handleToggleZuFuss,
    assignedResources,
    routeGroupResources,
    occupiedPersonnelIds,
    occupiedVehicleIds,
    occupiedMaterialIds,
    deleteReleaseHint,
    handleDeleteOperationConfirm,
  }
}
