import { describe, expect, it } from "vitest"

import { apiCoordinatesToTuple, coordinatesToApiFields } from "./coordinate-parser"

describe("incident coordinate conversion", () => {
  it("preserves located incidents", () => {
    expect(apiCoordinatesToTuple("47.5164", "7.5618")).toEqual([47.5164, 7.5618])
    expect(coordinatesToApiFields([47.5164, 7.5618])).toEqual({
      location_lat: "47.5164",
      location_lng: "7.5618",
    })
  })

  it("keeps missing or cleared coordinates nullable", () => {
    expect(apiCoordinatesToTuple(null, null)).toBeNull()
    expect(apiCoordinatesToTuple("47.5164", null)).toBeNull()
    expect(coordinatesToApiFields(null)).toEqual({
      location_lat: null,
      location_lng: null,
    })
    expect(coordinatesToApiFields(undefined)).toEqual({
      location_lat: null,
      location_lng: null,
    })
  })
})
