"use client"

import { useCallback, useEffect, useRef } from "react"

import type { DispatchPlan, DispatchPriority, DispatchResource, DispatchStatus } from "@/lib/command-dispatch"
import type { Operation } from "@/lib/contexts/operations-context"
import type { GroupResources } from "@/lib/types/groups"

/**
 * Runs a ⌘K dispatch («14 tlf meier einsatz») on the board — the impure half of
 * `lib/command-dispatch.ts`.
 *
 * Nothing here decides whether an assignment is allowed: every resource goes
 * through `assign`, which the board wires to the SAME function a drag onto the
 * card calls (`applyResourceDrop`) — grouped incidents to their Auftrag, Reko to
 * the Reko slot, the Doppelbelegung prompt, out-of-service refusals, all of it.
 *
 * One question at a time: the conflict prompt is a single slot, so a second
 * resource asking while the first is still open would replace it, and a
 * vehicle that lands without a driver asks for one. The runner waits for every
 * open question to be answered before it hands over the next resource.
 *
 * Undo is a new write that must still be valid now (CLAUDE.md → «Undo never
 * restores a snapshot blindly»): it takes off only what is on the Einsatz now
 * AND was not before the command, and puts status/priority back only while they
 * still read what the command set.
 */

export type DispatchCommand = Extract<DispatchPlan, { kind: "dispatch" }>

export interface DispatchOutcome {
  operation: Operation
  /** Resources the command put on (they hold now and did not before). */
  assigned: DispatchResource[]
  status: { from: DispatchStatus; to: DispatchStatus } | null
  priority: { from: DispatchPriority; to: DispatchPriority } | null
}

export interface CommandDispatchDeps {
  /** Latest board state — read at call time, never from a render's closure. */
  getOperation: (operationId: string) => Operation | undefined
  getGroupResources: (groupId: string) => GroupResources
  /** True while a question an assignment raised is open (Doppelbelegung, driver). */
  isQuestionOpen: () => boolean
  /** The drag-and-drop path for one resource onto one incident. */
  assign: (resource: DispatchResource, operationId: string) => unknown
  setPriority: (operationId: string, priority: DispatchPriority) => void
  /** A status move with the side effects a drag across columns has. */
  moveStatus: (operationId: string, status: DispatchStatus, previous: DispatchStatus) => void
  /** Raw writes for the undo. */
  revertPriority: (operationId: string, priority: DispatchPriority) => void
  revertStatus: (operationId: string, status: DispatchStatus) => void
  removeCrew: (operationId: string, name: string) => unknown
  removeReko: (operationId: string) => unknown
  removeVehicle: (operationId: string, name: string) => unknown
  removeMaterial: (operationId: string, materialId: string) => unknown
  unassignGroupResource: (groupId: string, assignmentId: string) => unknown
  /** Says what happened, with the undo. Not called when nothing changed. */
  report: (outcome: DispatchOutcome, undo: () => Promise<void>) => void
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>
}

/** How long nothing may ask before the next resource is handed over. */
const QUIET_MS = 300
/** A vehicle's driver prompt comes after two API calls — give it room. */
const VEHICLE_QUIET_MS = 1200

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Where a resource sits on this incident, if anywhere. */
type Holding =
  | { where: "crew" }
  | { where: "reko" }
  | { where: "vehicle" }
  | { where: "material" }
  | { where: "route"; groupId: string; assignmentId: string }

export function holding(
  operation: Operation,
  resource: DispatchResource,
  getGroupResources: (groupId: string) => GroupResources,
): Holding | null {
  if (resource.kind === "person") {
    if (operation.assignedReko?.id === resource.id) return { where: "reko" }
    if (operation.crew.includes(resource.name)) return { where: "crew" }
  } else if (resource.kind === "vehicle") {
    if (operation.vehicles.includes(resource.name)) return { where: "vehicle" }
  } else if (operation.materials.includes(resource.id)) {
    return { where: "material" }
  }
  if (operation.groupId) {
    const resources = getGroupResources(operation.groupId)
    const list =
      resource.kind === "person" ? resources.personnel : resource.kind === "vehicle" ? resources.vehicles : resources.materials
    const item = list.find((entry) => entry.resourceId === resource.id)
    if (item) return { where: "route", groupId: operation.groupId, assignmentId: item.assignmentId }
  }
  return null
}

