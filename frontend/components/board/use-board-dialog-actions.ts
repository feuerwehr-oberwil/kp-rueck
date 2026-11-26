"use client"

import { useEffect, useCallback, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useOperations } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { useNotifications } from "@/lib/contexts/notification-context"
import { apiClient } from "@/lib/api-client"
import { getIncidentRefParts } from "@/lib/incident-types"
import { storeFieldNudgeConfirmation } from "@/components/kanban/field-status-nudge"
import type { useClosedStopGuard } from "@/lib/hooks/use-closed-stop-guard"
import type { IncidentDialogsController } from "@/components/kanban/incident-dialogs"
import type { OpenIncidentDetail } from "./use-board-selection"
import type { BoardSheets } from "./use-board-sheets"

/** The board's dialog and sheet actions – see `useBoardDialogActions`. */
export type BoardDialogActions = ReturnType<typeof useBoardDialogActions>

interface UseBoardDialogActionsInput {
  openIncidentDetail: OpenIncidentDetail
  sheets: Pick<BoardSheets, "setActiveFooterSheet">
  /** The page's one closed-stop confirmation (its prompt renders in `BoardDialogs`). */
  closedStopGuard: ReturnType<typeof useClosedStopGuard>
  /** The shared assignment dialog (incident-dialogs.tsx) – a field request's
   *  «Material zuweisen» opens it, searched for the item. */
  openAssignment: IncidentDialogsController["openAssignment"]
}

/**
 * The board's dialog and sheet actions and the state they open: a Rapport, the
 * Appell, «+ Stop», the Reko assignment, the check-in link, the card toggles and
 * the bell's «Angekommen» / «Material zuweisen» answers.
 * Reads the board contexts itself; the assignment dialog and «An Auftrag
 * verteilen» are the shared incident-dialogs.tsx.
 */
export function useBoardDialogActions({ openIncidentDetail, sheets, closedStopGuard, openAssignment }: UseBoardDialogActionsInput) {
  const { operations, updateOperation, isLoading, changeStatusToTop } = useOperations()
  const { addStops: addStopsToGroup } = useGroups()
  const { personnel, refreshPersonnel } = usePersonnel()
  const { selectedEvent } = useEvent()
  const { isEditor, isViewer } = useAuth()
  const { registerAssignHandler, registerFieldActionHandler } = useNotifications()
  const { setActiveFooterSheet } = sheets
  // "+ Stop" incident picker: the route existing incidents are added to as stops.
  const [stopPickerGroupId, setStopPickerGroupId] = useState<string | null>(null)
  const [checkInUrl, setCheckInUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // The Appell. Not a ninth footer sheet and not a tab inside the shared QR body — it is
  // opened from the check-in sheet's Anwesenheit row, and opening it closes that sheet.
  const [attendanceOpen, setAttendanceOpen] = useState(false)
  // Reko assignment dialog state (context menu)
  const [rekoAssignDialogOpen, setRekoAssignDialogOpen] = useState(false)
  const [rekoAssignOperationId, setRekoAssignOperationId] = useState<string | null>(null)

  // Auto-generate check-in QR code URL when no personnel are available – never for a viewer:
  // the link is a credential (POST, CurrentEditor), and a viewer's phone shows no QR.
  useEffect(() => {
    if (isViewer || !selectedEvent || checkInUrl || isLoading) return
    if (personnel.filter((p) => p.status === "available").length > 0) return
    apiClient.generateCheckInLink(selectedEvent.id).then((response) => {
      setCheckInUrl(`${window.location.origin}${response.link}`)
    }).catch(() => {})
  }, [isViewer, selectedEvent, personnel, checkInUrl, isLoading])

  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')

  // An «Offen» row is «Rapport erfassen», a write, so the caret belongs in the
  // Kurzbericht. A filed one («Erfasst») is opened to read, like a Feldmeldung in
  // the bell or the green icon on a card: no section, or the next shortcut types
  // into a filed report.
  const handleOpenRapport = useCallback((operationId: string, filed: boolean) => {
    setActiveFooterSheet(null)
    if (filed) openIncidentDetail(operationId, 'rapport')
    else openIncidentDetail(operationId, 'rapport', 'kurzbericht')
  }, [openIncidentDetail, setActiveFooterSheet])

  /** Opening the Appell closes the sheet underneath it — two stacked layers for one job
   *  is one too many. */
  const openAttendance = () => {
    setActiveFooterSheet(null)
    setAttendanceOpen(true)
  }

  /** Where this person is still assigned («14 · Talstrasse 25», the Einsatz as the card names
   *  it), so a check-out can warn instead of surprising and the Appell row can say where.
   *  Never used to block, and never to release the assignment. */
  const assignmentLabelForPerson = useCallback(
    (person: { id: string }) => {
      const op = operations.find((o) => o.status !== 'complete' && o.crew.some((m) => m.personnelId === person.id))
      return op ? getIncidentRefParts(op).head : null
    },
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

  // «Angekommen» / «Einsatz beendet» answered straight from the bell, without
  // finding the card first. It has to be the SAME move the card's own nudge
  // makes, and for a while it was not: this one ran `requestCompletion`, i.e.
  // the whole completion flow down to *Abgeschlossen*, while the nudge on the
  // card moved to *Beendet / Rückfahrt* and stopped. Two buttons that ask the
  // same question and answer it differently is worse than either answer — and
  // the nudge's is the right one (see `field-status-nudge.tsx`): a crew that
  // has packed up is not a Schadenplatz the KP has closed.
  useEffect(() => {
    if (!isEditor) return
    registerFieldActionHandler((incidentId, kind) => {
      storeFieldNudgeConfirmation(incidentId, kind)
      changeStatusToTop(incidentId, kind === "complete" ? "returning" : "active")
    })
    return () => registerFieldActionHandler(null)
  }, [isEditor, registerFieldActionHandler, changeStatusToTop])

  // "+ Stop" — pick EXISTING event incidents to add to a route as stops. Picking
  // an incident already in another route MOVES it (addStops reassigns group_id).
  const handleConfirmAddStops = (incidentIds: string[]) => {
    if (!stopPickerGroupId || incidentIds.length === 0) return
    const groupId = stopPickerGroupId
    closedStopGuard.guard(incidentIds, () => {
      void addStopsToGroup(groupId, incidentIds).then((ok) => {
        if (ok) toast.success(tDash('stopsAddedToast', { count: incidentIds.length }))
      })
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

  return {
    stopPickerGroupId,
    setStopPickerGroupId,
    checkInUrl,
    copied,
    attendanceOpen,
    setAttendanceOpen,
    rekoAssignDialogOpen,
    setRekoAssignDialogOpen,
    rekoAssignOperationId,
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
  }
}
