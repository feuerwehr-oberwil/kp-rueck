"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  AlertCircle,
  ArrowRight,
  Binoculars,
  Check,
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
import { onStatusConflict } from "@/lib/status-conflict"
import type { Material, Operation, OperationStatus } from "@/lib/contexts/operations-context"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import { findAuftragForStop, isBackwardTransition, remainingRouteStops, startableNextStop, statusBadgeClass } from "@/lib/kanban-utils"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
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

/**
 * What every gate remembers about the move that opened it.
 *
 * The gates open AFTER the card has moved, so Abbrechen is an undo:
 * `returnStatus` is where the card came from (null when the mover did not say,
 * and then cancelling only closes). Moving a card into a working column also
 * auto-clears «Am Warten» (see `updateOperation`), so `restoreAmWarten` says
 * whether the undo has to put that flag back — otherwise the operator cancels
 * the move and the flag is gone anyway, with a toast already claiming it.
 */
interface GateBase {
  operationId: string
  returnStatus: OperationStatus | null
  restoreAmWarten: boolean
}

/**
 * The status gates. At most one is open at a time — the state is this union
 * (or null), so two can't be open at once.
 *
 * - `missingResources`: «es fehlt noch etwas» before a dispatch
 * - `returningVehicle`: «Beendet / Rückfahrt» without a vehicle
 * - `rekoMissing` / `rekoFormMissing`: into Reko without a Reko person / report
 * - `rekoAssignment`: the Reko picker opened from `rekoMissing`; it inherits
 *   that gate's undo, so backing out of the picker lands where backing out of
 *   the gate would have
 * - `statusCorrection`: a BACKWARD move into «Disponiert / Anfahrt»; always
 *   knows where the card came from
 * - `materialDecision`: the completion gate, with what the completion releases
 *   (snapshotted before the store emptied the card — see CompletionRelease)
 */
type OpenGate =
  | (GateBase & { kind: "missingResources" | "returningVehicle" | "rekoMissing" | "rekoFormMissing" | "rekoAssignment" })
  | (GateBase & { kind: "statusCorrection"; returnStatus: OperationStatus })
  | (GateBase & { kind: "materialDecision"; release: CompletionRelease | null })

