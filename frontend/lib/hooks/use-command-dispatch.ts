"use client"

import { useCallback, useEffect, useRef } from "react"

import type { DispatchPlan, DispatchPriority, DispatchResource, DispatchStatus } from "@/lib/command-dispatch"
import type { Operation } from "@/lib/contexts/operations-context"
import type { Released } from "@/lib/release-undo"
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
 * vehicle that lands without a driver asks for one. The runner waits until no
 * question is open AND no assignment is still settling (the board's explicit
 * signal: a vehicle's driver check, a resolved Doppelbelegung's move) before it
 * hands over the next resource. Two commands typed in a row run one after the
 * other, never interleaved (`useCommandDispatch` queues them).
 *
 * Undo is a new write that must still be valid now (CLAUDE.md → «Undo never
 * restores a snapshot blindly»): it takes off only what is on the Einsatz now
 * AND was not before the command, and puts status/priority back only while they
 * still read what the command set. A resource the command took off another
 * Einsatz or Auftrag («Hierher verschieben») goes back there through the
 * release undo (`checkRestore` first) — or the toast says why it cannot.
 */

export type DispatchCommand = Extract<DispatchPlan, { kind: "dispatch" }>

export interface DispatchOutcome {
  operation: Operation
  /** Resources the command put on (they hold now and did not before). */
  assigned: DispatchResource[]
  /** Where those came from when the operator chose to move them here. */
  moved: Released[]
  status: { from: DispatchStatus; to: DispatchStatus } | null
  priority: { from: DispatchPriority; to: DispatchPriority } | null
}

export interface CommandDispatchDeps {
  /** Latest board state — read at call time, never from a render's closure. */
  getOperation: (operationId: string) => Operation | undefined
  getGroupResources: (groupId: string) => GroupResources
  /** True while a question an assignment raised is open (Doppelbelegung, driver)
   *  or may still come (an assignment still settling). */
  isQuestionOpen: () => boolean
  /** Every Einsatz on the board — where a resource was before it was moved here. */
  getOperations: () => readonly Operation[]
  /** The Aufträge holding a resource now. */
  getGroupsHolding: (resource: DispatchResource) => readonly { id: string; name: string }[]
  /** Short label of an Einsatz, for «wieder bei …». */
  labelOf: (operation: Operation) => string
  /** Put moved resources back where they were (the release undo, `checkRestore` first). */
  restore: (item: Released) => Promise<unknown>
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

/** A just-raised question needs a render to reach `isQuestionOpen`: nothing
 *  may be open or settling for this long before the next resource goes. */
const QUIET_MS = 300

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

/** On this Einsatz itself (crew, Reko, vehicle, Gerät) — not via its Auftrag. */
function heldOnIncident(operation: Operation, resource: DispatchResource): boolean {
  if (resource.kind === "person") return operation.crew.includes(resource.name) || operation.assignedReko?.id === resource.id
  if (resource.kind === "vehicle") return operation.vehicles.includes(resource.name)
  return operation.materials.includes(resource.id)
}

function releasedFromIncident(resource: DispatchResource, operationId: string, targetLabel: string): Released {
  if (resource.kind === "person") return { kind: "personnel", operationId, personId: resource.id, name: resource.name, targetLabel }
  if (resource.kind === "vehicle") return { kind: "vehicle", operationId, vehicleId: resource.id, name: resource.name, targetLabel }
  return { kind: "material", operationId, materialId: resource.id, name: resource.name, targetLabel }
}

export async function runDispatch(command: DispatchCommand, deps: CommandDispatchDeps): Promise<DispatchOutcome | null> {
  const sleep = deps.sleep ?? defaultSleep
  const operationId = command.incident.id
  const before = deps.getOperation(operationId)
  if (!before) return null

  // Wait until nothing has been open or settling for `quietMs` in a row.
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
  // Where each resource is before the command — to tell, afterwards, what a
  // «Hierher verschieben» took it off (the undo puts it back there).
  const sourcesBefore = new Map(
    command.assign.map((entry) => [
      `${entry.target.kind}:${entry.target.id}`,
      {
        incidents: deps.getOperations().filter((op) => op.id !== operationId && heldOnIncident(op, entry.target)),
        groups: deps.getGroupsHolding(entry.target).filter((group) => group.id !== before.groupId),
      },
    ]),
  )
  for (const entry of command.assign) {
    if (wasHeld.has(`${entry.target.kind}:${entry.target.id}`)) continue
    deps.assign(entry.target, operationId)
    await waitForQuiet(QUIET_MS)
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

  // Report what is actually there — a cancelled prompt is not an assignment,
  // and the toast must not claim it. Every assign is optimistic and the last
  // one has settled (waitForQuiet), so the board already says.
  const after = deps.getOperation(operationId) ?? before
  const assigned = command.assign
    .map((entry) => entry.target)
    .filter(
      (resource) =>
        !wasHeld.has(`${resource.kind}:${resource.id}`) && holding(after, resource, deps.getGroupResources),
    )
  if (assigned.length === 0 && !status && !priority) return null

  const moved: Released[] = []
  for (const resource of assigned) {
    const sources = sourcesBefore.get(`${resource.kind}:${resource.id}`)
    if (!sources) continue
    for (const source of sources.incidents) {
      const now = deps.getOperations().find((op) => op.id === source.id)
      if (now && heldOnIncident(now, resource)) continue
      moved.push(releasedFromIncident(resource, source.id, deps.labelOf(source)))
    }
    const stillOn = new Set(deps.getGroupsHolding(resource).map((group) => group.id))
    for (const group of sources.groups) {
      if (stillOn.has(group.id)) continue
      moved.push({
        kind: "routeResource",
        groupId: group.id,
        resourceType: resource.kind === "person" ? "personnel" : resource.kind,
        resourceId: resource.id,
        name: resource.name,
        targetLabel: group.name,
      })
    }
  }

  const outcome: DispatchOutcome = { operation: after, assigned, moved, status, priority }
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
  // Back where «Hierher verschieben» took them from — now that they are free
  // again. The release undo checks first (closed, gone, put elsewhere meanwhile)
  // and says so; one at a time, so each answer is its own toast.
  for (const item of outcome.moved) await deps.restore(item)
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
  // One queue: a second command typed while the first still waits for an
  // answer runs after it, not interleaved with it.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  return useCallback((command: DispatchCommand) => {
    const live: CommandDispatchDeps = new Proxy({} as CommandDispatchDeps, {
      get: (_target, key: keyof CommandDispatchDeps) => ref.current[key],
    })
    const run = queue.current.then(() => runDispatch(command, live))
    queue.current = run.catch(() => null)
    return run
  }, [])
}
