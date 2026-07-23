import { describe, it, expect } from "vitest"
import { groupAssignedMaterials } from "./material-grouping"
import type { Material, MaterialGroup } from "@/lib/contexts/materials-context"

function mat(id: string, groupId: string | null = null): Material {
  return {
    id,
    name: `Material ${id}`,
    category: "Depot",
    type: "type",
    status: "assigned",
    categorySortOrder: 0,
    consumable: false,
    groupId,
  }
}

function group(id: string, materialIds: string[]): MaterialGroup {
  return { id, name: `Group ${id}`, description: null, location: "Depot", materialIds }
}

describe("groupAssignedMaterials", () => {
  it("returns loose materials as ungrouped", () => {
    const materials = [mat("a"), mat("b")]
    const result = groupAssignedMaterials(["a", "b"], materials, [])
    expect(result.completeGroups).toEqual([])
    expect(result.ungrouped).toEqual(["a", "b"])
  })

  it("collapses a fully-assigned group into a single group chip", () => {
    const materials = [mat("a", "g1"), mat("b", "g1")]
    const groups = [group("g1", ["a", "b"])]
    const result = groupAssignedMaterials(["a", "b"], materials, groups)
    expect(result.completeGroups).toHaveLength(1)
    expect(result.completeGroups[0].group.id).toBe("g1")
    expect(result.completeGroups[0].materialIds).toEqual(["a", "b"])
    expect(result.ungrouped).toEqual([])
  })

  it("degrades a partially-assigned group to individual chips", () => {
    const materials = [mat("a", "g1"), mat("b", "g1")]
    const groups = [group("g1", ["a", "b"])]
    const result = groupAssignedMaterials(["a"], materials, groups)
    expect(result.completeGroups).toEqual([])
    expect(result.ungrouped).toEqual(["a"])
  })

  it("mixes a complete group with loose materials", () => {
    const materials = [mat("a", "g1"), mat("b", "g1"), mat("c")]
    const groups = [group("g1", ["a", "b"])]
    const result = groupAssignedMaterials(["a", "b", "c"], materials, groups)
    expect(result.completeGroups).toHaveLength(1)
    expect(result.ungrouped).toEqual(["c"])
  })
})
