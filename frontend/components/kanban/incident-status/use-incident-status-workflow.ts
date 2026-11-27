"use client"

import { vehicleLabel } from "@/lib/vehicle-label"
import { useCallback, useEffect, useMemo, useState } from "react"
import { onStatusConflict } from "@/lib/status-conflict"
import type { Material, Operation, OperationStatus } from "@/lib/contexts/operations-context"
import type { IncidentGroup } from "@/lib/types/groups"
import { findAuftragForStop, isBackwardTransition, remainingRouteStops, startableNextStop } from "@/lib/kanban-utils"
import { vehicleOnSite } from "@/lib/vehicle-on-site"
import { usePersonNaming } from "@/components/person-name"
import { sortCrewByLeader } from "@/lib/crew-order"
import type { CompletionRelease, GateBase, GateKind, OpenGate, ResourceCoverage, ResourceType } from "@/components/kanban/incident-status/gates"
import { useCompletionMaterial } from "@/components/kanban/incident-status/use-completion-material"

/** What a card lacks before it goes out: its own resources and its Auftrag's together. */
function getMissingResources(operation: Operation): ResourceType[] {
  const route = operation.auftragResources
  const missing: ResourceType[] = []
  if (operation.crew.length + (route?.personnel.length ?? 0) === 0) missing.push("crew")
  if (!operation.zuFuss && operation.vehicles.length + (route?.vehicles.length ?? 0) === 0) missing.push("vehicles")
  if (operation.materials.length + (route?.materials.length ?? 0) === 0) missing.push("materials")
  return missing
}

/** Into «Rückfahrt» with no vehicle on site (`vehicleOnSite`: an own vehicle whose
 *  driver «kehrt zurück» has already left), none on its route, not zu Fuss. */
function lacksReturningVehicle(operation: Operation): boolean {
  return !operation.zuFuss && vehicleOnSite(operation) === null
}

interface UseIncidentStatusWorkflowOptions {
  operations: Operation[]
  materials: Material[]
  /** The Aufträge — a stop's route is resolved through these, not through its
   *  own groupId, which lags a stop that was just added (findAuftragForStop). */
  groups: IncidentGroup[]
  changeStatusToTop: (operationId: string, status: OperationStatus, extraUpdates?: Partial<Operation>) => void
  removeMaterial: (operationId: string, materialId: string) => unknown
  unassignGroupResource: (groupId: string, assignmentId: string) => unknown
}

/**
 * The board's status-change flow: every way a card moves goes through `requestStatusChange` /
 * `holdStatusMove`, and the gates it opens are rendered by `IncidentStatusWorkflowDialogs` from
 * the controller this returns. Created once per page (`incident-dialogs.tsx`).
 */
