import { describe, expect, it, vi, afterEach } from "vitest"
import { getDurationBetween, getTimeSince } from "./kanban-utils"

// The board carries TWO clocks and they must not be confused:
//  · getTimeSince   — «wie lange steht das schon in diesem Status». The nag. Keeps growing.
//  · getDurationBetween — how long the incident RAN. Stops at Abschluss.
// A closed Einsatz that ran 58 minutes used to read «1h 12'» that afternoon and «19h 40'» the
// next morning, which made every Rückblick useless.

const T = (iso: string) => new Date(iso)

afterEach(() => vi.useRealTimers())

describe("getDurationBetween", () => {
  it("stops at the end instant instead of running to now", () => {
    vi.useFakeTimers()
    vi.setSystemTime(T("2026-07-27T19:00:00Z")) // hours after the incident closed
    expect(getDurationBetween(T("2026-07-27T12:08:00Z"), T("2026-07-27T13:06:00Z"))).toBe("58'")
  })

  it("keeps counting while the incident is still running", () => {
    vi.useFakeTimers()
    vi.setSystemTime(T("2026-07-27T13:06:00Z"))
    expect(getDurationBetween(T("2026-07-27T12:08:00Z"), null)).toBe("58'")
    expect(getDurationBetween(T("2026-07-27T12:08:00Z"), undefined)).toBe("58'")
  })

  it("formats past the hour the same way the live clock does", () => {
    expect(getDurationBetween(T("2026-07-27T12:08:00Z"), T("2026-07-27T13:20:00Z"))).toBe("1h 12'")
    expect(getDurationBetween(T("2026-07-27T12:08:00Z"), T("2026-07-27T13:08:00Z"))).toBe("1h 0'")
  })

  it("clamps a reversed pair to zero rather than showing a negative duration", () => {
    // clock skew between the two stamps, or a completed_at written before the alarm time
    expect(getDurationBetween(T("2026-07-27T13:00:00Z"), T("2026-07-27T12:00:00Z"))).toBe("0'")
  })

  it("a frozen duration no longer moves when time passes", () => {
    vi.useFakeTimers()
    vi.setSystemTime(T("2026-07-27T13:10:00Z"))
    const from = T("2026-07-27T12:08:00Z")
    const until = T("2026-07-27T13:06:00Z")
    const first = getDurationBetween(from, until)
    vi.setSystemTime(T("2026-07-28T08:00:00Z"))
    expect(getDurationBetween(from, until)).toBe(first)
    // …while the status nag does move on, which is exactly what it is for
    expect(getTimeSince(from)).not.toBe(first)
  })
})
