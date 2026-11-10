import { describe, expect, it } from "vitest"
import { moveInList } from "./move-in-list"

describe("moveInList", () => {
  const list = ["a", "b", "c"]

  it("moves one place up, one place down, or to the start", () => {
    expect(moveInList(list, 1, "up")).toEqual(["b", "a", "c"])
    expect(moveInList(list, 1, "down")).toEqual(["a", "c", "b"])
    expect(moveInList(list, 2, "top")).toEqual(["c", "a", "b"])
  })

  it("answers null when nothing would change, so no write goes out", () => {
    expect(moveInList(list, 0, "up")).toBeNull()
    expect(moveInList(list, 0, "top")).toBeNull()
    expect(moveInList(list, 2, "down")).toBeNull()
    expect(moveInList(list, 7, "up")).toBeNull()
  })

  it("leaves the given list alone", () => {
    moveInList(list, 0, "down")
    expect(list).toEqual(["a", "b", "c"])
  })
})
