import { describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { useAssignmentConflicts, type AssignmentConflictInputs } from "./use-assignment-conflicts"
import { askAuftragStop, type AuftragStopQuestion } from "@/lib/auftrag-stop-question"

vi.mock("@/lib/auftrag-stop-question", () => ({ askAuftragStop: vi.fn() }))

type Conflict = Parameters<AssignmentConflictInputs["requestResourceConflict"]>[0]

const group = (id: string, name: string, assignments: { id: string; resourceType: string; resourceId: string }[] = []) =>
  ({ id, name, assignments }) as unknown as AssignmentConflictInputs["groups"][number]

const op = (id: string, location: string, extra: Record<string, unknown> = {}) =>
  ({ id, location, vehicles: [], crew: [], materials: [], ...extra }) as unknown as AssignmentConflictInputs["operations"][number]

function setup(overrides: Partial<AssignmentConflictInputs> = {}) {
  const inputs: AssignmentConflictInputs = {
    vehicleTypes: [{ id: "v-tlf", name: "TLF" }],
    groups: [],
    operations: [],
    requestResourceConflict: vi.fn(),
    assignGroupResource: vi.fn().mockResolvedValue(true),
    unassignGroupResource: vi.fn().mockResolvedValue(true),
    removeVehicle: vi.fn().mockResolvedValue(true),
    assignVehicleToOperation: vi.fn(),
    ...overrides,
  }
  const { result } = renderHook(() => useAssignmentConflicts(inputs))
  const asked = () => (inputs.requestResourceConflict as ReturnType<typeof vi.fn>).mock.calls.map(([c]) => c as Conflict)
  return { inputs, hook: result.current, asked }
}

describe("useAssignmentConflicts — a vehicle onto an Auftrag", () => {
  it("assigns straight away when nobody else holds it", () => {
    const { inputs, hook, asked } = setup()
    hook.assignVehicleToGroupWithConflict("g-1", "v-tlf")
    expect(inputs.assignGroupResource).toHaveBeenCalledWith("g-1", "vehicle", "v-tlf")
    expect(asked()).toEqual([])
  })

  it("does nothing for a vehicle the board does not know", () => {
    const { inputs, hook } = setup()
    hook.assignVehicleToGroupWithConflict("g-1", "v-gone")
    expect(inputs.assignGroupResource).not.toHaveBeenCalled()
  })

  it("asks once, naming the other route and the incident, and «move» frees both first", async () => {
    const { inputs, hook, asked } = setup({
      groups: [group("g-1", "Nord"), group("g-2", "Süd", [{ id: "ga-1", resourceType: "vehicle", resourceId: "v-tlf" }])],
      operations: [op("op-1", "Hauptstrasse 1", { vehicles: [{ vehicleId: "v-tlf", assignmentId: "a-tlf", name: "TLF", callsign: null }] })],
    })
    hook.assignVehicleToGroupWithConflict("g-1", "v-tlf")
    expect(inputs.assignGroupResource).not.toHaveBeenCalled()
    const [conflict] = asked()
    expect(conflict).toMatchObject({ resourceType: "vehicle", resourceId: "v-tlf", resourceName: "TLF", targetOperationId: "g-1" })
    expect(conflict.conflicts.map((c) => c.operationId)).toEqual(["g-2", "op-1"])
    expect(conflict.conflicts[0].operationLabel).toBe("Süd")

    await conflict.customResolve!("move")
    expect(inputs.unassignGroupResource).toHaveBeenCalledWith("g-2", "ga-1")
    expect(inputs.removeVehicle).toHaveBeenCalledWith("op-1", "v-tlf")
    expect(inputs.assignGroupResource).toHaveBeenCalledWith("g-1", "vehicle", "v-tlf")
  })

  it("a failed release stops the move before it double-books", async () => {
    const { inputs, hook, asked } = setup({
      groups: [group("g-2", "Süd", [{ id: "ga-1", resourceType: "vehicle", resourceId: "v-tlf" }])],
      unassignGroupResource: vi.fn().mockResolvedValue(false),
    })
    hook.assignVehicleToGroupWithConflict("g-1", "v-tlf")
    await asked()[0].customResolve!("move")
    expect(inputs.assignGroupResource).not.toHaveBeenCalled()
  })

  it("«keep» assigns without releasing anything", async () => {
    const { inputs, hook, asked } = setup({ operations: [op("op-1", "Hauptstrasse 1", { vehicles: [{ vehicleId: "v-tlf", assignmentId: "a-tlf", name: "TLF", callsign: null }] })] })
    hook.assignVehicleToGroupWithConflict("g-1", "v-tlf")
    await asked()[0].customResolve!("keep")
    expect(inputs.removeVehicle).not.toHaveBeenCalled()
    expect(inputs.assignGroupResource).toHaveBeenCalledWith("g-1", "vehicle", "v-tlf")
  })
})

describe("useAssignmentConflicts — a vehicle onto an incident", () => {
  it("hands off to the provider when no route holds it (the provider asks about incidents)", () => {
    const { inputs, hook, asked } = setup()
    hook.assignVehicleToIncidentWithConflict("v-tlf", "TLF", "op-1")
    expect(inputs.assignVehicleToOperation).toHaveBeenCalledWith("v-tlf", "TLF", "op-1")
    expect(asked()).toEqual([])
  })

  // Owner pick #23: the vehicle drives Auftrag «Süd» – the lone Einsatz may belong on that route.
  it("asks to take a lone Einsatz into the Auftrag that holds the vehicle", async () => {
    vi.mocked(askAuftragStop).mockClear()
    const { inputs, hook, asked } = setup({
      groups: [group("g-2", "Süd", [{ id: "ga-1", resourceType: "vehicle", resourceId: "v-tlf" }])],
      operations: [op("op-1", "Blumenweg 21", { number: 2, incidentType: "elementarereignis", notes: "Wasser im Keller" })],
    })
    expect(hook.assignVehicleToIncidentWithConflict("v-tlf", "TLF", "op-1")).toBe(true)
    expect(asked()).toEqual([])
    expect(inputs.assignVehicleToOperation).not.toHaveBeenCalled()
    const [[question]] = vi.mocked(askAuftragStop).mock.calls as [[AuftragStopQuestion]]
    // Number and place, no type, no Meldung – the card names it like the board (#14, 23.11.).
    expect(question).toMatchObject({ groupId: "g-2", groupName: "Süd", incidentId: "op-1", incidentLabel: "2 · Blumenweg 21", vehicleName: "TLF" })
    expect(question.alsoOn).toEqual([])
    await question.assignOnly()
    expect(inputs.assignVehicleToOperation).toHaveBeenCalledWith("v-tlf", "TLF", "op-1", true)
  })

  // Sol review E, S4: «Nur zusätzlich zuweisen» used to open the Einsatz move/keep question next.
  it("names an Einsatz that has the vehicle too in the same question, and «keep» does not ask again", async () => {
    vi.mocked(askAuftragStop).mockClear()
    const tlf = { vehicles: [{ vehicleId: "v-tlf", assignmentId: "a-tlf", name: "TLF", callsign: null }] }
    const { inputs, hook } = setup({
      groups: [group("g-2", "Süd", [{ id: "ga-1", resourceType: "vehicle", resourceId: "v-tlf" }])],
      operations: [op("op-1", "Blumenweg 21", { number: 2 }), op("op-9", "Schulstrasse 9", { number: 13, ...tlf })],
    })
    hook.assignVehicleToIncidentWithConflict("v-tlf", "TLF", "op-1")
    const [[question]] = vi.mocked(askAuftragStop).mock.calls as [[AuftragStopQuestion]]
    expect(question.alsoOn).toEqual([{ id: "op-9", label: "13 · Schulstrasse 9" }])
    await question.assignOnly()
    // force: the answer already covered op-9.
    expect(inputs.assignVehicleToOperation).toHaveBeenCalledExactlyOnceWith("v-tlf", "TLF", "op-1", true)
  })

  // Sol review E round 2, S2: the second Auftrag fell off the question and its «N×».
  it("names a second Auftrag that has the vehicle too, before the Einsätze", () => {
    vi.mocked(askAuftragStop).mockClear()
    const tlf = { vehicles: [{ vehicleId: "v-tlf", assignmentId: "a-tlf", name: "TLF", callsign: null }] }
    const { hook } = setup({
      groups: [
        group("g-2", "Süd", [{ id: "ga-1", resourceType: "vehicle", resourceId: "v-tlf" }]),
        group("g-3", "Nord", [{ id: "ga-2", resourceType: "vehicle", resourceId: "v-tlf" }]),
      ],
      operations: [op("op-1", "Blumenweg 21", { number: 2 }), op("op-9", "Schulstrasse 9", { number: 13, ...tlf })],
    })
    hook.assignVehicleToIncidentWithConflict("v-tlf", "TLF", "op-1")
    const [[question]] = vi.mocked(askAuftragStop).mock.calls as [[AuftragStopQuestion]]
    expect(question.groupId).toBe("g-2")
    expect(question.alsoOn).toEqual([{ id: "g-3", label: "Nord" }, { id: "op-9", label: "13 · Schulstrasse 9" }])
  })

  it("a grouped Einsatz asks once about the Auftrag AND the other Einsatz; «move» frees both", async () => {
    const tlf = { vehicles: [{ vehicleId: "v-tlf", assignmentId: "a-tlf", name: "TLF", callsign: null }] }
    const { inputs, hook, asked } = setup({
      groups: [group("g-2", "Süd", [{ id: "ga-1", resourceType: "vehicle", resourceId: "v-tlf" }])],
      operations: [op("op-1", "Rebgasse 8", { groupId: "g-9" }), op("op-9", "Schulstrasse 9", { number: 13, ...tlf })],
    })
    hook.assignVehicleToIncidentWithConflict("v-tlf", "TLF", "op-1")
    const [conflict] = asked()
    expect(conflict.conflicts.map((c) => c.operationId)).toEqual(["g-2", "op-9"])
    await conflict.customResolve!("move")
    expect(inputs.unassignGroupResource).toHaveBeenCalledWith("g-2", "ga-1")
    expect(inputs.removeVehicle).toHaveBeenCalledWith("op-9", "v-tlf")
    expect(inputs.assignVehicleToOperation).toHaveBeenCalledExactlyOnceWith("v-tlf", "TLF", "op-1", true)
  })

  it("asks move/keep when a route holds it and the Einsatz is on another Auftrag; «move» detaches it first", async () => {
    const { inputs, hook, asked } = setup({
      groups: [group("g-2", "Süd", [{ id: "ga-1", resourceType: "vehicle", resourceId: "v-tlf" }])],
      operations: [op("op-1", "Rebgasse 8", { groupId: "g-9" })],
    })
    hook.assignVehicleToIncidentWithConflict("v-tlf", "TLF", "op-1")
    const [conflict] = asked()
    expect(conflict.conflicts).toEqual([{ operationId: "g-2", operationLabel: "Süd" }])
    await conflict.customResolve!("move")
    expect(inputs.unassignGroupResource).toHaveBeenCalledWith("g-2", "ga-1")
    expect(inputs.assignVehicleToOperation).toHaveBeenCalledWith("v-tlf", "TLF", "op-1", true)
  })
})

describe("useAssignmentConflicts — people and material held by a route", () => {
  it("groupsHolding names the routes that hold it, except the one it is going to", () => {
    const { hook } = setup({
      groups: [
        group("g-1", "Nord", [{ id: "a", resourceType: "personnel", resourceId: "p-1" }]),
        group("g-2", "Süd", [{ id: "b", resourceType: "personnel", resourceId: "p-1" }]),
        group("g-3", "West", [{ id: "c", resourceType: "material", resourceId: "p-1" }]),
      ],
    })
    expect(hook.groupsHolding("personnel", "p-1").map((g) => g.id)).toEqual(["g-1", "g-2"])
    expect(hook.groupsHolding("personnel", "p-1", "g-2").map((g) => g.id)).toEqual(["g-1"])
  })

  it("one drop of three devices is ONE question naming all three, and «move» frees then assigns in order", async () => {
    const holder = group("g-2", "Süd", [
      { id: "a-1", resourceType: "material", resourceId: "m-1" },
      { id: "a-2", resourceType: "material", resourceId: "m-2" },
    ])
    const { inputs, hook, asked } = setup({ groups: [holder] })
    const order: string[] = []
    for (const [id, name] of [["m-1", "Säge"], ["m-2", "Pumpe"], ["m-3", "Sauger"]] as const) {
      hook.askRouteConflict({
        resourceType: "material",
        resourceId: id,
        resourceName: name,
        targetId: "op-1",
        conflicts: [{ operationId: "g-2", operationLabel: "Süd" }],
        releases: hook.releaseFromGroups("material", id, [holder]),
        assign: () => {
          order.push(id)
        },
      })
    }
    // Batched to the end of the tick: nothing asked yet.
    expect(asked()).toEqual([])
    await Promise.resolve()
    expect(asked()).toHaveLength(1)
    const [conflict] = asked()
    expect(conflict.resourceName).toBe("Säge, Pumpe, Sauger")
    expect(conflict.resourceId).toBe("m-1")
    expect(conflict.targetOperationId).toBe("op-1")
    // Every holder once, with the dropped devices that sit on it.
    expect(conflict.conflicts).toEqual([
      {
        operationId: "g-2",
        operationLabel: "Süd",
        held: [{ id: "m-1", name: "Säge" }, { id: "m-2", name: "Pumpe" }, { id: "m-3", name: "Sauger" }],
      },
    ])

    await conflict.customResolve!("move")
    expect(inputs.unassignGroupResource).toHaveBeenCalledWith("g-2", "a-1")
    expect(inputs.unassignGroupResource).toHaveBeenCalledWith("g-2", "a-2")
    expect(order).toEqual(["m-1", "m-2", "m-3"])
  })

  // Sol review E, S5: the Säge on Auftrag Süd, the Pumpe on Einsatz 11 – each card keeps its own.
  it("keeps which dropped device stands on which holder", async () => {
    const { hook, asked } = setup()
    for (const [id, name, holder] of [["m-1", "Säge", { operationId: "g-2", operationLabel: "Süd" }], ["m-2", "Pumpe", { operationId: "op-11", operationLabel: "11 · Bahnhofstrasse 12" }]] as const) {
      hook.askRouteConflict({ resourceType: "material", resourceId: id, resourceName: name, targetId: "g-1", conflicts: [holder], releases: [], assign: () => {} })
    }
    await Promise.resolve()
    expect(asked()[0].conflicts.map((c) => [c.operationId, c.held?.map((r) => r.name)])).toEqual([
      ["g-2", ["Säge"]],
      ["op-11", ["Pumpe"]],
    ])
  })

  it("a failed release cancels the whole drop", async () => {
    const holder = group("g-2", "Süd", [{ id: "a-1", resourceType: "personnel", resourceId: "p-1" }])
    const { hook, asked } = setup({ groups: [holder], unassignGroupResource: vi.fn().mockResolvedValue(false) })
    const assign = vi.fn()
    hook.askRouteConflict({
      resourceType: "personnel",
      resourceId: "p-1",
      resourceName: "Muster",
      targetId: "op-1",
      conflicts: [{ operationId: "g-2", operationLabel: "Süd" }],
      releases: hook.releaseFromGroups("personnel", "p-1", [holder]),
      assign,
    })
    await Promise.resolve()
    await asked()[0].customResolve!("move")
    expect(assign).not.toHaveBeenCalled()
  })

  it("two separate drops are two questions", async () => {
    const { hook, asked } = setup()
    const entry = (id: string) => ({
      resourceType: "personnel" as const,
      resourceId: id,
      resourceName: id,
      targetId: "op-1",
      conflicts: [{ operationId: "g-2", operationLabel: "Süd" }],
      releases: [],
      assign: () => {},
    })
    hook.askRouteConflict(entry("p-1"))
    await Promise.resolve()
    hook.askRouteConflict(entry("p-2"))
    await Promise.resolve()
    expect(asked().map((c) => c.resourceName)).toEqual(["p-1", "p-2"])
  })
})
