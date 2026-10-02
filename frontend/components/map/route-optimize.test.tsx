/**
 * The shared optimise action: save, name the start used, and an undo that the
 * SERVER guards (restoreGroupStops → "conflict" on 409). One action for all three
 * entry points, so this covers the modal, the /map panel and the Aufträge sheet.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import de from "@/messages/de.json"
import type { RouteStart } from "@/lib/route-start"

const restoreGroupStops = vi.hoisted(() => vi.fn())
vi.mock("@/lib/contexts/groups-context", () => ({ useGroups: () => ({ restoreGroupStops }) }))

type ToastOpts = { description?: string; action?: { label: string; onClick: () => void } }
const toasts = vi.hoisted(() => ({ calls: [] as { kind: string; message: string; opts?: ToastOpts }[] }))
vi.mock("sonner", () => {
  const record = (kind: string) => (message: string, opts?: ToastOpts) => toasts.calls.push({ kind, message, opts })
  return { toast: { success: record("success"), error: record("error"), info: record("info") } }
})

import { useRouteOptimizeAction } from "./route-optimize"

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
    {children}
  </NextIntlClientProvider>
)

const fallbackStart: RouteStart = { mode: "magazin", requested: "magazin", coords: [0, 0], source: "unset" }

function setup(stopIds = ["a", "b", "c"]) {
  const planning = {
    group: { id: "g1", stopIds } as never,
    anchors: { magazin: { coords: [0, 0] as [number, number], source: "unset" as const }, vehicle: null, firstStop: null },
    optimizeFrom: vi.fn(() => ({ ids: ["c", "a", "b"], start: fallbackStart })),
    reorder: vi.fn(async () => true),
  }
  const hook = renderHook(() => useRouteOptimizeAction(planning), { wrapper })
  return { planning, hook }
}

beforeEach(() => {
  toasts.calls = []
  restoreGroupStops.mockReset()
})

describe("useRouteOptimizeAction", () => {
  it("saves at once and names the basis and the fallback start in the toast", async () => {
    const { planning, hook } = setup()
    await act(async () => { await hook.result.current.runOptimize("magazin") })

    expect(planning.reorder).toHaveBeenCalledWith(["c", "a", "b"])
    const toast = toasts.calls.at(-1)!
    expect(toast.message).toBe("Reihenfolge nach Luftlinie vorgeschlagen")
    expect(toast.opts?.description).toBe(
      "Start: Magazin · Ersatzstandort – Magazin nicht eingerichtet · Planungshilfe, keine Strassenroute",
    )
    // The note under the list holds while the route has the produced order …
    planning.group = { id: "g1", stopIds: ["c", "a", "b"] } as never
    hook.rerender()
    expect(hook.result.current.lastRun?.start).toEqual(fallbackStart)
    // … and is history as soon as anybody changes it.
    planning.group = { id: "g1", stopIds: ["a", "c", "b"] } as never
    hook.rerender()
    expect(hook.result.current.lastRun).toBeNull()
  })

  it("lists the start anchors with their provenance before anything runs", () => {
    const { hook } = setup()
    expect(hook.result.current.startOptions.map((o) => [o.value, o.detail, !!o.caution, !!o.disabled])).toEqual([
      ["magazin", "Ersatzstandort – Magazin nicht eingerichtet", true, false],
      ["vehicle", "Kein Fahrzeug mit GPS auf diesem Auftrag", false, true],
      ["first", "Kein Stopp mit Koordinaten", false, true],
    ])
  })

  it("undo restores conditionally on the order the optimisation produced", async () => {
    restoreGroupStops.mockResolvedValue("restored")
    const { hook } = setup()
    await act(async () => { await hook.result.current.runOptimize("magazin") })
    const undo = toasts.calls.at(-1)!.opts!.action!

    await act(async () => { undo.onClick() })
    expect(restoreGroupStops).toHaveBeenCalledWith("g1", ["a", "b", "c"], ["c", "a", "b"])
    expect(toasts.calls.at(-1)).toMatchObject({ kind: "success", message: "Vorherige Reihenfolge wiederhergestellt" })
  })

  it("a stale undo is refused with «Nicht mehr rückgängig machbar – Auftrag geändert»", async () => {
    restoreGroupStops.mockResolvedValue("conflict")
    const { hook } = setup()
    await act(async () => { await hook.result.current.runOptimize("magazin") })
    await act(async () => { toasts.calls.at(-1)!.opts!.action!.onClick() })

    expect(toasts.calls.at(-1)).toMatchObject({
      kind: "error",
      message: "Nicht mehr rückgängig machbar – Auftrag geändert",
    })
  })

  it("a second click on the same undo does nothing", async () => {
    restoreGroupStops.mockResolvedValue("restored")
    const { hook } = setup()
    await act(async () => { await hook.result.current.runOptimize("magazin") })
    const undo = toasts.calls.at(-1)!.opts!.action!
    await act(async () => { undo.onClick(); undo.onClick() })
    expect(restoreGroupStops).toHaveBeenCalledTimes(1)
  })

  it("says so when the order is already the shortest, without saving", async () => {
    const { planning, hook } = setup(["c", "a", "b"])
    await act(async () => { await hook.result.current.runOptimize("magazin") })
    expect(planning.reorder).not.toHaveBeenCalled()
    expect(toasts.calls.at(-1)).toMatchObject({ kind: "info" })
  })
})
