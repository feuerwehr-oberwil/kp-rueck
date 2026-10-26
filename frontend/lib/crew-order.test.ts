import { describe, it, expect } from "vitest"
import { sortCrewByLeader } from "./crew-order"

describe("sortCrewByLeader — leaderId shape", () => {
  const m = (personnelId: string, name = personnelId) => ({ personnelId, assignmentId: `a-${personnelId}`, name })
  const ids = (crew: readonly { personnelId: string }[]) => crew.map((c) => c.personnelId)

  it("moves the Einsatzleiter to the front", () => {
    expect(ids(sortCrewByLeader([m("hans"), m("anna"), m("urs")], "anna"))).toEqual(["anna", "hans", "urs"])
  })

  it("leaves the order untouched when no EL is recorded", () => {
    const crew = [m("hans"), m("anna"), m("urs")]
    expect(sortCrewByLeader(crew, null)).toEqual(crew)
    expect(sortCrewByLeader(crew, undefined)).toEqual(crew)
    expect(sortCrewByLeader(crew, "")).toEqual(crew)
  })

  it("leaves the order untouched when the EL is already first", () => {
    const crew = [m("hans"), m("anna"), m("urs")]
    expect(sortCrewByLeader(crew, "hans")).toEqual(crew)
  })

  it("ignores a leaderId that is not on this incident's crew", () => {
    const crew = [m("hans"), m("anna")]
    expect(sortCrewByLeader(crew, "fritz")).toEqual(crew)
  })

  it("keeps everyone else in their original relative order", () => {
    const crew = ["zulu", "alpha", "mike", "bravo", "echo"].map((id) => m(id))
    expect(ids(sortCrewByLeader(crew, "bravo"))).toEqual(["bravo", "zulu", "alpha", "mike", "echo"])
  })

  it("moves only the leader when two crew members share a name", () => {
    const crew = [m("p1", "Meier Alex"), m("p2", "Meier Alex")]
    expect(ids(sortCrewByLeader(crew, "p2"))).toEqual(["p2", "p1"])
  })

  it("returns a new array and never mutates the input", () => {
    const crew = [m("hans"), m("anna")]
    const sorted = sortCrewByLeader(crew, "anna")
    expect(sorted).not.toBe(crew)
    expect(ids(crew)).toEqual(["hans", "anna"])
  })

  it("handles the empty crew", () => {
    expect(sortCrewByLeader([], "anna")).toEqual([])
  })
})

describe("sortCrewByLeader — accessor shape", () => {
  type Member = { name: string; is_leader: boolean }
  const member = (name: string, is_leader = false): Member => ({ name, is_leader })

  it("moves the flagged member to the front (is_leader)", () => {
    const crew = [member("Muster Hans"), member("Meier Anna", true), member("Keller Urs")]
    expect(sortCrewByLeader(crew, (p) => p.is_leader).map((p) => p.name)).toEqual([
      "Meier Anna",
      "Muster Hans",
      "Keller Urs",
    ])
  })

  it("moves the flagged member to the front (isLeader, optional boolean)", () => {
    const crew = [
      { name: "Muster Hans", isLeader: false as boolean | undefined },
      { name: "Meier Anna", isLeader: undefined as boolean | undefined },
      { name: "Keller Urs", isLeader: true as boolean | undefined },
    ]
    expect(sortCrewByLeader(crew, (p) => Boolean(p.isLeader)).map((p) => p.name)).toEqual([
      "Keller Urs",
      "Muster Hans",
      "Meier Anna",
    ])
  })

  it("leaves the order untouched when nobody is flagged", () => {
    const crew = [member("Muster Hans"), member("Meier Anna"), member("Keller Urs")]
    expect(sortCrewByLeader(crew, (p) => p.is_leader)).toEqual(crew)
  })

  it("leaves the order untouched when the EL is already first", () => {
    const crew = [member("Muster Hans", true), member("Meier Anna"), member("Keller Urs")]
    expect(sortCrewByLeader(crew, (p) => p.is_leader)).toEqual(crew)
  })

  it("keeps everyone else in their original relative order", () => {
    const crew = [member("Zulu"), member("Alpha"), member("Mike"), member("Bravo", true), member("Echo")]
    expect(sortCrewByLeader(crew, (p) => p.is_leader).map((p) => p.name)).toEqual([
      "Bravo",
      "Zulu",
      "Alpha",
      "Mike",
      "Echo",
    ])
  })

  it("sorts a mixed participants list (personnel/vehicle/material) without disturbing the rest", () => {
    // The participants history is one incident's whole record, not just people;
    // only a person can carry is_leader, so the EL lands on row 1 and the
    // first_assigned_at order below it survives.
    const participants = [
      { name: "TLF 1", resource_type: "vehicle", is_leader: false },
      { name: "Muster Hans", resource_type: "personnel", is_leader: false },
      { name: "Meier Anna", resource_type: "personnel", is_leader: true },
      { name: "Tauchpumpe", resource_type: "material", is_leader: false },
    ]
    expect(sortCrewByLeader(participants, (p) => p.is_leader).map((p) => p.name)).toEqual([
      "Meier Anna",
      "TLF 1",
      "Muster Hans",
      "Tauchpumpe",
    ])
  })

  it("keeps two flagged members in input order (the constraint should prevent this, the sort must not care)", () => {
    const crew = [member("Muster Hans"), member("Meier Anna", true), member("Keller Urs", true)]
    expect(sortCrewByLeader(crew, (p) => p.is_leader).map((p) => p.name)).toEqual([
      "Meier Anna",
      "Keller Urs",
      "Muster Hans",
    ])
  })
})
