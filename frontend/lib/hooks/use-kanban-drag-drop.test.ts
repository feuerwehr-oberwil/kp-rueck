import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  applyOperationDrop,
  applyResourceDrop,
  reorderWithinColumn,
} from "@/lib/hooks/use-kanban-drag-drop"
import type { Material, Operation, Person } from "@/lib/contexts/operations-context"

const ungrouped = { id: "op-2", status: "incoming", crew: [], materials: [] } as unknown as Operation
/** A stop of an Auftrag — the case where a drop used to vanish. */
const stop = {
  id: "op-3",
  status: "incoming",
  groupId: "grp-1",
  crew: [],
  materials: [],
} as unknown as Operation

const assignPersonToOperation = vi.fn()
const assignMaterialToOperation = vi.fn()
const assignGroupResource = vi.fn()

const notifyRefused = vi.fn()

const deps = (occupiedMaterialIds: string[] = [], occupiedPersonnelIds: string[] = []) => ({
  operations: [ungrouped, stop],
  assignPersonToOperation,
  assignRekoPersonToOperation: vi.fn(),
  assignMaterialToOperation,
  assignGroupResource,
  occupiedGroupResourceIds: {
    material: new Set(occupiedMaterialIds),
    personnel: new Set(occupiedPersonnelIds),
    vehicle: new Set<string>(),
  },
  notifyRefused,
})

const onCard = { type: "operation-drop", operationId: "op-2", index: 0 }
const onStop = { type: "operation-drop", operationId: "op-3", index: 0 }
const busyMaterial = { id: "m-1", name: "Tauchpumpe", status: "assigned", consumable: false } as unknown as Material
const busyPerson = { id: "p-1", name: "Muster Hans", status: "assigned" } as unknown as Person

beforeEach(() => {
  assignPersonToOperation.mockClear()
  assignMaterialToOperation.mockClear()
  assignGroupResource.mockClear()
  notifyRefused.mockClear()
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

  // The same rule on a STOP of an Auftrag. This path kept the
  // `status === "available"` check the incident path had already dropped, so a
  // busy person dropped on a stop did nothing whatsoever: no assignment, no
  // prompt, no message. That is what "drag and drop doesn't work" was.
  it("puts a person who is busy elsewhere on the stop's Auftrag", () => {
    expect(applyResourceDrop({ type: "person", person: busyPerson }, onStop, deps())).toBe(true)
    expect(assignGroupResource).toHaveBeenCalledWith("grp-1", "personnel", "p-1")
    expect(notifyRefused).not.toHaveBeenCalled()
  })

  it("refuses a person another Auftrag already holds — and says so", () => {
    applyResourceDrop({ type: "person", person: busyPerson }, onStop, deps([], ["p-1"]))
    expect(assignGroupResource).not.toHaveBeenCalled()
    expect(notifyRefused).toHaveBeenCalledWith("route-occupied")
  })

  it("refuses material another Auftrag holds — and says so", () => {
    applyResourceDrop({ type: "material", material: busyMaterial }, onStop, deps(["m-1"]))
    expect(assignGroupResource).not.toHaveBeenCalled()
    expect(notifyRefused).toHaveBeenCalledWith("route-occupied")
  })

  it("leaves an operation card being moved to the monitor", () => {
    const source = { type: "operation", operation: ungrouped, index: 0 }
    expect(applyResourceDrop(source, onCard, deps())).toBe(false)
  })
})

const card = (id: string, status: string) =>
  ({ id, status, crew: [], materials: [] }) as unknown as Operation

describe("reorderWithinColumn", () => {
  const column = [card("a", "incoming"), card("b", "incoming"), card("c", "incoming")]

  it("shifts a card dropped on its OWN bottom edge down by one", () => {
    // Exactly what a 3px wobble produced. It is why the monitor's guard asks
    // "is the target the dragged card?" rather than comparing orders — this
    // drop does change the order, it just changes it against the operator's
    // intent.
    expect(reorderWithinColumn(column, "a", 0, 0, "bottom").map(op => op.id)).toEqual(["b", "a", "c"])
  })

  it("moves a card down, below the card it was dropped on", () => {
    expect(reorderWithinColumn(column, "a", 0, 2, "bottom").map(op => op.id)).toEqual(["b", "c", "a"])
  })

  it("moves a card up, above the card it was dropped on", () => {
    expect(reorderWithinColumn(column, "c", 2, 0, "top").map(op => op.id)).toEqual(["c", "a", "b"])
  })
})

// A drag that changed nothing must not write, and must not eat the click that
// was clearly intended (§B4).
describe("applyOperationDrop", () => {
  const operations = [
    card("a", "incoming"),
    card("b", "incoming"),
    card("c", "incoming"),
    card("d", "enroute"),
  ]

  const setOperations = vi.fn()
  const updateOperation = vi.fn()
  const reorderColumn = vi.fn()
  const onOperationDrop = vi.fn()
  const onStatusChange = vi.fn()

  // No edge attached: `extractClosestEdge` reads a Symbol key the hitbox owns,
  // and none of these cases needs one — the wobble is caught before the edge is
  // consulted, and the moves below are unambiguous without it.
  const drop = (sourceId: string, sourceIndex: number, targetId: string, targetIndex: number) =>
    applyOperationDrop(
      {
        type: "operation",
        operation: operations.find(op => op.id === sourceId),
        index: sourceIndex,
      },
      { type: "operation-drop", operationId: targetId, index: targetIndex },
      { operations, setOperations, updateOperation, reorderColumn, onOperationDrop, onStatusChange },
    )

  beforeEach(() => {
    setOperations.mockClear()
    updateOperation.mockClear()
    reorderColumn.mockClear()
    onOperationDrop.mockClear()
    onStatusChange.mockClear()
  })

  it("treats a card dropped on itself as the click it was — no write", () => {
    drop("a", 0, "a", 0)
    expect(reorderColumn).not.toHaveBeenCalled()
    expect(setOperations).not.toHaveBeenCalled()
    expect(onOperationDrop).toHaveBeenCalledWith("a")
  })

  it("writes nothing when the drop lands the card back in its own slot", () => {
    // Card "a" onto the top edge of its immediate neighbour "b": same order.
    drop("a", 0, "b", 1)
    expect(reorderColumn).not.toHaveBeenCalled()
    expect(setOperations).not.toHaveBeenCalled()
  })

  it("still persists a real reorder", () => {
    drop("a", 0, "c", 2)
    expect(reorderColumn).toHaveBeenCalledWith(["b", "a", "c"])
    expect(setOperations).toHaveBeenCalled()
  })

  it("still moves a card across columns", () => {
    drop("a", 0, "d", 0)
    expect(updateOperation).toHaveBeenCalledWith("a", { status: "enroute" })
    expect(reorderColumn).toHaveBeenCalledWith(["a", "d"])
    expect(onStatusChange).toHaveBeenCalledWith("a", "enroute", "incoming")
  })
})
