"use client"

import { useCallback, useEffect, useMemo, useState, useRef } from "react"
import { useTranslations } from "next-intl"
import {
  AlertCircle,
  Binoculars,
  CheckCircle2,
  ClipboardCheck,
  Footprints,
  Package,
  Plus,
  Truck,
  Users,
  Waypoints,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"
import { DisponierTransitionDialog } from "@/components/kanban/disponiert-transition-dialog"
import { apiClient } from "@/lib/api-client"
import type { Material, Operation, OperationStatus } from "@/lib/contexts/operations-context"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import { findAuftragForStop } from "@/lib/kanban-utils"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import type { OperationDetailSection, OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"

// Home-town-free label for dialog texts; falls back to the incident type when
// the address was only the home town (formatted location is then empty).
function operationLabel(operation: Operation): string {
  return (operation.locationDisplay ?? formatLocationForDisplay(operation.location, getGlobalHomeCity()))
    || getIncidentTypeLabel(operation.incidentType)
}

type ResourceType = "crew" | "vehicles" | "materials"

/**
 * Which missing resources actually BAR a dispatch, as opposed to being worth a reminder.
 *
 * Material is deliberately not one of them. Most incidents genuinely need none — a
 * Brandbekämpfung with three people and a TLF is complete — so treating «Material (0)» as a
 * blocker fired the gate on nearly every incident and pushed the Funkdurchsage behind the
 * quietest button in the dialog. A gate that trips on the normal case does not teach care, it
 * teaches clicking through gates.
 *
 * Crew and vehicles stay hard: you cannot send nobody, and you cannot drive without a vehicle
 * unless the incident is marked «zu Fuss» (which getMissingResources already honours).
 */
const BLOCKING_RESOURCES: readonly ResourceType[] = ["crew", "vehicles"]
type AssignmentReturn = { kind: "missing" | "returning"; operationId: string }

interface UseIncidentStatusWorkflowOptions {
  operations: Operation[]
  materials: Material[]
  /** The Aufträge — a stop's route is resolved through these, not through its
   *  own groupId, which lags a stop that was just added (findAuftragForStop). */
  groups: IncidentGroup[]
  changeStatusToTop: (operationId: string, status: OperationStatus, extraUpdates?: Partial<Operation>) => void
  getGroupResources: (groupId: string) => GroupResources
  removeMaterial: (operationId: string, materialId: string) => unknown
  unassignGroupResource: (groupId: string, assignmentId: string) => unknown
}

export function useIncidentStatusWorkflow({
  operations,
  materials,
  groups,
  changeStatusToTop,
  getGroupResources,
  removeMaterial,
  unassignGroupResource,
}: UseIncidentStatusWorkflowOptions) {
  const [disponiertOperationId, setDisponiertOperationId] = useState<string | null>(null)
  const [missingResourcesOperationId, setMissingResourcesOperationId] = useState<string | null>(null)
  // Status the incident was in BEFORE dispatch — Cancel in the missing-resources
  // dialog reverts to it (the status change happens before the dialog opens).
  const [missingResourcesReturnStatus, setMissingResourcesReturnStatus] = useState<OperationStatus | null>(null)
  const [returningVehicleOperationId, setReturningVehicleOperationId] = useState<string | null>(null)
  // Same Cancel-reverts pattern for the other post-change gates: each stores
  // the status the incident was in BEFORE the change so Abbrechen can undo it.
  const [returningVehicleReturnStatus, setReturningVehicleReturnStatus] = useState<OperationStatus | null>(null)
  const [rekoMissingOperationId, setRekoMissingOperationId] = useState<string | null>(null)
  const [rekoMissingReturnStatus, setRekoMissingReturnStatus] = useState<OperationStatus | null>(null)
  const [rekoFormMissingOperationId, setRekoFormMissingOperationId] = useState<string | null>(null)
  const [rekoFormMissingReturnStatus, setRekoFormMissingReturnStatus] = useState<OperationStatus | null>(null)
  const [materialDecisionOperationId, setMaterialDecisionOperationId] = useState<string | null>(null)
  const [materialDecisionReturnStatus, setMaterialDecisionReturnStatus] = useState<OperationStatus | null>(null)
  // The stop that just reached «Beendet», while the board asks whether the
  // squad should start the next one. Holds the FINISHED stop rather than the
  // candidate: the candidate is derived, so it cannot go stale against a route
  // that changed while the dialog was open.
  const [nextStopAfterId, setNextStopAfterId] = useState<string | null>(null)
  const [rekoAssignmentOperationId, setRekoAssignmentOperationId] = useState<string | null>(null)
  // Carried over from the Reko gate so Abbrechen in the picker still undoes the
  // move, exactly like Abbrechen one dialog earlier would have.
  const [rekoAssignmentReturnStatus, setRekoAssignmentReturnStatus] = useState<OperationStatus | null>(null)
  const [assignmentReturn, setAssignmentReturn] = useState<AssignmentReturn | null>(null)
  const [materialDecisions, setMaterialDecisions] = useState<Record<string, "magazin" | "vorort">>({})
  // What the Schadenplatz-Rapport already answered, per material id, plus who
  // answered it. The crew ticked "vor Ort verblieben" unit by unit at the
  // scene; asking the same question again at completion is asking somebody who
  // was not there to overrule somebody who was.
  const [materialAnswers, setMaterialAnswers] = useState<Record<string, "magazin" | "vorort">>({})
  const [materialRapportBy, setMaterialRapportBy] = useState<string | null>(null)
  // Was that rapport filed, or is it still a draft the crew never submitted?
  // The gate reads both (§18.23) and must say which it is reading.
  const [materialRapportIsDraft, setMaterialRapportIsDraft] = useState(false)

  // Moving a card into a working column auto-clears «Am Warten» (see
  // `updateOperation`). The gates below move FIRST and ask afterwards, so
  // cancelling one has to put the flag back — otherwise the operator cancels
  // the move and the flag is gone anyway, with a toast already claiming it.
  // One ref is enough: only one gate is ever open at a time.
  const clearedAmWartenRef = useRef<{ operationId: string } | null>(null)

  const rememberAmWarten = useCallback(
    (operationId: string) => {
      const operation = operations.find((o) => o.id === operationId)
      clearedAmWartenRef.current = operation?.amWarten ? { operationId } : null
    },
    [operations],
  )

  /** Undo a gate's move, restoring anything the move silently changed. */
  const revertTo = useCallback(
    (operationId: string, status: OperationStatus) => {
      const remembered = clearedAmWartenRef.current
      clearedAmWartenRef.current = null
      // Called with two arguments when there is nothing to put back, so the
      // ordinary revert keeps exactly the call shape it always had.
      if (remembered?.operationId === operationId) {
        changeStatusToTop(operationId, status, { amWarten: true })
      } else {
        changeStatusToTop(operationId, status)
      }
    },
    [changeStatusToTop],
  )

  const operationById = useCallback(
    (operationId: string | null) => operationId
      ? operations.find((operation) => operation.id === operationId) ?? null
      : null,
    [operations],
  )

  const getMissingResources = useCallback((operation: Operation): ResourceType[] => {
    const auftrag = findAuftragForStop(groups, operation)
    const route = auftrag ? getGroupResources(auftrag.id) : null
    const missing: ResourceType[] = []
    if (operation.crew.length + (route?.personnel.length ?? 0) === 0) missing.push("crew")
    if (!operation.zuFuss && operation.vehicles.length + (route?.vehicles.length ?? 0) === 0) missing.push("vehicles")
    if (operation.materials.length + (route?.materials.length ?? 0) === 0) missing.push("materials")
    return missing
  }, [getGroupResources, groups])

  const getResourceCoverage = useCallback((operation: Operation) => {
    const auftrag = findAuftragForStop(groups, operation)
    const route = auftrag ? getGroupResources(auftrag.id) : null
    return {
      crewCount: operation.crew.length + (route?.personnel.length ?? 0),
      vehicleNames: [...operation.vehicles, ...(route?.vehicles.map((vehicle) => vehicle.name) ?? [])],
      materialCount: operation.materials.length + (route?.materials.length ?? 0),
    }
  }, [getGroupResources, groups])

  const triggerDisponiertDialog = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    rememberAmWarten(operationId)
    const operation = operationById(operationId)
    if (!operation) return
    if (getMissingResources(operation).length > 0) {
      setMissingResourcesOperationId(operation.id)
      setMissingResourcesReturnStatus(previousStatus ?? null)
    } else {
      setDisponiertOperationId(operation.id)
    }
  }, [getMissingResources, operationById, rememberAmWarten])

  const triggerReturningVehicleCheck = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    rememberAmWarten(operationId)
    const operation = operationById(operationId)
    if (!operation) return
    const auftrag = findAuftragForStop(groups, operation)
    const routeVehicleCount = auftrag ? getGroupResources(auftrag.id).vehicles.length : 0
    if (!operation.zuFuss && operation.vehicles.length === 0 && routeVehicleCount === 0) {
      setReturningVehicleOperationId(operation.id)
      // The assignment round-trip re-triggers without previousStatus — keep
      // the stored return status alive instead of overwriting it with null.
      if (previousStatus) setReturningVehicleReturnStatus(previousStatus)
    } else {
      // Gate resolved (vehicle assigned / zu Fuss) — drop any stored revert.
      setReturningVehicleReturnStatus(null)
    }
  }, [getGroupResources, groups, operationById, rememberAmWarten])

  const triggerRekoCheck = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    rememberAmWarten(operationId)
    const operation = operationById(operationId)
    if (operation && !operation.assignedReko) {
      setRekoMissingOperationId(operation.id)
      setRekoMissingReturnStatus(previousStatus ?? null)
    }
  }, [operationById, rememberAmWarten])

  const triggerRekoFormCheck = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    rememberAmWarten(operationId)
    const operation = operationById(operationId)
    if (operation && !operation.hasCompletedReko) {
      setRekoFormMissingOperationId(operation.id)
      setRekoFormMissingReturnStatus(previousStatus ?? null)
    }
  }, [operationById, rememberAmWarten])

  const promptMaterialDecision = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    rememberAmWarten(operationId)
    const operation = operationById(operationId)
    if (!operation) return
    if (operation.groupId) {
      if (getGroupResources(operation.groupId).materials.length === 0) return
      const hasOpenSibling = operations.some((candidate) =>
        candidate.groupId === operation.groupId
        && candidate.id !== operation.id
        && candidate.status !== "complete"
        && candidate.status !== "returning",
      )
      if (!hasOpenSibling) {
        setMaterialDecisionOperationId(operation.id)
        setMaterialDecisionReturnStatus(previousStatus ?? null)
      }
      return
    }
    if (operation.materials.length > 0) {
      setMaterialDecisionOperationId(operation.id)
      setMaterialDecisionReturnStatus(previousStatus ?? null)
    }
  }, [getGroupResources, operationById, operations, rememberAmWarten])

  const requestStatusChange = useCallback((operationId: string, targetStatus: OperationStatus) => {
    const operation = operationById(operationId)
    if (!operation || operation.status === targetStatus) return

    const previousStatus = operation.status
    changeStatusToTop(operationId, targetStatus)
    if (targetStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
    if (targetStatus === "reko") triggerRekoCheck(operationId, previousStatus)
    if (targetStatus === "reko_done") triggerRekoFormCheck(operationId, previousStatus)
    if (targetStatus === "returning") {
      triggerReturningVehicleCheck(operationId, previousStatus)
      // A squad that finished a stop is a squad with nothing to do — and the
      // route already says what is next. Only ASKED, never done: which stop a
      // crew drives to next is a decision somebody makes over the radio, and a
      // card that moved by itself is a card nobody trusts. Whether there is
      // anything to ask about is derived below.
      setNextStopAfterId(operationId)
    }
    if (targetStatus === "complete") promptMaterialDecision(operationId, previousStatus)
  }, [changeStatusToTop, operationById, promptMaterialDecision, triggerDisponiertDialog, triggerRekoCheck, triggerRekoFormCheck, triggerReturningVehicleCheck])

  /**
   * The stop the board is about to offer, or null when there is nothing to ask.
   *
   * Three conditions, all of them reasons NOT to ask:
   *  * the finished stop belongs to no Auftrag — there is no "next";
   *  * another stop of that Auftrag is already in Einsatz, so the squad is not
   *    free and the question would be about work they are already doing;
   *  * every remaining stop is finished, or the route is down to this one.
   *
   * Derived rather than stored, so a route edited while the dialog is open
   * cannot leave the board offering a stop that has since been dispatched.
   */
  const nextStopPrompt = useMemo(() => {
    const finished = operationById(nextStopAfterId)
    if (!finished) return null
    const auftrag = findAuftragForStop(groups, finished)
    if (!auftrag) return null

    const stops = auftrag.stopIds
      .map((stopId) => operations.find((candidate) => candidate.id === stopId))
      .filter((candidate): candidate is Operation => Boolean(candidate))
    const othersRunning = stops.some(
      (stop) => stop.id !== finished.id && stop.status === "active",
    )
    if (othersRunning) return null

    // "Not started yet": everything before Einsatz on the board's own order.
    // Reko and Reko-abgeschlossen count — they are stops nobody has driven to.
    const next = stops.find(
      (stop) =>
        stop.id !== finished.id &&
        !["active", "returning", "complete"].includes(stop.status),
    )
    return next ? { finished, auftrag, next } : null
  }, [groups, nextStopAfterId, operationById, operations])

  const requestCompletion = useCallback(
    (operationId: string) => requestStatusChange(operationId, "complete"),
    [requestStatusChange],
  )

  const suspendGateForAssignment = useCallback((kind: AssignmentReturn["kind"], operationId: string) => {
    setMissingResourcesOperationId(null)
    setReturningVehicleOperationId(null)
    setAssignmentReturn({ kind, operationId })
  }, [])

  const resumeGateAfterAssignment = useCallback(() => {
    if (!assignmentReturn) return
    const { kind, operationId } = assignmentReturn
    setAssignmentReturn(null)
    if (kind === "missing") setMissingResourcesOperationId(operationId)
    else triggerReturningVehicleCheck(operationId)
  }, [assignmentReturn, triggerReturningVehicleCheck])

  const cancelMissingResources = useCallback(() => {
    if (missingResourcesOperationId && missingResourcesReturnStatus) {
      revertTo(missingResourcesOperationId, missingResourcesReturnStatus)
    }
    setMissingResourcesOperationId(null)
    setMissingResourcesReturnStatus(null)
  }, [missingResourcesOperationId, missingResourcesReturnStatus, revertTo])

  const cancelReturningVehicle = useCallback(() => {
    if (returningVehicleOperationId && returningVehicleReturnStatus) {
      revertTo(returningVehicleOperationId, returningVehicleReturnStatus)
    }
    setReturningVehicleOperationId(null)
    setReturningVehicleReturnStatus(null)
    // The move was undone, so the stop is not finished after all and there is
    // nothing to ask about the next one.
    setNextStopAfterId(null)
  }, [returningVehicleOperationId, returningVehicleReturnStatus, revertTo])

  const cancelRekoMissing = useCallback(() => {
    if (rekoMissingOperationId && rekoMissingReturnStatus) {
      revertTo(rekoMissingOperationId, rekoMissingReturnStatus)
    }
    setRekoMissingOperationId(null)
    setRekoMissingReturnStatus(null)
  }, [rekoMissingOperationId, rekoMissingReturnStatus, revertTo])

  const cancelRekoFormMissing = useCallback(() => {
    if (rekoFormMissingOperationId && rekoFormMissingReturnStatus) {
      revertTo(rekoFormMissingOperationId, rekoFormMissingReturnStatus)
    }
    setRekoFormMissingOperationId(null)
    setRekoFormMissingReturnStatus(null)
  }, [rekoFormMissingOperationId, rekoFormMissingReturnStatus, revertTo])

  const cancelMaterialDecision = useCallback(() => {
    if (materialDecisionOperationId && materialDecisionReturnStatus) {
      revertTo(materialDecisionOperationId, materialDecisionReturnStatus)
    }
    setMaterialDecisionOperationId(null)
    setMaterialDecisionReturnStatus(null)
  }, [materialDecisionOperationId, materialDecisionReturnStatus, revertTo])

  const materialDecisionOperation = operationById(materialDecisionOperationId)

  // Prefill the gate from a submitted rapport instead of asking from scratch.
  // The fetch lives here rather than in `promptMaterialDecision` so the trigger
  // stays synchronous — the gate must open the instant the card moves, and the
  // crew's answers land in it a moment later rather than delaying it.
  useEffect(() => {
    setMaterialDecisions({})
    setMaterialAnswers({})
    setMaterialRapportBy(null)
    setMaterialRapportIsDraft(false)
    if (!materialDecisionOperationId) return

    let cancelled = false
    void (async () => {
      try {
        // `includeDraft` (§18.23): a crew that filled the checklist and never
        // pressed *Rapport abschliessen* on a phone in the rain has answered
        // the question anyway, and asking the operator from scratch is exactly
        // the complaint. Nothing is auto-applied — the operator still confirms,
        // which is what makes reading a draft safe here. The release list in
        // the incident detail does NOT pass it: its click releases assignments.
        const data = await apiClient.getRapportMaterialReturn(materialDecisionOperationId, { includeDraft: true })
        if (cancelled) return
        const answers: Record<string, "magazin" | "vorort"> = {}
        // `returned` also carries the units nobody answered — those are still
        // open questions and must stay unmarked, or the gate would claim the
        // crew said "Magazin" about a unit it never looked at.
        for (const unit of data.returned) {
          if (unit.answered && unit.material_id) answers[unit.material_id] = "magazin"
        }
        // `left_on_site` needs no `answered` check: saying where a unit stays
        // IS the answer. `used: null` next to `left_on_site: true` is the crew
        // answering one question and not the other, not an untouched row.
        for (const unit of data.left_on_site) {
          if (unit.material_id) answers[unit.material_id] = "vorort"
        }
        setMaterialAnswers(answers)
        const hasAnswers = Object.keys(answers).length > 0
        setMaterialRapportBy(hasAnswers ? data.rapport_by : null)
        setMaterialRapportIsDraft(hasAnswers && data.rapport_is_draft)
      } catch (error) {
        // A gate that fails open is right here: no prefill, ask everything, the
        // way it worked before the rapport existed.
        console.error("Failed to load rapport material answers:", error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [materialDecisionOperationId])

  const materialDecisionItems = useMemo(() => {
    if (!materialDecisionOperation) return []
    const rows = materialDecisionOperation.groupId
      ? getGroupResources(materialDecisionOperation.groupId).materials.map((material) => ({
          id: material.resourceId,
          assignmentId: material.assignmentId,
        }))
      : materialDecisionOperation.materials.map((id) => ({ id, assignmentId: null }))

    return rows.map((row) => {
      // A consumable has no "vor Ort" state at all — it was used or it was not,
      // and either way it does not come back (decision 26). So it is never an
      // open question, and it must not be one of the answers the operator is
      // asked to give.
      const consumable = Boolean(materials.find((material) => material.id === row.id)?.consumable)
      const answer = consumable ? "magazin" : materialAnswers[row.id]
      return {
        ...row,
        consumable,
        answer: answer ?? null,
        source: consumable ? ("consumable" as const) : answer ? ("rapport" as const) : null,
      }
    })
  }, [getGroupResources, materialAnswers, materialDecisionOperation, materials])

  /** How many units the operator genuinely still has to decide. */
  const materialDecisionOpenCount = materialDecisionItems.filter((item) => item.source === null).length

  /** The operator's own click wins; the rapport answers what they left alone. */
  const materialChoice = useCallback(
    (item: { id: string; answer: "magazin" | "vorort" | null }): "magazin" | "vorort" =>
      materialDecisions[item.id] ?? item.answer ?? "magazin",
    [materialDecisions],
  )

  const resolveMaterialDecision = useCallback(() => {
    if (!materialDecisionOperation) return { returned: [] as string[], kept: [] as string[] }
    const returnedItems = materialDecisionItems.filter((item) => materialChoice(item) === "magazin")
    const kept = materialDecisionItems
      .filter((item) => materialChoice(item) === "vorort")
      .map((item) => item.id)

    for (const item of returnedItems) {
      if (item.assignmentId && materialDecisionOperation.groupId) {
        void unassignGroupResource(materialDecisionOperation.groupId, item.assignmentId)
      } else {
        void removeMaterial(materialDecisionOperation.id, item.id)
      }
    }
    setMaterialDecisionOperationId(null)
    setMaterialDecisionReturnStatus(null)
    return { returned: returnedItems.map((item) => item.id), kept }
  }, [materialChoice, materialDecisionItems, materialDecisionOperation, removeMaterial, unassignGroupResource])

  const returningVehicleOperation = operationById(returningVehicleOperationId)
  const effectiveReturningVehicleOperation = returningVehicleOperation
    && !returningVehicleOperation.zuFuss
    && returningVehicleOperation.vehicles.length === 0
    && (!returningVehicleOperation.groupId || getGroupResources(returningVehicleOperation.groupId).vehicles.length === 0)
    ? returningVehicleOperation
    : null

  return {
    requestStatusChange,
    requestCompletion,
    triggerDisponiertDialog,
    triggerReturningVehicleCheck,
    triggerRekoCheck,
    triggerRekoFormCheck,
    promptMaterialDecision,
    getMissingResources,
    getResourceCoverage,
    suspendGateForAssignment,
    resumeGateAfterAssignment,
    disponiertOperation: operationById(disponiertOperationId),
    closeDisponiert: () => setDisponiertOperationId(null),
    openDisponiert: (operationId: string) => {
      setMissingResourcesOperationId(null)
      setMissingResourcesReturnStatus(null)
      setDisponiertOperationId(operationId)
    },
    missingResourcesOperation: operationById(missingResourcesOperationId),
    // No `closeMissingResources`: every way out of this gate is either
    // «Trotzdem disponieren» (which is `openDisponiert`, and clears the state
    // itself) or Abbrechen. A third "just close it" verb was what Escape ended
    // up bound to.
    cancelMissingResources,
    returningVehicleOperation: effectiveReturningVehicleOperation,
    closeReturningVehicle: () => {
      setReturningVehicleOperationId(null)
      setReturningVehicleReturnStatus(null)
    },
    cancelReturningVehicle,
    nextStopPrompt,
    closeNextStopPrompt: () => setNextStopAfterId(null),
    startNextStop: () => {
      const next = nextStopPrompt?.next
      setNextStopAfterId(null)
      if (next) requestStatusChange(next.id, "active")
    },
    rekoMissingOperation: operationById(rekoMissingOperationId),
    closeRekoMissing: () => {
      setRekoMissingOperationId(null)
      setRekoMissingReturnStatus(null)
    },
    cancelRekoMissing,
    rekoFormMissingOperation: operationById(rekoFormMissingOperationId),
    closeRekoFormMissing: () => {
      setRekoFormMissingOperationId(null)
      setRekoFormMissingReturnStatus(null)
    },
    cancelRekoFormMissing,
    materialDecisionOperation,
    // Same here: confirming goes through `resolveMaterialDecision`, which
    // clears the gate itself. Dismissing is a cancel.
    cancelMaterialDecision,
    materialDecisionItems,
    materialDecisions,
    /** Who filed the rapport the prefilled answers come from; null when none did. */
    materialRapportBy,
    /** …and whether that rapport is still a draft, which the dialog must say. */
    materialRapportIsDraft,
    /** Units the operator genuinely still has to decide (0 = a pure confirmation). */
    materialDecisionOpenCount,
    materialChoice,
    setMaterialDecision: (materialId: string, decision: "magazin" | "vorort") => {
      setMaterialDecisions((current) => ({ ...current, [materialId]: decision }))
    },
    resolveMaterialDecision,
    rekoAssignmentOperation: operationById(rekoAssignmentOperationId),
    openRekoAssignment: (operationId: string) => {
      setRekoMissingOperationId(null)
      setRekoMissingReturnStatus(null)
      // Hand the revert status ON to the assignment step instead of dropping
      // it. "Reko zuweisen" is not itself a decision to proceed — it opens a
      // picker that can still be cancelled, and backing out of the picker has
      // to land where backing out of the gate would have.
      setRekoAssignmentReturnStatus(rekoMissingReturnStatus)
      setRekoAssignmentOperationId(operationId)
    },
    /** Backed out of the picker → undo the move that opened the gate. */
    cancelRekoAssignment: () => {
      if (rekoAssignmentOperationId && rekoAssignmentReturnStatus) {
        revertTo(rekoAssignmentOperationId, rekoAssignmentReturnStatus)
      }
      setRekoAssignmentOperationId(null)
      setRekoAssignmentReturnStatus(null)
    },
    /** A Reko was actually assigned → the move stands. */
    closeRekoAssignment: () => {
      setRekoAssignmentOperationId(null)
      setRekoAssignmentReturnStatus(null)
    },
    materials,
  }
}

export type IncidentStatusWorkflowController = ReturnType<typeof useIncidentStatusWorkflow>

interface IncidentStatusWorkflowDialogsProps {
  controller: IncidentStatusWorkflowController
  printerEnabled: boolean
  funkrufname: string
  diveraEnabled: boolean
  onOpenAssignment: (resourceType: ResourceType, operationId: string) => void
  onOpenDetail: (operationId: string, tab?: OperationDetailTab, section?: OperationDetailSection) => void
  onSendDivera: (operation: Operation) => void
  onRefresh: () => void | Promise<void>
}

export function IncidentStatusWorkflowDialogs({
  controller,
  printerEnabled,
  funkrufname,
  diveraEnabled,
  onOpenAssignment,
  onOpenDetail,
  onSendDivera,
  onRefresh,
}: IncidentStatusWorkflowDialogsProps) {
  const tCommon = useTranslations("kanban.common")
  const tDash = useTranslations("kanban.dashboard")
  const tRes = useTranslations("kanban.resources")
  const tMissing = useTranslations("kanban.missingResources")
  const tReturning = useTranslations("kanban.returningVehicle")
  const tReko = useTranslations("kanban.rekoMissing")
  const tRekoForm = useTranslations("kanban.rekoFormMissing")
  const tMat = useTranslations("kanban.materialDecision")
  const tNext = useTranslations("kanban.nextStop")

  const openAssignment = (resourceType: ResourceType, operationId: string, kind: AssignmentReturn["kind"]) => {
    controller.suspendGateForAssignment(kind, operationId)
    onOpenAssignment(resourceType, operationId)
  }

  const missingOperation = controller.missingResourcesOperation
  const missing = missingOperation ? controller.getMissingResources(missingOperation) : []
  const allFilled = missing.length === 0
  // The checklist still LISTS everything that is missing; only these hold the dispatch back.
  const blocking = missing.some((resource) => BLOCKING_RESOURCES.includes(resource))
  const missingTitleKey = allFilled
    ? "readyTitle"
    : missing.length === 1
      ? missing[0] === "crew"
        ? "titleCrewOnly"
        : missing[0] === "vehicles"
          ? "titleVehiclesOnly"
          : "titleMaterialsOnly"
      : "title"

  return (
    <>
      {/* Escape and the overlay are Abbrechen, never the override next to it.
          These gates open because a card was ALREADY moved, so `close*` (which
          drops the revert status and leaves the move standing) is the same
          action as «Trotzdem disponieren» — bound to the one key an operator
          hits to get out of a dialog they did not mean to open. `cancel*` puts
          the card back, which is what the Abbrechen button does and what
          dismissing a modal has to mean. `AssignRekoDialog` below already got
          this right; the four gates did not. */}
      <AlertDialog open={!!missingOperation} onOpenChange={(open) => !open && controller.cancelMissingResources()}>
        <AlertDialogContent>
          {missingOperation && (() => {
            const coverage = controller.getResourceCoverage(missingOperation)
            const rows = [
              {
                key: "crew" as const,
                icon: Users,
                filled: !missing.includes("crew"),
                summary: tMissing("personalSummary", { count: coverage.crewCount }),
              },
              {
                key: "vehicles" as const,
                icon: Truck,
                filled: !missing.includes("vehicles"),
                summary: missingOperation.zuFuss ? tCommon("zuFuss") : coverage.vehicleNames.join(", "),
              },
              {
                key: "materials" as const,
                icon: Package,
                filled: !missing.includes("materials"),
                summary: tMissing("mittelSummary", { count: coverage.materialCount }),
              },
            ]
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    {allFilled
                      ? <CheckCircle2 className="h-5 w-5 text-success" />
                      : <Package className="h-5 w-5 text-primary" />}
                    {tMissing(missingTitleKey)}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {tMissing.rich(allFilled ? "readyIntro" : "checklistIntro", {
                      location: operationLabel(missingOperation),
                      hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-1.5 py-1">
                  {rows.map(({ key, icon: Icon, filled, summary }) => (
                    <button
                      key={key}
                      onClick={() => openAssignment(key, missingOperation.id, "missing")}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40"
                    >
                      {filled
                        ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />
                        : <AlertCircle className="h-4 w-4 flex-shrink-0 text-warning-foreground" />}
                      <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{tRes(key)}</div>
                        {filled && summary && <div className="truncate text-xs text-muted-foreground" title={summary}>{summary}</div>}
                      </div>
                      {filled ? (
                        <span className="flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <Plus className="h-3.5 w-3.5" />
                          {tMissing("addMore")}
                        </span>
                      ) : (
                        <span className="flex-shrink-0 rounded-md bg-secondary px-2 py-1 text-xs font-medium">
                          {tCommon("assign")}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {/* «Trotzdem disponieren» is the override for a REAL gate, so it only appears
                    while one is closed. With just material outstanding the primary button is
                    live and says «Fertig» — no override needed for the ordinary case. */}
                <AlertDialogFooter className={blocking ? "sm:justify-between" : undefined}>
                  {blocking && (
                    <Button variant="ghost" onClick={() => controller.openDisponiert(missingOperation.id)}>
                      {tMissing("dispatchAnyway")}
                    </Button>
                  )}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="outline" onClick={() => controller.cancelMissingResources()}>
                      {tCommon("cancel")}
                    </Button>
                    <Button disabled={blocking} onClick={() => controller.openDisponiert(missingOperation.id)}>
                      {tMissing("done")}
                    </Button>
                  </div>
                </AlertDialogFooter>
              </>
            )
          })()}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!controller.returningVehicleOperation} onOpenChange={(open) => !open && controller.cancelReturningVehicle()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Footprints className="h-5 w-5 text-warning-foreground" />
              {tReturning("title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {controller.returningVehicleOperation && tReturning.rich("description", {
                location: operationLabel(controller.returningVehicleOperation),
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={controller.closeReturningVehicle}>{tReturning("endAnyway")}</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={controller.cancelReturningVehicle}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={() => {
                const operation = controller.returningVehicleOperation
                if (operation) openAssignment("vehicles", operation.id, "returning")
              }}>
                {tReturning("assignVehicle")}
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* «Nächsten Stopp starten?» — queued BEHIND the missing-vehicle gate
          (`&& !returningVehicleOperation`) rather than racing it: both are
          answers to the same move, and two modals over one card is a question
          about which of them counts. */}
      <AlertDialog
        open={!!controller.nextStopPrompt && !controller.returningVehicleOperation}
        onOpenChange={(open) => !open && controller.closeNextStopPrompt()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Waypoints className="h-5 w-5 text-primary" />
              {tNext("title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {controller.nextStopPrompt && tNext.rich("description", {
                finished: operationLabel(controller.nextStopPrompt.finished),
                auftrag: controller.nextStopPrompt.auftrag.name,
                next: operationLabel(controller.nextStopPrompt.next),
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={controller.closeNextStopPrompt}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={controller.startNextStop}>{tNext("confirm")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!controller.rekoMissingOperation} onOpenChange={(open) => !open && controller.cancelRekoMissing()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Binoculars className="h-5 w-5 text-primary" />
              {tCommon("noRekoAssigned")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {controller.rekoMissingOperation && tReko.rich("description", {
                location: operationLabel(controller.rekoMissingOperation),
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={controller.closeRekoMissing}>{tReko("proceedAnyway")}</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={controller.cancelRekoMissing}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={() => {
                const operation = controller.rekoMissingOperation
                if (operation) controller.openRekoAssignment(operation.id)
              }}>
                {tReko("assignReko")}
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!controller.rekoFormMissingOperation} onOpenChange={(open) => !open && controller.cancelRekoFormMissing()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              {tRekoForm("title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {controller.rekoFormMissingOperation && tRekoForm.rich("description", {
                location: operationLabel(controller.rekoFormMissingOperation),
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={controller.closeRekoFormMissing}>{tRekoForm("proceedAnyway")}</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={controller.cancelRekoFormMissing}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={() => {
                const operation = controller.rekoFormMissingOperation
                // closeRekoFormMissing also drops the revert status — opening
                // the Reko details is a "proceed", not a cancel.
                controller.closeRekoFormMissing()
                // …on the REKO tab, with the entry form already open. The
                // dialog's whole subject is that no Reko report was filled in,
                // and it used to land the operator on Übersicht — the one tab
                // that says nothing about it — with the «erstellen» button two
                // clicks away.
                if (operation) onOpenDetail(operation.id, 'reko', 'newReport')
              }}>
                {tRekoForm("openReko")}
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!controller.materialDecisionOperation} onOpenChange={(open) => !open && controller.cancelMaterialDecision()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              {tMat("title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {controller.materialDecisionOperation && tMat.rich(
                // A rapport that answered everything turns this from a decision
                // into a confirmation, and the text has to say so — otherwise the
                // operator reads "entscheide pro Mittel" over answers that are
                // already made and starts checking work somebody else did.
                controller.materialRapportBy
                  ? controller.materialDecisionOpenCount === 0
                    ? "descriptionFromRapport"
                    : "descriptionPartialRapport"
                  : "description",
                {
                  location: operationLabel(controller.materialDecisionOperation),
                  count: controller.materialDecisionOpenCount,
                  hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {controller.materialRapportBy && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ClipboardCheck className="h-3.5 w-3.5 flex-shrink-0" />
              {/* "Rapport" vs "Rapport-Entwurf" (§18.23): the gate reads a
                  draft too now, and an operator weighing a half-finished
                  answer has to know it is half-finished. */}
              {tMat(controller.materialRapportIsDraft ? "rapportSourceDraft" : "rapportSource", {
                name: controller.materialRapportBy,
              })}
            </p>
          )}
          {controller.materialDecisionOperation && (
            <div className="max-h-64 space-y-1.5 overflow-y-auto py-1">
              {controller.materialDecisionItems.map((item) => {
                const materialId = item.id
                const choice = controller.materialChoice(item)
                const name = controller.materials.find((material) => material.id === materialId)?.name ?? materialId
                return (
                  <div key={materialId} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" title={name}>{name}</span>
                      {item.source && (
                        <span className="block text-xs text-muted-foreground">
                          {tMat(item.source === "consumable" ? "consumableHint" : "answeredHint")}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 gap-1">
                      <Button size="xs" variant={choice === "magazin" ? "default" : "outline"} onClick={() => controller.setMaterialDecision(materialId, "magazin")}>
                        {tMat("toMagazinShort")}
                      </Button>
                      {/* A consumable has no "vor Ort" state — offering the button
                          would offer a state the backend refuses to store. */}
                      {!item.consumable && (
                        <Button size="xs" variant={choice === "vorort" ? "default" : "outline"} onClick={() => controller.setMaterialDecision(materialId, "vorort")}>
                          {tMat("onSiteShort")}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <AlertDialogFooter>
            <Button variant="outline" onClick={controller.cancelMaterialDecision}>{tMat("cancel")}</Button>
            <Button onClick={() => {
              const { returned, kept } = controller.resolveMaterialDecision()
              const nameOf = (id: string) => controller.materials.find((material) => material.id === id)?.name ?? id
              const description = [
                returned.length ? `${tMat("toastToMagazin")}: ${returned.map(nameOf).join(", ")}` : null,
                kept.length ? `${tMat("toastOnSite")}: ${kept.map(nameOf).join(", ")}` : null,
              ].filter(Boolean).join(" · ")
              toast.success(returned.length ? tDash("materialReturned") : tMat("leftOnSite"), { description })
            }}>
              {controller.materialRapportBy && controller.materialDecisionOpenCount === 0
                ? tMat("confirmRapport")
                : tMat("confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DisponierTransitionDialog
        open={!!controller.disponiertOperation}
        onOpenChange={(open) => !open && controller.closeDisponiert()}
        operation={controller.disponiertOperation}
        materials={controller.materials}
        printerEnabled={printerEnabled}
        funkrufname={funkrufname}
        diveraEnabled={diveraEnabled}
        onSendDivera={(operation) => {
          controller.closeDisponiert()
          onSendDivera(operation)
        }}
      />

      {controller.rekoAssignmentOperation && (
        <AssignRekoDialog
          open
          onOpenChange={(open) => !open && controller.cancelRekoAssignment()}
          incidentId={controller.rekoAssignmentOperation.id}
          incidentTitle={operationLabel(controller.rekoAssignmentOperation)}
          onAssigned={() => {
            void onRefresh()
            controller.closeRekoAssignment()
          }}
        />
      )}
    </>
  )
}