export function useIncidentStatusWorkflow({
  operations,
  materials,
  groups,
  changeStatusToTop,
  removeMaterial,
  unassignGroupResource,
}: UseIncidentStatusWorkflowOptions) {
  // The Funkdurchsage dialog. Not a gate: it opens AFTER the decision to
  // dispatch, and closing it reverts nothing.
  const [disponiertOperationId, setDisponiertOperationId] = useState<string | null>(null)
  // «Funkdurchsage wiederholen» (card menu): the same dialog for an Einsatz already out –
  // the same text, nothing about the status (no batch dispatch of the other stops).
  const [disponiertRepeat, setDisponiertRepeat] = useState(false)
  const { inline: personInline } = usePersonNaming()
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
    (operationId: string, returnStatus: OperationStatus | null): GateBase => ({
      operationId,
      returnStatus,
      restoreAmWarten: Boolean(operations.find((o) => o.id === operationId)?.amWarten),
      held: false,
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

  /** What the «Ressourcen fehlen» rows name: the Einsatz's own resources plus its Auftrag's,
   *  crew EL first. A material the store cannot name has `name: null`. */
  const getResourceCoverage = useCallback((operation: Operation): ResourceCoverage => {
    const auftrag = findAuftragForStop(groups, operation)
    const route = operation.auftragResources
    const crew = [
      ...operation.crew.map((member) => ({
        personnelId: member.personnelId,
        name: member.name,
        // Under an Auftrag the route's leader leads, as in the board detail: a stop may keep
        // the EL it had before it joined, and two «EL» marks would say two different things.
        isLeader: !auftrag && member.personnelId === operation.leaderId,
        leaderTarget: auftrag
          ? null
          : { kind: "incident" as const, operationId: operation.id, personnelId: member.personnelId },
      })),
      ...(auftrag && route ? route.personnel.map((person) => ({
        personnelId: person.resourceId,
        name: person.name,
        isLeader: Boolean(person.isLeader),
        leaderTarget: { kind: "route" as const, groupId: auftrag.id, assignmentId: person.assignmentId },
      })) : []),
    ]
    return {
      crew: sortCrewByLeader(crew, (member) => member.isLeader),
      vehicles: [
        ...operation.vehicles.map((vehicle) => ({
          vehicleId: vehicle.vehicleId,
          name: vehicle.name,
          driverStay: vehicle.driverStay,
          target: { kind: "incident" as const, operationId: operation.id, vehicleId: vehicle.vehicleId },
        })),
        ...(auftrag && route ? route.vehicles.map((vehicle) => ({
          vehicleId: vehicle.resourceId,
          name: vehicle.name,
          driverStay: vehicle.driverStay,
          target: { kind: "route" as const, groupId: auftrag.id, assignmentId: vehicle.assignmentId },
        })) : []),
      ],
      materials: [
        ...operation.materials.map((id) => ({ id, name: materials.find((material) => material.id === id)?.name ?? null })),
        ...(route?.materials ?? []).map((material) => ({ id: material.resourceId, name: material.name })),
      ],
    }
  }, [groups, materials])

  /** The real dispatch path: the resource gate, then the Funkdurchsage dialog
   *  (which is also what RECORDS the Aufgebot on an Auftrag stop). */
  const openDispatchGate = useCallback((base: GateBase) => {
    const operation = operationById(base.operationId)
    if (!operation) return
    if (getMissingResources(operation).length > 0) {
      setGate({ ...base, kind: "missingResources" })
    } else {
      setDisponiertRepeat(false)
      setDisponiertOperationId(operation.id)
    }
  }, [operationById])

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

  const triggerReturningVehicleCheck = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    const operation = operationById(operationId)
    if (operation && lacksReturningVehicle(operation)) {
      setGate({ kind: "returningVehicle", ...gateFor(operationId, previousStatus ?? null) })
    }
  }, [gateFor, operationById])

  /** Into «Reko» without a Reko person: the picker opens at once, no question first
   *  (owner pick 19.11.2026, #4 A). Backing out of it puts the card back. */
  const triggerRekoCheck = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    const operation = operationById(operationId)
    if (operation && !operation.assignedReko) {
      setGate({ kind: "rekoAssignment", ...gateFor(operationId, previousStatus ?? null) })
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
   * Returns the gate to open for completing `operation`, or null. Asked before the
   * move (`holdStatusMove`, so the card is still staffed) or, for a move that was not
   * held, in the same tick as it – the store has not emptied the card yet.
   */
  const completionGateFor = useCallback((operation: Operation): { kind: "materialDecision"; release: CompletionRelease | null } | null => {
    // On a STANDARD Auftrag a stop owns neither crew nor vehicles — the route
    // does, and the route is not being completed — so this list is empty by
    // construction. Those are exactly the routes the next-stop offer below was
    // built for, which is why an empty list must not keep the gate shut.
    // The last open stop of an Auftrag also frees the route's squad (the server's
    // `auto_release_group_resources_if_last_stop`: every other stop `complete`), so the
    // list names them too – the gate is the confirmation for everybody it frees.
    const auftrag = findAuftragForStop(groups, operation)
    const routeSquad = auftrag && auftrag.stopIds.every(
      (stopId) => stopId === operation.id || (operations.find((o) => o.id === stopId)?.status ?? "complete") === "complete",
    )
      ? operation.auftragResources
      : null
    const release: CompletionRelease = {
      operationId: operation.id,
      // The Reko is held apart from the crew on the board, and the server frees it too.
      crew: [
        ...operation.crew.map(personInline),
        ...(operation.assignedReko ? [operation.assignedReko.name] : []),
        ...(routeSquad?.personnel.map((person) => person.name) ?? []),
      ],
      vehicles: [...operation.vehicles.map(vehicleLabel), ...(routeSquad?.vehicles.map((vehicle) => vehicle.name) ?? [])],
    }

    // «Vor Ort oder ins Magazin?» has two answers, and mid-route both are
    // wrong: the squad is not driving back to the Magazin, it is driving to
    // the next stop, and the Geräte go with it. So the question belongs to the
    // LAST stop of an Auftrag only — everywhere else the route keeps its
    // material exactly as it is (nothing here unassigns it).
    const asksAboutMaterial = routeContinuationFor(operation)
      ? false
      : auftrag
        ? (operation.auftragResources?.materials.length ?? 0) > 0
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
    if (!asksAboutMaterial && !offersNextStop && release.crew.length === 0 && release.vehicles.length === 0) return null

    return {
      kind: "materialDecision",
      release: release.crew.length > 0 || release.vehicles.length > 0 ? release : null,
    }
  }, [groups, operations, routeContinuationFor, personInline])

  /** The completion gate after a move that was NOT held (see `holdStatusMove`, which
   *  asks the same `completionGateFor` first – so this opens nothing for those paths). */
  const promptMaterialDecision = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    const operation = operationById(operationId)
    if (!operation) return
    const completion = completionGateFor(operation)
    if (completion) setGate({ ...completion, ...gateFor(operation.id, previousStatus ?? null) })
  }, [completionGateFor, gateFor, operationById])

  /**
   * Asked by EVERY way a card moves (drag, keys, ⌘K, the status menu) BEFORE it moves: true
   * when the workflow takes the move over and makes it itself once answered – the caller then
   * does nothing. One case today: into «Reko abgeschlossen» without a filed Reko report, which
   * opens the Reko form (`rekoReport`); the card moves with «Reko abschliessen» /
   * «Ohne Bericht abschliessen» (`finishRekoReport`).
   *
   * Why the move waits instead of opening after it like the other gates: Abbrechen then has
   * nothing to undo and the card is where the operator left it. The move itself files nothing –
   * the save that answers «Einsatz relevant?» does (`api/reko._board_save_files_now`, owner
   * re-pick 19.11.2026, #30), and the server moves a card in «Reko» on to «Reko abgeschlossen».
   */
  const holdStatusMove = useCallback((operationId: string, targetStatus: OperationStatus) => {
    const operation = operationById(operationId)
    if (!operation || operation.status === targetStatus) return false
    // Dispatch and completion wait too, whenever they have something to ask
    // (`completionGateFor`, `getMissingResources`): their gate is the confirmation, and
    // before it the board must not publish a dispatch or free anybody.
    if (targetStatus === "complete") {
      const completion = completionGateFor(operation)
      if (!completion) return false
      setGate({ ...completion, operationId, returnStatus: null, restoreAmWarten: false, held: true })
      return true
    }
    if (targetStatus === "enroute" && !isBackwardTransition(operation.status, "enroute")) {
      if (getMissingResources(operation).length === 0) return false
      setGate({ kind: "missingResources", operationId, returnStatus: null, restoreAmWarten: false, held: true })
      return true
    }
    if (targetStatus !== "reko_done") return false
    if (operation.hasCompletedReko) return false
    setGate({ kind: "rekoReport", operationId, returnStatus: null, restoreAmWarten: false, held: true })
    return true
  }, [completionGateFor, operationById])

  const requestStatusChange = useCallback((operationId: string, targetStatus: OperationStatus) => {
    const operation = operationById(operationId)
    if (!operation || operation.status === targetStatus) return

    if (holdStatusMove(operationId, targetStatus)) return
    const previousStatus = operation.status
    changeStatusToTop(operationId, targetStatus)
    if (targetStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
    if (targetStatus === "reko") triggerRekoCheck(operationId, previousStatus)
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
  }, [changeStatusToTop, holdStatusMove, operationById, promptMaterialDecision, triggerDisponiertDialog, triggerRekoCheck, triggerReturningVehicleCheck])

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
  }, [operationById, suspendedGate])

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

  // Closes the completion gate once `resolveMaterialDecision` has written its answers.
  const clearGate = useCallback(() => setGate(null), [])
  const materialDecision = useCompletionMaterial({
    materialDecisionOperationId,
    materialDecisionOperation,
    held: Boolean(materialDecisionGate?.held),
    midRoute: completionContinuation !== null,
    groups,
      materials,
    changeStatusToTop,
    removeMaterial,
    unassignGroupResource,
    onResolved: clearGate,
  })

  const returningVehicleOperation = gateOperation("returningVehicle")
  // Closes itself once a vehicle is on site after all (assigned meanwhile, or set to «bleibt vor Ort»).
  const effectiveReturningVehicleOperation = returningVehicleOperation && lacksReturningVehicle(returningVehicleOperation)
    ? returningVehicleOperation
    : null

  return {
    requestStatusChange,
    requestCompletion,
    triggerDisponiertDialog,
    triggerReturningVehicleCheck,
    triggerRekoCheck,
    holdStatusMove,
    promptMaterialDecision,
    getMissingResources,
    getResourceCoverage,
    suspendGateForAssignment,
    resumeGateAfterAssignment,
    /** Abbrechen on a gate — see `cancelGate`. */
    cancelGate,
    /** Proceed past a gate («Trotzdem …», «Status korrigieren», a Reko
     *  assigned, «Ohne Reko-Person verschieben») — the move stands. */
    closeGate,
    disponiertOperation: operationById(disponiertOperationId),
    disponiertRepeat,
    closeDisponiert: () => {
      setDisponiertOperationId(null)
      setDisponiertRepeat(false)
    },
    openDisponiert: (operationId: string) => {
      if (gate?.kind === "missingResources") {
        setGate(null)
        // The held dispatch happens now, with «Disponieren» (see `holdStatusMove`).
        if (gate.held) changeStatusToTop(gate.operationId, "enroute")
      }
      setDisponiertRepeat(false)
      setDisponiertOperationId(operationId)
    },
    /** The Funkdurchsage again for an Einsatz already out – no gate, no status change. */
    repeatDisponiert: (operationId: string) => {
      setDisponiertRepeat(true)
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
    completionRelease: materialDecisionGate?.held && materialDecisionOperation
      ? completionGateFor(materialDecisionOperation)?.release ?? null
      : materialDecisionGate?.release ?? null,
    /** Where the completed card came from, so the confirmation toast can offer
     *  «Rückgängig». Read from the gate rather than from `completionRelease`:
     *  a stop that hands nothing back has no snapshot but is just as undoable.
     *  Null when the mover did not say — an undo that guesses is not an undo. */
    completionReturnStatus: materialDecisionGate?.held
      ? materialDecisionOperation?.status ?? null
      : materialDecisionGate?.returnStatus ?? null,
    /** Held completion: the column the card still stands in («Status» row of the dialog). */
    completionFromStatus: materialDecisionGate?.held ? materialDecisionOperation?.status ?? null : null,
    /** Put a just-completed incident back where it came from. The backend undoes
     *  its own release in the same transaction (`_undo_completion_release`) and
     *  the context refetches on leaving `complete`, so crew and vehicles come
     *  back — material that was sent to the Magazin does not. */
    reopenCompleted: (operationId: string, status: OperationStatus) => changeStatusToTop(operationId, status),
    ...materialDecision,
    rekoAssignmentOperation: gateOperation("rekoAssignment"),
    /** The card whose move into «Reko abgeschlossen» waits for the Reko form (`holdStatusMove`). */
    rekoReportOperation: gateOperation("rekoReport"),
    /** «Reko abschliessen» / «Ohne Bericht abschliessen»: make the held move. It files nothing;
     *  after «Reko abschliessen» the relevance answer already did (same status – harmless). */
    finishRekoReport: () => {
      if (gate?.kind !== "rekoReport") return
      setGate(null)
      changeStatusToTop(gate.operationId, "reko_done")
    },
    materials,
  }
}

export type IncidentStatusWorkflowController = ReturnType<typeof useIncidentStatusWorkflow>
