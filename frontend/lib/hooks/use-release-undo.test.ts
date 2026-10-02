/**
 * «<Ressource> von <Einsatz> gelöst · Rückgängig»: the undo re-assigns through the
 * ordinary assign function, reading the board as it is when the undo is clicked —
 * and keeps a newer assignment made meanwhile instead of overriding it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

const board = vi.hoisted(() => ({
  operations: [] as unknown[],
  personnel: [{ id: "p1", name: "Meier", role: "", status: "assigned" }],
  materials: [] as unknown[],
  vehicles: [] as unknown[],
  outOfServiceVehicleIds: new Set<string>(),
  removeCrew: vi.fn(async () => true),
  removeMaterial: vi.fn(async () => true),
  removeVehicle: vi.fn(async () => true),
  assignPersonToOperation: vi.fn(async () => true),
  assignMaterialToOperation: vi.fn(async () => true),
  assignVehicleToOperation: vi.fn(async () => true),
}))
const routes = vi.hoisted(() => ({
  groups: [] as unknown[],
  removeStop: vi.fn(async () => true),
  addStops: vi.fn(async () => true),
  restoreGroupStops: vi.fn(async () => "restored"),
  unassignResource: vi.fn(async () => true),
  assignResource: vi.fn(async () => true),
  getGroupResources: () => ({ vehicles: [], personnel: [], materials: [] }),
}))
vi.mock("@/lib/contexts/operations-context", () => ({ useOperations: () => board }))
vi.mock("@/lib/contexts/groups-context", () => ({ useGroups: () => routes }))

type ToastOpts = { description?: string; action?: { label: string; onClick: () => void } }
const toasts = vi.hoisted(() => ({ calls: [] as { kind: string; message: string; opts?: ToastOpts }[] }))
vi.mock("sonner", () => {
  const record = (kind: string) => (message: string, opts?: ToastOpts) => toasts.calls.push({ kind, message, opts })
  return { toast: Object.assign(record("default"), { success: record("success"), error: record("error"), info: record("info") }) }
})

import { useReleaseUndo } from "./use-release-undo"

const incident = (id: string, location: string, crew: string[]) => ({
  id,
  location,
  locationDisplay: location,
  incidentType: "elementarereignis",
  status: "active",
  crew,
  vehicles: [],
  materials: [],
  groupId: null,
})

beforeEach(() => {
  vi.useFakeTimers()
  toasts.calls = []
  board.operations = [incident("e1", "Hauptstrasse 5", ["Meier"]), incident("e2", "Bahnhofstrasse 3", [])]
  board.assignPersonToOperation.mockClear()
  board.removeCrew.mockClear()
})
afterEach(() => vi.useRealTimers())

async function releaseMeier() {
  const hook = renderHook(() => useReleaseUndo())
  await act(async () => { await hook.result.current.releaseCrew("e1", "Meier") })
  await act(async () => { vi.advanceTimersByTime(200) })
  return hook
}

describe("useReleaseUndo", () => {
  it("names resource and Einsatz, and the undo re-assigns exactly that person once", async () => {
    const hook = await releaseMeier()
    expect(board.removeCrew).toHaveBeenCalledWith("e1", "Meier")
    const offer = toasts.calls.at(-1)!
    expect(offer.message).toBe("Meier von Hauptstrasse 5 gelöst")
    expect(offer.opts?.action?.label).toBe("Rückgängig")

    // The board as it is now: Meier is off the incident.
    board.operations = [incident("e1", "Hauptstrasse 5", []), incident("e2", "Bahnhofstrasse 3", [])]
    hook.rerender()
    await act(async () => {
      offer.opts!.action!.onClick()
      offer.opts!.action!.onClick()
    })

    expect(board.assignPersonToOperation).toHaveBeenCalledTimes(1)
    expect(board.assignPersonToOperation).toHaveBeenCalledWith("p1", "Meier", "e1")
    expect(toasts.calls.at(-1)).toMatchObject({ kind: "success", message: "Meier wieder bei Hauptstrasse 5" })
  })

  it("keeps a newer assignment from another device and says where the person is", async () => {
    const hook = await releaseMeier()
    const offer = toasts.calls.at(-1)!

    board.operations = [incident("e1", "Hauptstrasse 5", []), incident("e2", "Bahnhofstrasse 3", ["Meier"])]
    hook.rerender()
    await act(async () => { offer.opts!.action!.onClick() })

    expect(board.assignPersonToOperation).not.toHaveBeenCalled()
    expect(toasts.calls.at(-1)).toMatchObject({
      kind: "error",
      message: "Meier konnte nicht zurückgeholt werden",
      opts: { description: "Inzwischen bei Bahnhofstrasse 3 eingeteilt – diese neuere Zuweisung bleibt." },
    })
  })

  it("offers nothing when the release itself failed", async () => {
    board.removeCrew.mockResolvedValueOnce(false)
    await releaseMeier()
    expect(toasts.calls).toHaveLength(0)
  })
})
