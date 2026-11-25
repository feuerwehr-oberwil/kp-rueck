import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useIncidentStatusWorkflow } from "@/components/kanban/incident-status-workflow"
import type { Material, Operation, OperationStatus } from "@/lib/contexts/operations-context"
import type { GroupResources } from "@/lib/types/groups"
import { crewMember, assignedVehicle } from "@/test-utils/operation-fixtures"

// The material gate prefills itself from the Schadenplatz-Rapport. Every gate
// test opens one, so the door has to be mocked for all of them, not just the
// prefill cases. Resolving the gate writes the confirmed answers back through
// the second door, so that one is mocked alongside.
const getRapportMaterialReturn = vi.hoisted(() => vi.fn())
const applyRapportMaterialDecisions = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api-client", () => ({ apiClient: { getRapportMaterialReturn, applyRapportMaterialDecisions } }))

const emptyGroupResources: GroupResources = { personnel: [], vehicles: [], materials: [] }
// A route with its squad and Geräte: its next stop goes out without the dispatch gate.
const squadOnRoute: GroupResources = {
  personnel: [{ assignmentId: "sq-p", resourceId: "p-squad", name: "Roth Til" }],
  vehicles: [{ assignmentId: "sq-v", resourceId: "v-squad", name: "TLF" }],
  materials: [{ assignmentId: "sq-m", resourceId: "m-squad", name: "Schlauch" }],
}

function rapport(overrides: Partial<{
  returned: unknown[]
  left_on_site: unknown[]
  rapport_by: string | null
  rapport_is_draft: boolean
}> = {}) {
  return {
    returned: [],
    left_on_site: [],
    rapport_by: null,
    rapport_submitted_at: null,
    rapport_is_draft: false,
    ...overrides,
  }
}

beforeEach(() => {
  getRapportMaterialReturn.mockReset()
  getRapportMaterialReturn.mockResolvedValue(rapport())
  applyRapportMaterialDecisions.mockReset()
  applyRapportMaterialDecisions.mockResolvedValue({ applied: true })
})

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "incident-1",
    location: "Hauptstrasse 1",
    vehicle: null,
    vehicles: [],
    incidentType: "brand",
    dispatchTime: new Date("2026-07-23T10:00:00Z"),
    crew: [],
    priority: "high",
    status: "incoming",
    coordinates: [47.1, 7.2],
    materials: [],
    notes: "Meldung",
    contact: "",
    contactPhone: "",
    internalNotes: "",
    nachbarhilfe: false,
    nachbarhilfeNote: "",
    amWarten: false,
    amWartenNote: "",
    zuFuss: false,
    groupId: null,
    groupPosition: 0,
    statusChangedAt: null,
    hasCompletedReko: false,
    rekoArrivedAt: null,
    rekoSummary: null,
    assignedReko: null,
    leaderId: null,
    leaderName: null,
    materialAssignments: new Map(),
    ...overrides,
  }
}

function renderWorkflow(
  currentOperation: Operation,
  groupResources: GroupResources = emptyGroupResources,
  groups: { id: string; stopIds: string[] }[] = [],
  consumableIds: string[] = [],
  /** The other stops of the route, when the test is about one. */
  siblings: Operation[] = [],
) {
  // Resolves like the store's: true once the server took the status.
  // What the store holds.
  const board = { operations: [currentOperation, ...siblings] }
  // Like the store: the status is on the board at once (seen from the next render), and the
  // write resolves true once the server took it.
  const changeStatusToTop = vi.fn<(operationId: string, status: OperationStatus, extra?: Partial<Operation>) => Promise<boolean>>(
    (id, status) => {
      board.operations = board.operations.map((op) => (op.id === id ? { ...op, status } : op))
      return Promise.resolve(true)
    },
  )
  const getGroupResources = vi.fn(() => groupResources)
  const materials: Material[] = currentOperation.materials.map((id) => ({
    id,
    name: id,
    type: "Material",
    category: "Magazin",
    categorySortOrder: 0,
    status: "assigned",
    outOfService: false,
    outOfServiceSince: null,
    consumable: consumableIds.includes(id),
    groupId: null,
  }))
  const removeMaterial = vi.fn()
  const unassignGroupResource = vi.fn()
  const result = renderHook(() => useIncidentStatusWorkflow({
    operations: board.operations,
    materials,
    groups: groups as never,
    changeStatusToTop,
    getGroupResources,
    removeMaterial,
    unassignGroupResource,
  }))
  return { ...result, board, changeStatusToTop, removeMaterial, unassignGroupResource }
}

/** «Abschliessen» as the app runs it: the store shows the new status at once, and the write
 *  answers after the board re-rendered (a real PATCH takes a round trip). */
async function confirmAsTheApp(rendered: ReturnType<typeof renderWorkflow>, startNextId: string | null = null) {
  let done: Promise<{ returned: string[]; kept: string[] } | null> = Promise.resolve(null)
  act(() => { done = rendered.result.current.resolveMaterialDecision(startNextId) })
  rendered.rerender()
  let outcome: { returned: string[]; kept: string[] } | null = null
  await act(async () => { outcome = await done })
  return outcome
}

