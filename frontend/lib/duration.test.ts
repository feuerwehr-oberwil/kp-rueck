import { describe, expect, it } from "vitest"
import { createTranslator } from "next-intl"
import de from "@/messages/de.json"
import fr from "@/messages/fr.json"
import { formatDuration, formatDurationLong, formatDurationSince, splitDuration } from "./duration"
import { getTimeSince } from "./kanban-utils"
import { formatPickupWaiting } from "./pickup"

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

describe("formatDuration (clock)", () => {
  it("keeps the Ereignis clock's notation below a day and switches to days above", () => {
    expect(formatDuration(12 * MIN, "clock")).toBe("12m")
    expect(formatDuration(H + 4 * MIN, "clock")).toBe("1h 04m")
    expect(formatDuration(D + 10 * H + 4 * MIN, "clock")).toBe("1d 10h")
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

describe("formatPickupWaiting", () => {
  it("switches to days at 24 hours", () => {
    const now = new Date("2026-10-02T12:00:00Z")
    expect(formatPickupWaiting(new Date(now.getTime() - (26 * H + 5 * MIN)), now)).toBe("1 d 2 h")
    expect(formatPickupWaiting(new Date(now.getTime() - 2 * D), now)).toBe("2 d")
    expect(formatPickupWaiting(new Date(now.getTime() - (H + 20 * MIN)), now)).toBe("1 h 20")
  })
})
