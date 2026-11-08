import { describe, expect, it } from "vitest"
import { statusGroupCaption } from "@/components/map-legend"
import de from "@/messages/de.json"
import fr from "@/messages/fr.json"

describe("statusGroupCaption", () => {
  it("drops a caption that only repeats the group's name, in every catalogue", () => {
    for (const { map } of [de, fr]) {
      expect(statusGroupCaption(map.legend.statusCompleted, map.statusGroups.completedMembers)).toBeNull()
      expect(statusGroupCaption(map.statusGroups.completed, map.statusGroups.completedMembers)).toBeNull()
    }
  })

  it("keeps a caption that names columns the group's name does not", () => {
    expect(statusGroupCaption(de.map.legend.statusActive, de.map.statusGroups.activeMembers)).toBe(
      de.map.statusGroups.activeMembers,
    )
  })
})