describe("shared incident detail status workflow", () => {
  it("counts the Auftrag's crew for a stop whose groupId has not arrived yet", () => {
    // «+ Stop» writes the route; the incident's own group_id follows on the next
    // refresh. In that window the gate saw no crew and «es fehlt noch etwas»
    // opened for an Auftrag that was fully staffed.
    const stop = operation({ id: "incident-1", groupId: null })
    const routeCrew: GroupResources = {
      personnel: [{ assignmentId: "a1", resourceId: "p1", name: "Roth Til" }],
      vehicles: [{ assignmentId: "a2", resourceId: "v1", name: "TLF" }],
      materials: [{ assignmentId: "a3", resourceId: "m1", name: "Motorsäge" }],
    }

    const blind = renderWorkflow(stop, routeCrew, [])
    expect(blind.result.current.getMissingResources(stop)).toEqual(["crew", "vehicles", "materials"])

    const seeing = renderWorkflow(stop, routeCrew, [{ id: "g1", stopIds: ["incident-1"] }])
    expect(seeing.result.current.getMissingResources(stop)).toEqual([])
  })

  it("names the Einsatz's and the Auftrag's resources in the coverage, EL first", () => {
    // The «Ressourcen fehlen» Fahrzeuge row once read «[object Object], TLF».
    const stop = operation({
      id: "incident-1",
      crew: [crewMember("Roth Til"), crewMember("Meier Andrea")],
      leaderId: "p-Meier Andrea",
      vehicles: [assignedVehicle("Pio", { driverStay: true })],
    })
    const route: GroupResources = {
      ...emptyGroupResources,
      personnel: [{ assignmentId: "a1", resourceId: "p9", name: "Gerber Elias", isLeader: true }],
      vehicles: [{ assignmentId: "a2", resourceId: "v1", name: "TLF", driverStay: false }],
    }
    const { result } = renderWorkflow(stop, route, [{ id: "g1", stopIds: ["incident-1"] }])
    const coverage = result.current.getResourceCoverage(stop)

    // Under an Auftrag the route's leader leads; the stop's earlier EL is not marked a second time.
    expect(coverage.crew.map((member) => [member.name, member.isLeader])).toEqual([
      ["Gerber Elias", true],
      ["Roth Til", false],
      ["Meier Andrea", false],
    ])
    expect(coverage.vehicles.map((vehicle) => [vehicle.name, vehicle.driverStay, vehicle.target])).toEqual([
      ["Pio", true, { kind: "incident", operationId: "incident-1", vehicleId: "v-Pio" }],
      ["TLF", false, { kind: "route", groupId: "g1", assignmentId: "a2" }],
    ])
  })

  it("holds a dispatch with missing resources until «Disponieren» (hunt 2026-11-24)", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation())

    act(() => result.current.requestStatusChange("incident-1", "enroute"))

    // Nothing published yet: no status write, no broadcast, no Einsatzzettel.
    expect(changeStatusToTop).not.toHaveBeenCalled()
    expect(result.current.missingResourcesOperation?.id).toBe("incident-1")
    expect(result.current.disponiertOperation).toBeNull()

    act(() => result.current.openDisponiert("incident-1"))
    expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "enroute")
    expect(result.current.disponiertOperation?.id).toBe("incident-1")
  })

  it("holds a first dispatch straight into «Im Einsatz» the same way (hunt follow-up 25.11.)", () => {
    // Anfahrt is skippable, and the server prints the first Einsatzzettel on entering
    // «Im Einsatz» too – so this move needs the same gate as «Disponiert / Anfahrt».
    const { result, changeStatusToTop } = renderWorkflow(operation({ status: "reko_done" }))

    act(() => result.current.requestStatusChange("incident-1", "active"))
    expect(changeStatusToTop).not.toHaveBeenCalled()
    expect(result.current.missingResourcesOperation?.id).toBe("incident-1")

    act(() => result.current.openDisponiert("incident-1"))
    expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "active")

    // Already out: «Anfahrt» → «Im Einsatz» is no dispatch, and asks nothing.
    const out = renderWorkflow(operation({ status: "enroute" }))
    expect(out.result.current.holdStatusMove("incident-1", "active")).toBe(false)
  })

  it("opens Disponiert directly when all effective resources are present", () => {
    const { result } = renderWorkflow(operation({
      crew: [crewMember("AdF Eins")],
      vehicles: [assignedVehicle("TLF")],
      materials: ["Schlauch"],
    }))

    act(() => result.current.requestStatusChange("incident-1", "enroute"))

    expect(result.current.missingResourcesOperation).toBeNull()
    expect(result.current.disponiertOperation?.id).toBe("incident-1")
  })

  it("gates Reko, Reko completion, return, and incident completion requests", () => {
    const reko = renderWorkflow(operation())
    act(() => reko.result.current.requestStatusChange("incident-1", "reko"))
    expect(reko.result.current.rekoAssignmentOperation?.id).toBe("incident-1")

    const rekoDone = renderWorkflow(operation())
    act(() => rekoDone.result.current.requestStatusChange("incident-1", "reko_done"))
    expect(rekoDone.result.current.rekoReportOperation?.id).toBe("incident-1")

    const returning = renderWorkflow(operation())
    act(() => returning.result.current.requestStatusChange("incident-1", "returning"))
    expect(returning.result.current.returningVehicleOperation?.id).toBe("incident-1")

    const complete = renderWorkflow(operation({ materials: ["material-1"] }))
    act(() => complete.result.current.requestCompletion("incident-1"))
    expect(complete.changeStatusToTop).not.toHaveBeenCalled()
    expect(complete.result.current.materialDecisionOperation?.id).toBe("incident-1")
  })

  it("a cancelled dispatch gate leaves the card where it was – no move, no undo", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation({ status: "reko" }))

    act(() => result.current.requestStatusChange("incident-1", "enroute"))
    expect(result.current.missingResourcesOperation?.id).toBe("incident-1")

    act(() => result.current.cancelGate("missingResources"))
    expect(changeStatusToTop).not.toHaveBeenCalled()
    expect(result.current.missingResourcesOperation).toBeNull()
  })

  it("keeps the dispatch held across the assignment suspend/resume round-trip", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation())

    act(() => result.current.requestStatusChange("incident-1", "enroute"))
    act(() => result.current.suspendGateForAssignment())
    act(() => result.current.resumeGateAfterAssignment())
    expect(result.current.missingResourcesOperation?.id).toBe("incident-1")
    act(() => result.current.cancelGate("missingResources"))

    expect(changeStatusToTop).not.toHaveBeenCalled()
    expect(result.current.missingResourcesOperation).toBeNull()
  })

  it("cancel only closes the gate when no return status is known", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation())

    act(() => result.current.triggerDisponiertDialog("incident-1"))
    expect(result.current.missingResourcesOperation?.id).toBe("incident-1")

    act(() => result.current.cancelGate("missingResources"))
    expect(changeStatusToTop).not.toHaveBeenCalled()
    expect(result.current.missingResourcesOperation).toBeNull()
  })

  it("reverts to the previous status when the returning-vehicle gate is cancelled", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation({ status: "reko_done" }))

    act(() => result.current.requestStatusChange("incident-1", "returning"))
    expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "returning")
    expect(result.current.returningVehicleOperation?.id).toBe("incident-1")

    act(() => result.current.cancelGate("returningVehicle"))
    expect(changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "reko_done")
    expect(result.current.returningVehicleOperation).toBeNull()
  })

  it("keeps the returning-vehicle return status across the assignment suspend/resume round-trip", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation({ status: "reko_done" }))

    act(() => result.current.requestStatusChange("incident-1", "returning"))
    act(() => result.current.suspendGateForAssignment())
    expect(result.current.returningVehicleOperation).toBeNull()

    // Resume re-triggers WITHOUT previousStatus — the stored return status must survive.
    act(() => result.current.resumeGateAfterAssignment())
    expect(result.current.returningVehicleOperation?.id).toBe("incident-1")

    act(() => result.current.cancelGate("returningVehicle"))
    expect(changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "reko_done")
    expect(result.current.returningVehicleOperation).toBeNull()
  })

  it("Reko picker gate: cancel puts the card back, assigning or «ohne» keeps the move", () => {
    const cancelled = renderWorkflow(operation({ status: "enroute" }))
    act(() => cancelled.result.current.requestStatusChange("incident-1", "reko"))
    expect(cancelled.changeStatusToTop).toHaveBeenCalledWith("incident-1", "reko")
    act(() => cancelled.result.current.cancelGate("rekoAssignment"))
    expect(cancelled.changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "enroute")
    expect(cancelled.result.current.rekoAssignmentOperation).toBeNull()

    // «Zuweisen» (onAssigned) and «Ohne Reko-Person verschieben» both close the gate as a proceed.
    const kept = renderWorkflow(operation({ status: "enroute" }))
    act(() => kept.result.current.requestStatusChange("incident-1", "reko"))
    act(() => kept.result.current.closeGate("rekoAssignment"))
    expect(kept.changeStatusToTop).toHaveBeenCalledTimes(1)
    expect(kept.result.current.rekoAssignmentOperation).toBeNull()
  })

  it("Reko report gate holds the move until the form is finished", () => {
    const cancelled = renderWorkflow(operation({ status: "reko" }))
    act(() => cancelled.result.current.requestStatusChange("incident-1", "reko_done"))
    expect(cancelled.result.current.rekoReportOperation?.id).toBe("incident-1")
    // The card has not moved: the server would file the draft in «Reko abgeschlossen».
    expect(cancelled.changeStatusToTop).not.toHaveBeenCalled()
    act(() => cancelled.result.current.cancelGate("rekoReport"))
    expect(cancelled.changeStatusToTop).not.toHaveBeenCalled()
    expect(cancelled.result.current.rekoReportOperation).toBeNull()

    const finished = renderWorkflow(operation({ status: "reko" }))
    act(() => finished.result.current.requestStatusChange("incident-1", "reko_done"))
    act(() => finished.result.current.finishRekoReport())
    expect(finished.changeStatusToTop).toHaveBeenCalledWith("incident-1", "reko_done")
    expect(finished.result.current.rekoReportOperation).toBeNull()

    // With a filed report there is nothing to ask: the move happens at once.
    const filed = renderWorkflow(operation({ status: "reko", hasCompletedReko: true }))
    expect(filed.result.current.holdStatusMove("incident-1", "reko_done")).toBe(false)
  })

  it("holds the completion: nobody is freed before «Abschliessen», Abbrechen changes nothing", async () => {
    const staffed = operation({ status: "active", crew: [crewMember("AdF Eins")], vehicles: [assignedVehicle("TLF")] })
    const cancelled = renderWorkflow(staffed)
    act(() => cancelled.result.current.requestCompletion("incident-1"))
    expect(cancelled.changeStatusToTop).not.toHaveBeenCalled()
    expect(cancelled.result.current.completionRelease?.crew).toHaveLength(1)
    expect(cancelled.result.current.completionFromStatus).toBe("active")
    act(() => cancelled.result.current.cancelGate("materialDecision"))
    expect(cancelled.changeStatusToTop).not.toHaveBeenCalled()
    expect(cancelled.result.current.materialDecisionOperation).toBeNull()

    const confirmed = renderWorkflow(staffed)
    act(() => confirmed.result.current.requestCompletion("incident-1"))
    await act(() => confirmed.result.current.resolveMaterialDecision(null))
    expect(confirmed.changeStatusToTop).toHaveBeenCalledWith("incident-1", "complete")
  })

  it("on the last open stop, holds and names the route's squad – the server frees it too", () => {
    const routeSquad: GroupResources = {
      personnel: [{ assignmentId: "a1", resourceId: "p1", name: "Roth Til" }],
      vehicles: [{ assignmentId: "a2", resourceId: "v1", name: "TLF" }],
      materials: [],
    }
    const { result, changeStatusToTop } = renderWorkflow(
      operation({ id: "stop-2", groupId: "g1", status: "active" }),
      routeSquad,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-1", groupId: "g1", status: "complete" })],
    )

    act(() => result.current.requestCompletion("stop-2"))
    expect(changeStatusToTop).not.toHaveBeenCalled()
    expect(result.current.completionRelease).toMatchObject({ crew: ["Roth Til"], vehicles: ["TLF"] })
  })

  it("holds a Reko-only completion and names the Reko – the server frees it", () => {
    const { result, changeStatusToTop } = renderWorkflow(
      operation({ status: "active", assignedReko: { id: "p9", name: "Suter Beat" } }),
    )
    act(() => result.current.requestCompletion("incident-1"))
    expect(changeStatusToTop).not.toHaveBeenCalled()
    expect(result.current.completionRelease?.crew).toEqual(["Suter Beat"])
  })

  it("discards local decisions when the material decision is cancelled", () => {
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["material-1"] }))

    act(() => result.current.requestCompletion("incident-1"))
    act(() => result.current.setMaterialDecision("material-1", "vorort"))
    expect(result.current.materialDecisions["material-1"]).toBe("vorort")

    act(() => result.current.cancelGate("materialDecision"))
    expect(result.current.materialDecisionOperation).toBeNull()
    expect(result.current.materialDecisions).toEqual({})
  })

  it("never books an unanswered reusable unit as «Magazin» (hunt 2026-11-24)", async () => {
    const { result, removeMaterial } = renderWorkflow(operation({ status: "returning", materials: ["pumpe"] }))

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialAnswersLoading).toBe(false))
    const [pumpe] = result.current.materialDecisionItems
    expect(result.current.materialChoice(pumpe)).toBeNull()
    expect(result.current.materialUnanswered).toBe(1)

    act(() => result.current.setMaterialDecision("pumpe", "vorort"))
    expect(result.current.materialUnanswered).toBe(0)
    await act(() => result.current.resolveMaterialDecision(null))
    expect(removeMaterial).not.toHaveBeenCalled()
    expect(applyRapportMaterialDecisions).toHaveBeenCalledWith("incident-1", [{ material_id: "pumpe", left_on_site: true }])
  })

  it("cancel in the post-change gates only closes when no return status is known", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation({ status: "reko_done" }))

    act(() => result.current.triggerReturningVehicleCheck("incident-1"))
    expect(result.current.returningVehicleOperation?.id).toBe("incident-1")

    act(() => result.current.cancelGate("returningVehicle"))
    expect(changeStatusToTop).not.toHaveBeenCalled()
    expect(result.current.returningVehicleOperation).toBeNull()
  })

  it("puts «Am Warten» back on cancel even after the assignment round-trip", () => {
    // The move clears the flag in the store; the gate must remember it from
    // BEFORE the move, through the parked assignment dialog and back.
    const changeStatusToTop = vi.fn()
    const { result, rerender } = renderHook(
      ({ operations }: { operations: Operation[] }) => useIncidentStatusWorkflow({
        operations,
        materials: [],
        groups: [],
        changeStatusToTop,
        getGroupResources: () => emptyGroupResources,
        removeMaterial: vi.fn(),
        unassignGroupResource: vi.fn(),
      }),
      { initialProps: { operations: [operation({ status: "reko_done", amWarten: true })] } },
    )

    act(() => result.current.requestStatusChange("incident-1", "returning"))
    rerender({ operations: [operation({ status: "returning", amWarten: false })] })
    act(() => result.current.suspendGateForAssignment())
    act(() => result.current.resumeGateAfterAssignment())
    act(() => result.current.cancelGate("returningVehicle"))

    expect(changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "reko_done", { amWarten: true })
  })

  it("returns to the missing-resource gate after its assignment dialog closes", () => {
    const { result } = renderWorkflow(operation())
    act(() => result.current.requestStatusChange("incident-1", "enroute"))
    act(() => result.current.suspendGateForAssignment())
    expect(result.current.missingResourcesOperation).toBeNull()

    act(() => result.current.resumeGateAfterAssignment())
    expect(result.current.missingResourcesOperation?.id).toBe("incident-1")
  })
})

