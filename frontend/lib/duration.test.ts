import { describe, expect, it } from "vitest"
import { createTranslator } from "next-intl"
import de from "@/messages/de.json"
import fr from "@/messages/fr.json"
import { formatAgo, formatAgoSince, formatDuration, formatDurationHours, formatDurationLong, formatDurationSince, splitDuration } from "./duration"
import { getTimeSince } from "./kanban-utils"

const MIN = 60_000
const H = 60 * MIN
const D = 24 * H

const tDe = createTranslator({ locale: "de", messages: de, namespace: "common.duration" })
const tFr = createTranslator({ locale: "fr", messages: fr, namespace: "common.duration" })

describe("splitDuration", () => {
  it("splits into days, hours within the day and minutes within the hour", () => {
    expect(splitDuration(D + 10 * H + 12 * MIN)).toEqual({ totalMinutes: 2052, days: 1, hours: 10, minutes: 12 })
  })

  it("clamps negative and non-finite spans to zero", () => {
    expect(splitDuration(-5 * MIN).totalMinutes).toBe(0)
    expect(splitDuration(Number.NaN).totalMinutes).toBe(0)
  })
})

describe("formatDuration (board)", () => {
  // The four lengths the review asked to read stably: 59 min, 2 h, 25 h, 3 days.
  it.each([
    [0, "0'"],
    [59 * MIN, "59'"],
    [2 * H, "2h 0'"],
    [2 * H + 5 * MIN, "2h 5'"],
    [23 * H + 59 * MIN, "23h 59'"],
    [24 * H, "1d 0h"],
    [25 * H, "1d 1h"],
    [34 * H + 12 * MIN, "1d 10h"],
    [3 * D + 9 * H + 40 * MIN, "3d 9h"],
  ])("%d ms → %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })

  it("is what getTimeSince renders on the cards", () => {
    const since = new Date(Date.now() - (34 * H + 12 * MIN))
    expect(getTimeSince(since)).toBe("1d 10h")
    expect(getTimeSince(new Date(Date.now() + 30_000))).toBe("0'")
  })

  it("formatDurationSince measures against an explicit now", () => {
    expect(formatDurationSince(new Date(0), 82 * H + 17 * MIN)).toBe("3d 10h")
  })
})

describe("formatAgo", () => {
  it.each([
    [0, "gerade eben"],
    [59_999, "gerade eben"],
    [-30_000, "gerade eben"],
    [MIN, "vor 1'"],
    [H + 23 * MIN, "vor 1h 23'"],
    [34 * H, "vor 1d 10h"],
  ])("%d ms → %s", (ms, expected) => {
    expect(formatAgo(ms, tDe)).toBe(expected)
  })

  it("speaks French around the same notation", () => {
    expect(formatAgo(12 * MIN, tFr)).toBe("il y a 12'")
    expect(formatAgo(0, tFr)).toBe("à l’instant")
  })

  it("formatAgoSince measures against an explicit now", () => {
    expect(formatAgoSince(new Date(0), tDe, 5 * MIN)).toBe("vor 5'")
  })
})

describe("formatDurationHours", () => {
  // The Reko's estimate arrives as decimal hours; the card used to print «2.5h».
  it.each([
    [2.5, "2h 30'"],
    [1.5, "1h 30'"],
    [0.5, "30'"],
    [1.33, "1h 20'"],
    [26, "1d 2h"],
  ])("%d h → %s", (hours, expected) => {
    expect(formatDurationHours(hours)).toBe(expected)
  })
})

describe("formatDurationLong", () => {
  it("spells the full duration for screen readers and tooltips (de)", () => {
    expect(formatDurationLong(34 * H + 12 * MIN, tDe)).toBe("1 Tag 10 Stunden")
    expect(formatDurationLong(2 * D, tDe)).toBe("2 Tage")
    expect(formatDurationLong(H + MIN, tDe)).toBe("1 Stunde 1 Minute")
    expect(formatDurationLong(3 * H, tDe)).toBe("3 Stunden")
    expect(formatDurationLong(59 * MIN, tDe)).toBe("59 Minuten")
  })

  it("uses the French plurals", () => {
    expect(formatDurationLong(D + 2 * H, tFr)).toBe("1 jour 2 heures")
  })
})
