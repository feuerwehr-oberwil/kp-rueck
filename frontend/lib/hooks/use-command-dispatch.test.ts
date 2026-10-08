import { describe, expect, it, vi } from "vitest"

import type { DispatchResource } from "@/lib/command-dispatch"
import type { Operation } from "@/lib/contexts/operations-context"
import type { GroupResources } from "@/lib/types/groups"

import { holding, runDispatch, type CommandDispatchDeps, type DispatchCommand } from "./use-command-dispatch"

const EMPTY: GroupResources = { vehicles: [], personnel: [], materials: [] }

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "inc-14",
    number: 14,
    status: "incoming",
    priority: "medium",
    crew: [],
    vehicles: [],
    materials: [],
    groupId: null,
    assignedReko: null,
    ...overrides,
  } as Operation
}

const TLF: DispatchResource = { kind: "vehicle", id: "v-tlf", name: "TLF", incidentIds: [], outOfService: false }
const MUSTER: DispatchResource = { kind: "person", id: "p-muster", name: "Muster Peter", incidentIds: [] }
const PUMPE: DispatchResource = { kind: "material", id: "m-pumpe", name: "Tauchpumpe", incidentIds: [], outOfService: false }

function command(overrides: Partial<DispatchCommand> = {}): DispatchCommand {
  return {
    kind: "dispatch",
    incident: { id: "inc-14", number: 14, label: "Bachweg 3", status: "incoming", priority: "medium" },
    assign: [TLF, MUSTER].map((target) => ({ target, alreadyHere: false, elsewhere: [] })),
    status: null,
    priority: null,
    noop: false,
    ...overrides,
  }
}

/** A tiny board: assigning lands immediately, unless `refuse` names the resource. */
function board(start: Operation, { refuse = [] as string[], askFor = [] as string[], askLate = [] as string[] } = {}) {
  let current = start
  let question = false
  const order: string[] = []
  const deps: CommandDispatchDeps = {
    getOperation: () => current,
    getGroupResources: () => EMPTY,
    isQuestionOpen: () => question,
    assign: (resource) => {
      order.push(`assign:${resource.name}`)
      if (askFor.includes(resource.name)) {
        // The conflict prompt opens; the operator answers «verschieben» later.
        question = true
        setTimeout(() => {
          order.push(`answer:${resource.name}`)
          question = false
          land(resource)
        }, 5)
        return
      }
      if (refuse.includes(resource.name)) return
      land(resource)
      if (askLate.includes(resource.name)) {
        // The driver prompt: it lands first, and asks a few round trips later.
        setTimeout(() => {
          order.push(`late-question:${resource.name}`)
          question = true
          setTimeout(() => {
            order.push(`late-answer:${resource.name}`)
            question = false
          }, 5)
        }, 4)
      }
    },
    setPriority: (_id, priority) => {
      order.push(`priority:${priority}`)
      current = { ...current, priority }
    },
    moveStatus: (_id, status) => {
      order.push(`status:${status}`)
      current = { ...current, status }
    },
    revertPriority: (_id, priority) => {
      current = { ...current, priority }
    },
    revertStatus: (_id, status) => {
      current = { ...current, status }
    },
    removeCrew: vi.fn((_id: string, name: string) => {
      current = { ...current, crew: current.crew.filter((entry) => entry !== name) }
    }),
    removeReko: vi.fn(),
    removeVehicle: vi.fn((_id: string, name: string) => {
      current = { ...current, vehicles: current.vehicles.filter((entry) => entry !== name) }
    }),
    removeMaterial: vi.fn(),
    unassignGroupResource: vi.fn(),
    report: vi.fn(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 1))),
  }
  function land(resource: DispatchResource) {
    if (resource.kind === "person") current = { ...current, crew: [...current.crew, resource.name] }
    if (resource.kind === "vehicle") current = { ...current, vehicles: [...current.vehicles, resource.name] }
    if (resource.kind === "material") current = { ...current, materials: [...current.materials, resource.id] }
  }
  return {
    deps,
    order,
    get current() {
      return current
    },
    set current(next: Operation) {
      current = next
    },
  }
}