describe("the completion write comes first (hunt follow-up 25.11.)", () => {
  // «Abschliessen» used to fire the status write and, in the same tick, book the
  // material and start the next stop. A refused completion then left a pump booked
  // into the Magazin and the squad on the next stop of an Einsatz still open.

  function deferred() {
    let settle: (ok: boolean) => void = () => {}
    const promise = new Promise<boolean>((resolve) => { settle = resolve })
    return { promise, settle }
  }

  async function heldCompletion() {
    const write = deferred()
    const rendered = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "returning", crew: [crewMember("AdF Eins")], materials: ["pumpe"] }),
      squadOnRoute,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-2", groupId: "g1", status: "incoming" })],
    )
    // Like the store: the status is on the board at once, the server's answer comes later.
    rendered.changeStatusToTop.mockImplementation((id, status) => {
      rendered.board.operations = rendered.board.operations.map((op) => (op.id === id ? { ...op, status } : op))
      return status === "complete" ? write.promise : Promise.resolve(true)
    })
    act(() => rendered.result.current.requestCompletion("stop-1"))
    await waitFor(() => expect(rendered.result.current.materialAnswersLoading).toBe(false))
    act(() => rendered.result.current.setMaterialDecision("pumpe", "magazin"))
    return { ...rendered, write }
  }

  it("books the material and starts the next stop only once the completion is written", async () => {
    const { result, changeStatusToTop, removeMaterial, write } = await heldCompletion()

    let done: Promise<unknown> = Promise.resolve()
    act(() => { done = result.current.resolveMaterialDecision("stop-2") })
    expect(changeStatusToTop).toHaveBeenCalledWith("stop-1", "complete")
    expect(removeMaterial).not.toHaveBeenCalled()
    expect(applyRapportMaterialDecisions).not.toHaveBeenCalled()
    expect(changeStatusToTop).not.toHaveBeenCalledWith("stop-2", "active")

    await act(async () => {
      write.settle(true)
      await done
    })
    expect(removeMaterial).toHaveBeenCalledWith("stop-1", "pumpe")
    expect(applyRapportMaterialDecisions).toHaveBeenCalled()
    expect(changeStatusToTop).toHaveBeenLastCalledWith("stop-2", "active")
  })

  it("a refused completion books nothing and starts nothing", async () => {
    const { result, changeStatusToTop, removeMaterial, write } = await heldCompletion()

    let done: Promise<unknown> = Promise.resolve()
    act(() => { done = result.current.resolveMaterialDecision("stop-2") })
    let outcome: unknown
    await act(async () => {
      write.settle(false)
      outcome = await done
    })
    expect(outcome).toBeNull()
    expect(removeMaterial).not.toHaveBeenCalled()
    expect(applyRapportMaterialDecisions).not.toHaveBeenCalled()
    expect(changeStatusToTop).not.toHaveBeenCalledWith("stop-2", "active")
  })

  it("starts the next stop only if it still is the next one once the write landed", async () => {
    // A slow write: meanwhile the KP sent the squad to stop 3. Starting stop 2 as well
    // would dispatch two stops for one squad.
    const write = deferred()
    const changeStatusToTop = vi.fn<(operationId: string, status: OperationStatus, extra?: Partial<Operation>) => Promise<boolean>>(
      (_id, status) => (status === "complete" ? write.promise : Promise.resolve(true)),
    )
    const stops = (third: Operation["status"], first: Operation["status"] = "returning") => [
      operation({ id: "stop-1", groupId: "g1", status: first, crew: [crewMember("AdF Eins")] }),
      operation({ id: "stop-2", groupId: "g1", status: "incoming" }),
      operation({ id: "stop-3", groupId: "g1", status: third }),
    ]
    const { result, rerender } = renderHook(
      ({ operations }: { operations: Operation[] }) => useIncidentStatusWorkflow({
        operations,
        materials: [],
        groups: [{ id: "g1", stopIds: ["stop-1", "stop-2", "stop-3"] }] as never,
        changeStatusToTop,
        getGroupResources: () => squadOnRoute,
        removeMaterial: vi.fn(),
        unassignGroupResource: vi.fn(),
      }),
      { initialProps: { operations: stops("incoming") } },
    )

    act(() => result.current.requestCompletion("stop-1"))
    let done: Promise<unknown> = Promise.resolve()
    act(() => { done = result.current.resolveMaterialDecision("stop-2") })
    rerender({ operations: stops("active", "complete") })
    await act(async () => {
      write.settle(true)
      await done
    })
    expect(changeStatusToTop).not.toHaveBeenCalledWith("stop-2", "active")
  })

  it("keeps the route's Geräte when the last stop was reopened during the write", async () => {
    const write = deferred()
    const changeStatusToTop = vi.fn<(operationId: string, status: OperationStatus, extra?: Partial<Operation>) => Promise<boolean>>(
      (_id, status) => (status === "complete" ? write.promise : Promise.resolve(true)),
    )
    const unassignGroupResource = vi.fn()
    const routeMaterial: GroupResources = {
      ...emptyGroupResources,
      materials: [{ assignmentId: "a1", resourceId: "motorsaege", name: "Motorsäge" }],
    }
    const only = (status: Operation["status"]) => [operation({ id: "stop-1", groupId: "g1", status })]
    const { result, rerender } = renderHook(
      ({ operations }: { operations: Operation[] }) => useIncidentStatusWorkflow({
        operations,
        materials: [],
        groups: [{ id: "g1", stopIds: ["stop-1"] }] as never,
        changeStatusToTop,
        getGroupResources: () => routeMaterial,
        removeMaterial: vi.fn(),
        unassignGroupResource,
      }),
      { initialProps: { operations: only("returning") } },
    )

    act(() => result.current.requestCompletion("stop-1"))
    await waitFor(() => expect(result.current.materialAnswersLoading).toBe(false))
    act(() => result.current.setMaterialDecision("motorsaege", "magazin"))
    let done: Promise<unknown> = Promise.resolve()
    act(() => { done = result.current.resolveMaterialDecision(null) })
    rerender({ operations: only("active") })
    await act(async () => {
      write.settle(true)
      await done
    })
    expect(unassignGroupResource).not.toHaveBeenCalled()
  })

  it("starts nothing when the finished stop was reopened during the write", async () => {
    const write = deferred()
    const changeStatusToTop = vi.fn<(operationId: string, status: OperationStatus, extra?: Partial<Operation>) => Promise<boolean>>(
      (_id, status) => (status === "complete" ? write.promise : Promise.resolve(true)),
    )
    const stops = (first: Operation["status"]) => [
      operation({ id: "stop-1", groupId: "g1", status: first, crew: [crewMember("AdF Eins")] }),
      operation({ id: "stop-2", groupId: "g1", status: "incoming" }),
    ]
    const { result, rerender } = renderHook(
      ({ operations }: { operations: Operation[] }) => useIncidentStatusWorkflow({
        operations,
        materials: [],
        groups: [{ id: "g1", stopIds: ["stop-1", "stop-2"] }] as never,
        changeStatusToTop,
        getGroupResources: () => squadOnRoute,
        removeMaterial: vi.fn(),
        unassignGroupResource: vi.fn(),
      }),
      { initialProps: { operations: stops("returning") } },
    )

    act(() => result.current.requestCompletion("stop-1"))
    let done: Promise<unknown> = Promise.resolve()
    act(() => { done = result.current.resolveMaterialDecision("stop-2") })
    // Another desk put the stop back on «Im Einsatz» before this completion answered.
    rerender({ operations: stops("active") })
    await act(async () => {
      write.settle(true)
      await done
    })
    expect(changeStatusToTop).not.toHaveBeenCalledWith("stop-2", "active")
  })

  it("keeps the route's Geräte on the route when a stop was added during the write", async () => {
    const write = deferred()
    const changeStatusToTop = vi.fn<(operationId: string, status: OperationStatus, extra?: Partial<Operation>) => Promise<boolean>>(
      (_id, status) => (status === "complete" ? write.promise : Promise.resolve(true)),
    )
    const unassignGroupResource = vi.fn()
    const removeMaterial = vi.fn()
    const routeMaterial: GroupResources = {
      ...emptyGroupResources,
      materials: [{ assignmentId: "a1", resourceId: "motorsaege", name: "Motorsäge" }],
    }
    const lastStop = operation({ id: "stop-2", groupId: "g1", status: "returning", materials: ["pumpe"] })
    const { result, rerender } = renderHook(
      ({ operations, groups }: { operations: Operation[]; groups: { id: string; stopIds: string[] }[] }) =>
        useIncidentStatusWorkflow({
          operations,
          materials: [],
          groups: groups as never,
          changeStatusToTop,
          getGroupResources: () => routeMaterial,
          removeMaterial,
          unassignGroupResource,
        }),
      {
        initialProps: {
          operations: [operation({ id: "stop-1", groupId: "g1", status: "complete" }), lastStop],
          groups: [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
        },
      },
    )

    act(() => result.current.requestCompletion("stop-2"))
    await waitFor(() => expect(result.current.materialAnswersLoading).toBe(false))
    act(() => result.current.setMaterialDecision("motorsaege", "magazin"))
    act(() => result.current.setMaterialDecision("pumpe", "magazin"))
    let done: Promise<unknown> = Promise.resolve()
    act(() => { done = result.current.resolveMaterialDecision(null) })
    rerender({
      operations: [
        operation({ id: "stop-1", groupId: "g1", status: "complete" }),
        lastStop,
        operation({ id: "stop-3", groupId: "g1", status: "incoming" }),
      ],
      groups: [{ id: "g1", stopIds: ["stop-1", "stop-2", "stop-3"] }],
    })
    let booked: unknown
    await act(async () => {
      write.settle(true)
      booked = await done
    })
    expect(unassignGroupResource).not.toHaveBeenCalled()
    // The stop's own unit is the stop's: its answer stands – in the release, the rapport and the receipt.
    expect(removeMaterial).toHaveBeenCalledWith("stop-2", "pumpe")
    expect(applyRapportMaterialDecisions).toHaveBeenCalledWith("stop-2", [{ material_id: "pumpe", left_on_site: false }])
    expect(booked).toEqual({ returned: ["pumpe"], kept: [] })
  })
})

