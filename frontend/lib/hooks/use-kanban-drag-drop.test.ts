import { beforeEach, describe, expect, it, vi } from "vitest"
import { applyResourceDrop } from "@/lib/hooks/use-kanban-drag-drop"
import type { Material, Operation, Person } from "@/lib/contexts/operations-context"

const ungrouped = { id: "op-2", status: "incoming", crew: [], materials: [] } as unknown as Operation

const assignPersonToOperation = vi.fn()
const assignMaterialToOperation = vi.fn()
const assignGroupResource = vi.fn()

const deps = (occupiedMaterialIds: string[] = []) => ({
  operations: [ungrouped],
  assignPersonToOperation,
  assignRekoPersonToOperation: vi.fn(),
  assignMaterialToOperation,
  assignGroupResource,
  occupiedGroupResourceIds: {
    material: new Set(occupiedMaterialIds),
    personnel: new Set<string>(),
    vehicle: new Set<string>(),
  },
})

const onCard = { type: "operation-drop", operationId: "op-2", index: 0 }
const busyMaterial = { id: "m-1", name: "Tauchpumpe", status: "assigned", consumable: false } as unknown as Material
const busyPerson = { id: "p-1", name: "Muster Hans", status: "assigned" } as unknown as Person

beforeEach(() => {
  assignPersonToOperation.mockClear()
  assignMaterialToOperation.mockClear()
  assignGroupResource.mockClear()
})

// The Doppelbelegung prompt lives in operations-context. A drop that never gets
// there is a drag the operator makes and the board silently ignores.
describe("applyResourceDrop", () => {
  it("hands material that is already on another incident to the assign call", () => {
    expect(applyResourceDrop({ type: "material", material: busyMaterial }, onCard, deps())).toBe(true)
    expect(assignMaterialToOperation).toHaveBeenCalledWith("m-1", "op-2")
  })

  it("hands a person who is already on another incident to the assign call", () => {
    expect(applyResourceDrop({ type: "person", person: busyPerson }, onCard, deps())).toBe(true)
    expect(assignPersonToOperation).toHaveBeenCalledWith("p-1", "Muster Hans", "op-2")
  })

  it("still refuses material an Auftrag holds — that conflict has no prompt", () => {
    applyResourceDrop({ type: "material", material: busyMaterial }, onCard, deps(["m-1"]))
    expect(assignMaterialToOperation).not.toHaveBeenCalled()
  })

  it("leaves an operation card being moved to the monitor", () => {
    const source = { type: "operation", operation: ungrouped, index: 0 }
    expect(applyResourceDrop(source, onCard, deps())).toBe(false)
  })
})
