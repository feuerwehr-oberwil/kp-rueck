import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { Operation } from "@/lib/contexts/operations-context"
import { useClosedStopGuard } from "./use-closed-stop-guard"

// The guard only ever reads id + status + the address it names in the prompt.
const op = (id: string, status: Operation["status"], location = "Poststrasse 6") =>
  ({ id, status, location, locationDisplay: location, incidentType: "brand" }) as unknown as Operation

describe("useClosedStopGuard", () => {
  it("lets an open incident through without asking", () => {
    const run = vi.fn()
    const { result } = renderHook(() => useClosedStopGuard([op("a", "incoming")]))
    act(() => result.current.guard(["a"], run))
    expect(run).toHaveBeenCalledTimes(1)
    expect(result.current.prompt).toBeNull()
  })

  it("holds a closed incident back and names it", () => {
    const run = vi.fn()
    const { result } = renderHook(() => useClosedStopGuard([op("a", "complete", "Schulstrasse 9")]))
    act(() => result.current.guard(["a"], run))
    expect(run).not.toHaveBeenCalled()
    expect(result.current.prompt?.closed.map((o) => o.id)).toEqual(["a"])
  })

  it("warns, it does not forbid — confirming runs the action", () => {
    const run = vi.fn()
    const { result } = renderHook(() => useClosedStopGuard([op("a", "complete")]))
    act(() => result.current.guard(["a"], run))
    act(() => result.current.proceed())
    expect(run).toHaveBeenCalledTimes(1)
    expect(result.current.prompt).toBeNull()
  })

  it("cancelling drops the action entirely", () => {
    const run = vi.fn()
    const { result } = renderHook(() => useClosedStopGuard([op("a", "complete")]))
    act(() => result.current.guard(["a"], run))
    act(() => result.current.dismiss())
    expect(run).not.toHaveBeenCalled()
    expect(result.current.prompt).toBeNull()
  })

  it("asks once for a mixed selection and then adds all of them", () => {
    const run = vi.fn()
    const { result } = renderHook(() =>
      useClosedStopGuard([op("a", "incoming"), op("b", "complete"), op("c", "complete")]),
    )
    act(() => result.current.guard(["a", "b", "c"], run))
    expect(result.current.prompt?.closed.map((o) => o.id)).toEqual(["b", "c"])
    expect(result.current.prompt?.total).toBe(3)
    act(() => result.current.proceed())
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("treats «beendet / Rückfahrt» as still running — only ABGESCHLOSSEN counts", () => {
    const run = vi.fn()
    const { result } = renderHook(() => useClosedStopGuard([op("a", "returning")]))
    act(() => result.current.guard(["a"], run))
    expect(run).toHaveBeenCalledTimes(1)
  })
})