export async function runDispatch(command: DispatchCommand, deps: CommandDispatchDeps): Promise<DispatchOutcome | null> {
  const sleep = deps.sleep ?? defaultSleep
  const operationId = command.incident.id
  const before = deps.getOperation(operationId)
  if (!before) return null

  // Wait until no question has been open for `quietMs` in a row. A question
  // can arrive late: the driver prompt follows a vehicle only after two API
  // round trips, and «Hierher verschieben» re-assigns after its own removals —
  // so «the prompt just closed» is not yet «nothing more will be asked».
  const waitForQuiet = async (quietMs: number) => {
    const step = 100
    let quiet = 0
    while (quiet < quietMs) {
      await sleep(step)
      quiet = deps.isQuestionOpen() ? 0 : quiet + step
    }
  }

  const wasHeld = new Set(
    command.assign
      .filter((entry) => holding(before, entry.target, deps.getGroupResources))
      .map((entry) => `${entry.target.kind}:${entry.target.id}`),
  )
  for (const entry of command.assign) {
    if (wasHeld.has(`${entry.target.kind}:${entry.target.id}`)) continue
    deps.assign(entry.target, operationId)
    await waitForQuiet(entry.target.kind === "vehicle" ? VEHICLE_QUIET_MS : QUIET_MS)
  }

  let priority: DispatchOutcome["priority"] = null
  if (command.priority && command.priority !== before.priority) {
    deps.setPriority(operationId, command.priority)
    priority = { from: before.priority, to: command.priority }
  }
  let status: DispatchOutcome["status"] = null
  // Last: «→ Disponiert» asks its own questions (the Disponiert dialog), and
  // those are about the crew that was just put on.
  const current = deps.getOperation(operationId) ?? before
  if (command.status && command.status !== current.status) {
    deps.moveStatus(operationId, command.status, current.status)
    status = { from: current.status, to: command.status }
  }

  // Assignments land optimistically, a route's through its API call: give them
  // a moment, then report what is actually there — a cancelled prompt is not
  // an assignment, and the toast must not claim it.
  const pending = () => {
    const now = deps.getOperation(operationId)
    return command.assign.filter(
      (entry) =>
        !wasHeld.has(`${entry.target.kind}:${entry.target.id}`) &&
        !(now && holding(now, entry.target, deps.getGroupResources)),
    )
  }
  for (let waited = 0; pending().length > 0 && waited < 1500; waited += 100) await sleep(100)

  const after = deps.getOperation(operationId) ?? before
  const assigned = command.assign
    .map((entry) => entry.target)
    .filter(
      (resource) =>
        !wasHeld.has(`${resource.kind}:${resource.id}`) && holding(after, resource, deps.getGroupResources),
    )
  if (assigned.length === 0 && !status && !priority) return null

  const outcome: DispatchOutcome = { operation: after, assigned, status, priority }
  deps.report(outcome, () => undoDispatch(outcome, deps))
  return outcome
}

export async function undoDispatch(outcome: DispatchOutcome, deps: CommandDispatchDeps): Promise<void> {
  const operationId = outcome.operation.id
  const now = deps.getOperation(operationId)
  if (!now) return
  for (const resource of outcome.assigned) {
    const held = holding(now, resource, deps.getGroupResources)
    if (!held) continue
    if (held.where === "crew") await deps.removeCrew(operationId, resource.name)
    else if (held.where === "reko") await deps.removeReko(operationId)
    else if (held.where === "vehicle") await deps.removeVehicle(operationId, resource.name)
    else if (held.where === "material") await deps.removeMaterial(operationId, resource.id)
    else await deps.unassignGroupResource(held.groupId, held.assignmentId)
  }
  if (outcome.priority && now.priority === outcome.priority.to) deps.revertPriority(operationId, outcome.priority.from)
  if (outcome.status && now.status === outcome.status.to) deps.revertStatus(operationId, outcome.status.from)
}

/**
 * The board's runner: `deps` is read through a ref on every call, so the
 * returned function is stable and an in-flight dispatch keeps seeing the
 * newest board while it waits for a prompt.
 */
export function useCommandDispatch(deps: CommandDispatchDeps) {
  const ref = useRef(deps)
  useEffect(() => {
    ref.current = deps
  })
  return useCallback((command: DispatchCommand) => {
    const live: CommandDispatchDeps = new Proxy({} as CommandDispatchDeps, {
      get: (_target, key: keyof CommandDispatchDeps) => ref.current[key],
    })
    return runDispatch(command, live)
  }, [])
}
