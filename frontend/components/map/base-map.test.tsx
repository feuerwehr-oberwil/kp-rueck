/**
 * The two decisions `<BaseMap>` makes without a GL context, tested without one.
 *
 * `baseLayerMoves` is the layer-order guard across a style swap – the auto→offline fallback is the
 * one moment react-map-gl re-appends the surfaces' sources, and getting it wrong buries the
 * assignment lines under the basemap on a station whose uplink just died. `reportMapError` is the
 * cap that keeps a viewport full of failing tiles from filling the station's server log.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"

import { baseLayerMoves, reportMapError, type OrderedLayer } from "./base-map"

const reportClientError = vi.hoisted(() => vi.fn())
vi.mock("@/lib/report-error", () => ({ reportClientError }))

const base = (id: string): OrderedLayer => ({ id, isBase: true })
const overlay = (id: string): OrderedLayer => ({ id, isBase: false })

describe("baseLayerMoves", () => {
  it("asks for nothing while the basemap is already at the bottom", () => {
    expect(
      baseLayerMoves([base("kp-basemap-tiles"), overlay("assignment-lines-line"), overlay("group-routes-line")]),
    ).toEqual([])
  })

  it("moves a basemap that re-appended above the overlays back underneath them", () => {
    const moves = baseLayerMoves([
      overlay("assignment-lines-line"),
      overlay("vehicle-trails-line"),
      base("kp-basemap-tiles"),
    ])

    expect(moves).toEqual([{ id: "kp-basemap-tiles", beforeId: "assignment-lines-line" }])
  })

  it("moves every drifted base layer and keeps their order among themselves", () => {
    // What the offline vector style looks like when it lands after the overlays are already up.
    const moves = baseLayerMoves([
      overlay("assignment-lines-line"),
      base("background"),
      base("water"),
      base("road"),
    ])

    expect(moves).toEqual([
      { id: "background", beforeId: "assignment-lines-line" },
      { id: "water", beforeId: "assignment-lines-line" },
      { id: "road", beforeId: "assignment-lines-line" },
    ])
  })

  it("leaves the base layers below the FIRST overlay alone", () => {
    const moves = baseLayerMoves([
      base("background"),
      base("water"),
      overlay("assignment-lines-line"),
      base("kp-basemap-tiles"),
    ])

    expect(moves).toEqual([{ id: "kp-basemap-tiles", beforeId: "assignment-lines-line" }])
  })

  it("asks for nothing when there is no overlay, and nothing when there is no basemap", () => {
    expect(baseLayerMoves([base("background"), base("water")])).toEqual([])
    expect(baseLayerMoves([overlay("assignment-lines-line")])).toEqual([])
    expect(baseLayerMoves([])).toEqual([])
  })
})

describe("reportMapError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    reportClientError.mockClear()
  })

  it("reports a distinct failure once, however often the tiles repeat it", () => {
    const seen = new Set<string>()
    const tileError = new Error("Failed to fetch tile")

    expect(reportMapError(tileError, seen, 3)).toBe(true)
    expect(reportMapError(new Error("Failed to fetch tile"), seen, 3)).toBe(false)
    expect(reportClientError).toHaveBeenCalledTimes(1)
  })

  it("stops reporting past the cap but never stops logging", () => {
    const seen = new Set<string>()
    for (const message of ["one", "two", "three", "four", "five"]) {
      reportMapError(new Error(message), seen, 3)
    }

    expect(reportClientError).toHaveBeenCalledTimes(3)
    expect(console.error).toHaveBeenCalledTimes(5)
  })
})