describe("the material gate takes the crew's word for it", () => {
  // The crew answered "vor Ort oder ins Magazin" per unit at the Schadenplatz.
  // Asking the operator the same question from scratch at completion asks
  // somebody who was not there to overrule somebody who was.

  const unit = (id: string, extra: Record<string, unknown> = {}) => ({
    assignment_id: `a-${id}`,
    material_id: id,
    name: id,
    location: null,
    used: true,
    answered: true,
    ...extra,
  })

  it("prefills every unit the rapport answered, attributed to its author", async () => {
    getRapportMaterialReturn.mockResolvedValue(rapport({
      returned: [unit("pumpe")],
      left_on_site: [unit("nasssauger")],
      rapport_by: "Muster Hans",
    }))
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["pumpe", "nasssauger"] }))

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialRapportBy).toBe("Muster Hans"))

    const byId = Object.fromEntries(result.current.materialDecisionItems.map((item) => [item.id, item]))
    expect(result.current.materialChoice(byId.pumpe)).toBe("magazin")
    expect(result.current.materialChoice(byId.nasssauger)).toBe("vorort")
    // Nothing left to decide: the dialog is a confirmation, not a questionnaire.
    expect(result.current.materialDecisionOpenCount).toBe(0)
    expect(byId.pumpe.source).toBe("rapport")
  })

  it("still asks about the units the rapport did not answer", async () => {
    // `returned` also carries what nobody looked at — an unanswered row defaults
    // to "not left on site". Treating that as an answer would put words in the
    // crew's mouth about a unit it never saw.
    getRapportMaterialReturn.mockResolvedValue(rapport({
      returned: [unit("pumpe"), unit("leiter", { answered: false })],
      rapport_by: "Muster Hans",
    }))
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["pumpe", "leiter"] }))

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialRapportBy).toBe("Muster Hans"))

    const byId = Object.fromEntries(result.current.materialDecisionItems.map((item) => [item.id, item]))
    expect(byId.pumpe.source).toBe("rapport")
    expect(byId.leiter.source).toBeNull()
    expect(result.current.materialDecisionOpenCount).toBe(1)
  })

  it("never treats a consumable as an open question", async () => {
    // A consumable has no "vor Ort" state at all (decision 26), so the rapport
    // does not carry one and the gate must not ask for one.
    const { result } = renderWorkflow(
      operation({ status: "returning", materials: ["oelbinder"] }),
      emptyGroupResources,
      [],
      ["oelbinder"],
    )

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialDecisionItems).toHaveLength(1))

    const [item] = result.current.materialDecisionItems
    expect(item.consumable).toBe(true)
    expect(item.source).toBe("consumable")
    expect(result.current.materialChoice(item)).toBe("magazin")
    expect(result.current.materialDecisionOpenCount).toBe(0)
  })

  it("an operator click overrules the rapport", async () => {
    getRapportMaterialReturn.mockResolvedValue(rapport({
      left_on_site: [unit("pumpe")],
      rapport_by: "Muster Hans",
    }))
    const { result, removeMaterial } = renderWorkflow(
      operation({ status: "returning", materials: ["pumpe"] }),
    )

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialRapportBy).toBe("Muster Hans"))
    act(() => result.current.setMaterialDecision("pumpe", "magazin"))

    let resolved: { returned: string[]; kept: string[] } | null | undefined
    await act(async () => {
      resolved = await result.current.resolveMaterialDecision(null)
    })
    expect(resolved).toEqual({ returned: ["pumpe"], kept: [] })
    expect(removeMaterial).toHaveBeenCalledWith("incident-1", "pumpe")
  })

  it("releases what the rapport sent back without a single click", async () => {
    getRapportMaterialReturn.mockResolvedValue(rapport({
      returned: [unit("pumpe")],
      left_on_site: [unit("nasssauger")],
      rapport_by: "Muster Hans",
    }))
    const { result, removeMaterial } = renderWorkflow(
      operation({ status: "returning", materials: ["pumpe", "nasssauger"] }),
    )

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialRapportBy).toBe("Muster Hans"))

    let resolved: { returned: string[]; kept: string[] } | null | undefined
    await act(async () => {
      resolved = await result.current.resolveMaterialDecision(null)
    })
    expect(resolved).toEqual({ returned: ["pumpe"], kept: ["nasssauger"] })
    expect(removeMaterial).toHaveBeenCalledExactlyOnceWith("incident-1", "pumpe")
  })

  it("prefills from a DRAFT rapport, and says that it is one (§18.23)", async () => {
    // The bug: a crew fills the checklist on /feld and never presses "Rapport
    // abschliessen" — on a phone, in the rain, that is the normal case. The
    // gate used to throw those answers away and ask the operator from scratch.
    // `left_on_site: true` is the crew saying where a unit stays; since §18.32
    // `used` has no third value, so an answered draft row is one that
    // contradicts the prefill.
    getRapportMaterialReturn.mockResolvedValue(rapport({
      left_on_site: [unit("pumpe", { answered: true })],
      rapport_by: "Muster Hans",
      rapport_is_draft: true,
    }))
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["pumpe"] }))

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialRapportBy).toBe("Muster Hans"))

    const [item] = result.current.materialDecisionItems
    expect(result.current.materialChoice(item)).toBe("vorort")
    expect(result.current.materialDecisionOpenCount).toBe(0)
    // The operator has to be able to weigh a half-finished answer.
    expect(result.current.materialRapportIsDraft).toBe(true)
  })

  it("calls the gate's own door — the release list must not read drafts", async () => {
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["pumpe"] }))
    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() =>
      expect(getRapportMaterialReturn).toHaveBeenCalledWith("incident-1", { includeDraft: true }),
    )
  })

  it("asks from scratch when no rapport was submitted", async () => {
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["pumpe"] }))

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(getRapportMaterialReturn).toHaveBeenCalledWith("incident-1", { includeDraft: true }))

    expect(result.current.materialRapportBy).toBeNull()
    expect(result.current.materialDecisionOpenCount).toBe(1)
    expect(result.current.materialDecisionItems[0].source).toBeNull()
  })

  it("asks nothing about material while the Auftrag still has stops ahead", async () => {
    // The squad is not driving back to the Magazin, it is driving to the next
    // stop — «vor Ort oder ins Magazin?» offers two answers that are both
    // wrong. The route's Geräte must also survive the gate untouched.
    const routeMaterial: GroupResources = {
      personnel: [],
      vehicles: [],
      materials: [{ assignmentId: "a1", resourceId: "motorsaege", name: "Motorsäge" }],
    }
    const { result, unassignGroupResource } = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "returning", crew: [crewMember("AdF Eins")] }),
      routeMaterial,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-2", groupId: "g1", status: "incoming" })],
    )

    act(() => result.current.requestCompletion("stop-1"))

    // The gate still opens — the stop's own crew is handed back and that has to
    // be named — but it is a «Stopp abschliessen», with the next stop on it.
    expect(result.current.materialDecisionOperation?.id).toBe("stop-1")
    expect(result.current.completionContinuation?.next.id).toBe("stop-2")
    expect(result.current.materialDecisionItems).toEqual([])

    let resolved: { returned: string[]; kept: string[] } | null | undefined
    await act(async () => {
      resolved = await result.current.resolveMaterialDecision(null)
    })
    expect(resolved).toEqual({ returned: [], kept: [] })
    expect(unassignGroupResource).not.toHaveBeenCalled()
    expect(applyRapportMaterialDecisions).not.toHaveBeenCalled()
  })

  it("opens for a mid-route stop that hands nothing back, because the route is the subject", () => {
    // The standard Auftrag: crew, vehicles and Geräte belong to the ROUTE, so
    // a stop releases nothing at all. The gate used to return early on exactly
    // that shape — which made «Weiter zu: …» and the offer to start the next
    // stop invisible on the routes they were built for.
    const routeResources: GroupResources = {
      personnel: [{ assignmentId: "a0", resourceId: "p1", name: "Roth Til" }],
      vehicles: [{ assignmentId: "a1", resourceId: "v1", name: "TLF" }],
      materials: [{ assignmentId: "a2", resourceId: "motorsaege", name: "Motorsäge" }],
    }
    const { result } = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "returning" }),
      routeResources,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-2", groupId: "g1", status: "incoming" })],
    )

    act(() => result.current.requestCompletion("stop-1"))

    expect(result.current.materialDecisionOperation?.id).toBe("stop-1")
    // Nothing to list and nothing to decide — the dialog carries the route
    // alone, which is why its description must not promise a release list.
    expect(result.current.completionRelease).toBeNull()
    expect(result.current.materialDecisionItems).toEqual([])
    expect(result.current.completionContinuation?.next.id).toBe("stop-2")
    expect(result.current.completionNextStop?.id).toBe("stop-2")
  })

  it("stays shut when nothing is released and no stop can be started", () => {
    const routeResources: GroupResources = {
      personnel: [{ assignmentId: "a0", resourceId: "p1", name: "Roth Til" }],
      vehicles: [],
      materials: [],
    }

    // The squad is already working another stop of the route, so there is
    // nothing to offer — and with an empty release list, nothing to say.
    const busy = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "returning" }),
      routeResources,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-2", groupId: "g1", status: "active" })],
    )
    act(() => busy.result.current.requestCompletion("stop-1"))
    expect(busy.result.current.materialDecisionOperation).toBeNull()

    // The last stop of a route whose squad is already off it: an Abschluss that
    // hands nothing back is still a one-gesture move. (With a squad still on the
    // route the last stop frees it – see «names the route's squad».)
    const lastStop = renderWorkflow(
      operation({ id: "stop-2", groupId: "g1", status: "returning" }),
      emptyGroupResources,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-1", groupId: "g1", status: "complete" })],
    )
    act(() => lastStop.result.current.requestCompletion("stop-2"))
    expect(lastStop.result.current.materialDecisionOperation).toBeNull()

    // …and an incident that belongs to no Auftrag at all.
    const lone = renderWorkflow(operation({ status: "returning" }))
    act(() => lone.result.current.requestCompletion("incident-1"))
    expect(lone.result.current.materialDecisionOperation).toBeNull()
  })

  it("asks about a grouped stop's own equipment, on the way and at the end (hunt follow-up 25.11.)", async () => {
    // A stop can hold Material of its own («Nur dieser Einsatz»); the server keeps it
    // assigned on completion, so the gate must ask about it like on a lone incident.
    const routeMaterial: GroupResources = {
      personnel: [],
      vehicles: [],
      materials: [{ assignmentId: "a1", resourceId: "motorsaege", name: "Motorsäge" }],
    }
    const midRoute = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "returning", materials: ["pumpe"] }),
      routeMaterial,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-2", groupId: "g1", status: "incoming" })],
    )
    act(() => midRoute.result.current.requestCompletion("stop-1"))
    await waitFor(() => expect(midRoute.result.current.materialAnswersLoading).toBe(false))
    // The route's Motorsäge drives on with the squad; the stop's own pump is asked about.
    expect(midRoute.result.current.materialDecisionItems.map((item) => item.id)).toEqual(["pumpe"])

    const lastStop = renderWorkflow(
      operation({ id: "stop-2", groupId: "g1", status: "returning", materials: ["pumpe"] }),
      routeMaterial,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-1", groupId: "g1", status: "complete" })],
    )
    act(() => lastStop.result.current.requestCompletion("stop-2"))
    await waitFor(() => expect(lastStop.result.current.materialAnswersLoading).toBe(false))
    expect(lastStop.result.current.materialDecisionItems.map((item) => item.id)).toEqual(["motorsaege", "pumpe"])

    act(() => lastStop.result.current.setMaterialDecision("motorsaege", "magazin"))
    act(() => lastStop.result.current.setMaterialDecision("pumpe", "magazin"))
    await confirmAsTheApp(lastStop)
    expect(lastStop.unassignGroupResource).toHaveBeenCalledWith("g1", "a1")
    expect(lastStop.removeMaterial).toHaveBeenCalledWith("stop-2", "pumpe")
  })

  it("asks about the route's material once the last open stop closes", async () => {
    const routeMaterial: GroupResources = {
      personnel: [],
      vehicles: [],
      materials: [{ assignmentId: "a1", resourceId: "motorsaege", name: "Motorsäge" }],
    }
    const rendered = renderWorkflow(
      operation({ id: "stop-2", groupId: "g1", status: "returning" }),
      routeMaterial,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-1", groupId: "g1", status: "complete" })],
    )
    const { result, unassignGroupResource } = rendered

    act(() => result.current.requestCompletion("stop-2"))
    await waitFor(() => expect(result.current.materialDecisionItems).toHaveLength(1))
    expect(result.current.completionContinuation).toBeNull()

    act(() => result.current.setMaterialDecision("motorsaege", "magazin"))
    await confirmAsTheApp(rendered)
    expect(unassignGroupResource).toHaveBeenCalledWith("g1", "a1")
  })

  it("offers the next stop from the completion gate, and starts the one it named", () => {
    // Dragging a stop straight to «Abgeschlossen» skips the «Nächsten Stopp
    // starten?» prompt, which only fires on the way through «Beendet». The gate
    // already NAMES the next stop, so it carries the same offer.
    const { result, changeStatusToTop } = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "returning", crew: [crewMember("AdF Eins")] }),
      squadOnRoute,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-2", groupId: "g1", status: "incoming" })],
    )

    act(() => result.current.requestCompletion("stop-1"))
    expect(result.current.completionNextStop?.id).toBe("stop-2")
    // The offer names exactly the stop the dialog prints as «Weiter zu: …».
    expect(result.current.completionNextStop?.id).toBe(result.current.completionContinuation?.next.id)

    act(() => result.current.startNextStop("stop-2"))
    expect(changeStatusToTop).toHaveBeenLastCalledWith("stop-2", "active")
  })

  it("offers nothing on the last stop, on a lone incident, or while the squad is working", () => {
    const lastStop = renderWorkflow(
      operation({ id: "stop-2", groupId: "g1", status: "returning", crew: [crewMember("AdF Eins")] }),
      emptyGroupResources,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-1", groupId: "g1", status: "complete" })],
    )
    act(() => lastStop.result.current.requestCompletion("stop-2"))
    expect(lastStop.result.current.completionContinuation).toBeNull()
    expect(lastStop.result.current.completionNextStop).toBeNull()

    const lone = renderWorkflow(operation({ status: "returning", crew: [crewMember("AdF Eins")] }))
    act(() => lone.result.current.requestCompletion("incident-1"))
    expect(lone.result.current.completionNextStop).toBeNull()

    // The route continues, so the gate is still a «Stopp abschliessen» — but
    // another stop is already in Einsatz, so there is nothing to send anybody to.
    const busy = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "returning", crew: [crewMember("AdF Eins")] }),
      emptyGroupResources,
      [{ id: "g1", stopIds: ["stop-1", "stop-2", "stop-3"] }],
      [],
      [
        operation({ id: "stop-2", groupId: "g1", status: "active" }),
        operation({ id: "stop-3", groupId: "g1", status: "incoming" }),
      ],
    )
    act(() => busy.result.current.requestCompletion("stop-1"))
    expect(busy.result.current.completionContinuation?.next.id).toBe("stop-2")
    expect(busy.result.current.completionNextStop).toBeNull()
  })

  it("keeps offering the same stop from the «Beendet» prompt", () => {
    // The other half of the pair: both offers read one rule, so a stop finished
    // either way sends the squad to the same place.
    const { result, changeStatusToTop } = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "active", zuFuss: true }),
      squadOnRoute,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-2", groupId: "g1", status: "incoming" })],
    )

    act(() => result.current.requestStatusChange("stop-1", "returning"))
    expect(result.current.nextStopPrompt?.next.id).toBe("stop-2")

    act(() => result.current.startNextStop("stop-2"))
    expect(changeStatusToTop).toHaveBeenLastCalledWith("stop-2", "active")
    expect(result.current.nextStopPrompt).toBeNull()
  })

  it("falls back to asking when the rapport cannot be read", async () => {
    getRapportMaterialReturn.mockRejectedValue(new Error("offline"))
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["pumpe"] }))

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(getRapportMaterialReturn).toHaveBeenCalledWith("incident-1", { includeDraft: true }))

    expect(result.current.materialDecisionOperation?.id).toBe("incident-1")
    expect(result.current.materialRapportBy).toBeNull()
    expect(result.current.materialDecisionOpenCount).toBe(1)
  })
})