describe("runDispatch", () => {
  it("assigns every resource through the drop path and reports what landed", async () => {
    const b = board(operation())
    const outcome = await runDispatch(command(), b.deps)
    expect(b.order).toEqual(["assign:TLF", "assign:Muster Peter"])
    expect(outcome?.assigned.map((resource) => resource.id)).toEqual(["v-tlf", "p-muster"])
    expect(b.deps.report).toHaveBeenCalledTimes(1)
  })

  it("asks one question at a time: the next resource waits for the prompt", async () => {
    const b = board(operation(), { askFor: ["TLF"] })
    await runDispatch(command(), b.deps)
    expect(b.order).toEqual(["assign:TLF", "answer:TLF", "assign:Muster Peter"])
  })

  it("waits for a question that comes late, like the driver prompt after a vehicle", async () => {
    const b = board(operation(), { askLate: ["TLF"] })
    await runDispatch(command(), b.deps)
    expect(b.order).toEqual(["assign:TLF", "late-question:TLF", "late-answer:TLF", "assign:Muster Peter"])
  })

  it("leaves alone what is already there and does not claim it", async () => {
    const b = board(operation({ vehicles: ["TLF"] }))
    const outcome = await runDispatch(command(), b.deps)
    expect(b.order).toEqual(["assign:Muster Peter"])
    expect(outcome?.assigned.map((resource) => resource.id)).toEqual(["p-muster"])
  })

  it("reports only what landed — a refused or cancelled resource is not claimed", async () => {
    const b = board(operation(), { refuse: ["TLF"] })
    const outcome = await runDispatch(command(), b.deps)
    expect(outcome?.assigned.map((resource) => resource.id)).toEqual(["p-muster"])
  })

  it("says nothing when nothing changed", async () => {
    const b = board(operation(), { refuse: ["TLF", "Muster Peter"] })
    expect(await runDispatch(command(), b.deps)).toBeNull()
    expect(b.deps.report).not.toHaveBeenCalled()
  })

  it("moves the status last, after the crew is on", async () => {
    const b = board(operation())
    await runDispatch(command({ status: "enroute", priority: "high" }), b.deps)
    expect(b.order).toEqual(["assign:TLF", "assign:Muster Peter", "priority:high", "status:enroute"])
  })
})

describe("undo", () => {
  async function dispatched(start = operation(), extra: Partial<DispatchCommand> = {}) {
    const b = board(start)
    await runDispatch(command({ assign: [TLF, MUSTER, PUMPE].map((target) => ({ target, alreadyHere: false, elsewhere: [] })), ...extra }), b.deps)
    const undo = (b.deps.report as ReturnType<typeof vi.fn>).mock.calls[0][1] as () => Promise<void>
    return { b, undo }
  }

  it("takes off exactly what the command put on", async () => {
    const { b, undo } = await dispatched(operation({ crew: ["Schon Da"] }))
    await undo()
    expect(b.deps.removeVehicle).toHaveBeenCalledWith("inc-14", "TLF")
    expect(b.deps.removeCrew).toHaveBeenCalledWith("inc-14", "Muster Peter")
    expect(b.deps.removeMaterial).toHaveBeenCalledWith("inc-14", "m-pumpe")
    expect(b.current.crew).toEqual(["Schon Da"])
  })

  it("does not touch a resource somebody already took off meanwhile", async () => {
    const { b, undo } = await dispatched()
    b.current = { ...b.current, vehicles: [] }
    await undo()
    expect(b.deps.removeVehicle).not.toHaveBeenCalled()
  })

  it("puts status and priority back only while they still read what it set", async () => {
    const first = await dispatched(operation(), { status: "active", priority: "high" })
    await first.undo()
    expect(first.b.current).toMatchObject({ status: "incoming", priority: "medium" })

    const second = await dispatched(operation(), { status: "active", priority: "high" })
    // Another operator moved it on and lowered it in between.
    second.b.current = { ...second.b.current, status: "returning", priority: "low" }
    await second.undo()
    expect(second.b.current).toMatchObject({ status: "returning", priority: "low" })
  })
})

describe("holding", () => {
  it("finds a person as crew, as Reko, or on the Auftrag of a grouped stop", () => {
    const resources: GroupResources = {
      ...EMPTY,
      personnel: [{ assignmentId: "ga-1", resourceId: "p-muster", name: "Muster Peter" }],
    }
    expect(holding(operation({ crew: ["Muster Peter"] }), MUSTER, () => EMPTY)).toEqual({ where: "crew" })
    expect(holding(operation({ assignedReko: { id: "p-muster", name: "Muster Peter" } }), MUSTER, () => EMPTY)).toEqual({
      where: "reko",
    })
    expect(holding(operation({ groupId: "g-1" }), MUSTER, () => resources)).toEqual({
      where: "route",
      groupId: "g-1",
      assignmentId: "ga-1",
    })
    expect(holding(operation(), MUSTER, () => resources)).toBeNull()
  })
})
