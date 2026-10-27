"use client"

import { useEffect, useCallback, useRef, useMemo } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { type Person, type Operation } from "@/lib/contexts/operations-context"
import { apiClient } from "@/lib/api-client"
import { type OperationDetailSection, type OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { type FooterSheet } from "@/components/board/board-footer"
import type { Event } from "@/lib/types/incidents"
import type { Dispatch, SetStateAction } from "react"
import type { ClosedStopPrompt } from "@/lib/hooks/use-closed-stop-guard"
import type { FieldRequestAssignHandler } from "@/lib/contexts/notification-context"

export interface UseBoardDialogActionsInput {
  deleteOperation: (operationId: string) => Promise<void>
  operations: Operation[]
  updateOperation: (operationId: string, updates: Partial<Operation>) => void
  refreshPersonnel: (options?: { skipStateUpdate?: boolean; }) => Promise<Person[]>
  addStopsToGroup: (groupId: string, incidentIds: string[]) => Promise<boolean>
  closedStopGuard: { guard: (incidentIds: string[], run: () => void) => void; prompt: ClosedStopPrompt | null; proceed: () => void; dismiss: () => void; }
  selectedEvent: Event | null
  isEditor: boolean
  registerAssignHandler: (handler: FieldRequestAssignHandler | null) => void
  openIncidentDetail: (operationId: string, tab?: OperationDetailTab, section?: OperationDetailSection, options?: { allowModal?: boolean; }) => void
  setActiveFooterSheet: Dispatch<SetStateAction<FooterSheet | null>>
  stopPickerGroupId: string | null
  /** The shared assignment dialog (incident-dialogs.tsx) – a field request's
   *  «Material zuweisen» opens it, searched for the item. */
  openAssignment: (resourceType: "crew" | "vehicles" | "materials", operationId: string, search?: string) => void
  checkInUrl: string | null
  setCopied: Dispatch<SetStateAction<boolean>>
  setAttendanceOpen: Dispatch<SetStateAction<boolean>>
  setOperationToDelete: Dispatch<SetStateAction<Operation | null>>
  operationToDelete: Operation | null
  setRekoAssignDialogOpen: Dispatch<SetStateAction<boolean>>
  setRekoAssignOperationId: Dispatch<SetStateAction<string | null>>
}

/**
 * The board's dialog and sheet actions: open a Rapport, the attendance dialog,
 * «+ Stop», the card toggles and the delete confirmation. Moved verbatim out of
 * app/page.tsx; the assignment dialog and «An Auftrag verteilen» are the shared
 * incident-dialogs.tsx now.
 */
export function useBoardDialogActions(input: UseBoardDialogActionsInput) {
  const {
    deleteOperation,
    operations,
    updateOperation,
    refreshPersonnel,
    addStopsToGroup,
    closedStopGuard,
    selectedEvent,
    isEditor,
    registerAssignHandler,
    openIncidentDetail,
    setActiveFooterSheet,
    stopPickerGroupId,
    openAssignment,
    checkInUrl,
    setCopied,
    setAttendanceOpen,
    setOperationToDelete,
    operationToDelete,
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
    (person: { id: string }) =>
      operations.find((op) => op.status !== 'complete' && op.crew.some((m) => m.personnelId === person.id))?.location ?? null,
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

  // «Material zuweisen» / «Mannschaft zuweisen» on a field request in the
  // notification sidebar (R13) — the same dialog, searched for the item.
  // Through a ref so the registration does not churn on every render.
  const openAssignmentRef = useRef(openAssignment)
  openAssignmentRef.current = openAssignment
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

  /** «Freigegeben werden: 2 Personen, MTW» — what a delete hands back, named in
   *  the confirmation. Null when the card carries nothing. */
  const deleteReleaseHint = useMemo(() => {
    if (!operationToDelete) return null
    const parts = [
      operationToDelete.crew.length ? tCommon('personCount', { count: operationToDelete.crew.length }) : null,
      operationToDelete.vehicles.length ? operationToDelete.vehicles.map((v) => v.name).join(', ') : null,
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
    handleConfirmAddStops,
    handleOpenRekoAssignDialog,
    handleToggleNachbarhilfe,
    handleToggleAmWarten,
    handleToggleZuFuss,
    deleteReleaseHint,
    handleDeleteOperationConfirm,
  }
}
