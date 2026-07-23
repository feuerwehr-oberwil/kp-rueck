import type { Material, MaterialGroup } from "@/lib/contexts/materials-context"

/**
 * Collapse a list of assigned material ids into complete groups + loose items.
 *
 * A material group renders as a single chip only when *every* material in the
 * group is assigned to the operation; a partially-assigned group degrades to
 * its individual materials. This logic was copy-pasted verbatim between the
 * operation detail panel and the kanban card — extracted here so the two can
 * never drift and so it can be unit-tested in isolation.
 */
export interface GroupedMaterials {
  /** Fully-assigned groups, in first-seen order, each with its member ids. */
  completeGroups: Array<{ group: MaterialGroup; materialIds: string[] }>
  /** Material ids shown as individual chips (no group, or partial group). */
  ungrouped: string[]
}

export function groupAssignedMaterials(
  assignedIds: string[],
  materials: Material[],
  groups: MaterialGroup[],
): GroupedMaterials {
  const ungrouped: string[] = []
  const grouped: Record<string, string[]> = {}

  for (const materialId of assignedIds) {
    const material = materials.find((m) => m.id === materialId)
    const groupId = material?.groupId
    const group = groupId ? groups.find((g) => g.id === groupId) : null
    if (group) {
      if (!grouped[group.id]) grouped[group.id] = []
      grouped[group.id].push(materialId)
    } else {
      ungrouped.push(materialId)
    }
  }

  // Only surface a group when ALL of its materials are assigned; otherwise the
  // partial members fall back to individual chips.
  const completeGroups: Array<{ group: MaterialGroup; materialIds: string[] }> = []
  for (const [groupId, matIds] of Object.entries(grouped)) {
    const group = groups.find((g) => g.id === groupId)
    if (group && matIds.length === group.materialIds.length) {
      completeGroups.push({ group, materialIds: matIds })
    } else {
      ungrouped.push(...matIds)
    }
  }

  return { completeGroups, ungrouped }
}
