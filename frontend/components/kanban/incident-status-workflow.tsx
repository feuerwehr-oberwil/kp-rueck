"use client"

import { useCallback, useEffect, useMemo, useState, useRef } from "react"
import { useTranslations } from "next-intl"
import {
  AlertCircle,
  ArrowRight,
  Binoculars,
  CheckCircle2,
  ClipboardCheck,
  Footprints,
  Package,
  PenLine,
  Plus,
  Truck,
  Users,
  Waypoints,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
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
import { findAuftragForStop, isBackwardTransition, remainingRouteStops, startableNextStop, statusBadgeClass } from "@/lib/kanban-utils"
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

/**
 * What completing an incident is about to hand back — read off the card BEFORE
 * the status change empties it.
 *
 * `updateOperation` clears crew, vehicles and their assignment maps the instant
 * the status becomes `complete` (the backend releases the same rows), so by the
 * time the gate renders there is nothing left to name. The snapshot is taken in
 * the trigger, which still runs against the pre-change store.
 */
export interface CompletionRelease {
  operationId: string
  /** Crew names, as the card showed them. */
  crew: string[]
  /** «TLF 1 · Omega 21» — name plus Funkrufname where there is one. */
  vehicles: string[]
}

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
  // What that same completion hands back — see CompletionRelease. Null while no
  // completion gate is open, and while one is open for material alone.
  const [completionRelease, setCompletionRelease] = useState<CompletionRelease | null>(null)
  // A card that arrived in «Disponiert / Anfahrt» from a LATER column: the
  // operator is straightening a status, not sending anybody out.
  const [statusCorrection, setStatusCorrection] = useState<{ operationId: string; previousStatus: OperationStatus } | null>(null)
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

  /** The real dispatch path: the resource gate, then the Funkdurchsage dialog
   *  (which is also what RECORDS the Aufgebot on an Auftrag stop). */
  const openDispatchGate = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    const operation = operationById(operationId)
    if (!operation) return
    if (getMissingResources(operation).length > 0) {
      setMissingResourcesOperationId(operation.id)
      setMissingResourcesReturnStatus(previousStatus ?? null)
    } else {
      setDisponiertOperationId(operation.id)
    }
  }, [getMissingResources, operationById])

  /**
   * An incident arrived in «Disponiert / Anfahrt» — from any of the three ways
   * in (drag, `<`, the detail's status picker).
   *
   * Forward is a disposition and keeps everything it had: the Funkdurchsage
   * «An alle Omega, neuer Einsatz …» and, on a route stop, a recorded Aufgebot.
   * BACKWARD is a correction — the crew is long since on site and the operator
   * is only straightening the board — so it must not announce that anybody is
   * rolling. It gets a plain confirm instead, whose secondary action is this
   * very dispatch path for the case where they really are going out again.
   */
  const triggerDisponiertDialog = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    rememberAmWarten(operationId)
    const operation = operationById(operationId)
    if (!operation) return
    if (previousStatus && isBackwardTransition(previousStatus, "enroute")) {
      setStatusCorrection({ operationId, previousStatus })
      return
    }
    openDispatchGate(operationId, previousStatus)
  }, [openDispatchGate, operationById, rememberAmWarten])

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

  /**
   * The stop the squad drives to next once `operation` is closed — null when
   * `operation` is the last stop still open in its Auftrag, and null for an
   * incident that belongs to no Auftrag at all.
   *
   * That null is the whole of the «letzter Stopp?» question: a route whose
   * remaining stops are empty is finished, so closing this one really is
   * «Einsatz abschliessen». Anything else means the Auftrag continues and the
   * squad, with its Geräte, moves on.
   */
  const routeContinuationFor = useCallback((operation: Operation) => {
    const auftrag = findAuftragForStop(groups, operation)
    if (!auftrag) return null
    const [next] = remainingRouteStops(auftrag, operations, operation.id)
    return next ? { auftrag, next } : null
  }, [groups, operations])

  /**
   * The completion gate. Named for the material question it started as, but it
   * now answers the whole of «was passiert beim Abschliessen»:
   *
   *  * it NAMES the crew and vehicles the completion releases — the most
   *    consequential move on the board used to empty half the roster with no
   *    dialog and no toast, while two Geräte got a full per-unit form;
   *  * it keeps that per-unit material question in the same window, so an
   *    Abschluss is one gate rather than two in a row;
   *  * and mid-route it asks the ROUTE's question instead — this stop is done,
   *    the Auftrag runs on, «Weiter zu: …» — with the offer to start that stop.
   *
   * It opens whenever the completion has one of those three things to say:
   * material to decide, resources to hand back, or a next stop to send the
   * squad to. It stays shut only when none of them applies — completing an
   * incident that was never staffed is still a one-gesture move.
   *
   * Must be called BEFORE the store has been emptied — see CompletionRelease.
   * It runs in the same tick as the status change, so `operations` here is
   * still the pre-completion array.
   */
  const promptMaterialDecision = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    rememberAmWarten(operationId)
    const operation = operationById(operationId)
    if (!operation) return

    // On a STANDARD Auftrag a stop owns neither crew nor vehicles — the route
    // does, and the route is not being completed — so this list is empty by
    // construction. Those are exactly the routes the next-stop offer below was
    // built for, which is why an empty list must not keep the gate shut.
    const release: CompletionRelease = {
      operationId: operation.id,
      crew: [...operation.crew],
      vehicles: operation.vehicles.map((name) => {
        const callsign = operation.vehicleCallsigns?.get(name)
        return callsign ? `${name} · ${callsign}` : name
      }),
    }

    // «Vor Ort oder ins Magazin?» has two answers, and mid-route both are
    // wrong: the squad is not driving back to the Magazin, it is driving to
    // the next stop, and the Geräte go with it. So the question belongs to the
    // LAST stop of an Auftrag only — everywhere else the route keeps its
    // material exactly as it is (nothing here unassigns it).
    const auftrag = findAuftragForStop(groups, operation)
    const asksAboutMaterial = routeContinuationFor(operation)
      ? false
      : auftrag
        ? getGroupResources(auftrag.id).materials.length > 0
        : operation.materials.length > 0

    // The third reason to open, and on a standard Auftrag the only one: the
    // squad is free and the route has a stop it may be sent to. Same rule as
    // the gate's own offer (`completionNextStop`) and the «Nächsten Stopp
    // starten?» prompt, so the three can never disagree — false here means the
    // last stop of a route, an incident in no Auftrag, or a route whose squad
    // is already working another stop, and none of those gets a new dialog.
    const offersNextStop = Boolean(auftrag && startableNextStop(auftrag, operations, operation.id))

    // Nothing released, nothing to decide, nowhere to send anybody — no dialog.
    // Completing an incident that was never staffed stays the one-gesture move
    // it always was.
    if (!asksAboutMaterial && !offersNextStop && release.crew.length === 0 && release.vehicles.length === 0) return

    setCompletionRelease(release.crew.length > 0 || release.vehicles.length > 0 ? release : null)
    setMaterialDecisionOperationId(operation.id)
    setMaterialDecisionReturnStatus(previousStatus ?? null)
  }, [getGroupResources, groups, operationById, operations, rememberAmWarten, routeContinuationFor])

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
   * The stop the board is about to offer, or null when there is nothing to ask
   * — the finished stop belongs to no Auftrag, or `startableNextStop` says the
   * route has nothing left to start (see there for the reasons).
   *
   * Derived rather than stored, so a route edited while the dialog is open
   * cannot leave the board offering a stop that has since been dispatched.
   */
  const nextStopPrompt = useMemo(() => {
    const finished = operationById(nextStopAfterId)
    if (!finished) return null
    const auftrag = findAuftragForStop(groups, finished)
    if (!auftrag) return null
    const next = startableNextStop(auftrag, operations, finished.id)
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
    setCompletionRelease(null)
  }, [materialDecisionOperationId, materialDecisionReturnStatus, revertTo])

  /** Backing out of the correction confirm puts the card where it came from. */
  const cancelStatusCorrection = useCallback(() => {
    if (statusCorrection) revertTo(statusCorrection.operationId, statusCorrection.previousStatus)
    setStatusCorrection(null)
  }, [revertTo, statusCorrection])

  const materialDecisionOperation = operationById(materialDecisionOperationId)

  /**
   * The open gate's route context: the Auftrag this stop belongs to and the
   * stop it continues with, or null when this is an Abschluss proper (last
   * stop, or no Auftrag).
   *
   * Derived rather than stored alongside the gate, for the same reason
   * `nextStopPrompt` is: a route edited while the dialog is open must not
   * leave the dialog naming a stop that has since been closed.
   */
  const completionContinuation = useMemo(
    () => (materialDecisionOperation ? routeContinuationFor(materialDecisionOperation) : null),
    [materialDecisionOperation, routeContinuationFor],
  )

  /**
   * The stop the completion gate may OFFER to start — the same question the
   * «Nächsten Stopp starten?» prompt asks after «Beendet / Rückfahrt», asked
   * where dragging a card straight to «Abgeschlossen» lands instead.
   *
   * Null whenever there is nothing to offer, which is every case the offer must
   * leave alone: the last stop of a route, an incident in no Auftrag, and a
   * route whose squad is already working another stop (`startableNextStop`).
   * Because both offers read that one rule, they can never name different
   * stops than the gate's own «Weiter zu: …».
   */
  const completionNextStop = useMemo(() => {
    if (!materialDecisionOperation || !completionContinuation) return null
    return startableNextStop(completionContinuation.auftrag, operations, materialDecisionOperation.id)
  }, [completionContinuation, materialDecisionOperation, operations])

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
    // Mid-route there is nothing to decide — see `asksAboutMaterial`. Empty
    // here is what makes that true rather than merely written down:
    // `resolveMaterialDecision` iterates this list, so an empty one returns
    // and unassigns nothing, and the route's Geräte stay on the route.
    if (completionContinuation) return []
    // The Auftrag is resolved through the routes, not through `groupId` — a
    // just-added stop has not been told about its group yet (findAuftragForStop).
    const auftrag = findAuftragForStop(groups, materialDecisionOperation)
    const rows = auftrag
      ? getGroupResources(auftrag.id).materials.map((material) => ({
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
  }, [completionContinuation, getGroupResources, groups, materialAnswers, materialDecisionOperation, materials])

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

    // Write the confirmed answers back into the rapport: «Vor Ort» persists as
    // `left_on_site` (so the Restliste / Abholliste show the unit), «Magazin»
    // clears a crew's earlier tick. Fire-and-forget on purpose — an incident
    // that never had a rapport has nothing to record (the server answers
    // `applied: false`), and the board release below is independent of it.
    // Consumables are excluded the same way the dialog excludes them: a used
    // consumable is gone and can never be "vor Ort".
    const rapportDecisions = materialDecisionItems
      .filter((item) => !item.consumable)
      .map((item) => ({ material_id: item.id, left_on_site: materialChoice(item) === "vorort" }))
    if (rapportDecisions.length > 0) {
      void apiClient
        .applyRapportMaterialDecisions(materialDecisionOperation.id, rapportDecisions)
        .catch((error) => console.error("Failed to write material decisions back to the rapport:", error))
    }

    // Route-owned units are released from the ROUTE — and the route is the one
    // `materialDecisionItems` listed them from, so it is resolved the same way.
    const auftrag = findAuftragForStop(groups, materialDecisionOperation)
    for (const item of returnedItems) {
      if (item.assignmentId && auftrag) {
        void unassignGroupResource(auftrag.id, item.assignmentId)
      } else {
        void removeMaterial(materialDecisionOperation.id, item.id)
      }
    }
    setMaterialDecisionOperationId(null)
    setMaterialDecisionReturnStatus(null)
    setCompletionRelease(null)
    return { returned: returnedItems.map((item) => item.id), kept }
  }, [groups, materialChoice, materialDecisionItems, materialDecisionOperation, removeMaterial, unassignGroupResource])

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
    /**
     * Put a stop on Einsatz — the ONE way the board starts the next stop of a
     * route, called both from the «Nächsten Stopp starten?» prompt and from the
     * same offer in the «Stopp abschliessen?» gate. The stop is passed in rather
     * than re-derived here so the card that starts is provably the card the
     * operator just read the name of.
     */
    startNextStop: (stopId: string) => {
      setNextStopAfterId(null)
      requestStatusChange(stopId, "active")
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
    /** The «Status korrigieren?» confirm, or null. Carries the operation so the
     *  dialog can name it, and the column it came from so it can be undone. */
    statusCorrectionPrompt: statusCorrection
      ? { operation: operationById(statusCorrection.operationId), previousStatus: statusCorrection.previousStatus }
      : null,
    /** «Status korrigieren» — the move stands, nothing is announced. */
    confirmStatusCorrection: () => setStatusCorrection(null),
    cancelStatusCorrection,
    /** «Neu disponieren …» — the correction was itself the mistake, or the
     *  squad really is going out again: hand over to the full dispatch path so
     *  the Funkdurchsage stays written in exactly one place. */
    dispatchAfterCorrection: () => {
      const pending = statusCorrection
      setStatusCorrection(null)
      if (pending) openDispatchGate(pending.operationId, pending.previousStatus)
    },
    materialDecisionOperation,
    /** The Auftrag this completion does NOT end, plus the stop it continues
     *  with — null for the last stop of a route and for an incident that is in
     *  none. Non-null turns the gate from «Einsatz abschliessen» into «Stopp
     *  abschliessen – weiter zu …», and takes the material question off it. */
    completionContinuation,
    /** The stop that gate may offer to start, or null when the offer must not
     *  appear at all (last stop, no Auftrag, squad already working). */
    completionNextStop,
    /** What this completion releases, snapshotted before the card was emptied —
     *  null when the gate is open for material alone, and null for a stop of a
     *  standard Auftrag, whose crew and vehicles belong to the route. */
    completionRelease,
    /** Where the completed card came from, so the confirmation toast can offer
     *  «Rückgängig». Read from the gate rather than from `completionRelease`:
     *  a stop that hands nothing back has no snapshot but is just as undoable.
     *  Null when the mover did not say — an undo that guesses is not an undo. */
    completionReturnStatus: materialDecisionReturnStatus,
    /** Put a just-completed incident back where it came from. The backend undoes
     *  its own release in the same transaction (`_undo_completion_release`) and
     *  the context refetches on leaving `complete`, so crew and vehicles come
     *  back — material that was sent to the Magazin does not. */
    reopenCompleted: (operationId: string, status: OperationStatus) => changeStatusToTop(operationId, status),
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
  const tCompletion = useTranslations("kanban.completion")
  const tCorrection = useTranslations("kanban.statusCorrection")
  const tColumns = useTranslations("kanban.columns")
  // The board's one «Rückgängig» label — no second copy of the same word.
  const tUndo = useTranslations("notifications.operations")

  // The completion gate's two subjects: what is released (null when the gate is
  // open for material alone) and how many units still need an answer.
  const release = controller.completionRelease
  const materialCount = controller.materialDecisionItems.length
  const correction = controller.statusCorrectionPrompt
  // …and, when the finished card is a stop with route left ahead of it, what
  // the Auftrag continues with. Then the gate is not an Abschluss at all.
  const continuation = controller.completionContinuation
  // The stop the gate may additionally OFFER to start, or null when it must not
  // offer anything (last stop, no Auftrag, squad already on another stop).
  const nextStopOffer = controller.completionNextStop

  /**
   * Close the stop — and, when `startNext` is given, put that stop on Einsatz in
   * the same click.
   *
   * One body for both footer buttons on purpose: the offer must not become a
   * second, quieter way of completing an incident that reports itself
   * differently. Starting the next stop goes through the controller's
   * `startNextStop`, the same call the «Nächsten Stopp starten?» prompt makes,
   * so both offers land the card in exactly the same state.
   */
  const confirmCompletion = (startNext: Operation | null) => {
    // Captured before resolving: `resolveMaterialDecision` clears the
    // gate, and the toast's «Rückgängig» has to outlive it.
    const completed = controller.materialDecisionOperation
    const location = completed ? operationLabel(completed) : ""
    const undoStatus = controller.completionReturnStatus
    const { returned, kept } = controller.resolveMaterialDecision()
    // The completion is written first, then the squad is sent on — so an
    // operator watching the board sees the stop leave before the next one runs.
    if (startNext) controller.startNextStop(startNext.id)
    const nameOf = (id: string) => controller.materials.find((material) => material.id === id)?.name ?? id
    const materialParts = [
      returned.length ? `${tMat("toastToMagazin")}: ${returned.map(nameOf).join(", ")}` : null,
      kept.length ? `${tMat("toastOnSite")}: ${kept.map(nameOf).join(", ")}` : null,
    ]
    // The gate has three subjects and the toast reports the one that was
    // actually answered. Material alone — no release, no route ahead — is the
    // only one that is not a completion the operator needs a receipt for.
    if (!release && !continuation) {
      toast.success(returned.length ? tDash("materialReturned") : tMat("leftOnSite"), {
        description: materialParts.filter(Boolean).join(" · ") || undefined,
      })
      return
    }
    // Mid-route the gate never carries a material question (see
    // `materialDecisionItems`), so `materialParts` is empty here and the toast
    // says what actually happened: one stop off the route. On a standard
    // Auftrag there is no release either — crew and vehicles stayed with the
    // route — and the toast is then the stop line alone.
    toast.success(
      continuation
        ? tCompletion("stopToastTitle", { location })
        : tCompletion("toastTitle", { location }), {
      description: [
        release?.crew.length ? tCompletion("releasedCrew", { count: release.crew.length }) : null,
        release?.vehicles.length ? tCompletion("releasedVehicles", { vehicles: release.vehicles.join(", ") }) : null,
        ...materialParts,
      ].filter(Boolean).join(" · ") || undefined,
      duration: 10000,
      // Only offered when we know where the card came from — an undo
      // that has to guess a status is not an undo. It reopens the
      // incident (crew and vehicles come back with the refetch);
      // material already sent to the Magazin stays there.
      action: completed && undoStatus
        ? {
            label: tUndo("undoLabel"),
            onClick: () => controller.reopenCompleted(completed.id, undoStatus),
          }
        : undefined,
    })
  }

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
            <Button onClick={() => {
              const next = controller.nextStopPrompt?.next
              if (next) controller.startNextStop(next.id)
            }}>{tNext("confirm")}</Button>
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

      {/* The completion gate. One window for the whole of «was passiert beim
          Abschliessen»: what is released by name, and — underneath — the
          per-unit material question that used to be the only thing asked.

          On a stop with route still ahead of it, neither half is an Abschluss:
          the Auftrag runs on, so the window says «Stopp abschliessen» and names
          where the squad goes next, and the material question is gone (the
          Geräte drive on with them — `materialDecisionItems`). There it opens
          for the route alone, with no release list and none promised: on a
          standard Auftrag the Mittel belong to the route, so a stop hands
          nothing back and the offer would otherwise never be seen. */}
      <AlertDialog open={!!controller.materialDecisionOperation} onOpenChange={(open) => !open && controller.cancelMaterialDecision()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {continuation ? (
                <Waypoints className="h-5 w-5 text-primary" />
              ) : release ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : (
                <Package className="h-5 w-5 text-primary" />
              )}
              {continuation ? tCompletion("stopTitle") : release ? tCompletion("title") : tMat("title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {controller.materialDecisionOperation && (continuation
                // Mid-route the release list is the only thing that can sit
                // under this sentence (the material question is gone — see
                // `materialDecisionItems`), so when there is no release the
                // text must not promise one: on a standard Auftrag the Mittel
                // belong to the route and the stop hands nothing back.
                ? tCompletion.rich(release ? "stopDescription" : "stopDescriptionNoRelease", {
                    location: operationLabel(controller.materialDecisionOperation),
                    auftrag: continuation.auftrag.name,
                    hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                  })
                : release
                ? tCompletion.rich("description", {
                    location: operationLabel(controller.materialDecisionOperation),
                    hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                  })
                : tMat.rich(
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
                  ))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Where the squad goes now — named, because «der nächste Stopp» is
              an address somebody has to read out over the radio. */}
          {continuation && (
            <div className="flex items-center gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
              <Waypoints className="h-4 w-4 flex-shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {tCompletion("nextStop", { location: operationLabel(continuation.next) })}
              </span>
            </div>
          )}
          {/* What the completion hands back, by name. Read off the card before
              the status change emptied it (see CompletionRelease) — this is the
              list an operator used to have to reconstruct from memory. */}
          {release && (
            <div className="space-y-1.5 py-1">
              {release.crew.length > 0 && (
                <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                  <Users className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm" title={release.crew.join(", ")}>
                    {tCommon("personCount", { count: release.crew.length })}
                    <span className="text-muted-foreground"> – {release.crew.join(", ")}</span>
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">{tCompletion("toAvailable")}</span>
                </div>
              )}
              {release.vehicles.length > 0 && (
                <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                  <Truck className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm" title={release.vehicles.join(", ")}>
                    {release.vehicles.join(", ")}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">{tCompletion("toAvailable")}</span>
                </div>
              )}
              {materialCount > 0 && (
                <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                  <Package className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {tCompletion("materialCount", { count: materialCount })}
                  </span>
                  <span className="flex-shrink-0 text-xs text-warning-foreground">{tCompletion("toDecision")}</span>
                </div>
              )}
            </div>
          )}
          {/* The material question keeps its own heading once it sits under a
              release list — two subjects in one window, each labelled. */}
          {release && materialCount > 0 && (
            <p className="border-t pt-3 text-sm font-medium">{tMat("title")}</p>
          )}
          {/* …and only while there is material to say it about: a completion
              that releases people alone must not cite a Materialrapport. */}
          {controller.materialRapportBy && materialCount > 0 && (
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
          {/* Mid-route the list is empty (`materialDecisionItems`), and an empty
              scroll area is padding pretending to be a section. */}
          {materialCount > 0 && (
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
          {/* Two ways out that both close the stop, and one of them also puts
              the next one on Einsatz (`confirmCompletion`). The offer sits in
              the quiet ghost slot the other gates use for their non-default
              action, and only appears mid-route: closing the stop stays the
              single obvious click it was, because the squad may just as well be
              standing down and the next stop may be one the KP dispatches
              deliberately. */}
          <AlertDialogFooter className={nextStopOffer ? "sm:justify-between" : undefined}>
            {nextStopOffer && (
              <Button variant="ghost" onClick={() => confirmCompletion(nextStopOffer)}>
                {tCompletion("stopConfirmAndNext")}
              </Button>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={controller.cancelMaterialDecision}>{tMat("cancel")}</Button>
              <Button onClick={() => confirmCompletion(null)}>
                {continuation
                  ? tCompletion("stopConfirm")
                  : release
                    ? tCompletion("confirm")
                    : controller.materialRapportBy && controller.materialDecisionOpenCount === 0
                      ? tMat("confirmRapport")
                      : tMat("confirm")}
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* «Status korrigieren?» — the backward way into «Disponiert / Anfahrt».
          Deliberately NOT the dispatch dialog: a Funkdurchsage is a statement
          that somebody is rolling right now, and an Auftrag stop must not
          collect a second Aufgebotseintrag because a status was straightened.
          «Neu disponieren …» is one click away for when it really is a new
          departure — or when the backward move was itself the misfire. */}
      <AlertDialog
        open={!!correction?.operation}
        onOpenChange={(open) => !open && controller.cancelStatusCorrection()}
      >
        <AlertDialogContent>
          {correction?.operation && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <PenLine className="h-5 w-5 text-primary" />
                  {tCorrection("title")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {tCorrection.rich("description", {
                    location: operationLabel(correction.operation),
                    hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2 py-1">
                {/* The two chips are the two COLUMNS, painted from the board's
                    own table (statusBadgeClass) — a status that is orange on
                    the board must not be something else in a dialog about it.
                    The word stays inside the chip: the colour repeats it, it
                    never replaces it. */}
                <div className="flex items-center gap-2">
                  <Badge className={statusBadgeClass(correction.previousStatus)}>
                    {tColumns(correction.previousStatus)}
                  </Badge>
                  <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <Badge className={statusBadgeClass("enroute")}>
                    {tColumns("enroute")}
                  </Badge>
                </div>
                <p className="border-t pt-2 text-sm text-muted-foreground">{tCorrection("noAnnouncement")}</p>
                <p className="text-xs text-muted-foreground">{tCorrection("dispatchHint")}</p>
              </div>
              <AlertDialogFooter className="sm:justify-between">
                <Button variant="ghost" onClick={controller.dispatchAfterCorrection}>
                  {tCorrection("dispatchAgain")}
                </Button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="outline" onClick={controller.cancelStatusCorrection}>
                    {tCommon("cancel")}
                  </Button>
                  <Button onClick={controller.confirmStatusCorrection}>{tCorrection("confirm")}</Button>
                </div>
              </AlertDialogFooter>
            </>
          )}
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
