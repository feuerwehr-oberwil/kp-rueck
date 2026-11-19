import { describe, expect, it } from "vitest"
import { ANT_DASH, ANT_PERIOD, dashAtPhase } from "./assignment-lines"

/** Where the dashes of a `line-dasharray` start along the line, within one period. */
function dashStarts(pattern: number[]): number[] {
  const starts: number[] = []
  let at = 0
  pattern.forEach((length, i) => {
    if (i % 2 === 0 && length > 0) starts.push(at)
    at += length
  })
  return starts
}

describe("the marching ants on an assignment line", () => {
  it("keep one period and one dash length at every phase", () => {
    for (const phase of [0, 0.5, ANT_DASH, ANT_DASH + 1, ANT_PERIOD - 0.1]) {
      const pattern = dashAtPhase(phase)
      expect(pattern.reduce((sum, length) => sum + length, 0)).toBeCloseTo(ANT_PERIOD)
      expect(pattern[0] + pattern[2]).toBeCloseTo(ANT_DASH)
    }
  })

  it("march from the vehicle (the line's start) towards the target", () => {
    // A dash that started at 0 has moved `phase` further along the line.
    expect(dashStarts(dashAtPhase(0))).toEqual([0])
    const whole = dashStarts(dashAtPhase(1)).filter((start) => start > 0)
    expect(whole).toHaveLength(1)
    expect(whole[0]).toBeCloseTo(1)
  })
})