export type GateKind = OpenGate["kind"]

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
  // The Funkdurchsage dialog. Not a gate: it opens AFTER the decision to
  // dispatch, and closing it reverts nothing.
  const [disponiertOperationId, setDisponiertOperationId] = useState<string | null>(null)
  // The one gate that is open, or null. A union rather than a pair of states per
  // gate, so «only one gate is ever open» is what the state says, not a comment.
  const [gate, setGate] = useState<OpenGate | null>(null)
  // A gate parked while its assignment dialog runs (missing resources /
  // returning vehicle) — brought back by `resumeGateAfterAssignment`.
  const [suspendedGate, setSuspendedGate] = useState<OpenGate | null>(null)
  // The stop that just reached «Beendet», while the board asks whether the
  // squad should start the next one. Holds the FINISHED stop rather than the
  // candidate: the candidate is derived, so it cannot go stale against a route
  // that changed while the dialog was open. Not a gate either: it waits behind
  // the returning-vehicle gate by design.
  const [nextStopAfterId, setNextStopAfterId] = useState<string | null>(null)
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

  // The server refused this card's move («Gerade geändert», lib/status-conflict.ts):
  // the move a gate opened for never happened, so its Abbrechen-as-undo would be a
  // fresh move from the server's state. Close whatever this card had open.
  useEffect(
    () =>
      onStatusConflict(({ operationId }) => {
        const other = (open: OpenGate | null) => (open?.operationId === operationId ? null : open)
        setGate(other)
        setSuspendedGate(other)
        setDisponiertOperationId((id) => (id === operationId ? null : id))
        setNextStopAfterId((id) => (id === operationId ? null : id))
      }),
    [],
  )

  /** A gate for `operationId`, remembering whether the move it follows
   *  cleared «Am Warten». Called in the trigger, i.e. against the store as it
   *  was BEFORE the move, which is the only moment the flag can still be read. */
  const gateFor = useCallback(
    (operationId: string, returnStatus: OperationStatus | null) => ({
      operationId,
      returnStatus,
      restoreAmWarten: Boolean(operations.find((o) => o.id === operationId)?.amWarten),
    }),
    [operations],
  )

  /** Undo a gate's move, restoring anything the move silently changed. */
  const revertGate = useCallback(
    ({ operationId, returnStatus, restoreAmWarten }: GateBase) => {
      if (!returnStatus) return
      // Called with two arguments when there is nothing to put back, so the
      // ordinary revert keeps exactly the call shape it always had.
      if (restoreAmWarten) changeStatusToTop(operationId, returnStatus, { amWarten: true })
      else changeStatusToTop(operationId, returnStatus)
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
  const openDispatchGate = useCallback((base: GateBase) => {
    const operation = operationById(base.operationId)
    if (!operation) return
    if (getMissingResources(operation).length > 0) {
      setGate({ ...base, kind: "missingResources" })
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
    const operation = operationById(operationId)
    if (!operation) return
    const base = gateFor(operationId, previousStatus ?? null)
    if (previousStatus && isBackwardTransition(previousStatus, "enroute")) {
      setGate({ kind: "statusCorrection", ...base, returnStatus: previousStatus })
      return
    }
    openDispatchGate(base)
  }, [gateFor, openDispatchGate, operationById])

  /** Still «Beendet» without a vehicle — no own vehicle, none on its route, not zu Fuss. */
  const lacksReturningVehicle = useCallback((operation: Operation) => {
    const auftrag = findAuftragForStop(groups, operation)
    const routeVehicleCount = auftrag ? getGroupResources(auftrag.id).vehicles.length : 0
    return !operation.zuFuss && operation.vehicles.length === 0 && routeVehicleCount === 0
  }, [getGroupResources, groups])

  const triggerReturningVehicleCheck = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    const operation = operationById(operationId)
    if (operation && lacksReturningVehicle(operation)) {
      setGate({ kind: "returningVehicle", ...gateFor(operationId, previousStatus ?? null) })
    }
  }, [gateFor, lacksReturningVehicle, operationById])

  const triggerRekoCheck = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    const operation = operationById(operationId)
    if (operation && !operation.assignedReko) {
      setGate({ kind: "rekoMissing", ...gateFor(operationId, previousStatus ?? null) })
    }
  }, [gateFor, operationById])

  const triggerRekoFormCheck = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    const operation = operationById(operationId)
    if (operation && !operation.hasCompletedReko) {
      setGate({ kind: "rekoFormMissing", ...gateFor(operationId, previousStatus ?? null) })
    }
  }, [gateFor, operationById])

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

    setGate({
      kind: "materialDecision",
      ...gateFor(operation.id, previousStatus ?? null),
      release: release.crew.length > 0 || release.vehicles.length > 0 ? release : null,
    })
  }, [gateFor, getGroupResources, groups, operationById, operations, routeContinuationFor])

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

  /** The open gate's operation when the open gate is a `kind` gate, else null. */
  const gateOperation = (kind: GateKind) => (gate?.kind === kind ? operationById(gate.operationId) : null)

  /** Park the open gate while its assignment dialog runs. */
  const suspendGateForAssignment = useCallback(() => {
    setSuspendedGate(gate)
    setGate(null)
  }, [gate])

  /** The assignment dialog closed: bring the parked gate back, undo and all —
   *  unless it was the returning-vehicle gate and a vehicle is now assigned,
   *  which answers it (the move stands). */
  const resumeGateAfterAssignment = useCallback(() => {
    if (!suspendedGate) return
    setSuspendedGate(null)
    if (suspendedGate.kind === "returningVehicle") {
      const operation = operationById(suspendedGate.operationId)
      if (!operation || !lacksReturningVehicle(operation)) return
    }
    setGate(suspendedGate)
  }, [lacksReturningVehicle, operationById, suspendedGate])

  /**
   * Abbrechen (and Escape, and the overlay) on a `kind` gate: undo the move
   * that opened it, then close. A no-op unless that gate is the open one, so a
   * dialog that is already on its way out cannot cancel the gate after it.
   */
  const cancelGate = useCallback((kind: GateKind) => {
    if (gate?.kind !== kind) return
    revertGate(gate)
    setGate(null)
    // The move was undone, so the stop is not finished after all and there is
    // nothing to ask about the next one.
    if (kind === "returningVehicle") setNextStopAfterId(null)
  }, [gate, revertGate])

  /** Proceed past a `kind` gate: close it and let the move stand. */
  const closeGate = useCallback((kind: GateKind) => {
    if (gate?.kind === kind) setGate(null)
  }, [gate])

  const materialDecisionGate = gate?.kind === "materialDecision" ? gate : null
  const materialDecisionOperationId = materialDecisionGate?.operationId ?? null
  const materialDecisionOperation = gateOperation("materialDecision")

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
    setGate(null)
    return { returned: returnedItems.map((item) => item.id), kept }
  }, [groups, materialChoice, materialDecisionItems, materialDecisionOperation, removeMaterial, unassignGroupResource])

  const returningVehicleOperation = gateOperation("returningVehicle")
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
    /** Abbrechen on a gate — see `cancelGate`. */
    cancelGate,
    /** Proceed past a gate («Trotzdem …», «Status korrigieren», a Reko
     *  assigned) — the move stands. */
    closeGate,
    disponiertOperation: operationById(disponiertOperationId),
    closeDisponiert: () => setDisponiertOperationId(null),
    openDisponiert: (operationId: string) => {
      if (gate?.kind === "missingResources") setGate(null)
      setDisponiertOperationId(operationId)
    },
    // Every way out of this gate is either the (second) «Disponieren» press
    // (which is `openDisponiert`, and closes the gate itself) or Abbrechen. A
    // third "just close it" verb was what Escape ended up bound to.
    missingResourcesOperation: gateOperation("missingResources"),
    returningVehicleOperation: effectiveReturningVehicleOperation,
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
    rekoMissingOperation: gateOperation("rekoMissing"),
    rekoFormMissingOperation: gateOperation("rekoFormMissing"),
    /** The «Status korrigieren?» confirm, or null. Carries the operation so the
     *  dialog can name it, and the column it came from so it can be undone. */
    statusCorrectionPrompt: gate?.kind === "statusCorrection"
      ? { operation: operationById(gate.operationId), previousStatus: gate.returnStatus }
      : null,
    /** «Neu disponieren …» — the correction was itself the mistake, or the
     *  squad really is going out again: hand over to the full dispatch path so
     *  the Funkdurchsage stays written in exactly one place. */
    dispatchAfterCorrection: () => {
      if (gate?.kind !== "statusCorrection") return
      setGate(null)
      openDispatchGate(gate)
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
    completionRelease: materialDecisionGate?.release ?? null,
    /** Where the completed card came from, so the confirmation toast can offer
     *  «Rückgängig». Read from the gate rather than from `completionRelease`:
     *  a stop that hands nothing back has no snapshot but is just as undoable.
     *  Null when the mover did not say — an undo that guesses is not an undo. */
    completionReturnStatus: materialDecisionGate?.returnStatus ?? null,
    /** Put a just-completed incident back where it came from. The backend undoes
     *  its own release in the same transaction (`_undo_completion_release`) and
     *  the context refetches on leaving `complete`, so crew and vehicles come
     *  back — material that was sent to the Magazin does not. */
    reopenCompleted: (operationId: string, status: OperationStatus) => changeStatusToTop(operationId, status),
    // Confirming the completion gate goes through `resolveMaterialDecision`,
    // which clears the gate itself. Dismissing is a cancel.
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
    rekoAssignmentOperation: gateOperation("rekoAssignment"),
    /** «Reko zuweisen» in the Reko gate: open the picker in its place. The
     *  picker inherits the gate's undo — choosing to pick is not yet a decision
     *  to proceed, and backing out of the picker has to land where backing out
     *  of the gate would have. */
    openRekoAssignment: () => {
      if (gate?.kind === "rekoMissing") setGate({ ...gate, kind: "rekoAssignment" })
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
  /** «Zu Fuss» in the dispatch gate: flip the card's own `zuFuss` flag. */
  onToggleZuFuss: (operation: Operation) => void
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
  onToggleZuFuss,
  onOpenDetail,
  onSendDivera,
  onRefresh,
}: IncidentStatusWorkflowDialogsProps) {
  const tCommon = useTranslations("kanban.common")
  const tDash = useTranslations("kanban.dashboard")
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

  // The open gate waits while its assignment dialog runs.
  const openAssignment = (resourceType: ResourceType, operationId: string) => {
    controller.suspendGateForAssignment()
    onOpenAssignment(resourceType, operationId)
  }

  return (
    <>
      <DispatchGateDialog
        controller={controller}
        onOpenAssignment={openAssignment}
        onToggleZuFuss={onToggleZuFuss}
      />

      <AlertDialog open={!!controller.returningVehicleOperation} onOpenChange={(open) => !open && controller.cancelGate("returningVehicle")}>
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
          <AlertDialogFooter>
            <Button variant="ghost" onClick={() => controller.closeGate("returningVehicle")} className="sm:mr-auto">
              {tReturning("endAnyway")}
            </Button>
            <Button variant="outline" onClick={() => controller.cancelGate("returningVehicle")}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={() => {
              const operation = controller.returningVehicleOperation
              if (operation) openAssignment("vehicles", operation.id)
            }}>
              {tReturning("assignVehicle")}
            </Button>
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
              <Waypoints className="h-5 w-5 text-muted-foreground" />
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

      {/* «Nicht verschieben», not «Abbrechen»: the card goes back where it came from
          (Esc too), and the text says the move has NOT happened yet. Wide enough for
          the three answers on one row in German. */}
      <AlertDialog open={!!controller.rekoMissingOperation} onOpenChange={(open) => !open && controller.cancelGate("rekoMissing")}>
        <AlertDialogContent className="sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Binoculars className="h-5 w-5 text-muted-foreground" />
              {tCommon("noRekoAssigned")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {controller.rekoMissingOperation && tReko.rich("description", {
                location: operationLabel(controller.rekoMissingOperation),
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="ghost" onClick={() => controller.closeGate("rekoMissing")} className="sm:mr-auto">
              {tReko("proceedAnyway")}
            </Button>
            <Button variant="outline" onClick={() => controller.cancelGate("rekoMissing")}>
              {tReko("dontMove")}
            </Button>
            <Button onClick={controller.openRekoAssignment}>
              {tReko("assignReko")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!controller.rekoFormMissingOperation} onOpenChange={(open) => !open && controller.cancelGate("rekoFormMissing")}>
        {/* xl: three answers on one row in German, like the Reko gate above. */}
        <AlertDialogContent className="sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
              {tRekoForm("title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {controller.rekoFormMissingOperation && tRekoForm.rich("description", {
                location: operationLabel(controller.rekoFormMissingOperation),
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="ghost" onClick={() => controller.closeGate("rekoFormMissing")} className="sm:mr-auto">
              {tRekoForm("proceedAnyway")}
            </Button>
            <Button variant="outline" onClick={() => controller.cancelGate("rekoFormMissing")}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={() => {
              const operation = controller.rekoFormMissingOperation
              // closeGate also drops the revert status — opening
              // the Reko details is a "proceed", not a cancel.
              controller.closeGate("rekoFormMissing")
              // …on the REKO tab, with the entry form already open. The
              // dialog's whole subject is that no Reko report was filled in,
              // and it used to land the operator on Übersicht — the one tab
              // that says nothing about it — with the «erstellen» button two
              // clicks away.
              if (operation) onOpenDetail(operation.id, 'reko', 'newReport')
            }}>
              {tRekoForm("openReko")}
            </Button>
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
      <AlertDialog open={!!controller.materialDecisionOperation} onOpenChange={(open) => !open && controller.cancelGate("materialDecision")}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {continuation ? (
                <Waypoints className="h-5 w-5 text-muted-foreground" />
              ) : release ? (
                <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              ) : (
                <Package className="h-5 w-5 text-muted-foreground" />
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
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
              <Waypoints className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
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
                      <Button size="xs" variant={choice === "magazin" ? "selected" : "outline"} aria-pressed={choice === "magazin"} onClick={() => controller.setMaterialDecision(materialId, "magazin")}>
                        {tMat("toMagazinShort")}
                      </Button>
                      {/* A consumable has no "vor Ort" state — offering the button
                          would offer a state the backend refuses to store. */}
                      {!item.consumable && (
                        <Button size="xs" variant={choice === "vorort" ? "selected" : "outline"} aria-pressed={choice === "vorort"} onClick={() => controller.setMaterialDecision(materialId, "vorort")}>
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
          <AlertDialogFooter>
            {nextStopOffer && (
              <Button
                variant="ghost"
                onClick={() => confirmCompletion(nextStopOffer)}
                className="sm:mr-auto"
              >
                {tCompletion("stopConfirmAndNext")}
              </Button>
            )}
            <Button variant="outline" onClick={() => controller.cancelGate("materialDecision")}>{tMat("cancel")}</Button>
            <Button onClick={() => confirmCompletion(null)}>
              {continuation
                ? tCompletion("stopConfirm")
                : release
                  ? tCompletion("confirm")
                  : controller.materialRapportBy && controller.materialDecisionOpenCount === 0
                    ? tMat("confirmRapport")
                    : tMat("confirm")}
            </Button>
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
        onOpenChange={(open) => !open && controller.cancelGate("statusCorrection")}
      >
        <AlertDialogContent>
          {correction?.operation && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <PenLine className="h-5 w-5 text-muted-foreground" />
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
              <AlertDialogFooter>
                <Button
                  variant="ghost"
                  onClick={controller.dispatchAfterCorrection}
                  className="sm:mr-auto"
                >
                  {tCorrection("dispatchAgain")}
                </Button>
                <Button variant="outline" onClick={() => controller.cancelGate("statusCorrection")}>
                  {tCommon("cancel")}
                </Button>
                <Button onClick={() => controller.closeGate("statusCorrection")}>{tCorrection("confirm")}</Button>
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
          onOpenChange={(open) => !open && controller.cancelGate("rekoAssignment")}
          incidentId={controller.rekoAssignmentOperation.id}
          incidentTitle={operationLabel(controller.rekoAssignmentOperation)}
          onAssigned={() => {
            void onRefresh()
            controller.closeGate("rekoAssignment")
          }}
        />
      )}
    </>
  )
}

/**
 * «Ressourcen fehlen» — the gate in front of the Funkdurchsage (the board's
 * `missingResources` gate). Rendered once by `IncidentStatusWorkflowDialogs`.
 *
 * PRESS TWICE (owner pick, UX-DESKTOP-09 B): «Disponieren» is always live and
 * always in the same place. With a blocking gap open (no crew, or no vehicle and
 * not «zu Fuss») the first press only ARMS it: the missing row turns amber and
 * asks «wirklich so ausrücken?», the button says what it will do («Ja, ohne
 * Fahrzeug disponieren»), and «Abbrechen» becomes «Zurück». The second press —
 * or Enter, the button has the focus — dispatches; Zurück or Esc disarms. There
 * is no greyed-out button and no third «Trotzdem» button any more.
 *
 * ZU FUSS (borrowed from variant C): without a vehicle the vehicle row offers
 * «Zuweisen | Zu Fuss». «Zu Fuss» sets the card's own `zuFuss` flag, which
 * `getMissingResources` already honours — so it answers the gap and the button
 * goes back to a plain «Disponieren».
 *
 * The armed state belongs to one opening of the gate and one set of gaps: it is
 * dropped when the gate closes (also for an assignment round-trip) and whenever
 * what is missing changes, so a press can never confirm a question it did not see.
 */
function DispatchGateDialog({
  controller,
  onOpenAssignment,
  onToggleZuFuss,
}: {
  controller: IncidentStatusWorkflowController
  onOpenAssignment: (resourceType: ResourceType, operationId: string) => void
  onToggleZuFuss: (operation: Operation) => void
}) {
  const tCommon = useTranslations("kanban.common")
  const tRes = useTranslations("kanban.resources")
  const tMissing = useTranslations("kanban.missingResources")
  const primaryRef = useRef<HTMLButtonElement>(null)

  const missingOperation = controller.missingResourcesOperation
  const missing = missingOperation ? controller.getMissingResources(missingOperation) : []
  const allFilled = missing.length === 0
  // The checklist still LISTS everything that is missing; only these hold the dispatch back.
  const blockingGaps = missing.filter((resource) => BLOCKING_RESOURCES.includes(resource))
  const gapKey = missing.join(",")

  // `armedFor`: the opening and the gaps the first press was made against.
  // Reset on every open/close (the render-time «props changed» pattern, no effect).
  const openId = missingOperation?.id ?? null
  const [seenOpenId, setSeenOpenId] = useState(openId)
  const [armedFor, setArmedFor] = useState<string | null>(null)
  if (seenOpenId !== openId) {
    setSeenOpenId(openId)
    setArmedFor(null)
  }
  const armed = blockingGaps.length > 0 && openId !== null && armedFor === `${openId}|${gapKey}`

  const missingTitleKey = allFilled
    ? "readyTitle"
    : missing.length === 1
      ? missing[0] === "crew"
        ? "titleCrewOnly"
        : missing[0] === "vehicles"
          ? "titleVehiclesOnly"
          : "titleMaterialsOnly"
      : "title"
  const dispatchLabelKey = !armed
    ? "done"
    : blockingGaps.length === 2
      ? "dispatchWithoutBoth"
      : blockingGaps[0] === "crew"
        ? "dispatchWithoutCrew"
        : "dispatchWithoutVehicle"

  const dispatch = () => {
    if (!missingOperation) return
    if (blockingGaps.length > 0 && !armed) {
      setArmedFor(`${missingOperation.id}|${gapKey}`)
      return
    }
    controller.openDisponiert(missingOperation.id)
  }
  const assign = (resourceType: ResourceType, operationId: string) => {
    setArmedFor(null)
    onOpenAssignment(resourceType, operationId)
  }

  return (
    // Escape and the overlay are Abbrechen, never the dispatch: these gates open
    // because a card was ALREADY moved, and `cancelGate` puts it back. While the
    // button is armed, Escape first only disarms it (the same as «Zurück»).
    <AlertDialog open={!!missingOperation} onOpenChange={(open) => !open && controller.cancelGate("missingResources")}>
      <AlertDialogContent
        // A little wider than the default: the armed button names both gaps
        // («Ja, ohne Mannschaft und Fahrzeug disponieren») beside «Zurück».
        className="sm:max-w-xl"
        // The dispatch button takes the focus, so Enter is the first press and
        // Enter again the confirmation — the keyboard path of the mouse's two clicks.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          primaryRef.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (!armed) return
          event.preventDefault()
          setArmedFor(null)
        }}
      >
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
                    : <Package className="h-5 w-5 text-muted-foreground" />}
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
                {rows.map(({ key, icon: Icon, filled, summary }) => {
                  const asking = armed && blockingGaps.includes(key)
                  // No vehicle of its own or on the route: the row answers with
                  // «Zuweisen | Zu Fuss» instead of being one big «Zuweisen».
                  const footOption = key === "vehicles" && coverage.vehicleNames.length === 0
                  const body = (
                    <>
                      {filled
                        ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />
                        : <AlertCircle className="h-4 w-4 flex-shrink-0 text-warning-foreground" />}
                      <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{tRes(key)}</div>
                        {asking
                          ? <div className="text-xs text-muted-foreground">{tMissing(key === "crew" ? "armedCrew" : "armedVehicles")}</div>
                          : filled && summary && <div className="truncate text-xs text-muted-foreground" title={summary}>{summary}</div>}
                      </div>
                    </>
                  )
                  const rowClass = cn(
                    "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                    asking && "border-warning/60 bg-warning/10",
                  )
                  if (footOption) {
                    return (
                      <div key={key} data-gate-row={key} className={rowClass}>
                        {body}
                        <div role="group" aria-label={tRes(key)} className="flex flex-shrink-0">
                          <Button
                            variant="outline"
                            size="xs"
                            className="rounded-r-none"
                            onClick={() => assign(key, missingOperation.id)}
                          >
                            {tCommon("assign")}
                          </Button>
                          <Button
                            variant={missingOperation.zuFuss ? "selected" : "outline"}
                            size="xs"
                            className="-ml-px rounded-l-none"
                            aria-pressed={missingOperation.zuFuss}
                            onClick={() => onToggleZuFuss(missingOperation)}
                          >
                            <Footprints className="h-3.5 w-3.5" />
                            {tCommon("zuFuss")}
                          </Button>
                        </div>
                      </div>
                    )
                  }
                  return (
                    <button
                      key={key}
                      data-gate-row={key}
                      onClick={() => assign(key, missingOperation.id)}
                      className={cn(rowClass, "cursor-pointer hover:border-sel-edge hover:bg-secondary/40")}
                    >
                      {body}
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
                  )
                })}
              </div>
              <div className="space-y-2">
                <AlertDialogFooter>
                  {armed ? (
                    <Button variant="outline" onClick={() => setArmedFor(null)}>
                      {tMissing("back")}
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => controller.cancelGate("missingResources")}>
                      {tCommon("cancel")}
                    </Button>
                  )}
                  <Button ref={primaryRef} onClick={dispatch}>
                    {armed && <Check className="h-4 w-4" />}
                    {tMissing(dispatchLabelKey)}
                  </Button>
                </AlertDialogFooter>
                {armed && (
                  <p role="status" className="text-right text-xs text-muted-foreground">
                    {tMissing("armedHint")}
                  </p>
                )}
              </div>
            </>
          )
        })()}
      </AlertDialogContent>
    </AlertDialog>
  )
}
